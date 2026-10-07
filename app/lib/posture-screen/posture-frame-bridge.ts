/**
 * Posture Screen — Motion Intelligence frame bridge (Phase-2A).
 *
 * Consumes NormalizedMotionFrame and adapts required joints into the
 * NormLandmark[] representation expected by the Phase-1 posture analyzer.
 *
 * Does NOT reimplement posture scoring/math.
 * Does NOT use acquisition-adapter `present` (threshold 0.2) as the posture gate.
 * Posture visibility gate remains >= 0.3 (enforced here and by analysePostureFrame).
 */
import type { NormLandmark } from "@/app/lib/body-axis-acl-squat";
import type { JointId, NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  analysePostureFrame,
  type PostureCheckResult,
} from "@/app/lib/posture-analyzer";

/** Phase-1 posture visibility threshold (must not use adapter present @ 0.2). */
export const POSTURE_MIN_JOINT_VISIBILITY = 0.3;

/** Minimum joints required for static postural observation. */
export const POSTURE_REQUIRED_JOINT_IDS = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_hip",
  "right_hip",
] as const satisfies readonly JointId[];

export type PostureRequiredJointId = (typeof POSTURE_REQUIRED_JOINT_IDS)[number];

/** BlazePose index mapping for the Phase-1 analyzer slots. */
const POSTURE_JOINT_INDEX: Record<PostureRequiredJointId, number> = {
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_hip: 23,
  right_hip: 24,
};

/**
 * Adapt a NormalizedMotionFrame into a PostureCheckResult via the existing
 * Phase-1 analyser. Returns null when required joints are missing or below
 * the posture visibility threshold.
 */
export function analysePostureNormalizedFrame(
  frame: NormalizedMotionFrame
): PostureCheckResult | null {
  const landmarks: NormLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));

  for (const jointId of POSTURE_REQUIRED_JOINT_IDS) {
    const joint = frame.joints[jointId];
    if (!joint) return null;

    // Use visibility only — ignore confidence.present (adapter threshold 0.2).
    const visibility = joint.confidence.visibility;
    if (typeof visibility !== "number" || !Number.isFinite(visibility)) {
      return null;
    }
    if (visibility < POSTURE_MIN_JOINT_VISIBILITY) {
      return null;
    }

    const { x, y } = joint.landmark;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }

    landmarks[POSTURE_JOINT_INDEX[jointId]] = { x, y, visibility };
  }

  return analysePostureFrame(landmarks);
}
