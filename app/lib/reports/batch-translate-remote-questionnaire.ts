/**
 * Server-side batch translation for remote questionnaire submissions.
 * Preserves original patient text; writes sibling {fieldKey}_en keys only.
 */
import type { PatientAssessmentDraft, PatientSectionId } from "@/app/lib/api/remote-assessments";
import {
  translateClinicalText,
  type ClinicalTranslationResult,
} from "@/app/lib/ai/translate-clinical-text";
import { getAssessmentLanguage } from "@/app/lib/assessment-payload";
import { PATIENT_SECTION_QUESTIONS } from "@/app/lib/patient-assessment-questions";
import { isPatientAssessmentDraft } from "@/app/lib/remote-questionnaire-summary";
import { isTranslatablePatientFieldKey } from "@/app/lib/reports/patient-clinical-translation";

export const CLINICAL_TRANSLATION_REVIEW_WARNING =
  "Clinical English translation could not be generated for all fields. Original patient responses are shown for therapist review.";

export type TranslatableDraftField = {
  fieldKey: string;
  text: string;
};

export function collectTranslatableDraftFields(
  draft: PatientAssessmentDraft,
): TranslatableDraftField[] {
  const fields: TranslatableDraftField[] = [];

  for (const sectionId of Object.keys(PATIENT_SECTION_QUESTIONS) as PatientSectionId[]) {
    const block = draft[sectionId];
    if (!block || typeof block !== "object") continue;

    for (const question of PATIENT_SECTION_QUESTIONS[sectionId]) {
      if (!isTranslatablePatientFieldKey(question.key)) continue;
      const raw = (block as Record<string, string>)[question.key];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) continue;
      fields.push({ fieldKey: question.key, text: trimmed });
    }
  }

  return fields;
}

export type BatchTranslateRemoteQuestionnaireResult = {
  structuredData: Record<string, unknown>;
  failedFieldKeys: string[];
  translationAttempted: boolean;
};

export type ClinicalTextTranslator = (text: string) => Promise<ClinicalTranslationResult>;

export async function batchTranslateRemoteQuestionnaire(
  structuredData: Record<string, unknown>,
  apiKey: string | null,
  translateFn?: ClinicalTextTranslator,
): Promise<BatchTranslateRemoteQuestionnaireResult> {
  const translate =
    translateFn ??
    (async (text: string) => {
      if (!apiKey) return { ok: false, code: "no_content" };
      return translateClinicalText(apiKey, text);
    });
  if (getAssessmentLanguage(structuredData) !== "ar" || !isPatientAssessmentDraft(structuredData)) {
    return { structuredData, failedFieldKeys: [], translationAttempted: false };
  }

  const fields = collectTranslatableDraftFields(structuredData);
  if (fields.length === 0) {
    return { structuredData, failedFieldKeys: [], translationAttempted: false };
  }

  const updated: Record<string, unknown> = { ...structuredData };
  const failedFieldKeys: string[] = [];
  const generatedAt = new Date().toISOString();

  if (!apiKey) {
    for (const { fieldKey } of fields) {
      failedFieldKeys.push(fieldKey);
    }
    updated.clinical_translation_status = "failed";
    updated.clinical_translation_warning = CLINICAL_TRANSLATION_REVIEW_WARNING;
    return { structuredData: updated, failedFieldKeys, translationAttempted: true };
  }

  for (const { fieldKey, text } of fields) {
    const existingKey = `${fieldKey}_en`;
    const existing = updated[existingKey];
    if (typeof existing === "string" && existing.trim()) continue;

    const result = await translate(text);
    if (result.ok) {
      updated[existingKey] = result.translation;
      updated[`${fieldKey}_en_generated_at`] = generatedAt;
      updated[`${fieldKey}_en_reviewed`] = false;
    } else {
      failedFieldKeys.push(fieldKey);
    }
  }

  if (failedFieldKeys.length > 0) {
    updated.clinical_translation_status =
      failedFieldKeys.length === fields.length ? "failed" : "partial";
    updated.clinical_translation_warning = CLINICAL_TRANSLATION_REVIEW_WARNING;
  } else {
    updated.clinical_translation_status = "complete";
  }

  return { structuredData: updated, failedFieldKeys, translationAttempted: true };
}
