import type { PatientPlanData, PatientSession } from "@/app/api/patient/plan/route";
import { resolveCatalogSessionDisplay } from "@/app/lib/interactive-shoulder/resolve-catalog-session-display";
import { resolvePatientRehabFocus } from "@/app/lib/plan-program-metadata";
import type { ProgramSessionEstimatedDurationMinutes } from "@/app/lib/rehab-programs/rehab-program-types";
import {
  formatSessionDisplayTitle,
  type PatientPortalLanguage,
} from "@/app/lib/patient-portal-ui";

function planMetadataForRehabFocus(plan: PatientPlanData) {
  return {
    programTemplateId: plan.programTemplateId ?? undefined,
    patientFriendlyGoal: plan.patientFriendlyGoal ?? undefined,
    programGoal: plan.phaseGoal?.trim() || undefined,
  };
}

/** UI-language rehab focus — avoids English API copy when Arabic portal is active. */
export function resolvePatientHomeRehabFocus(
  plan: PatientPlanData,
  lang: PatientPortalLanguage,
): string {
  return resolvePatientRehabFocus(
    planMetadataForRehabFocus(plan),
    plan.phaseGoal,
    lang,
  );
}

/** Known catalog / template program titles for Arabic home display (presentation only). */
const PATIENT_HOME_PROGRAM_TITLE_AR: Record<string, string> = {
  "stroke-upper-limb-recovery-foundation-v1": "أساسيات تعافي الطرف العلوي",
  "knee-rehab-beginner": "تأهيل الركبة — المستوى المبتدئ",
  "low-back-beginner": "تأهيل أسفل الظهر — المستوى المبتدئ",
  "shoulder-mobility-beginner": "مرونة الكتف — المستوى المبتدئ",
  "sports-knee-foundation": "أساسيات ركبة الرياضيين",
};

export type PatientHomeSessionDisplay = {
  title: string;
  context: string | null;
  durationLabel: string | null;
};

/** Catalog sessions store content under catalogSession.blocks — do not show exercise counts. */
export function shouldShowPatientHomeExerciseCount(session: PatientSession): boolean {
  return session.catalogSession == null;
}

export function resolvePatientHomeProgramTitle(
  plan: PatientPlanData,
  lang: PatientPortalLanguage,
): string {
  if (lang !== "ar") {
    return plan.planTitle?.trim() || plan.programName?.trim() || "";
  }

  const templateId = plan.programTemplateId?.trim();
  if (templateId && PATIENT_HOME_PROGRAM_TITLE_AR[templateId]) {
    return PATIENT_HOME_PROGRAM_TITLE_AR[templateId]!;
  }

  const catalogProgramId = plan.sessions.find((session) => session.catalogSession)?.catalogSession
    ?.programId;
  if (catalogProgramId && PATIENT_HOME_PROGRAM_TITLE_AR[catalogProgramId]) {
    return PATIENT_HOME_PROGRAM_TITLE_AR[catalogProgramId]!;
  }

  const localizedFocus = resolvePatientHomeRehabFocus(plan, lang).trim();
  if (localizedFocus) return localizedFocus;

  return plan.planTitle?.trim() || plan.programName?.trim() || "";
}

export function formatPatientSessionDurationLabel(
  duration: ProgramSessionEstimatedDurationMinutes,
  lang: PatientPortalLanguage,
): string {
  if (duration.min === duration.max) {
    return lang === "ar" ? `${duration.min} دقيقة` : `${duration.min} min`;
  }
  return lang === "ar"
    ? `${duration.min}–${duration.max} دقيقة`
    : `${duration.min}–${duration.max} min`;
}

export function resolvePatientHomeSessionDisplay(
  session: PatientSession,
  plan: PatientPlanData,
  lang: PatientPortalLanguage,
): PatientHomeSessionDisplay {
  const catalog = session.catalogSession;
  const localizedRehabFocus = resolvePatientHomeRehabFocus(plan, lang);
  const fallbackGoal =
    lang === "ar"
      ? localizedRehabFocus
      : plan.patientFriendlyGoal?.trim() ?? plan.patientRehabFocus?.trim() ?? null;

  const localized = resolveCatalogSessionDisplay(
    lang,
    catalog?.id,
    session.title,
    catalog?.goal ?? fallbackGoal,
  );

  const title =
    catalog != null
      ? localized.title
      : formatSessionDisplayTitle(session.sessionNumber, session.title, lang);

  const context = localized.goal ?? fallbackGoal;

  const durationLabel = catalog
    ? formatPatientSessionDurationLabel(catalog.estimatedDurationMinutes, lang)
    : null;

  return { title, context, durationLabel };
}
