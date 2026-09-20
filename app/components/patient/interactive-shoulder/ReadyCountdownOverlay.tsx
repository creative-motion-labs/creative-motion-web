"use client";

import { useEffect, useState } from "react";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import { interactiveShoulderUi } from "@/app/lib/interactive-shoulder/interactive-shoulder-ui";

type ReadyCountdownOverlayProps = {
  language: PatientExerciseLanguage;
  arClass?: string;
  reducedMotion: boolean;
  onTick?: () => void;
  onComplete: () => void;
};

const COUNTDOWN_STEPS = [3, 2, 1] as const;

export function ReadyCountdownOverlay({
  language,
  arClass = "",
  reducedMotion,
  onTick,
  onComplete,
}: ReadyCountdownOverlayProps) {
  const ui = interactiveShoulderUi(language);
  const [stepIndex, setStepIndex] = useState(0);
  const [showBegin, setShowBegin] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      onComplete();
      return;
    }

    if (showBegin) {
      const timer = window.setTimeout(onComplete, 650);
      return () => window.clearTimeout(timer);
    }

    onTick?.();
    const timer = window.setTimeout(() => {
      if (stepIndex >= COUNTDOWN_STEPS.length - 1) {
        setShowBegin(true);
        onTick?.();
        return;
      }
      setStepIndex((value) => value + 1);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [onComplete, onTick, reducedMotion, showBegin, stepIndex]);

  if (reducedMotion) return null;

  const display = showBegin ? ui.beginLabel : String(COUNTDOWN_STEPS[stepIndex]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-[#0A0F1A]/55 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className={`text-center ${arClass}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5DCAA5]/90">
          {ui.readyLabel}
        </p>
        <p
          key={display}
          className="mt-2 text-5xl font-bold tabular-nums text-white motion-safe:animate-[ready-countdown-pop_0.28s_ease-out]"
        >
          {display}
        </p>
      </div>
    </div>
  );
}
