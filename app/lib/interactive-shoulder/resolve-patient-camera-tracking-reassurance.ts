import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { ShoulderAbductionReachTrackingStatus } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";

export type PatientCameraTrackingReassuranceState = "good" | "adjusting";

export type PatientCameraTrackingReassuranceCopy = {
  label: string;
  status: string;
};

const COPY: Record<
  PatientExerciseLanguage,
  Record<PatientCameraTrackingReassuranceState, PatientCameraTrackingReassuranceCopy>
> = {
  en: {
    good: { label: "Camera tracking", status: "Good" },
    adjusting: { label: "Camera tracking", status: "Adjusting" },
  },
  ar: {
    good: { label: "تتبع الكاميرا", status: "جيد" },
    adjusting: { label: "تتبع الكاميرا", status: "جارٍ الضبط" },
  },
};

/**
 * Maps detector tracking status to patient-facing reassurance copy only.
 * Never exposes clinical quality tiers or negative labels.
 */
export function resolvePatientCameraTrackingReassuranceState(
  trackingStatus: ShoulderAbductionReachTrackingStatus | null | undefined,
): PatientCameraTrackingReassuranceState {
  return trackingStatus === "tracking" ? "good" : "adjusting";
}

export function resolvePatientCameraTrackingReassuranceCopy(
  language: PatientExerciseLanguage,
  trackingStatus: ShoulderAbductionReachTrackingStatus | null | undefined,
): PatientCameraTrackingReassuranceCopy {
  const state = resolvePatientCameraTrackingReassuranceState(trackingStatus);
  return COPY[language][state];
}
