import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { InteractiveShoulderOutcomeSaveState } from "@/app/lib/patient-portal/interactive-shoulder-outcome-submission";
import { resolveOutcomeSaveNotice } from "@/app/lib/patient-portal/interactive-shoulder-outcome-save-notice";

/**
 * Honest status for the movement-outcome save. Renders nothing unless the save failed or is
 * being retried by hand. Amber, not red: the patient's own session report is a separate
 * save with its own error state, and this notice must not be mistaken for it.
 */
export function InteractiveShoulderOutcomeSaveNotice({
  state,
  lang,
  textDir,
  arClass,
  onRetry,
}: {
  state: InteractiveShoulderOutcomeSaveState;
  lang: PatientExerciseLanguage;
  textDir: "ltr" | "rtl";
  arClass: string;
  onRetry: () => void;
}) {
  const view = resolveOutcomeSaveNotice(state, lang);
  if (!view) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="outcome-save-notice"
      data-state={view.kind}
      dir={textDir}
      className={`rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 ${arClass}`}
    >
      <p className="text-[13px] leading-relaxed text-amber-900">{view.message}</p>
      {view.canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-[8px] border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          {view.retryLabel}
        </button>
      ) : null}
    </div>
  );
}
