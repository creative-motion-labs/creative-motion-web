/**
 * Shoulder Flexion — contract (remote battery v1).
 *
 * Camera-derived shoulder elevation observation when the tested side faces
 * the camera. Distinct from shoulder abduction (hip-shoulder-elbow angle).
 * Not clinical goniometry — for therapist review only.
 */

import { DEFAULT_MIN_JOINT_VISIBILITY, type JointId } from "@/app/lib/motion-intelligence";

export type ShoulderFlexionSide = "left" | "right";

export type ShoulderFlexionCoreJoints = {
  shoulder: JointId;
  elbow: JointId;
};

export const SHOULDER_FLEXION_CORE_JOINTS: Record<ShoulderFlexionSide, ShoulderFlexionCoreJoints> = {
  left: { shoulder: "left_shoulder", elbow: "left_elbow" },
  right: { shoulder: "right_shoulder", elbow: "right_elbow" },
};

export type ShoulderFlexionPhase =
  | "resting"
  | "raising"
  | "peak_flexion"
  | "lowering"
  | "unknown";

export type ShoulderFlexionThresholds = {
  minJointConfidence: number;
  restingMaxElevationDegrees: number;
  peakMinElevationDegrees: number;
  peakLowerHysteresisDegrees: number;
  poseLostUnknownMinTicks: number;
};

/** Technical defaults — camera-derived observation, not clinical ROM. */
export const DEFAULT_SHOULDER_FLEXION_THRESHOLDS: ShoulderFlexionThresholds = {
  minJointConfidence: DEFAULT_MIN_JOINT_VISIBILITY,
  restingMaxElevationDegrees: 25,
  peakMinElevationDegrees: 55,
  peakLowerHysteresisDegrees: 10,
  poseLostUnknownMinTicks: 8,
};
