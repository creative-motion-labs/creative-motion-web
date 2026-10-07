/**
 * Lateral Reach Camera Lab — acquisition sample diagnostics (lab only).
 *
 * Read-only evidence assembly for calibration acquisition ticks. Uses the
 * existing Slice 19 sample resolver as the sole source of truth for
 * trackingValid. Does not mutate calibration behavior.
 */

import type {
  LateralReachCameraAcquisitionObservation,
  LateralReachCameraStatus,
} from "@/app/lib/cv/lateral-reach-camera-detector";
import type { JointId } from "@/app/lib/motion-intelligence/types";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";
import { resolveLateralReachCalibrationSampleFromObservation } from "./calibration-frame-bridge";

export type CalibrationAcquisitionReasonLabel =
  | "normalized_frame_unavailable"
  | "selected_wrist_missing"
  | "confidence_not_present"
  | "visibility_below_threshold"
  | "tracking_valid";

export type CalibrationAcquisitionDetectorSnapshotEvidence = {
  readonly status: LateralReachCameraStatus;
  readonly rightWristVisibility: number | null;
  readonly leftWristVisibility: number | null;
  readonly rightWristCoords: { x: number; y: number } | null;
  readonly leftWristCoords: { x: number; y: number } | null;
};

export type CalibrationAcquisitionDiagnostic = {
  readonly capturedAtMs: number;
  readonly detectorStatus: LateralReachCameraStatus;
  readonly rawRightWristVisibility: number | null;
  readonly rawRightWristCoords: { x: number; y: number } | null;
  readonly rawLeftWristVisibility: number | null;
  readonly rawLeftWristCoords: { x: number; y: number } | null;
  readonly normalizedFramePresent: boolean;
  readonly selectedWristPresentInFrame: boolean;
  readonly selectedWristConfidencePresent: boolean | null;
  readonly selectedWristVisibility: number | null;
  readonly testedSide: UpperLimbSide;
  readonly minWristVisibility: number;
  readonly trackingValid: boolean;
  readonly reasonLabel: CalibrationAcquisitionReasonLabel | null;
};

export type ResolveCalibrationAcquisitionDiagnosticsInput = {
  readonly observation: LateralReachCameraAcquisitionObservation;
  readonly testedSide: UpperLimbSide;
  readonly minWristVisibility: number;
  readonly detectorSnapshot: CalibrationAcquisitionDetectorSnapshotEvidence;
};

const TESTED_SIDE_WRIST: Readonly<Record<UpperLimbSide, JointId>> = {
  left: "left_wrist",
  right: "right_wrist",
};

function resolveProvableReasonLabel(
  trackingValid: boolean,
  normalizedFramePresent: boolean,
  selectedWristPresentInFrame: boolean,
  selectedWristConfidencePresent: boolean | null,
  selectedWristVisibility: number | null,
  minWristVisibility: number,
): CalibrationAcquisitionReasonLabel | null {
  if (trackingValid) {
    return "tracking_valid";
  }

  if (!normalizedFramePresent) {
    return "normalized_frame_unavailable";
  }

  if (!selectedWristPresentInFrame) {
    return "selected_wrist_missing";
  }

  if (selectedWristConfidencePresent === false) {
    return "confidence_not_present";
  }

  if (
    selectedWristConfidencePresent === true &&
    selectedWristVisibility !== null &&
    selectedWristVisibility < minWristVisibility
  ) {
    return "visibility_below_threshold";
  }

  return null;
}

/**
 * Assemble read-only calibration acquisition diagnostics for one observation
 * tick. trackingValid always comes from resolveLateralReachCalibrationSampleFromObservation.
 */
export function resolveCalibrationAcquisitionDiagnostics(
  input: ResolveCalibrationAcquisitionDiagnosticsInput,
): CalibrationAcquisitionDiagnostic {
  const sample = resolveLateralReachCalibrationSampleFromObservation(
    input.observation,
    input.testedSide,
    input.minWristVisibility,
  );

  const frame = input.observation.frame;
  const normalizedFramePresent = frame !== null;
  const jointId = TESTED_SIDE_WRIST[input.testedSide];
  const joint = frame?.joints[jointId] ?? null;
  const selectedWristPresentInFrame = joint !== null;
  const selectedWristConfidencePresent = joint ? joint.confidence.present : null;
  const selectedWristVisibility = joint ? joint.confidence.visibility : null;

  const trackingValid = sample.trackingValid;
  const reasonLabel = resolveProvableReasonLabel(
    trackingValid,
    normalizedFramePresent,
    selectedWristPresentInFrame,
    selectedWristConfidencePresent,
    selectedWristVisibility,
    input.minWristVisibility,
  );

  return {
    capturedAtMs: input.observation.capturedAtMs,
    detectorStatus: input.detectorSnapshot.status,
    rawRightWristVisibility: input.detectorSnapshot.rightWristVisibility,
    rawRightWristCoords: input.detectorSnapshot.rightWristCoords,
    rawLeftWristVisibility: input.detectorSnapshot.leftWristVisibility,
    rawLeftWristCoords: input.detectorSnapshot.leftWristCoords,
    normalizedFramePresent,
    selectedWristPresentInFrame,
    selectedWristConfidencePresent,
    selectedWristVisibility,
    testedSide: input.testedSide,
    minWristVisibility: input.minWristVisibility,
    trackingValid,
    reasonLabel,
  };
}
