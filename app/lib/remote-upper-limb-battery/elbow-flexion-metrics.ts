/**
 * Elbow Flexion — interior elbow angle metric (shoulder→elbow→wrist).
 */

import { computeJointAngleDegrees, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import type { ElbowFlexionSide } from "./elbow-flexion-contract";
import { ELBOW_FLEXION_CORE_JOINTS } from "./elbow-flexion-contract";

export function computeElbowFlexionInteriorAngleDegrees(
  frame: NormalizedMotionFrame,
  side: ElbowFlexionSide,
  minConfidence: number,
): number | null {
  const { shoulder: shoulderId, elbow: elbowId, wrist: wristId } = ELBOW_FLEXION_CORE_JOINTS[side];
  const shoulder = frame.joints[shoulderId];
  const elbow = frame.joints[elbowId];
  const wrist = frame.joints[wristId];
  if (!shoulder || !elbow || !wrist) return null;

  return computeJointAngleDegrees(shoulder.landmark, elbow.landmark, wrist.landmark, {
    minConfidence,
    confidences: [shoulder.confidence, elbow.confidence, wrist.confidence],
  });
}
