import type {
  PatientAssessmentDraft,
  PatientSectionId,
} from "./api/remote-assessments";
import { getAssessmentLanguage } from "./assessment-payload";
import {
  isTranslatablePatientFieldKey,
  readStoredClinicalTranslation,
} from "./reports/patient-clinical-translation";

const SECTION_IDS: PatientSectionId[] = [
  "pain",
  "rom",
  "strength",
  "balance",
  "gait",
  "functional",
];

const RED_FLAG_KEY_RE = /red\s*flags?|warning|safety/i;

export type RemoteQuestionnaireSummaryRow = {
  label: string;
  /** Clinician-facing value — prefers stored clinical English when available. */
  value: string;
  /** Original patient response (preserved verbatim). */
  originalValue?: string;
  fieldKey?: string;
  clinicalEnglish?: string;
  translationMissing?: boolean;
};

export type RemoteQuestionnaireSummaryMetric = {
  label: string;
  value: string;
  originalValue?: string;
  fieldKey?: string;
  clinicalEnglish?: string;
  translationMissing?: boolean;
};

export type RemoteQuestionnaireSummary = {
  title: string;
  submittedAt: string;
  metrics: RemoteQuestionnaireSummaryMetric[];
  rows: RemoteQuestionnaireSummaryRow[];
  hasRedFlag: boolean;
  patientDraft: PatientAssessmentDraft;
  includedSections: PatientSectionId[];
  clinicalTranslationWarning?: string;
  patientAnsweredInArabic: boolean;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumberString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asTrimmedString(value);
}

export function isPatientAssessmentDraft(data: unknown): data is PatientAssessmentDraft {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return SECTION_IDS.some((section) => section in (data as object));
}

export function extractRemoteQuestionnaireDraft(
  structuredData: unknown,
  type: string,
): PatientAssessmentDraft | null {
  if (type !== "remote_questionnaire") return null;
  if (!isPatientAssessmentDraft(structuredData)) return null;
  return structuredData;
}

export function inferIncludedSections(draft: PatientAssessmentDraft): PatientSectionId[] {
  return SECTION_IDS.filter((section) => {
    const block = draft[section];
    if (!block || typeof block !== "object") return false;
    return Object.values(block).some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  });
}

function readField(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = asTrimmedString(data[key]) ?? asNumberString(data[key]);
    if (value) return value;
  }
  return null;
}

function buildBilingualSummaryValue(
  root: Record<string, unknown>,
  fieldKey: string | undefined,
  original: string,
): Pick<
  RemoteQuestionnaireSummaryRow,
  "value" | "originalValue" | "fieldKey" | "clinicalEnglish" | "translationMissing"
> {
  const answeredInArabic = getAssessmentLanguage(root) === "ar";
  if (!answeredInArabic || !fieldKey || !isTranslatablePatientFieldKey(fieldKey)) {
    return { value: original, fieldKey };
  }

  const clinicalEnglish = readStoredClinicalTranslation(root, fieldKey);
  const translationMissing = clinicalEnglish.length === 0;
  return {
    value: clinicalEnglish || original,
    originalValue: original,
    fieldKey,
    clinicalEnglish: clinicalEnglish || undefined,
    translationMissing,
  };
}

export function detectRedFlag(structuredData: unknown): boolean {
  function walk(value: unknown, depth: number): boolean {
    if (depth > 8 || value === null || value === undefined) return false;

    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().length > 0;

    if (Array.isArray(value)) {
      return value.some((item) => walk(item, depth + 1));
    }

    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (RED_FLAG_KEY_RE.test(key) && walk(nested, depth + 1)) return true;
      }
    }

    return false;
  }

  return walk(structuredData, 0);
}

export function buildRemoteQuestionnaireSummary(
  structuredData: unknown,
  createdAt: string,
): RemoteQuestionnaireSummary | null {
  if (!isPatientAssessmentDraft(structuredData)) return null;

  const draft = structuredData;
  const pain = draft.pain;
  const root =
    typeof structuredData === "object" && structuredData !== null
      ? (structuredData as Record<string, unknown>)
      : {};

  const metrics: RemoteQuestionnaireSummaryMetric[] = [];
  const painAtRest =
    readField(root, "painAtRest") ??
    (pain?.painScore ? `${pain.painScore}/10` : null);
  const painOnMovement = readField(root, "painOnMovement");
  const bodyRegionOriginal =
    readField(root, "bodyRegion") ?? asTrimmedString(pain?.painLocation);

  if (painAtRest) metrics.push({ label: "Pain at rest", value: painAtRest });
  if (painOnMovement) metrics.push({ label: "Pain on movement", value: painOnMovement });
  if (bodyRegionOriginal) {
    metrics.push({
      label: "Body region",
      ...buildBilingualSummaryValue(root, "painLocation", bodyRegionOriginal),
    });
  }

  const rows: RemoteQuestionnaireSummaryRow[] = [];
  const mainComplaint = asTrimmedString(pain?.chiefComplaint);
  const aggravating = asTrimmedString(pain?.aggravating);
  const functionalGoal = asTrimmedString(pain?.goals);
  const rehabPhase = readField(root, "rehabilitationPhase", "rehabPhase");

  if (mainComplaint) {
    rows.push({
      label: "Main complaint",
      ...buildBilingualSummaryValue(root, "chiefComplaint", mainComplaint),
    });
  }
  if (aggravating) {
    rows.push({
      label: "Aggravating factors",
      ...buildBilingualSummaryValue(root, "aggravating", aggravating),
    });
  }
  if (functionalGoal) {
    rows.push({
      label: "Functional goal",
      ...buildBilingualSummaryValue(root, "goals", functionalGoal),
    });
  }
  if (rehabPhase) rows.push({ label: "Rehab phase", value: rehabPhase });

  const clinicalTranslationWarning = asTrimmedString(root.clinical_translation_warning);

  return {
    title: "Remote Questionnaire Assessment",
    submittedAt: createdAt,
    metrics,
    rows,
    hasRedFlag: detectRedFlag(structuredData),
    patientDraft: draft,
    includedSections: inferIncludedSections(draft),
    clinicalTranslationWarning: clinicalTranslationWarning ?? undefined,
    patientAnsweredInArabic: getAssessmentLanguage(root) === "ar",
  };
}
