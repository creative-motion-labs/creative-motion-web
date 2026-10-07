import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";

export type CatalogSessionDisplay = {
  title: string;
  goal: string | null;
};

const CATALOG_SESSION_DISPLAY: Record<
  string,
  Record<PatientExerciseLanguage, { title: string; goal: string }>
> = {
  "stroke-upper-limb-recovery-foundation-v1-session-1": {
    en: {
      title: "Session 1 — Activation and Functional Reaching",
      goal: "Activation and Functional Reaching",
    },
    ar: {
      title: "الجلسة 1 — التنشيط والوصول الوظيفي",
      goal: "التنشيط والوصول الوظيفي",
    },
  },
};

/** Playback loads program_sessions.id (UUID); catalog keys use session_key. */
const CATALOG_SESSION_KEY_BY_ENGLISH_TITLE: Record<string, string> = {
  "Session 1 — Activation and Functional Reaching":
    "stroke-upper-limb-recovery-foundation-v1-session-1",
};

function resolveCatalogSessionKey(
  catalogSessionId: string | undefined,
  fallbackTitle: string,
): string | undefined {
  if (catalogSessionId && CATALOG_SESSION_DISPLAY[catalogSessionId]) {
    return catalogSessionId;
  }
  return CATALOG_SESSION_KEY_BY_ENGLISH_TITLE[fallbackTitle];
}

export function hasLocalizedCatalogSessionDisplay(
  catalogSessionId: string | undefined,
  fallbackTitle?: string,
): boolean {
  return Boolean(resolveCatalogSessionKey(catalogSessionId, fallbackTitle ?? ""));
}

export function resolveCatalogSessionDisplay(
  language: PatientExerciseLanguage,
  catalogSessionId: string | undefined,
  fallbackTitle: string,
  fallbackGoal: string | null | undefined,
): CatalogSessionDisplay {
  const catalogKey = resolveCatalogSessionKey(catalogSessionId, fallbackTitle);
  const localized = catalogKey ? CATALOG_SESSION_DISPLAY[catalogKey]?.[language] : undefined;
  return {
    title: localized?.title ?? fallbackTitle,
    goal: localized?.goal ?? fallbackGoal ?? null,
  };
}
