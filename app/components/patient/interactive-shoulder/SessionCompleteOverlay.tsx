"use client";

import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import { interactiveShoulderUi } from "@/app/lib/interactive-shoulder/interactive-shoulder-ui";

type SessionCompleteOverlayProps = {
  language: PatientExerciseLanguage;
  arClass?: string;
  blocksCompleted: number;
  durationSeconds: number;
  targetsReached: number;
  patternsCompleted: number;
};

export function SessionCompleteOverlay({
  language,
  arClass = "",
  blocksCompleted,
  durationSeconds,
  targetsReached,
  patternsCompleted,
}: SessionCompleteOverlayProps) {
  const ui = interactiveShoulderUi(language);
  const interactionsCompleted = targetsReached + patternsCompleted;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[#0A0F1A]/55 p-4 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <div
        className={`w-full max-w-lg rounded-[14px] border border-[#1D9E75]/35 bg-[#0F1825]/96 px-5 py-5 text-white shadow-[0_16px_48px_rgba(10,15,26,0.4)] sm:px-6 sm:py-6 ${arClass}`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5DCAA5] sm:text-[12px]">
          {ui.sessionCompleteTitle}
        </p>
        <p className="mt-3 text-[18px] font-semibold text-white sm:text-[20px]">{ui.sessionCompleteHeadline}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-white/70 sm:text-[14px]">{ui.sessionCompleteEncouragement}</p>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-[11px] sm:gap-4">
          <div className="rounded-[8px] border border-white/10 bg-white/5 px-3 py-2">
            <dt className="text-white/50">{ui.blocksCompletedLabel}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-white" dir="ltr">
              {blocksCompleted}
            </dd>
          </div>
          {interactionsCompleted > 0 ? (
            <div className="rounded-[8px] border border-white/10 bg-white/5 px-3 py-2">
              <dt className="text-white/50">{ui.interactionsCompletedLabel}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-white" dir="ltr">
                {interactionsCompleted}
              </dd>
            </div>
          ) : null}
          <div className="rounded-[8px] border border-white/10 bg-white/5 px-3 py-2">
            <dt className="text-white/50">{ui.durationLabel}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-white" dir="ltr">
              {ui.durationSeconds(durationSeconds)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[10px] leading-relaxed text-white/45">{ui.sessionCompleteReviewNote}</p>
      </div>
    </div>
  );
}
