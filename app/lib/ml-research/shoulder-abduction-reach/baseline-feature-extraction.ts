/**
 * Shoulder Abduction Reach — baseline experiment feature extraction.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Computes a small, transparent feature vector from pose frames ONLY.
 * Does NOT read derivedFeatures from capture records, QC metadata, labels,
 * or deterministic compensation classifier outputs.
 */

import {
  SHOULDER_ABDUCTION_REACH_BONUS_JOINTS,
  SHOULDER_ABDUCTION_REACH_CORE_JOINTS,
  type ShoulderAbductionReachSide,
} from "@/app/lib/shoulder-rehabilitation";
import type { ShoulderAbductionReachCapturedFrame } from "./capture-schema";
import { BASELINE_FEATURE_SCHEMA_VERSION } from "./baseline-experiment-schema";
import {
  assertBaselineFeatureVectorShape,
  BASELINE_FEATURE_NAMES,
  type BaselineFeatureVector,
} from "./baseline-feature-schema";

function distance2d(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readPresentLandmark(
  frame: ShoulderAbductionReachCapturedFrame,
  jointId: string,
): { x: number; y: number } | null {
  const joint = frame.joints[jointId as keyof typeof frame.joints];
  if (!joint || !joint.confidence.present) return null;

  const landmark = joint.landmark;
  if (!landmark) return null;

  const { x, y } = landmark;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  return { x, y };
}

/**
 * Deterministic baseline features from one sample's pose-frame sequence.
 * `side` selects exercised-side joints but is NOT encoded as a feature value.
 */
export function extractBaselineFeaturesFromPoseFrames(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  side: ShoulderAbductionReachSide,
): BaselineFeatureVector {
  const { hip, shoulder, elbow } = SHOULDER_ABDUCTION_REACH_CORE_JOINTS[side];
  const { wrist } = SHOULDER_ABDUCTION_REACH_BONUS_JOINTS[side];

  const wristYValues: number[] = [];
  const shoulderElbowDistances: number[] = [];
  const trunkWidths: number[] = [];
  const wristElevations: number[] = [];
  let coreJointPresentFrames = 0;

  for (const frame of frames) {
    const shoulderLm = readPresentLandmark(frame, shoulder);
    const elbowLm = readPresentLandmark(frame, elbow);
    const wristLm = readPresentLandmark(frame, wrist);
    const hipLm = readPresentLandmark(frame, hip);
    const leftShoulder = readPresentLandmark(frame, "left_shoulder");
    const rightShoulder = readPresentLandmark(frame, "right_shoulder");

    const corePresent =
      shoulderLm !== null && elbowLm !== null && hipLm !== null;
    if (corePresent) {
      coreJointPresentFrames += 1;
    }

    if (wristLm) {
      wristYValues.push(wristLm.y);
    }
    if (shoulderLm && elbowLm) {
      shoulderElbowDistances.push(
        distance2d(shoulderLm.x, shoulderLm.y, elbowLm.x, elbowLm.y),
      );
    }
    if (leftShoulder && rightShoulder) {
      trunkWidths.push(Math.abs(leftShoulder.x - rightShoulder.x));
    }
    if (shoulderLm && wristLm) {
      wristElevations.push(shoulderLm.y - wristLm.y);
    }
  }

  const movementDurationMs =
    frames.length > 0
      ? frames[frames.length - 1].relativeTimestampMs - frames[0].relativeTimestampMs
      : 0;

  const wristYMin = wristYValues.length > 0 ? Math.min(...wristYValues) : 0;
  const wristYMax = wristYValues.length > 0 ? Math.max(...wristYValues) : 0;

  const values = [
    frames.length / 100,
    movementDurationMs / 1000,
    mean(wristYValues),
    std(wristYValues),
    wristYMax - wristYMin,
    mean(shoulderElbowDistances),
    std(shoulderElbowDistances),
    mean(trunkWidths),
    std(trunkWidths),
    wristElevations.length > 0 ? Math.max(...wristElevations) : 0,
    frames.length > 0 ? coreJointPresentFrames / frames.length : 0,
  ];

  const vector: BaselineFeatureVector = {
    featureSchemaVersion: BASELINE_FEATURE_SCHEMA_VERSION,
    values,
  };
  assertBaselineFeatureVectorShape(vector);

  // Sanity: feature name count matches extraction order.
  if (values.length !== BASELINE_FEATURE_NAMES.length) {
    throw new Error("baseline feature extraction produced unexpected dimension");
  }

  return vector;
}
