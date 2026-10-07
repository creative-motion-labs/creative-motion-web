/**
 * Shoulder Abduction Reach — dev-only ML research capture schema.
 * RASQ ML bridge, Slice 1 (2026-08-19).
 *
 * DEV/RESEARCH ONLY. This schema is deliberately NOT `cv_session_metrics`
 * and NOT any other production Supabase table: it exists to unblock the
 * technical-development stage of the RASQ ML bridge (see the Slice 1
 * project report), using internal volunteers, entirely local to a
 * developer's machine. It must never be written to production storage, and
 * `app/lib/cv/cv-forbidden-keys.ts`'s guard on `cv_session_metrics` is left
 * untouched by this module — this schema lives in a completely separate
 * pipeline on purpose.
 *
 * Not coupled to raw MediaPipe landmark arrays: every joint below is the
 * `MotionFrameJoint` shape RASQ already defines in
 * `app/lib/motion-intelligence/types.ts`, i.e. exactly what
 * `NormalizedMotionFrame.joints` already produces — this schema just picks
 * out the eight joints relevant to this exercise instead of inventing a new
 * per-joint shape.
 */

import type { MotionFrameJoint } from "@/app/lib/motion-intelligence";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

/** Bumped whenever the on-disk record shape (context + time-series envelope) changes. */
export const ML_RESEARCH_CAPTURE_SCHEMA_VERSION = "shoulder-abduction-reach-capture-v1" as const;

/**
 * Bumped whenever the derived-feature *computation* changes, independent of
 * the envelope.
 *
 * v1 (2026-08-19): first raising-frame trunk baseline; tracking quality
 * without `minCoreJointVisibility`. Persisted on the validated 29-rep session.
 *
 * v2 (2026-08-19): pre-onset resting-frame trunk baseline (see
 * `rep-recorder.ts`); adds optional `minCoreJointVisibility` to tracking
 * quality. New captures only — v1 records on disk are never rewritten.
 */
export const ML_RESEARCH_FEATURE_SCHEMA_VERSION = "shoulder-abduction-reach-features-v2" as const;

/** Prior feature schema — still readable; stored on existing capture JSONL lines. */
export const ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1 = "shoulder-abduction-reach-features-v1" as const;

/**
 * The eight joints captured per frame: the affected side's core exercise
 * joints (hip/shoulder/elbow), its bonus wrist joint, and the CONTRALATERAL
 * shoulder/hip — captured bilaterally because the normalized trunk-drift
 * feature (`computeShoulderAbductionReachNormalizedTrunkDrift`) needs both
 * shoulders, and future trunk analysis may need both hips too.
 */
export const ML_RESEARCH_CAPTURED_JOINT_IDS = [
  "left_hip",
  "right_hip",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
] as const;

export type MlResearchCapturedJointId = (typeof ML_RESEARCH_CAPTURED_JOINT_IDS)[number];

export type MlResearchCapturedJoints = Partial<Record<MlResearchCapturedJointId, MotionFrameJoint>>;

/** One captured frame within a completed repetition's time series. */
export type ShoulderAbductionReachCapturedFrame = {
  /** Milliseconds since the first frame of this repetition (frame 0 = 0). */
  relativeTimestampMs: number;
  /** Zero-based index of this frame within the repetition. */
  frameIndex: number;
  joints: MlResearchCapturedJoints;
};

export type ShoulderAbductionReachTrackingQualitySummary = {
  framesTotal: number;
  /** Count of frames where `computeShoulderAbductionAngle` returned a usable value. */
  framesWithUsableAngle: number;
  /** framesWithUsableAngle / framesTotal, or null when framesTotal is 0. */
  usableFrameRatio: number | null;
  /**
   * Minimum MediaPipe visibility observed across the exercised side's core
   * joints (hip, shoulder, elbow) in any frame where those joints were
   * present. A coarse capture-quality summary only — not a clinical
   * tracking-confidence score. Absent on v1 persisted records — readers
   * treat a missing value as `null`.
   */
  minCoreJointVisibility?: number | null;
};

/**
 * Technical, non-clinical features derived once per completed repetition.
 * Explicitly NOT a clinical measurement — see each field's comment.
 */
