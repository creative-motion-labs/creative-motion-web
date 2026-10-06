import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership, type PatientRow } from "../../../lib/validate-patient-ownership";
import {
  buildGeneralMskPayload,
  extractGeneralDraft,
  getAssessmentLanguage,
  type AssessmentLanguage,
} from "../../../lib/assessment-payload";
import type { GeneralAssessmentDraft } from "../../../lib/general-assessment/types";
import type { StoredAssessmentPayload } from "../../../lib/assessment-payload";
import {
  ownershipErrorResponse,
  serviceUnavailableResponse,
} from "../../../lib/api/safe-errors";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "../../../lib/rate-limit";

export type AssessmentDetailResponse = {
  id: string;
  patient_id: string;
  provider_id: string;
  type: string;
  structured_data: StoredAssessmentPayload | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  patient: Pick<PatientRow, "id" | "full_name" | "diagnosis" | "age" | "gender" | "sport" | "status">;
};

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
          /* read-only */
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

type AssessmentDbRow = {
  id: string;
  patient_id: string;
  provider_id: string;
  type: string;
  structured_data: unknown;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

// ── GET /api/assessments/[id] ─────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: assessmentId } = await params;
  if (!assessmentId?.trim()) {
    return NextResponse.json({ error: "Assessment ID is required." }, { status: 400 });
  }

  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const { data: row, error: queryErr } = await adminClient
    .from("assessments")
    .select("id, patient_id, provider_id, type, structured_data, notes, status, created_at, updated_at")
    .eq("id", assessmentId)
    .eq("provider_id", user.id)
    .maybeSingle<AssessmentDbRow>();

  if (queryErr) {
    console.error("[GET /api/assessments/[id]] query failed:", queryErr.message);
    return NextResponse.json({ error: "Failed to load assessment." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  }

  const ownership = await validatePatientOwnership(adminClient, row.patient_id, user.id);
  if (!ownership.ok) {
    return ownershipErrorResponse(ownership);
  }

  const patient = ownership.patient;
  const response: AssessmentDetailResponse = {
    id: row.id,
    patient_id: row.patient_id,
    provider_id: row.provider_id,
    type: row.type,
    structured_data: row.structured_data as StoredAssessmentPayload | null,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    patient: {
      id: patient.id,
      full_name: patient.full_name,
      diagnosis: patient.diagnosis,
      age: patient.age,
      gender: patient.gender,
      sport: patient.sport,
      status: patient.status,
    },
  };

  return NextResponse.json(response);
}

// ── PATCH /api/assessments/[id] — general_msk draft updates (SOAP, etc.) ─────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: assessmentId } = await params;
  if (!assessmentId?.trim()) {
    return NextResponse.json({ error: "Assessment ID is required." }, { status: 400 });
  }

  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const limited = checkClinicianWriteLimit(user.id, "assessments:update");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  let body: {
    draft?: GeneralAssessmentDraft;
    notes?: string;
    fieldKey?: string;
    markTranslationReviewed?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.markTranslationReviewed && body.fieldKey?.trim()) {
    const fieldKey = body.fieldKey.trim();
    const { data: row, error: fetchErr } = await adminClient
      .from("assessments")
      .select("id, patient_id, provider_id, structured_data")
      .eq("id", assessmentId)
      .eq("provider_id", user.id)
      .maybeSingle<AssessmentDbRow>();

    if (fetchErr || !row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ownership = await validatePatientOwnership(adminClient, row.patient_id, user.id);
    if (!ownership.ok) {
      return ownershipErrorResponse(ownership);
    }

    const existing =
      typeof row.structured_data === "object" && row.structured_data !== null
        ? (row.structured_data as Record<string, unknown>)
        : {};

    const updatedData = {
      ...existing,
      [`${fieldKey}_en_reviewed`]: true,
    };

    const { error: updateErr } = await adminClient
      .from("assessments")
      .update({ structured_data: updatedData, updated_at: new Date().toISOString() })
      .eq("id", assessmentId)
      .eq("provider_id", user.id);

    if (updateErr) {
      console.error("[PATCH /api/assessments/[id]] translation review failed:", updateErr.message);
      return NextResponse.json({ error: "Failed to update assessment." }, { status: 500 });
    }

    return NextResponse.json({ reviewed: true });
  }

  const { data: row, error: fetchErr } = await adminClient
    .from("assessments")
    .select("id, patient_id, provider_id, type, structured_data, notes")
    .eq("id", assessmentId)
    .eq("provider_id", user.id)
    .maybeSingle<AssessmentDbRow>();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  }

  if (row.type !== "general_msk") {
    return NextResponse.json(
      { error: "Only general_msk assessments can be updated via this endpoint." },
      { status: 400 },
    );
  }

  const existing = extractGeneralDraft(row.structured_data, row.type);
  if (!existing) {
    return NextResponse.json({ error: "Invalid assessment payload." }, { status: 400 });
  }

  if (!body.draft) {
    return NextResponse.json({ error: "draft is required." }, { status: 400 });
  }

  const merged: GeneralAssessmentDraft = {
    ...existing,
    ...body.draft,
    soap: { ...existing.soap, ...body.draft.soap },
    subjective: { ...existing.subjective, ...body.draft.subjective },
    updatedAt: new Date().toISOString(),
  };

  const existingLang = getAssessmentLanguage(row.structured_data);
  const { data: updated, error: updateErr } = await adminClient
    .from("assessments")
    .update({
      structured_data: buildGeneralMskPayload(merged, existingLang ?? undefined),
      notes: body.notes?.trim() ?? row.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assessmentId)
    .eq("provider_id", user.id)
    .select("id, patient_id, provider_id, type, structured_data, notes, status, created_at, updated_at")
    .single<AssessmentDbRow>();

  if (updateErr) {
    console.error("[PATCH /api/assessments/[id]] update failed:", updateErr.message);
    return NextResponse.json({ error: "Failed to update assessment." }, { status: 500 });
  }

  const ownership = await validatePatientOwnership(adminClient, updated.patient_id, user.id);
  if (!ownership.ok) {
    return ownershipErrorResponse(ownership);
  }

  const response: AssessmentDetailResponse = {
    id: updated.id,
    patient_id: updated.patient_id,
    provider_id: updated.provider_id,
    type: updated.type,
    structured_data: updated.structured_data as StoredAssessmentPayload | null,
    notes: updated.notes,
    status: updated.status,
    created_at: updated.created_at,
    updated_at: updated.updated_at,
    patient: {
      id: ownership.patient.id,
      full_name: ownership.patient.full_name,
      diagnosis: ownership.patient.diagnosis,
      age: ownership.patient.age,
      gender: ownership.patient.gender,
      sport: ownership.patient.sport,
      status: ownership.patient.status,
    },
  };

  return NextResponse.json(response);
}
