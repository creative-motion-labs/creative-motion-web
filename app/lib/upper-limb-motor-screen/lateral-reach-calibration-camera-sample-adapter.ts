/**
 * Lateral Reach — Slice 12: calibration camera-sample adapter.
 *
 * Pure structural bridge from NormalizedMotionFrame + testedSide wrist
 * selection + externally supplied minWristVisibility into one Slice 11
 * controller sample.
 *
 * Does NOT own camera technology, engine config, controller lifecycle,
 * direction intention, framing validity, numeric production thresholds,
 * or timestamp repair.
 */

import { isJointConfident } from "@/app/lib/motion-intelligence/frame-validation";
import type {
  JointId,
  NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence/types";
import type { LateralReachCalibrationControllerSample } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

const TESTED_SIDE_WRIST: Readonly<Record<UpperLimbSide, JointId>> = {
  left: "left_wrist",
  right: "right_wrist",
};

const MIN_VISIBILITY_ERROR =
  "minWristVisibility must be a finite number within [0,1]";

function assertFiniteUnitVisibility(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new RangeError(MIN_VISIBILITY_ERROR);
  }
  return value;
}

function isFiniteUnitCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function unusableSample(atMs: number): LateralReachCalibrationControllerSample {
  return {
    atMs,
    wrist: null,
    trackingValid: false,
  };
}

/**
 * Resolve one calibration controller sample from a normalized motion frame.
 * Wrist selection is metadata only; coordinates remain raw camera-space.
 */
export function resolveLateralReachCalibrationSampleFromFrame(
  frame: NormalizedMotionFrame,
  testedSide: UpperLimbSide,
  minWristVisibility: unknown,
): LateralReachCalibrationControllerSample {
  const validatedMinVisibility = assertFiniteUnitVisibility(minWristVisibility);
  const atMs = frame.source.capturedAtMs;
  const jointId = TESTED_SIDE_WRIST[testedSide];
  const joint = frame.joints[jointId];

  if (!joint) {
    return unusableSample(atMs);
  }

  if (!isJointConfident(joint.confidence, validatedMinVisibility)) {
    return unusableSample(atMs);
  }

  const { x, y } = joint.landmark;
  if (!isFiniteUnitCoordinate(x) || !isFiniteUnitCoordinate(y)) {
    return unusableSample(atMs);
  }

  return {
    atMs,
    wrist: { x, y },
    trackingValid: true,
  };
}
