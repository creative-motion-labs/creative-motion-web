/**
 * Shoulder Flexion — per-frame elevation metric.
 *
 * Camera-derived shoulder elevation observation: upper-arm angle from downward
 * vertical using shoulder→elbow in image space. Intended for side-view capture.
 * Not clinical goniometry. */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import { isJointConfident } from "@/app/lib/motion-intelligence";
import { BLAZEPOSE_SIDE_INDICES } from "./battery-tracking";
import type { ShoulderFlexionSide } from "./shoulder-flexion-contract";
import { SHOULDER_FLEXION_CORE_JOINTS } from "./shoulder-flexion-contract";

function rawLandmarkConfident(visibility: number | undefined, minConfidence: number): boolean {
  const value = visibility ?? 0;
  return isJointConfident({ visibility: value, present: value >= minConfidence }, minConfidence);
}

function computeUpperArmElevationFromDownDegrees(
  shoulder: { x: number; y: number },
  elbow: { x: number; y: number },
): number | null {
  const dx = elbow.x - shoulder.x;
  const dy = elbow.y - shoulder.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const armLength = Math.hypot(dx, dy);
  if (armLength < 1e-6) return null;
  const cosAngle = dy / armLength;
  const clamped = Math.max(-1, Math.min(1, cosAngle));
  const degrees = (Math.acos(clamped) * 180) / Math.PI;
  if (!Number.isFinite(degrees) || degrees < 0 || degrees > 180) return null;
  return degrees;
}

export function computeShoulderFlexionElevationDegrees(
  frame: NormalizedMotionFrame,
  side: ShoulderFlexionSide,
  minConfidence: number,
): number | null {
  const { shoulder: shoulderId, elbow: elbowId } = SHOULDER_FLEXION_CORE_JOINTS[side];
  const shoulder = frame.joints[shoulderId];
  const elbow = frame.joints[elbowId];
  if (!shoulder || !elbow) return null;
  if (!isJointConfident(shoulder.confidence, minConfidence)) return null;
  if (!isJointConfident(elbow.confidence, minConfidence)) return null;

  return computeUpperArmElevationFromDownDegrees(shoulder.landmark, elbow.landmark);
}

export function canObserveShoulderFlexionArm(
  landmarks: readonly PoseLandmark[],
  side: ShoulderFlexionSide,
  minConfidence: number,
): boolean {
  const indices = BLAZEPOSE_SIDE_INDICES[side];
  const shoulder = landmarks[indices.shoulder];
  const elbow = landmarks[indices.elbow];
  if (!shoulder || !elbow) return false;
  if (!rawLandmarkConfident(shoulder.visibility, minConfidence)) return false;
  if (!rawLandmarkConfident(elbow.visibility, minConfidence)) return false;
  return computeUpperArmElevationFromDownDegrees(shoulder, elbow) !== null;
}

/** Fallback when acquisition omits near-edge joints from the normalized frame. */
export function computeShoulderFlexionElevationFromPoseLandmarks(
  landmarks: readonly PoseLandmark[],
  side: ShoulderFlexionSide,
  minConfidence: number,
): number | null {
  const indices = BLAZEPOSE_SIDE_INDICES[side];
  const shoulder = landmarks[indices.shoulder];
  const elbow = landmarks[indices.elbow];
  if (!shoulder || !elbow) return null;
  if (!rawLandmarkConfident(shoulder.visibility, minConfidence)) return null;
  if (!rawLandmarkConfident(elbow.visibility, minConfidence)) return null;

  return computeUpperArmElevationFromDownDegrees(shoulder, elbow);
}
