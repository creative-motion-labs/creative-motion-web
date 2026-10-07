import { translateClinicalText } from "@/app/lib/ai/translate-clinical-text";
import {
  formatStrokeResponseValue,
  isStrokeSourceResponseUnclear,
  STROKE_UNCLEAR_CLINICAL_ENGLISH,
  strokeQuestionById,
  type StrokeQuestionnaireSubmission,
  type StrokeResponse,
} from "./stroke-questionnaire-schema";

const FORBIDDEN_TRANSLATION_UPGRADES = [
  "spasticity",
  "hemiparesis",
  "foot drop",
  "neglect",
  "proprioceptive deficit",
  "aphasia",
] as const;

function rawText(response: StrokeResponse): string {
  return Array.isArray(response.rawValue)
    ? response.rawValue.join(", ")
    : response.rawValue;
}

function reporterPrefix(response: StrokeResponse): string {
  return response.provenance === "CAREGIVER_REPORTED"
    ? "The caregiver reports"
    : "The patient reports";
}

function isSelectionResponse(id: string, response: StrokeResponse): boolean {
  return (
    response.responseMethod === "selection" ||
    (response.responseMethod === undefined &&
      Boolean(strokeQuestionById(id)?.options))
  );
}

function selectionTranslation(id: string, response: StrokeResponse): string {
  const question = strokeQuestionById(id);
  const provenanceLabel =
    response.provenance === "CAREGIVER_REPORTED"
      ? "Caregiver-reported response"
      : "Patient-reported response";
  return `${provenanceLabel} — ${question?.en ?? id}: ${formatStrokeResponseValue(id, response)}.`;
}

function hasForbiddenUpgrade(text: string): boolean {
  const normalized = text.toLowerCase();
  return FORBIDDEN_TRANSLATION_UPGRADES.some((term) => normalized.includes(term));
}

function translationAddsUnsupportedNegative(
  source: string,
  translated: string,
): boolean {
  const sourceHasNegation =
    /\b(?:no|not|none|without|deny|denies|denied)\b/i.test(source) ||
    /(?:^|[\s،])(?:لا|ليس|ليست|لم|لن|بدون|ما ?في|لا يوجد)(?=$|[\s،.])/u.test(
      source,
    );
  const translationHasNegative =
    /\b(?:no|not|none|without|deny|denies|denied)\b/i.test(translated);
  return translationHasNegative && !sourceHasNegation;
}

export async function translateStrokeSubmission(
  submission: StrokeQuestionnaireSubmission,
  apiKey: string,
): Promise<{
  submission: StrokeQuestionnaireSubmission;
  failedFieldIds: string[];
}> {
  const responses = { ...submission.responses };
  const failedFieldIds: string[] = [];
  const generatedAt = new Date().toISOString();

  for (const [id, response] of Object.entries(responses)) {
    const sourceText = rawText(response).trim();
    if (!sourceText) {
      responses[id] = {
        ...response,
        clinicalEnglish: undefined,
        translation: undefined,
      };
      continue;
    }
    if (
      !isSelectionResponse(id, response) &&
      isStrokeSourceResponseUnclear(id, response)
    ) {
      responses[id] = {
        ...response,
        clinicalEnglish: STROKE_UNCLEAR_CLINICAL_ENGLISH,
        translation: { status: "review_required", generatedAt },
      };
      continue;
    }
    if (response.rawLanguage === "en") {
      responses[id] = {
        ...response,
        clinicalEnglish:
          isSelectionResponse(id, response)
            ? selectionTranslation(id, response)
            : `${reporterPrefix(response)} ${sourceText}`,
        translation: { status: "review_required", generatedAt },
      };
      continue;
    }

    if (isSelectionResponse(id, response)) {
      responses[id] = {
        ...response,
        clinicalEnglish: selectionTranslation(id, response),
        translation: { status: "review_required", generatedAt },
      };
      continue;
    }

    const result = await translateClinicalText(apiKey, sourceText);
    if (!result.ok) {
      failedFieldIds.push(id);
      continue;
    }
    if (
      hasForbiddenUpgrade(result.translation) ||
      translationAddsUnsupportedNegative(sourceText, result.translation)
    ) {
      responses[id] = {
        ...response,
        clinicalEnglish: STROKE_UNCLEAR_CLINICAL_ENGLISH,
        translation: { status: "review_required", generatedAt },
      };
      continue;
    }
    const translated = result.translation
      .replace(/^The patient reports/i, reporterPrefix(response))
      .replace(/^Patient reports/i, reporterPrefix(response));
    responses[id] = {
      ...response,
      clinicalEnglish: translated,
      translation: { status: "review_required", generatedAt },
    };
  }

  return {
    submission: {
      ...submission,
      responses,
      strokeWorkflow: {
        ...submission.strokeWorkflow,
        translation: {
          status: failedFieldIds.length === 0 ? "review_required" : "not_generated",
        },
        report: { status: "not_generated" },
      },
    },
    failedFieldIds,
  };
}

export function approveStrokeTranslations(
  submission: StrokeQuestionnaireSubmission,
  approvedBy?: string,
): StrokeQuestionnaireSubmission {
  const approvedAt = new Date().toISOString();
  const responses = Object.fromEntries(
    Object.entries(submission.responses).map(([id, response]) => [
      id,
      response.clinicalEnglish?.trim()
        ? {
            ...response,
            translation: {
              ...response.translation,
              status: "approved" as const,
              approvedAt,
              approvedBy,
            },
          }
        : response,
    ]),
  );
  return {
    ...submission,
    responses,
    strokeWorkflow: {
      ...submission.strokeWorkflow,
      translation: { status: "approved", approvedAt },
      report: { status: "not_generated" },
    },
  };
}

export function allStrokeTranslationsPresent(
  submission: StrokeQuestionnaireSubmission,
): boolean {
  return Object.values(submission.responses).every(
    (response) =>
      !rawText(response).trim() ||
      (typeof response.clinicalEnglish === "string" &&
        response.clinicalEnglish.trim().length > 0),
  );
}
