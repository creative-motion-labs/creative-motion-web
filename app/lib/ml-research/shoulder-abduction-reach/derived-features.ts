/**
 * Shoulder Abduction Reach — dev-only ML research derived features.
 * RASQ ML bridge, Slice 1 (2026-08-19); feature-leak fix + velocity numerical
 * safety in Slice 1.1 (2026-08-19).
 *
 * Computes the per-repetition `ShoulderAbductionReachDerivedFeatures` block
 * from a completed repetition's captured frames. Every number here is
 * produced by an EXISTING pure Motion Intelligence / shoulder-rehabilitation
 * primitive (`computeShoulderAbductionAngle`,
 * `computeShoulderAbductionReachNormalizedTrunkDrift`) — this module reuses
 * them over the captured joint subset, it does not reimplement them.
 *
 * Slice 1.1 root-cause note: `peakShoulderAngleDegrees` previously accepted
 * the live phase FSM's own running `peakAngleDegrees` as a parameter and
 * passed it through unchanged. That value is INTENTIONALLY not reset when a
 * repetition completes (`tickShoulderAbductionReachPhase`'s own doc comment:
 * "retains the most recently finished attempt's peak ... until the next
 * raise begins") — correct for the live FSM's own purpose, but wrong for
 * this module: a real live-capture session showed several near-empty
 * "stub" repetitions all reporting the SAME stale peak angle from an
 * earlier, unrelated real rep, because nothing in this module's own
 * captured frames ever justified that number. `peakShoulderAngleDegrees` is
 * now computed exclusively from THIS repetition's own `computeCapturedAngleTrace`
 * — never from any externally supplied value — so an empty or untracked
 * buffer correctly yields `null` instead of a carried-over number.
 */

import {
  computeShoulderAbductionReachNormalizedTrunkDrift,
  DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS,
} from "@/app/lib/cv/shoulder-abduction-reach-compensation";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence";
import {
  computeShoulderAbductionAngle,
  DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS,
  SHOULDER_ABDUCTION_REACH_CORE_JOINTS,
  type ShoulderAbductionReachSide,
} from "@/app/lib/shoulder-rehabilitation";
import type {
  MlResearchCapturedJointId,
  MlResearchCapturedJoints,
  ShoulderAbductionReachCapturedFrame,
  ShoulderAbductionReachDerivedFeatures,
  ShoulderAbductionReachTrackingQualitySummary,
} from "./capture-schema";

/**
 * Rebuilds a minimal `NormalizedMotionFrame` from a captured frame's joint
 * subset so the existing Motion Intelligence primitives can be reused
 * as-is. Only the fields those primitives read (`schemaVersion`, `joints`)
 * are meaningful here — `source` is filled with the captured frame's own
 * index/timestamp for traceability, not because any primitive reads it.
 */
export function capturedFrameToNormalizedMotionFrame(
  joints: MlResearchCapturedJoints,
  frameIndex: number,
  capturedAtMs: number,
): NormalizedMotionFrame {
  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      kind: "web_camera_pose",
      capturedAtMs,
      frameIndex,
      coordinateSpace: "normalized_2d",
    },
    joints,
  };
}

/**
 * Per-frame abduction angle trace for a completed repetition's captured
 * frames — reused (not recomputed logic) by both the derived-feature
 * computation below and the inspection utility.
 */
export function computeCapturedAngleTrace(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  side: ShoulderAbductionReachSide,
  minConfidence: number = DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS.minJointConfidence,
): (number | null)[] {
  return frames.map((frame) => {
    const normalizedFrame = capturedFrameToNormalizedMotionFrame(
      frame.joints,
      frame.frameIndex,
      frame.relativeTimestampMs,
    );
    return computeShoulderAbductionAngle(normalizedFrame, side, minConfidence);
  });
}

/**
 * Numerical-safety floor for the dt used by the velocity calculation below —
 * NOT a physiological/clinical limit. Two captured samples separated by less
 * than 1ms cannot represent two independently observed instants given
 * `performance.now()`'s realistic resolution and this pipeline's capture
 * cadence; dividing by a dt that small amplifies even sub-degree landmark
 * jitter into an enormous, physically meaningless deg/s figure. This guards
 * the arithmetic only — it never excludes a transition for being "too fast"
 * in angle terms, only for having a degenerate/near-zero time base.
 */
const MIN_VELOCITY_SAMPLE_DT_MS = 1;

function computePeakAngularVelocityDegPerSec(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  angleTrace: readonly (number | null)[],
): number | null {
  let peak: number | null = null;
  for (let i = 1; i < frames.length; i += 1) {
    const previousAngle = angleTrace[i - 1];
    const currentAngle = angleTrace[i];
    if (previousAngle === null || currentAngle === null) continue;

    const dtMs = frames[i].relativeTimestampMs - frames[i - 1].relativeTimestampMs;
    if (dtMs < MIN_VELOCITY_SAMPLE_DT_MS) continue;

    const velocity = Math.abs(currentAngle - previousAngle) / (dtMs / 1_000);
    if (peak === null || velocity > peak) {
      peak = velocity;
    }
  }
  return peak;
}

