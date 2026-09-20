import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import {
  API_ERRORS,
  genericServerErrorResponse,
  ownershipErrorResponse,
  serviceUnavailableResponse,
} from "@/app/lib/api/safe-errors";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";

async function buildClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* Route Handler context */
        }
      },
    },
  });

  const adminClient = serviceKey
    ? createAdminClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : sessionClient;

  return { sessionClient, adminClient };
}

/**
 * POST /api/remote-assessments
 * Clinician creates a tokenized remote assessment link.
 */
export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError ?? !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limited = checkClinicianWriteLimit(user.id, "remote-assessments:create");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  let body: {
    patientId?: string;
    assessmentType?: string;
    includedSections?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patientId = body.patientId?.trim();
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required." }, { status: 400 });
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) {
    return ownershipErrorResponse(ownership);
  }

  const token = crypto.randomUUID();
  const assessmentType = body.assessmentType?.trim() || "remote_questionnaire";
  const includedSections = Array.isArray(body.includedSections) ? body.includedSections : [];

  const { data: row, error: insertError } = await adminClient
    .from("remote_assessment_requests")
    .insert({
      token,
      patient_id: patientId,
      provider_id: user.id,
      assessment_type: assessmentType,
      included_sections: includedSections,
      status: "pending",
    })
    .select("token, expires_at")
    .single();

  if (insertError) {
    if (insertError.code === "42P01") {
      console.error("[POST /api/remote-assessments] remote_assessment_requests table missing");
      return genericServerErrorResponse();
    }
    console.error("[POST /api/remote-assessments] insert failed:", insertError.message);
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  return NextResponse.json({
    token: row.token,
    url: `/assessment/${row.token}`,
    expiresAt: row.expires_at,
  });
}

type RemoteAssessmentListRow = {
  token: string;
  patient_id: string;
  assessment_type: string;
  included_sections: unknown;
  status: string;
  expires_at: string;
  created_at: string;
  submitted_at: string | null;
  assessment_id: string | null;
};

/**
 * GET /api/remote-assessments?patientId=UUID
 * Clinician lists remote assessment links for a patient (newest first).
 */
export async function GET(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError ?? !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const patientId = new URL(req.url).searchParams.get("patientId")?.trim();
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required." }, { status: 400 });
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) {
    return ownershipErrorResponse(ownership);
  }

  const { data: rows, error: queryError } = await adminClient
    .from("remote_assessment_requests")
    .select(
      "token, patient_id, assessment_type, included_sections, status, expires_at, created_at, submitted_at, assessment_id",
    )
    .eq("patient_id", patientId)
    .eq("provider_id", user.id)
    .order("created_at", { ascending: false });

  if (queryError) {
    if (queryError.code === "42P01") {
      console.error("[GET /api/remote-assessments] remote_assessment_requests table missing");
      return genericServerErrorResponse();
    }
    console.error("[GET /api/remote-assessments] query failed:", queryError.message);
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  const result = (rows ?? []).map((row: RemoteAssessmentListRow) => ({
    token: row.token,
    patientId: row.patient_id,
    assessmentType: row.assessment_type,
    includedSections: Array.isArray(row.included_sections) ? row.included_sections : [],
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    assessmentId: row.assessment_id,
  }));

  return NextResponse.json(result);
}
