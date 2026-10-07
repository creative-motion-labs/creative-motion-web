/**
 * Shared clinician auth + assessment fetch for remote questionnaire workflow routes.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import {
  AI_ERROR_CODES,
  aiErrorHttpStatus,
  aiErrorMessage,
} from "@/app/lib/ai/ai-errors";

export type AssessmentWorkflowRow = {
  id: string;
  patient_id: string;
  provider_id: string;
  type: string;
  structured_data: Record<string, unknown> | null;
};

export async function buildAssessmentWorkflowClients() {
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

export function aiErrorJson(code: (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES]) {
  return NextResponse.json(
    { error: aiErrorMessage(code), code },
    { status: aiErrorHttpStatus(code) },
  );
}

export async function loadRemoteQuestionnaireAssessment(
  assessmentId: string,
): Promise<
  | { ok: true; assessment: AssessmentWorkflowRow; adminClient: SupabaseClient }
  | { ok: false; response: NextResponse }
> {
  const clients = await buildAssessmentWorkflowClients();
  if (!clients) {
    return { ok: false, response: aiErrorJson(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE) };
  }

  const { sessionClient, adminClient } = clients;
  const {
    data: { user },
    error: authErr,
  } = await sessionClient.auth.getUser();
  if (authErr ?? !user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: assessment, error: queryErr } = await adminClient
    .from("assessments")
    .select("id, patient_id, provider_id, type, structured_data")
    .eq("id", assessmentId)
    .eq("provider_id", user.id)
    .maybeSingle<AssessmentWorkflowRow>();

  if (queryErr) {
    return { ok: false, response: aiErrorJson(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE) };
  }
  if (!assessment || assessment.type !== "remote_questionnaire") {
    return { ok: false, response: aiErrorJson(AI_ERROR_CODES.AI_CONTEXT_INVALID) };
  }

  const ownership = await validatePatientOwnership(adminClient, assessment.patient_id, user.id);
  if (!ownership.ok) {
    return { ok: false, response: aiErrorJson(AI_ERROR_CODES.AI_CONTEXT_INVALID) };
  }

  return { ok: true, assessment, adminClient };
}

export async function saveAssessmentStructuredData(
  adminClient: SupabaseClient,
  assessmentId: string,
  providerId: string,
  structuredData: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const updatedAt = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("assessments")
    .update({ structured_data: structuredData, updated_at: updatedAt })
    .eq("id", assessmentId)
    .eq("provider_id", providerId);

  if (updateError) {
    return { ok: false, response: aiErrorJson(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE) };
  }
  return { ok: true };
}
