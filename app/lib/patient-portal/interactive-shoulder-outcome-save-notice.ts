import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { InteractiveShoulderOutcomeSaveState } from "@/app/lib/patient-portal/interactive-shoulder-outcome-submission";

/**
 * Patient-facing status for the Interactive Shoulder MOVEMENT-OUTCOME save.
 *
 * This is deliberately separate from the patient-reported session completion (effort and
 * pain), which has its own error state. A session can be completed and reported while the
 * camera-derived movement summary failed to save; the patient must be told that plainly,
 * and the screen must never imply a movement summary exists when it does not.
 *
 * Wording is neutral status text only: no clinical claim, no score, no reassurance about
 * results. Arabic is provided for every string; it is flagged for native-speaker review in
 * the pull request that introduced it.
 */
type OutcomeSaveNoticeCopy = {
  failed: string;
  retrying: string;
  retryLabel: string;
};

const OUTCOME_SAVE_NOTICE_COPY: Record<PatientExerciseLanguage, OutcomeSaveNoticeCopy> = {
  en: {
    failed:
      "We couldn't save your movement details. You can still finish your session, but your therapist may not see the movement summary for this session.",
    retrying: "Saving your movement details…",
    retryLabel: "Try saving again",
  },
  ar: {
    failed:
      "تعذّر حفظ تفاصيل حركتك. يمكنك إكمال جلستك، لكن قد لا يرى معالجك ملخص الحركة لهذه الجلسة.",
    retrying: "جارٍ حفظ تفاصيل حركتك…",
    retryLabel: "حاول الحفظ مرة أخرى",
  },
};

export type OutcomeSaveNoticeView = {
  kind: "failed" | "retrying";
  message: string;
  retryLabel: string;
  /** Only a failed save can be retried by hand; a save already in flight cannot. */
  canRetry: boolean;
};

/**
 * Returns the notice to show, or null when there is nothing the patient needs to be told
 * (not started, first save still in progress, or saved).
 */
export function resolveOutcomeSaveNotice(
  state: InteractiveShoulderOutcomeSaveState,
  lang: PatientExerciseLanguage,
): OutcomeSaveNoticeView | null {
  const copy = OUTCOME_SAVE_NOTICE_COPY[lang];
  if (state === "failed") {
    return { kind: "failed", message: copy.failed, retryLabel: copy.retryLabel, canRetry: true };
  }
  if (state === "retrying") {
    return { kind: "retrying", message: copy.retrying, retryLabel: copy.retryLabel, canRetry: false };
  }
  return null;
}
