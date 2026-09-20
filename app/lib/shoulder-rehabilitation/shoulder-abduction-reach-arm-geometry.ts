/**
 * Shoulder Abduction Reach — affected-side arm geometry extraction (CHANGE-002).
 *
 * Pure reader over an already-normalized `NormalizedMotionFrame`. It selects the
 * affected side's shoulder / elbow / wrist through the existing joint contracts
 * (`SHOULDER_ABDUCTION_REACH_CORE_JOINTS` and `..._BONUS_JOINTS`) and reports an
 * estimated arm length. It introduces no new confidence rule: a joint is usable
 * only when the frame already marked it `confidence.present === true`, which the
 * BlazePose acquisition adapter sets from `visibility >= MIN_PRESENT_VISIBILITY`.
 * No threshold is lowered here to make a value available.
 *
 * WHAT THIS IS NOT: the arm length produced here is an ESTIMATE derived from
 * two normalized on-screen segment lengths in a single camera view. It is not an
 * anthropometric limb measurement, not a calibrated distance, and carries no
 * clinical meaning. It exists solely to give adaptive target placement a
 * patient-relative reach scale instead of a hard-coded screen distance.
 *
 * This module lives beside the joint contracts rather than under
 * `interactive-shoulder/adaptive/` because `app/lib/cv` (the live detector) must
 * consume it, and `cv -> interactive-shoulder` is not an existing dependency
 * direction in this repository.
 */

import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import type { JointId } from "@/app/lib/motion-intelligence";
import {
  SHOULDER_ABDUCTION_REACH_BONUS_JOINTS,
  SHOULDER_ABDUCTION_REACH_CORE_JOINTS,
  type ShoulderAbductionReachSide,
} from "./shoulder-abduction-reach-contract";

/** Normalized preview-space point, same space as `primaryWristNormalized`. */
export type ShoulderAbductionReachNormalizedPoint = { x: number; y: number };

export type ShoulderAbductionReachArmGeometry = {
  /** Affected-side shoulder, or null when absent / below the existing presence rule. */
  shoulder: ShoulderAbductionReachNormalizedPoint | null;
  /** Affected-side elbow, or null when absent / below the existing presence rule. */
  elbow: ShoulderAbductionReachNormalizedPoint | null;
  /** Affected-side wrist, or null when absent / below the existing presence rule. */
  wrist: ShoulderAbductionReachNormalizedPoint | null;
  /**
   * shoulder→elbow plus elbow→wrist normalized distance.
   * Null unless all three joints are individually usable — never fabricated.
   */
  estimatedArmLengthNormalized: number | null;
};

/** Explicit "nothing usable this frame" value — avoids inventing coordinates. */
export const EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY: ShoulderAbductionReachArmGeometry = {
  shoulder: null,
  elbow: null,
  wrist: null,
  estimatedArmLengthNormalized: null,
};

/**
 * Reads one joint using the frame's existing presence flag. Returns null rather
 * than a partial or fabricated point.
 */
function readPresentJoint(
  frame: NormalizedMotionFrame,
  jointId: JointId,
): ShoulderAbductionReachNormalizedPoint | null {
  const joint = frame.joints[jointId];
  if (joint?.confidence.present !== true) {
    return null;
  }
  const { x, y } = joint.landmark;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

/**
 * Estimates arm length as the sum of the two visible arm segments.
 * Returns null when any joint is unavailable or the sum is not a usable
 * positive finite number — callers must handle null, not substitute a default.
 */
export function estimateShoulderAbductionReachArmLength(
  shoulder: ShoulderAbductionReachNormalizedPoint | null,
  elbow: ShoulderAbductionReachNormalizedPoint | null,
  wrist: ShoulderAbductionReachNormalizedPoint | null,
): number | null {
  if (!shoulder || !elbow || !wrist) {
    return null;
  }
  const upperArm = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
  const forearm = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const total = upperArm + forearm;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return total;
}

/**
 * Extracts the affected side's arm geometry. Pure and deterministic: it reads the
 * frame and never mutates it, reads no clock, and uses no randomness.
 */
export function extractShoulderAbductionReachArmGeometry(
  frame: NormalizedMotionFrame,
  side: ShoulderAbductionReachSide,
): ShoulderAbductionReachArmGeometry {
  const { shoulder: shoulderId, elbow: elbowId } = SHOULDER_ABDUCTION_REACH_CORE_JOINTS[side];
  const { wrist: wristId } = SHOULDER_ABDUCTION_REACH_BONUS_JOINTS[side];

  const shoulder = readPresentJoint(frame, shoulderId);
  const elbow = readPresentJoint(frame, elbowId);
  const wrist = readPresentJoint(frame, wristId);

  return {
    shoulder,
    elbow,
    wrist,
    estimatedArmLengthNormalized: estimateShoulderAbductionReachArmLength(shoulder, elbow, wrist),
  };
}