export type ShoulderAbductionReachDerivedFeatures = {
  /**
   * Scale-normalized trunk-drift ratio at the frame with the largest drift
   * during this repetition (see `computeShoulderAbductionReachNormalizedTrunkDrift`
   * for the normalization rationale). Baseline (features-v2): the last
   * pre-onset resting-frame hip→shoulder deltaX observed immediately before
   * the raising transition — not the live session-long baseline
   * `updateShoulderAbductionReachCompensation` uses. v1 records used the
   * first raising frame instead. Null when no frame had a usable ratio.
   */
  peakNormalizedTrunkDriftRatio: number | null;
  /**
   * Peak 2D shoulder-abduction angle estimate (degrees) observed during this
   * repetition — the maximum valid frame from `computeShoulderAbductionAngle`
   * over the captured frames. A single-camera, image-space technical
   * estimate only; NOT a clinical goniometric ROM measurement (same framing
   * as `shoulder-abduction-reach-metrics.ts`).
   *
   * Conceptually equivalent to a "peak shoulder-elevation estimate" in the
   * research brief; kept as `peakShoulderAngleDegrees` to match the existing
   * shoulder-rehabilitation metric name. Under this exercise's angle
   * convention (~0 deg at rest), the peak already IS the technical
   * excursion from the resting posture, so a separate ROM field is omitted.
   */
  peakShoulderAngleDegrees: number | null;
  /** Last captured frame's relativeTimestampMs minus the first's. */
  movementDurationMs: number;
  /**
   * Largest frame-to-frame |change in shoulder angle / change in time|
   * observed during the repetition, in degrees per second. A secondary
   * technical velocity feature for research only — not a clinical velocity
   * measurement and not a smoothness metric (no SPARC/LDLJ in this slice).
   * Null when fewer than two consecutive frames had a usable angle.
   */
  peakAngularVelocityDegPerSec: number | null;
  trackingQuality: ShoulderAbductionReachTrackingQualitySummary;
};

export type ShoulderAbductionReachRepCaptureContext = {
  captureSchemaVersion: typeof ML_RESEARCH_CAPTURE_SCHEMA_VERSION;
  featureSchemaVersion: typeof ML_RESEARCH_FEATURE_SCHEMA_VERSION;
  /** Anonymous development participant identifier — never a production/clinical patient ID. */
  participantId: string;
  /** Identifier for one local dev capture session (may contain many repetitions). */
  devSessionId: string;
  /** 1-based index of this repetition within the dev session. */
  repetitionIndex: number;
  /** Stable per-repetition identifier: `${devSessionId}-rep-${repetitionIndex}`. */
  repetitionId: string;
  side: ShoulderAbductionReachSide;
  movementType: "shoulder_abduction_reach";
  /** Absolute capture-clock timestamp (ms) of the first captured frame. */
  startedAtMs: number;
  /** Absolute capture-clock timestamp (ms) of the last captured frame. */
  endedAtMs: number;
  /**
   * Optional, explicitly non-clinical field for internal test fixtures only
   * (e.g. "normal" | "simulated_trunk_lean"). NEVER therapist ground truth —
   * see `app/lib/ml-research/shoulder-abduction-reach/README.md`.
   */
  simulationCondition?: string;
};

export type ShoulderAbductionReachRepCaptureRecord = {
  context: ShoulderAbductionReachRepCaptureContext;
  frames: ShoulderAbductionReachCapturedFrame[];
  derivedFeatures: ShoulderAbductionReachDerivedFeatures;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidTrackingQualitySummary(value: unknown): value is ShoulderAbductionReachTrackingQualitySummary {
  if (!value || typeof value !== "object") return false;
  const trackingQuality = value as Partial<ShoulderAbductionReachTrackingQualitySummary>;
  if (!Number.isInteger(trackingQuality.framesTotal)) return false;
  if (!Number.isInteger(trackingQuality.framesWithUsableAngle)) return false;
  if (
    trackingQuality.usableFrameRatio !== null &&
    !Number.isFinite(trackingQuality.usableFrameRatio)
  ) {
    return false;
  }
  if ("minCoreJointVisibility" in trackingQuality) {
    const visibility = trackingQuality.minCoreJointVisibility;
    if (visibility !== null && visibility !== undefined && !Number.isFinite(visibility)) {
      return false;
    }
  }
  return true;
}

/**
 * Validates the minimum on-disk capture record shape required before Slice 5
 * training export dereferences source JSONL lines. Aligns with the manifest
 * assembly capture contract for context/frames identity, plus the derived
 * feature fields the exporter reads for QC metadata.
 */
export function isValidShoulderAbductionReachRepCaptureRecordForTrainingExport(
  value: unknown,
): value is ShoulderAbductionReachRepCaptureRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as {
    context?: unknown;
    frames?: unknown;
    derivedFeatures?: unknown;
  };
  if (!record.context || typeof record.context !== "object") return false;
  if (!Array.isArray(record.frames)) return false;
  if (!record.derivedFeatures || typeof record.derivedFeatures !== "object") return false;

  const context = record.context as Record<string, unknown>;
  if (!isNonEmptyString(context.captureSchemaVersion)) return false;
  if (!isNonEmptyString(context.featureSchemaVersion)) return false;
  if (!isNonEmptyString(context.participantId)) return false;
  if (!isNonEmptyString(context.devSessionId)) return false;
  if (!isNonEmptyString(context.repetitionId)) return false;
  if (!isNonEmptyString(context.movementType)) return false;
  if (!Number.isInteger(context.repetitionIndex)) return false;
  if (context.side !== "left" && context.side !== "right") return false;
  if (!Number.isFinite(context.startedAtMs)) return false;
  if (!Number.isFinite(context.endedAtMs)) return false;

  const derivedFeatures = record.derivedFeatures as Record<string, unknown>;
  if (!Number.isFinite(derivedFeatures.movementDurationMs)) return false;
  if (!isValidTrackingQualitySummary(derivedFeatures.trackingQuality)) return false;

  return true;
}
