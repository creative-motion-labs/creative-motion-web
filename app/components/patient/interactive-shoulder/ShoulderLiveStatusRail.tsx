"use client";

import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import { interactiveShoulderUi } from "@/app/lib/interactive-shoulder/interactive-shoulder-ui";
import { PATIENT_PRIMARY_TOUCH_MIN_CLASS } from "@/app/lib/patient-portal-touch-targets";
import { SoundToggleButton } from "./SoundToggleButton";

export type ShoulderLivePhaseAccent = "warmup" | "cooldown" | "exercise";

export type ShoulderLiveStatusMetric = {
  label: string;
  value: string;
};

type ShoulderLiveStatusRailProps = {
  language: PatientExerciseLanguage;
  arClass?: string;
  phaseLabel: string;
  phaseAccent?: ShoulderLivePhaseAccent;
  title: string;
  timer?: string | null;
  metrics?: ShoulderLiveStatusMetric[];
  showBlockProgress?: boolean;
  blockProgressPercent: number;
  sessionProgressPercent: number;
  pausedOrHold: boolean;
  onPause: () => void;
  onResume: () => void;
  controlsLocked?: boolean;
  soundMuted: boolean;
  onSoundToggle: () => void;
};

function blockBarClass(accent: ShoulderLivePhaseAccent): string {
  if (accent === "cooldown") return "bg-[#5B8DEF]";
  return "bg-[#1D9E75]";
}

function ProgressRow({
  label,
  percent,
  barClass,
  quiet = false,
}: {
  label: string;
  percent: number;
  barClass: string;
  quiet?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-[#374151] sm:text-[13px]">{label}</span>
        <span className="text-[12px] font-medium tabular-nums text-[#6B7280] sm:text-[13px]" dir="ltr">
          {clamped}%
        </span>
      </div>
      <div className={`h-1 w-full overflow-hidden rounded-full sm:h-1.5 ${quiet ? "bg-[#E8EDF2]" : "bg-[#E2E8E5]"}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${barClass}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function ShoulderLiveStatusRail({
  language,
  arClass = "",
  phaseLabel,
  phaseAccent = "exercise",
  title,
  timer = null,
  metrics = [],
  showBlockProgress = true,
  blockProgressPercent,
  sessionProgressPercent,
  pausedOrHold,
  onPause,
  onResume,
  controlsLocked = false,
  soundMuted,
  onSoundToggle,
}: ShoulderLiveStatusRailProps) {
  const ui = interactiveShoulderUi(language);

  return (
    <aside
      className={`flex w-full flex-col lg:min-h-[min(72vh,720px)] lg:pt-3 ${arClass}`}
      aria-label={ui.currentBlockLabel}
    >
      <div className="flex flex-1 flex-col">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">{phaseLabel}</p>
        <h2 className="mt-2 text-[18px] font-semibold leading-tight text-[#0A0F1A] sm:text-[20px] lg:text-[22px]">
          {title}
        </h2>

        {timer ? (
          <p className="mt-4 text-[28px] font-semibold tabular-nums leading-none text-[#0A0F1A] sm:text-[32px]" dir="ltr">
            {timer}
          </p>
        ) : null}

        {metrics.length > 0 ? (
          <div className="mt-6 space-y-5">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">
                  {metric.label}
                </p>
                <p className="mt-1 text-[22px] font-semibold tabular-nums leading-none text-[#0A0F1A] sm:text-[24px]" dir="ltr">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="my-6 h-px w-full bg-[#E2E8E5]" />

        <div className="space-y-5">
          {showBlockProgress ? (
            <ProgressRow
              label={ui.blockLabel}
              percent={blockProgressPercent}
              barClass={blockBarClass(phaseAccent)}
            />
          ) : null}
          <ProgressRow
            label={ui.sessionProgressLabel}
            percent={sessionProgressPercent}
            barClass="bg-[#94A3B8]"
            quiet
          />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-[#E2E8E5] pt-5">
        {controlsLocked ? (
          <span className="text-[13px] text-[#9CA3AF]">{ui.pause}</span>
        ) : (
          <button
            type="button"
            className={`rounded-[10px] border border-[#CBD5E1] bg-white px-5 text-[13px] font-semibold text-[#374151] transition hover:border-[#94A3B8] hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
            onClick={pausedOrHold ? onResume : onPause}
            aria-label={pausedOrHold ? ui.resumeAriaLabel : ui.pauseAriaLabel}
          >
            {pausedOrHold ? ui.resume : ui.pause}
          </button>
        )}
        <SoundToggleButton language={language} muted={soundMuted} onToggle={onSoundToggle} variant="icon" />
      </div>
    </aside>
  );
}
