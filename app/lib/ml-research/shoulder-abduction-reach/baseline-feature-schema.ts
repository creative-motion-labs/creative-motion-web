/**
 * Shoulder Abduction Reach — baseline experiment feature schema.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Versioned, auditable feature names for the transparent baseline classifier.
 * Features are derived ONLY from pose-frame model input (+ exercised side for
 * joint selection). Identity, labels, QC metadata, and deterministic
 * compensation outputs are never included.
 */

import { BASELINE_FEATURE_SCHEMA_VERSION } from "./baseline-experiment-schema";

/** Ordered feature names — index order is the model input vector order. */
export const BASELINE_FEATURE_NAMES = [
  "frame_count_norm",
  "movement_duration_sec",
  "wrist_y_mean",
  "wrist_y_std",
  "wrist_y_range",
  "shoulder_elbow_distance_mean",
  "shoulder_elbow_distance_std",
  "trunk_width_mean",
  "trunk_width_std",
  "peak_wrist_elevation",
  "core_joint_presence_ratio",
] as const;

export type BaselineFeatureName = (typeof BASELINE_FEATURE_NAMES)[number];

export type BaselineFeatureVector = {
  featureSchemaVersion: typeof BASELINE_FEATURE_SCHEMA_VERSION;
  values: number[];
};

/** Keys that must never appear in a baseline feature vector or its metadata. */
export const FORBIDDEN_BASELINE_FEATURE_KEYS = [
  "participantId",
  "devSessionId",
  "repetitionId",
  "raterId",
  "labeledAtMs",
  "compensationLabel",
  "peakNormalizedTrunkDriftRatio",
  "peakShoulderAngleDegrees",
  "peakAngularVelocityDegPerSec",
  "reviewCaution",
  "note",
] as const;

export function assertBaselineFeatureVectorShape(vector: BaselineFeatureVector): void {
  if (vector.featureSchemaVersion !== BASELINE_FEATURE_SCHEMA_VERSION) {
    throw new Error(
      `unsupported baseline feature schema: ${vector.featureSchemaVersion}`,
    );
  }
  if (vector.values.length !== BASELINE_FEATURE_NAMES.length) {
    throw new Error(
      `baseline feature vector length mismatch: expected ${BASELINE_FEATURE_NAMES.length}, got ${vector.values.length}`,
    );
  }
  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new Error("baseline feature vector contains non-finite value");
    }
  }
}
