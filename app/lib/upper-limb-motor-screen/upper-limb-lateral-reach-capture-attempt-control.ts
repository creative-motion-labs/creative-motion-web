/**
 * Clinician-shell attempt control for Upper Limb Lateral Reach capture.
 *
 * Stricter than the dev lab's canEndAttemptWindow: Finish is only available
 * after real movement onset. Does not modify engine or detector behavior.
 */

import type {
  LateralReachCameraSnapshot,
  LateralReachCameraStatus,
} from "@/app/lib/cv/lateral-reach-camera-detector";
import type { LateralReachRuntimeSnapshot } from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import type { LateralReachCalibrationControllerOutcome } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import { shouldRetainDetectorAcquisitionForTerminalCalibration } from "@/app/clinician/lateral-reach-camera-lab/calibration-engine-handoff";
import type {
  UpperLimbMovementAttemptResult,
  UpperLimbSide,
} from "@/app/lib/upper-limb-motor-screen/types";
import { LATERAL_REACH_DEMO_TECHNICAL_CONFIG } from "@/app/lib/upper-limb-motor-screen/lateral-reach-demo-preset";

/** Visual-only CSS transform for clinician preview — does not affect CV coordinates. */
export const CLINICIAN_LATERAL_REACH_PREVIEW_MIRROR_TRANSFORM = "scaleX(-1)" as const;

const PRE_MOVEMENT_ENGINE_PHASES = new Set<LateralReachRuntimeSnapshot["phase"]>([
  "idle",
  "awaiting_readiness",
  "ready_confirmed_awaiting_onset",
]);

export function canClinicianFinishLateralReachAttempt(
  detectorStatus: LateralReachCameraStatus,
  engineSnapshot: LateralReachRuntimeSnapshot | null,
): boolean {
  if (detectorStatus !== "running") return false;
  if (engineSnapshot === null) return false;
  if (engineSnapshot.terminal) return false;
  if (PRE_MOVEMENT_ENGINE_PHASES.has(engineSnapshot.phase)) return false;
  return true;
}

export function shouldAdvanceClinicianAttemptResult(
  result: UpperLimbMovementAttemptResult | null,
): result is UpperLimbMovementAttemptResult {
  if (result === null) return false;
  return result.completionState !== "not_started";
}

/** Demo overlay threshold — visual guidance only; calibration uses locked config separately. */
const ACQUISITION_TRACKING_VISIBILITY =
  LATERAL_REACH_DEMO_TECHNICAL_CONFIG.tracking.minWristVisibility;

export function resolveLateralReachTrackingGuidance(
  snapshot: LateralReachCameraSnapshot | null,
  testedSide: UpperLimbSide,
): string | null {
  if (!snapshot) return null;
  if (snapshot.status !== "acquiring" && snapshot.status !== "running") {
    return null;
  }

  const hasAnyPoseSignal =
    snapshot.rightWristVisibility !== null || snapshot.leftWristVisibility !== null;
  if (!hasAnyPoseSignal) {
    return "Move back and keep your upper body and tested arm visible in the frame.";
  }

  const testedVisibility =
    testedSide === "right" ? snapshot.rightWristVisibility : snapshot.leftWristVisibility;
  if (
    testedVisibility === null ||
    testedVisibility < ACQUISITION_TRACKING_VISIBILITY
  ) {
    return "Tracking interrupted — adjust position so your tested arm stays clearly visible.";
  }

  return null;
}

export function formatLateralReachPatientArmLabel(testedSide: UpperLimbSide): string {
  return testedSide === "right" ? "right arm" : "left arm";
}

export function resolveLateralReachPatientPositionStatus(
  snapshot: LateralReachCameraSnapshot | null,
  testedSide: UpperLimbSide,
): string {
  const armLabel = formatLateralReachPatientArmLabel(testedSide);
  const trackingIssue = resolveLateralReachPatientTrackingMessage(snapshot, testedSide);
  if (trackingIssue) {
    return `Stand still and keep your ${armLabel} visible.`;
  }
  return "Position detected";
}

export function isLateralReachPatientPositionReady(
  snapshot: LateralReachCameraSnapshot | null,
  testedSide: UpperLimbSide,
): boolean {
  return resolveLateralReachPatientTrackingMessage(snapshot, testedSide) === null;
}

export function resolveLateralReachPatientReachInstruction(testedSide: UpperLimbSide): string {
  const armLabel = formatLateralReachPatientArmLabel(testedSide);
  return `Raise your ${armLabel} out to the side as far as you comfortably can.`;
}