export type ComputeShoulderAbductionReachDerivedFeaturesOptions = {
  /** Last resting-frame joints immediately before this repetition's raising transition. */
  preOnsetRestingJoints?: MlResearchCapturedJoints | null;
  minConfidence?: number;
};

/** Resolves hip→shoulder deltaX for trunk-drift baseline from pre-onset resting joints, or the first raising frame. */
export function resolveTrunkDriftBaselineDeltaX(
  side: ShoulderAbductionReachSide,
  preOnsetRestingJoints: MlResearchCapturedJoints | null | undefined,
  firstAttemptFrameJoints: MlResearchCapturedJoints,
): number | null {
  const { hip, shoulder } = SHOULDER_ABDUCTION_REACH_CORE_JOINTS[side];
  const baselineJoints = preOnsetRestingJoints ?? firstAttemptFrameJoints;
  const normalizedFrame = capturedFrameToNormalizedMotionFrame(baselineJoints, 0, 0);
  const hipJoint = normalizedFrame.joints[hip];
  const shoulderJoint = normalizedFrame.joints[shoulder];
  if (!hipJoint || !shoulderJoint) return null;
  return shoulderJoint.landmark.x - hipJoint.landmark.x;
}

function computePeakNormalizedTrunkDriftRatio(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  side: ShoulderAbductionReachSide,
  minConfidence: number,
  preOnsetRestingJoints?: MlResearchCapturedJoints | null,
): number | null {
  if (frames.length === 0) return null;

  const baselineDeltaX = resolveTrunkDriftBaselineDeltaX(
    side,
    preOnsetRestingJoints,
    frames[0].joints,
  );
  if (baselineDeltaX === null) return null;

  let peak: number | null = null;
  for (const frame of frames) {
    const normalizedFrame = capturedFrameToNormalizedMotionFrame(
      frame.joints,
      frame.frameIndex,
      frame.relativeTimestampMs,
    );
    const result = computeShoulderAbductionReachNormalizedTrunkDrift(
      normalizedFrame,
      side,
      baselineDeltaX,
      minConfidence,
    );
    if (result && (peak === null || result.ratio > peak)) {
      peak = result.ratio;
    }
  }
  return peak;
}

function computeTrackingQualitySummary(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  side: ShoulderAbductionReachSide,
  framesWithUsableAngle: number,
): ShoulderAbductionReachTrackingQualitySummary {
  const { hip, shoulder, elbow } = SHOULDER_ABDUCTION_REACH_CORE_JOINTS[side];
  let minCoreJointVisibility: number | null = null;

  const coreJointIds = [hip, shoulder, elbow] as MlResearchCapturedJointId[];

  for (const frame of frames) {
    for (const jointId of coreJointIds) {
      const joint = frame.joints[jointId];
      if (!joint) continue;
      const visibility = joint.confidence.visibility;
      if (minCoreJointVisibility === null || visibility < minCoreJointVisibility) {
        minCoreJointVisibility = visibility;
      }
    }
  }

  return {
    framesTotal: frames.length,
    framesWithUsableAngle,
    usableFrameRatio: frames.length > 0 ? framesWithUsableAngle / frames.length : null,
    minCoreJointVisibility,
  };
}

export function computeShoulderAbductionReachDerivedFeatures(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  side: ShoulderAbductionReachSide,
  options: ComputeShoulderAbductionReachDerivedFeaturesOptions = {},
): ShoulderAbductionReachDerivedFeatures {
  const minConfidence =
    options.minConfidence ?? DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS.minConfidence;
  const angleTrace = computeCapturedAngleTrace(frames, side, minConfidence);
  const usableAngles = angleTrace.filter((angle): angle is number => angle !== null);
  const framesWithUsableAngle = usableAngles.length;
  const movementDurationMs =
    frames.length > 0
      ? frames[frames.length - 1].relativeTimestampMs - frames[0].relativeTimestampMs
      : 0;

  return {
    peakNormalizedTrunkDriftRatio: computePeakNormalizedTrunkDriftRatio(
      frames,
      side,
      minConfidence,
      options.preOnsetRestingJoints,
    ),
    // Computed strictly from THIS repetition's own captured frames — see the
    // Slice 1.1 root-cause note in the module doc comment. Never reused from
    // any other repetition or from the live phase FSM's own running state.
    peakShoulderAngleDegrees: usableAngles.length > 0 ? Math.max(...usableAngles) : null,
    movementDurationMs,
    peakAngularVelocityDegPerSec: computePeakAngularVelocityDegPerSec(frames, angleTrace),
    trackingQuality: computeTrackingQualitySummary(frames, side, framesWithUsableAngle),
  };
}
