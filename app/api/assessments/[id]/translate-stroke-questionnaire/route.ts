import { NextResponse, type NextRequest } from "next/server";
import { AI_ERROR_CODES } from "@/app/lib/ai/ai-errors";
import { checkAiRateLimit } from "@/app/lib/ai/rate-limit";
import { getOpenAiKeyConfig } from "@/app/lib/openai/server-env";
import {
  aiErrorJson,
  loadRemoteQuestionnaireAssessment,
  saveAssessmentStructuredData,
} from "@/app/lib/reports/assessment-workflow-route-auth";
import {
  allStrokeTranslationsPresent,
  approveStrokeTranslations,
  translateStrokeSubmission,
} from "@/app/lib/stroke-questionnaire/stroke-translation";
import {
  isStrokeQuestionnaireData,
  type StrokeQuestionnaireSubmission,
} from "@/app/lib/stroke-questionnaire/stroke-questionnaire-schema";

type Body = {
  approve?: unknown;
  saveFieldEdits?: unknown;
};

type FieldEdit = { fieldId?: unknown; clinicalEnglish?: unknown };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id?.trim()) return aiErrorJson(AI_ERROR_CODES.AI_INVALID_INPUT);

  const loaded = await loadRemoteQuestionnaireAssessment(id);
  if (!loaded.ok) return loaded.response;
  const { assessment, adminClient } = loaded;
  if (!isStrokeQuestionnaireData(assessment.structured_data)) {
    return aiErrorJson(AI_ERROR_CODES.AI_CONTEXT_INVALID);
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  let submission: StrokeQuestionnaireSubmission = {
    ...assessment.structured_data,
    responses: { ...assessment.structured_data.responses },
  };

  if (Array.isArray(body.saveFieldEdits)) {
    for (const edit of body.saveFieldEdits as FieldEdit[]) {
      const fieldId = typeof edit.fieldId === "string" ? edit.fieldId.trim() : "";
      const clinicalEnglish =
        typeof edit.clinicalEnglish === "string" ? edit.clinicalEnglish.trim() : "";
      if (!fieldId || !clinicalEnglish || !submission.responses[fieldId]) continue;
      submission.responses[fieldId] = {
        ...submission.responses[fieldId],
        clinicalEnglish,
        translation: { status: "review_required" },
      };
    }
    submission.strokeWorkflow = {
      translation: { status: "review_required" },
      report: { status: "not_generated" },
    };
  } else if (body.approve === true) {
    if (!allStrokeTranslationsPresent(submission)) {
      return NextResponse.json(
        { error: "Clinical English is incomplete." },
        { status: 400 },
      );
    }
    submission = approveStrokeTranslations(submission, assessment.provider_id);
  } else {
    const keyConfig = getOpenAiKeyConfig();
    if (!keyConfig.ok) {
      return NextResponse.json(
        { error: "Translation service unavailable." },
        { status: 503 },
      );
    }
    const rateLimit = checkAiRateLimit(assessment.provider_id);
    if (!rateLimit.allowed) return aiErrorJson(AI_ERROR_CODES.AI_RATE_LIMITED);
    const result = await translateStrokeSubmission(submission, keyConfig.apiKey);
    submission = result.submission;
    if (result.failedFieldIds.length > 0) {
      submission.strokeWorkflow.translation.status = "not_generated";
    }
  }

  const saved = await saveAssessmentStructuredData(
    adminClient,
    assessment.id,
    assessment.provider_id,
    submission as unknown as Record<string, unknown>,
  );
  if (!saved.ok) return saved.response;
  return NextResponse.json({
    translationStatus: submission.strokeWorkflow.translation.status,
    submission,
  });
}