export function shouldAutoFinalizeLateralReachPatientAttempt(
  engineSnapshot: LateralReachRuntimeSnapshot | null,
): boolean {
  if (engineSnapshot === null || engineSnapshot.terminal) {
    return false;
  }
  return (
    engineSnapshot.phase === "completed_pending_finalization" &&
    engineSnapshot.returnToStartCompleted
  );
}

type PatientCalibrationPhase = "capturing_start" | "capturing_endpoint" | null;

export function resolveLateralReachPatientMovementStatus(input: {
  snapshot: LateralReachCameraSnapshot | null;
  testedSide: UpperLimbSide;
  calibrationPhase: PatientCalibrationPhase;
  testStarted: boolean;
  movementActive: boolean;
}): string | null {
  if (!input.testStarted) {
    return null;
  }

  const trackingIssue = resolveLateralReachPatientTrackingMessage(input.snapshot, input.testedSide);
  if (trackingIssue) {
    return trackingIssue;
  }

  if (!input.movementActive) {
    return "Hold still";
  }

  if (input.calibrationPhase === "capturing_start") {
    return "Hold still";
  }
  if (input.calibrationPhase === "capturing_endpoint") {
    return resolveLateralReachPatientRaiseArmMessage(input.testedSide);
  }

  const enginePhase = input.snapshot?.engineSnapshot?.phase;
  if (!enginePhase) {
    return "Hold still";
  }

  switch (enginePhase) {
    case "idle":
    case "awaiting_readiness":
    case "ready_confirmed_awaiting_onset":
      return "Hold still";
    case "outbound":
      return resolveLateralReachPatientRaiseArmMessage(input.testedSide);
    case "dwelling":
    case "reach_confirmed":
      return "Keep going to your maximum comfortable reach";
    case "returning":
    case "completed_pending_finalization":
      return resolveLateralReachPatientReturnMessage(input.testedSide);
    default:
      return "Hold still";
  }
}

export function resolveLateralReachPatientMovementSpeechCue(
  status: string | null,
  testedSide: UpperLimbSide,
): "stand-still" | "reach-out" | "return-start" | null {
  if (!status) return null;
  if (status === "Hold still") return "stand-still";
  if (status === resolveLateralReachPatientRaiseArmMessage(testedSide)) return "reach-out";
  if (status === resolveLateralReachPatientReturnMessage(testedSide)) return "return-start";
  return null;
}

function resolveLateralReachPatientRaiseArmMessage(testedSide: UpperLimbSide): string {
  const armLabel = formatLateralReachPatientArmLabel(testedSide);
  return `Raise your ${armLabel} to the side`;
}

function resolveLateralReachPatientReturnMessage(testedSide: UpperLimbSide): string {
  const armLabel = formatLateralReachPatientArmLabel(testedSide);
  return `Now return your ${armLabel} to the starting position`;
}

function resolveLateralReachPatientTrackingMessage(
  snapshot: LateralReachCameraSnapshot | null,
  testedSide: UpperLimbSide,
): string | null {
  if (!snapshot) return null;
  if (snapshot.status !== "acquiring" && snapshot.status !== "running") {
    return null;
  }

  const armLabel = formatLateralReachPatientArmLabel(testedSide);
  const hasAnyPoseSignal =
    snapshot.rightWristVisibility !== null || snapshot.leftWristVisibility !== null;
  if (!hasAnyPoseSignal) {
    return `Tracking interrupted — keep your ${armLabel} and upper body visible.`;
  }

  const testedVisibility =
    testedSide === "right" ? snapshot.rightWristVisibility : snapshot.leftWristVisibility;
  if (
    testedVisibility === null ||
    testedVisibility < ACQUISITION_TRACKING_VISIBILITY
  ) {
    return `Tracking interrupted — keep your ${armLabel} and upper body visible.`;
  }

  return null;
}

export const PATIENT_CALIBRATION_FAILURE_MESSAGE =
  "We could not detect your position. Stand where your upper body and arm are fully visible, then try again." as const;

export function getPatientCalibrationFailureMessage(
  outcome: LateralReachCalibrationControllerOutcome | null,
): string | null {
  if (outcome === null || outcome.kind === "cancelled") {
    return null;
  }
  if (shouldRetainDetectorAcquisitionForTerminalCalibration(outcome)) {
    return null;
  }
  return PATIENT_CALIBRATION_FAILURE_MESSAGE;
}
