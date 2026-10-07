"use client";

import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import { interactiveShoulderUi } from "@/app/lib/interactive-shoulder/interactive-shoulder-ui";
import { PATIENT_ICON_TOUCH_TARGET_CLASS, PATIENT_PRIMARY_TOUCH_MIN_CLASS } from "@/app/lib/patient-portal-touch-targets";

type SoundToggleButtonProps = {
  language: PatientExerciseLanguage;
  muted: boolean;
  onToggle: () => void;
  className?: string;
  variant?: "text" | "icon";
};

function SpeakerIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M11 5L6 9H3v6h3l5 4V5z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path d="M16 9l4 4M20 9l-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 5L6 9H3v6h3l5 4V5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 8.5a4.5 4.5 0 010 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SoundToggleButton({
  language,
  muted,
  onToggle,
  className = "",
  variant = "icon",
}: SoundToggleButtonProps) {
  const ui = interactiveShoulderUi(language);
  const ariaLabel = muted ? ui.soundUnmuteAria : ui.soundMuteAria;

  if (variant === "text") {
    return (
      <button
        type="button"
        className={`rounded-[10px] border border-white/20 bg-[#0F1825]/88 px-3 text-[11px] font-semibold text-white/90 backdrop-blur-sm transition hover:border-[#1D9E75]/40 hover:bg-[#0F1825] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5DCAA5] ${PATIENT_PRIMARY_TOUCH_MIN_CLASS} ${className}`}
        onClick={onToggle}
        aria-pressed={muted}
        aria-label={ariaLabel}
      >
        {muted ? ui.soundOffLabel : ui.soundOnLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      title={ariaLabel}
      className={`${PATIENT_ICON_TOUCH_TARGET_CLASS} rounded-[10px] border border-[#D1D9E0] bg-white text-[#374151] transition hover:border-[#94A3B8] hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${className}`}
      onClick={onToggle}
      aria-pressed={muted}
      aria-label={ariaLabel}
    >
      <SpeakerIcon muted={muted} />
    </button>
  );
}
