import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRemoteAssessmentLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import {
  isRemoteAssessmentBodyTooLarge,
  validateRemoteAssessmentStructuredData,
} from "@/app/lib/remote-assessment-validation";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";
import { backfillTranscriptionSessionAssessmentId } from "@/app/lib/speech-ai/transcription-session-persistence";
import { batchTranslateRemoteQuestionnaire } from "@/app/lib/reports/batch-translate-remote-questionnaire";
import { getOpenAiKeyConfig } from "@/app/lib/openai/server-env";
import {
  isStrokeQuestionnaireData,
  STROKE_PATHWAY,
  STROKE_QUESTIONNAIRE_VERSION,
  validateStrokeIntakeProvenance,
  type StrokeQuestionnaireSubmission,
} from "@/app/lib/stroke-questionnaire/stroke-questionnaire-schema";
import { prepareStrokeSubmission } from "@/app/lib/stroke-questionnaire/stroke-pt-clinical-report";
import {
  buildStrokeBranchTrace,
  resolveStrokeSafetyState,
} from "@/app/lib/stroke-questionnaire/stroke-branch-engine";

let serviceRoleClientOverride: SupabaseClient | null = null;

/** Test-only hook for route tests — not used in production. */
export function __setServiceRoleClientForTests(client: SupabaseClient | null): void {
  serviceRoleClientOverride = client;
}

function adminClient() {
  if (serviceRoleClientOverride) return serviceRoleClientOverride;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type RequestRow = {
  id: string;
  patient_id: string;
  provider_id: string;
  status: string;
  assessment_id: string | null;
  submitted_at: string | null;
  assessment_type: string;
};

/**
 * POST /api/remote-assessments/[token]/submit
 * Patient submission — no auth, token only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const trimmed = token?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  const limited = checkRemoteAssessmentLimit(req, trimmed, "submit");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  if (isRemoteAssessmentBodyTooLarge(req.headers.get("content-length"))) {
    return NextResponse.json({ error: "Assessment data exceeds allowed size." }, { status: 413 });
  }

  const admin = adminClient();
  if (!admin) {
    return serviceUnavailableResponse();
  }

  let body: { structuredData?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateRemoteAssessmentStructuredData(body.structuredData);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { data: requestRow, error: fetchError } = await admin
    .from("remote_assessment_requests")
    .select("id, patient_id, provider_id, status, assessment_id, submitted_at, assessment_type")
    .eq("token", trimmed)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<RequestRow>();

  if (fetchError) {
    console.error("[POST /api/remote-assessments/[token]/submit] fetch failed");
    return NextResponse.json({ error: "Failed to submit assessment." }, { status: 500 });
  }

  if (!requestRow) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  if (requestRow.status === "submitted") {
    return NextResponse.json({
      alreadySubmitted: true,
      assessmentId: requestRow.assessment_id,
      submittedAt: requestRow.submitted_at,
    });
  }

  if (requestRow.status !== "pending") {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  const submittedData = validated.data as Record<string, unknown>;
  const isStrokeRequest = requestRow.assessment_type === "stroke_neuro_v1";
  if (isStrokeRequest !== isStrokeQuestionnaireData(submittedData)) {
    return NextResponse.json(
      { error: "Questionnaire kind does not match this assessment link." },
      { status: 400 },
    );
  }
  if (isStrokeRequest) {
    const provenanceValidation = validateStrokeIntakeProvenance(submittedData);
    if (!provenanceValidation.ok) {
      return NextResponse.json(
        { error: provenanceValidation.error },
        { status: 400 },
      );
    }
  }

  let structuredDataForSave: Record<string, unknown>;
  let translationAttempted = false;
  let failedFieldKeys: string[] = [];
  if (isStrokeRequest) {
    structuredDataForSave = prepareStrokeSubmission({
      ...(submittedData as unknown as Omit<StrokeQuestionnaireSubmission, "strokeWorkflow">),
      questionnaireVersion: STROKE_QUESTIONNAIRE_VERSION,
      pathway: STROKE_PATHWAY,
      safetyState: resolveStrokeSafetyState(
        (submittedData as unknown as StrokeQuestionnaireSubmission).responses ?? {},
      ),
      branchTrace: buildStrokeBranchTrace(
        (submittedData as unknown as StrokeQuestionnaireSubmission).responses ?? {},
      ),
    }) as unknown as Record<string, unknown>;
  } else {
    const keyConfig = getOpenAiKeyConfig();
    const translation = await batchTranslateRemoteQuestionnaire(
      submittedData,
      keyConfig.ok ? keyConfig.apiKey : null,
    );
    structuredDataForSave = translation.structuredData;
    translationAttempted = translation.translationAttempted;
    failedFieldKeys = translation.failedFieldKeys;
  }

  const { data: assessment, error: insertError } = await admin
    .from("assessments")
    .insert({
      patient_id: requestRow.patient_id,
      provider_id: requestRow.provider_id,
      type: "remote_questionnaire",
      structured_data: structuredDataForSave,
      status: "completed",
      mode: "remote",
      selected_tests: [],
    })
    .select("id, created_at")
    .single();

  if (insertError) {
    console.error("[POST /api/remote-assessments/[token]/submit] assessment insert failed");
    return NextResponse.json({ error: "Failed to save assessment." }, { status: 500 });
  }

  if (translationAttempted && failedFieldKeys.length > 0) {
    console.warn(
      "[POST /api/remote-assessments/[token]/submit] clinical translation incomplete",
      { assessmentId: assessment.id, failedFields: failedFieldKeys.length },
    );
  }

  const submittedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("remote_assessment_requests")
    .update({
      status: "submitted",
      submitted_at: submittedAt,
      assessment_id: assessment.id,
    })
    .eq("token", trimmed);

  if (updateError) {
    console.error("[POST /api/remote-assessments/[token]/submit] request update failed");
    return NextResponse.json({ error: "Failed to finalize submission." }, { status: 500 });
  }

  const backfilled = await backfillTranscriptionSessionAssessmentId(
    admin,
    requestRow.id,
    assessment.id,
  );
  if (!backfilled) {
    console.warn(
      "[POST /api/remote-assessments/[token]/submit] transcription session assessment backfill skipped",
    );
  }

  return NextResponse.json({
    assessmentId: assessment.id,
    submittedAt,
  });
}
