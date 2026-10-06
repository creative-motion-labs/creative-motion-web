import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "../../lib/validate-patient-ownership";
import type { AssessmentData } from "../../lib/assessment-types";
import { API_ERRORS, genericServerErrorResponse, ownershipErrorResponse, serviceUnavailableResponse } from "../../lib/api/safe-errors";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "../../lib/rate-limit";
import type { GeneralAssessmentDraft } from "../../lib/general-assessment/types";
import {
  buildGeneralMskPayload,
  type StoredAssessmentPayload,
} from "../../lib/assessment-payload";
import type { AssessmentsRow } from "../../lib/supabase/database.types";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AssessmentListRow = Pick<
  AssessmentsRow,
  "id" | "patient_id" | "provider_id" | "type" | "notes" | "status" | "created_at" | "updated_at"
>;

export type AssessmentRow = AssessmentListRow & {
  structured_data: StoredAssessmentPayload | null;
};

// ── Shared client factory ──────────────────────────────────────────────────────

async function buildClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Route Handler context */ }
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

function migrationPending(col: string) {
  console.error(
    `[POST/GET /api/assessments] assessments column missing (${col}) — apply migration 004`,
  );
  return genericServerErrorResponse();
}

// ── POST /api/assessments ──────────────────────────────────────────────────────

/**
 * Creates a new structured clinical assessment.
 *
 * Body:
 *   patient_id     string (UUID)  required
 *   data           AssessmentData  required when type is "structured" (default)
 *   draft          GeneralAssessmentDraft  required when type is "general_msk"
 *   type           string          optional, defaults to "structured"
 *   notes          string          optional
 *
 * Response 201: AssessmentRow
 * Response 400: { error }
 * Response 401: { error }
 * Response 404: { error } — patient not found or not owned
 * Response 500: { error } — DB error or migration not applied
 */
export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) return serviceUnavailableResponse();
  const { sessionClient, adminClient } = clients;

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const limited = checkClinicianWriteLimit(user.id, "assessments:create");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: {
    patient_id?: string;
    data?: AssessmentData;
    draft?: GeneralAssessmentDraft;
    type?: string;
    notes?: string;
    assessmentLanguage?: "en" | "ar";
  };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const patientId = body.patient_id?.trim();
  const assessmentType = body.type?.trim() || "structured";

  if (!patientId) return NextResponse.json({ error: "patient_id is required." }, { status: 400 });

  let structuredData: StoredAssessmentPayload;
  if (assessmentType === "general_msk") {
    if (!body.draft) {
      return NextResponse.json({ error: "draft (GeneralAssessmentDraft) is required for general_msk." }, { status: 400 });
    }
    const lang = body.assessmentLanguage === "ar" ? "ar" : body.assessmentLanguage === "en" ? "en" : undefined;
    structuredData = buildGeneralMskPayload(body.draft, lang);
  } else {
    if (!body.data) {
      return NextResponse.json({ error: "data (AssessmentData) is required." }, { status: 400 });
    }
    structuredData = body.data;
  }

  // ── Verify patient ownership ──────────────────────────────────────────────────
  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  // ── Insert ───────────────────────────────────────────────────────────────────
  const { data: assessment, error: insertError } = await adminClient
    .from("assessments")
    .insert({
      provider_id:     user.id,
      patient_id:      patientId,
      type:            assessmentType,
      structured_data: structuredData,
      notes:           body.notes?.trim() || null,
      status:          "completed",
      mode:            "in_clinic",   // existing NOT NULL column
      selected_tests:  [],            // existing NOT NULL column (array)
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "42703") return migrationPending("provider_id or structured_data");
    console.error("[POST /api/assessments] insert failed:", insertError.message);
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  return NextResponse.json(assessment as AssessmentRow, { status: 201 });
}

// ── GET /api/assessments?patientId=UUID ───────────────────────────────────────

/**
 * Returns all assessments for a patient, newest first.
 * Only returns assessments belonging to the requesting provider.
 *
 * Query params:
 *   patientId   string (UUID)  required
 *
 * Response 200: AssessmentListRow[]
 * Response 400: { error }
 * Response 401: { error }
 * Response 404: { error } — patient not found or not owned
 * Response 500: { error } — DB error or migration not applied
 */
export async function GET(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) return serviceUnavailableResponse();
  const { sessionClient, adminClient } = clients;

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  // ── Params ───────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId")?.trim();
  if (!patientId) return NextResponse.json({ error: "patientId query param is required." }, { status: 400 });

  // ── Verify patient ownership ──────────────────────────────────────────────────
  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  // ── Query ────────────────────────────────────────────────────────────────────
  const { data: assessments, error: queryError } = await adminClient
    .from("assessments")
    .select("id, patient_id, provider_id, type, notes, status, created_at, updated_at")
    .eq("patient_id", patientId)
    .eq("provider_id", user.id)
    .order("created_at", { ascending: false });

  if (queryError) {
    if (queryError.code === "42703") return migrationPending("provider_id or structured_data");
    console.error("[GET /api/assessments] query failed:", queryError.message);
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  return NextResponse.json((assessments ?? []) as AssessmentListRow[]);
}
