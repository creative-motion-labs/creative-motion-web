/**
 * Elbow Flexion — contract (remote battery v1).
 */

import { DEFAULT_MIN_JOINT_VISIBILITY, type JointId } from "@/app/lib/motion-intelligence";

export type ElbowFlexionSide = "left" | "right";

export type ElbowFlexionCoreJoints = {
  shoulder: JointId;
  elbow: JointId;
  wrist: JointId;
};

export const ELBOW_FLEXION_CORE_JOINTS: Record<ElbowFlexionSide, ElbowFlexionCoreJoints> = {
  left: { shoulder: "left_shoulder", elbow: "left_elbow", wrist: "left_wrist" },
  right: { shoulder: "right_shoulder", elbow: "right_elbow", wrist: "right_wrist" },
};

export type ElbowFlexionPhase =
  | "resting"
  | "flexing"
  | "peak_flexion"
  | "extending"
  | "unknown";

export type ElbowFlexionThresholds = {
  minJointConfidence: number;
  restingMinInteriorAngleDegrees: number;
  peakMaxInteriorAngleDegrees: number;
  peakRaiseHysteresisDegrees: number;
  poseLostUnknownMinTicks: number;
};

/** Technical defaults — interior elbow angle (shoulder-elbow-wrist), not clinical goniometry. */
export const DEFAULT_ELBOW_FLEXION_THRESHOLDS: ElbowFlexionThresholds = {
  minJointConfidence: DEFAULT_MIN_JOINT_VISIBILITY,
  restingMinInteriorAngleDegrees: 140,
  peakMaxInteriorAngleDegrees: 90,
  peakRaiseHysteresisDegrees: 12,
  poseLostUnknownMinTicks: 8,
};
