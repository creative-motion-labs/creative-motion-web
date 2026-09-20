/**
 * Clinician-shell calibration policy for Upper Limb Lateral Reach capture.
 *
 * Differs from the dev lab: failed terminal calibration keeps acquisition alive
 * so therapists can retry without reopening the camera.
 */

import type { LateralReachCameraStatus } from "@/app/lib/cv/lateral-reach-camera-detector";
import type { LateralReachCalibrationControllerOutcome } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import { shouldRetainDetectorAcquisitionForTerminalCalibration } from "@/app/clinician/lateral-reach-camera-lab/calibration-engine-handoff";
import type { CalibrationStartEligibility } from "@/app/clinician/lateral-reach-camera-lab/calibration-attempt-runtime";

export const CLINICIAN_CALIBRATION_FAILURE_MESSAGE =
  "Calibration did not complete. Hold steady in the starting position, then reach laterally and retry." as const;

/**
 * Clinician shell never stops the detector from the calibration observation
 * callback. Explicit Stop/Cancel handlers remain responsible for teardown.
 */
export function shouldStopDetectorAfterTerminalCalibrationObservation(
  _outcome: LateralReachCalibrationControllerOutcome | null,
): boolean {
  return false;
}

export function getClinicianCalibrationFailureMessage(
  outcome: LateralReachCalibrationControllerOutcome | null,
): string | null {
  if (outcome === null || outcome.kind === "cancelled") {
    return null;
  }
  if (shouldRetainDetectorAcquisitionForTerminalCalibration(outcome)) {
    return null;
  }
  return CLINICIAN_CALIBRATION_FAILURE_MESSAGE;
}

export function shouldRetainAcquisitionAfterTerminalCalibration(
  outcome: LateralReachCalibrationControllerOutcome | null,
): boolean {
  return shouldRetainDetectorAcquisitionForTerminalCalibration(outcome);
}

/**
 * Retry calibration while the camera is already acquiring (post-failure path).
 */
export function checkClinicianCalibrationRetryEligibility(
  detectorStatus: LateralReachCameraStatus,
  legacyStartInProgress: boolean,
  calibrationStartupOwned: boolean,
  activeCalibrationExists: boolean,
  attemptPlanLocked: boolean,
  technicalConfigLocked: boolean,
  engineActive: boolean,
): CalibrationStartEligibility {
  if (legacyStartInProgress) {
    return { allowed: false, reason: "legacy_start_in_progress" };
  }
  if (calibrationStartupOwned) {
    return { allowed: false, reason: "calibration_startup_in_progress" };
  }
  if (activeCalibrationExists) {
    return { allowed: false, reason: "active_calibration_exists" };
  }
  if (!attemptPlanLocked) {
    return { allowed: false, reason: "attempt_plan_not_locked" };
  }
  if (!technicalConfigLocked) {
    return { allowed: false, reason: "technical_config_not_locked" };
  }
  if (engineActive) {
    return { allowed: false, reason: "engine_already_active" };
  }
  if (detectorStatus !== "acquiring") {
    return { allowed: false, reason: "detector_not_acquiring" };
  }
  return { allowed: true };
}
