"use client";

import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { ShoulderAbductionReachTrackingStatus } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import {
  resolvePatientCameraTrackingReassuranceCopy,
  resolvePatientCameraTrackingReassuranceState,
} from "@/app/lib/interactive-shoulder/resolve-patient-camera-tracking-reassurance";

type PatientCameraTrackingIndicatorProps = {
  language: PatientExerciseLanguage;
  arClass?: string;
  trackingStatus: ShoulderAbductionReachTrackingStatus | null | undefined;
};

export function PatientCameraTrackingIndicator({
  language,
  arClass = "",
  trackingStatus,
}: PatientCameraTrackingIndicatorProps) {
  const reassurance = resolvePatientCameraTrackingReassuranceCopy(language, trackingStatus);
  const state = resolvePatientCameraTrackingReassuranceState(trackingStatus);
  const dotClass = state === "good" ? "bg-[#5DCAA5]" : "bg-amber-300";

  return (
    <div
      className={`pointer-events-none absolute start-2 top-2 z-20 flex items-center gap-1.5 rounded-[6px] border border-white/15 bg-black/45 px-2 py-1 text-[10px] text-white/85 sm:start-3 sm:top-3 ${arClass}`}
      role="status"
      aria-live="polite"
      aria-label={`${reassurance.label}: ${reassurance.status}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className="font-medium text-white/70">{reassurance.label}</span>
      <span className="text-white/90">{reassurance.status}</span>
    </div>
  );
}
