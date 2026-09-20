import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";

const COOL_DOWN_COACHING: Record<
  PatientExerciseLanguage,
  {
    complete: string;
    protectedReturn: string;
    restOnSupport: string;
    supportedStillness: string;
    safety: string;
  }
> = {
  en: {
    complete: "Exercise complete.",
    protectedReturn:
      "Slowly bring your arm back to a comfortable, supported position. Do not force the movement.",
    restOnSupport: "Let your arm rest comfortably on the support.",
    supportedStillness: "Keep your arm supported and breathe normally.",
    safety:
      "If you feel shoulder pain or cannot control the arm comfortably, stop and support the arm.",
  },
  ar: {
    complete: "اكتمل التمرين.",
    protectedReturn: "أعد ذراعك ببطء إلى وضع مريح ومدعوم. لا تُجبر الحركة.",
    restOnSupport: "دع ذراعك يستقر بشكل مريح على المسند.",
    supportedStillness: "أبقِ ذراعك مدعومًا وتنفس بهدوء.",
    safety:
      "إذا شعرت بألم في الكتف أو لم تستطع التحكم بالذراع براحة، توقف وضع الذراع على المسند.",
  },
};

function resolveCoolDownPhaseMessage(
  language: PatientExerciseLanguage,
  elapsedSeconds: number,
): string {
  const copy = COOL_DOWN_COACHING[language];
  if (elapsedSeconds < 5) return copy.complete;
  if (elapsedSeconds < 20) return copy.protectedReturn;
  if (elapsedSeconds < 30) return copy.restOnSupport;
  return copy.supportedStillness;
}

/**
 * Supported-return coaching for the cool-down instructional block.
 * Uses elapsed block time — presentation only, no measured dose.
 */
export function resolveCoolDownCoachingMessage(
  language: PatientExerciseLanguage,
  elapsedSeconds: number,
): string {
  const elapsed = Math.max(0, elapsedSeconds);
  const primary = resolveCoolDownPhaseMessage(language, Math.floor(elapsed));
  if (elapsed >= 5) {
    return `${primary}\n${COOL_DOWN_COACHING[language].safety}`;
  }
  return primary;
}

export function resolveCoolDownCoachingPhase(
  elapsedSeconds: number,
): "complete" | "protectedReturn" | "restOnSupport" | "supportedStillness" {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds));
  if (elapsed < 5) return "complete";
  if (elapsed < 20) return "protectedReturn";
  if (elapsed < 30) return "restOnSupport";
  return "supportedStillness";
}
