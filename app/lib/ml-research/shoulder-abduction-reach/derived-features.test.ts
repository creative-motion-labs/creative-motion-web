/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/derived-features.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCapturedAngleTrace,
  computeShoulderAbductionReachDerivedFeatures,
  resolveTrunkDriftBaselineDeltaX,
} from "./derived-features";
import type { MlResearchCapturedJoints, ShoulderAbductionReachCapturedFrame } from "./capture-schema";

function frame(
  frameIndex: number,
  relativeTimestampMs: number,
  overrides: Partial<{
    hipX: number;
    shoulderX: number;
    elbowX: number;
    elbowY: number;
    leftShoulderX: number;
    side: "left" | "right";
    visibility: number;
  }> = {},
): ShoulderAbductionReachCapturedFrame {
  const side = overrides.side ?? "right";
  const hipX = overrides.hipX ?? 0.6;
  const shoulderX = overrides.shoulderX ?? 0.6;
  const elbowX = overrides.elbowX ?? shoulderX;
  const elbowY = overrides.elbowY ?? 0.5;
  const visibility = overrides.visibility ?? 0.9;
  const conf = { visibility, present: true } as const;

  if (side === "right") {
    const joints: MlResearchCapturedJoints = {
      right_hip: { landmark: { x: hipX, y: 0.62 }, confidence: conf },
      right_shoulder: { landmark: { x: shoulderX, y: 0.3 }, confidence: conf },
      right_elbow: { landmark: { x: elbowX, y: elbowY }, confidence: conf },
      right_wrist: { landmark: { x: elbowX, y: elbowY + 0.1 }, confidence: conf },
      left_shoulder: {
        landmark: { x: overrides.leftShoulderX ?? 0.3, y: 0.3 },
        confidence: conf,
      },
    };
    return { relativeTimestampMs, frameIndex, joints };
  }

  const joints: MlResearchCapturedJoints = {
    left_hip: { landmark: { x: hipX, y: 0.62 }, confidence: conf },
    left_shoulder: { landmark: { x: shoulderX, y: 0.3 }, confidence: conf },
    left_elbow: { landmark: { x: elbowX, y: elbowY }, confidence: conf },
    left_wrist: { landmark: { x: elbowX, y: elbowY + 0.1 }, confidence: conf },
    right_shoulder: {
      landmark: { x: overrides.leftShoulderX ?? 0.65, y: 0.3 },
      confidence: conf,
    },
  };
  return { relativeTimestampMs, frameIndex, joints };
}

/** Uniform zoom toward a center — simulates camera-distance / coordinate scaling. */
function zoom(x: number, k: number, center = 0.5): number {
  return center + (x - center) * k;
}

describe("computeCapturedAngleTrace", () => {
  it("returns one angle per frame, null where a required joint is missing", () => {
    const frames = [
      frame(0, 0),
      { relativeTimestampMs: 33, frameIndex: 1, joints: {} }, // no joints at all
    ];
    const trace = computeCapturedAngleTrace(frames, "right");
    assert.equal(trace.length, 2);
    assert.equal(trace[0] !== null, true);
    assert.equal(trace[1], null);
  });
});

describe("computeShoulderAbductionReachDerivedFeatures", () => {
  it("selects the maximum valid shoulder angle frame and ignores null-angle frames", () => {
    const lowAngle = frame(0, 0, { elbowY: 0.45 });
    const peakAngle = frame(1, 33, { elbowY: 0.05 });
    const untracked = { relativeTimestampMs: 66, frameIndex: 2, joints: {} };
    const frames = [lowAngle, peakAngle, untracked];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    const trace = computeCapturedAngleTrace(frames, "right");
    const expectedPeak = Math.max(...trace.filter((angle): angle is number => angle !== null));
    assert.ok(Math.abs(features.peakShoulderAngleDegrees! - expectedPeak) < 1e-9);
    assert.ok(features.peakShoulderAngleDegrees! > 0);
  });

  it("does not let invalid low-quality frames corrupt the peak angle calculation", () => {
    const validPeak = frame(0, 0, { elbowY: 0.05 });
    const validRest = frame(1, 33, { elbowY: 0.5 });
    const lowQuality = frame(2, 66, {
      elbowY: -0.5,
      visibility: 0.05,
    });
    const features = computeShoulderAbductionReachDerivedFeatures([validPeak, validRest, lowQuality], "right");
    const trace = computeCapturedAngleTrace([validPeak, validRest, lowQuality], "right");
    const expectedPeak = Math.max(...trace.filter((angle): angle is number => angle !== null));
    assert.equal(features.peakShoulderAngleDegrees, expectedPeak);
  });

  it("has no way to accept an externally supplied peak angle (options-only third parameter)", () => {
    // Regression guard for the Slice 1.1 root-cause fix: the old signature accepted
    // peakAngleDegreesAtCompletion as a third positional argument. Confirms the
    // function now takes an optional options object, not a stale peak value.
    assert.equal(computeShoulderAbductionReachDerivedFeatures.length, 2);
  });

  it("returns null peakShoulderAngleDegrees when no frame has a usable angle, never a stale fallback", () => {
    const frames = [{ relativeTimestampMs: 0, frameIndex: 0, joints: {} }];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.equal(features.peakShoulderAngleDegrees, null);
  });

  it("computes movement duration as the span between first and last frame", () => {
    const frames = [frame(0, 0), frame(1, 33), frame(2, 133)];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.equal(features.movementDurationMs, 133);
  });

  it("reports tracking quality as the fraction of frames with a usable angle", () => {
    const frames = [
      frame(0, 0),
      { relativeTimestampMs: 33, frameIndex: 1, joints: {} },
      frame(2, 66),
      frame(3, 99),
    ];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.equal(features.trackingQuality.framesTotal, 4);
    assert.equal(features.trackingQuality.framesWithUsableAngle, 3);
    assert.ok(features.trackingQuality.usableFrameRatio !== null);
    assert.ok(Math.abs(features.trackingQuality.usableFrameRatio! - 0.75) < 1e-9);
  });

  it("summarizes the minimum core-joint visibility across captured frames", () => {
    const frames = [
      frame(0, 0, { visibility: 0.9 }),
      frame(1, 33, { visibility: 0.55 }),
      frame(2, 66, { visibility: 0.8 }),
    ];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.equal(features.trackingQuality.minCoreJointVisibility, 0.55);
  });

  it("computes features for only the requested side and ignores contralateral joint geometry", () => {
    const frames = [
      frame(0, 0, { elbowY: 0.5 }),
      frame(1, 33, { elbowY: 0.05 }),
    ];
    const rightFeatures = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    const leftFeatures = computeShoulderAbductionReachDerivedFeatures(frames, "left");
    assert.ok(rightFeatures.peakShoulderAngleDegrees !== null);
    assert.equal(leftFeatures.peakShoulderAngleDegrees, null);
    assert.equal(leftFeatures.trackingQuality.framesWithUsableAngle, 0);
  });

  it("returns null tracking ratio and zero duration for an empty frame list", () => {
    const features = computeShoulderAbductionReachDerivedFeatures([], "right");
    assert.equal(features.trackingQuality.usableFrameRatio, null);
    assert.equal(features.movementDurationMs, 0);
    assert.equal(features.peakNormalizedTrunkDriftRatio, null);
    assert.equal(features.peakAngularVelocityDegPerSec, null);
    assert.equal(features.peakShoulderAngleDegrees, null);
  });

  it("computes peak normalized trunk drift relative to the pre-onset resting baseline when provided", () => {
    const preOnsetRest = frame(0, 0, { hipX: 0.6, shoulderX: 0.6, leftShoulderX: 0.22 });
    const raisingStart = frame(0, 0, { hipX: 0.6, shoulderX: 0.62, leftShoulderX: 0.22 });
    const peakDrift = frame(1, 33, { hipX: 0.6, shoulderX: 0.7, leftShoulderX: 0.22 });
    const withPreOnset = computeShoulderAbductionReachDerivedFeatures([raisingStart, peakDrift], "right", {
      preOnsetRestingJoints: preOnsetRest.joints,
    });
    const withoutPreOnset = computeShoulderAbductionReachDerivedFeatures([raisingStart, peakDrift], "right");
    // Pre-onset baseline deltaX = 0; raising-start deltaX = 0.02; peak deltaX = 0.1 -> drift 0.1 / width 0.48
    assert.ok(Math.abs(withPreOnset.peakNormalizedTrunkDriftRatio! - 0.1 / 0.48) < 1e-9);
    // First raising frame baseline deltaX = 0.02 -> drift at peak = 0.08 / 0.48
    assert.ok(Math.abs(withoutPreOnset.peakNormalizedTrunkDriftRatio! - 0.08 / 0.48) < 1e-9);
    assert.notEqual(
      withPreOnset.peakNormalizedTrunkDriftRatio,
      withoutPreOnset.peakNormalizedTrunkDriftRatio,
    );
  });

  it("resolveTrunkDriftBaselineDeltaX prefers pre-onset resting joints over the first raising frame", () => {
    const preOnset = frame(0, 0, { hipX: 0.6, shoulderX: 0.6, leftShoulderX: 0.3 }).joints;
    const raising = frame(0, 0, { hipX: 0.6, shoulderX: 0.62, leftShoulderX: 0.3 }).joints;
    assert.ok(Math.abs(resolveTrunkDriftBaselineDeltaX("right", preOnset, raising)! - 0) < 1e-9);
    assert.ok(Math.abs(resolveTrunkDriftBaselineDeltaX("right", null, raising)! - 0.02) < 1e-9);
  });

  it("computes a nonzero peak normalized trunk drift ratio when the trunk drifts from the baseline", () => {
    const frames = [
      frame(0, 0, { hipX: 0.6, shoulderX: 0.62, leftShoulderX: 0.3 }), // baseline deltaX = 0.02
      frame(1, 33, { hipX: 0.6, shoulderX: 0.7, leftShoulderX: 0.3 }), // deltaX = 0.1, drift = 0.08
    ];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.ok(features.peakNormalizedTrunkDriftRatio !== null);
    assert.ok(features.peakNormalizedTrunkDriftRatio! > 0);
  });

  it("computes peak normalized trunk drift relative to the first raising frame when no pre-onset baseline exists", () => {
    const frames = [
      frame(0, 0, { hipX: 0.6, shoulderX: 0.62, leftShoulderX: 0.22 }),
      frame(1, 33, { hipX: 0.6, shoulderX: 0.7, leftShoulderX: 0.22 }),
    ];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    // drift = |0.1 - 0.02| = 0.08; shoulder width = |0.7 - 0.22| = 0.48 -> ratio = 0.08/0.48
    assert.ok(Math.abs(features.peakNormalizedTrunkDriftRatio! - 0.08 / 0.48) < 1e-9);
  });

  it("keeps peak normalized trunk drift invariant under uniform coordinate scaling", () => {
    const buildFrames = (k: number) => [
      frame(0, 0, {
        hipX: zoom(0.6, k),
        shoulderX: zoom(0.62, k),
        leftShoulderX: zoom(0.22, k),
      }),
      frame(1, 33, {
        hipX: zoom(0.6, k),
        shoulderX: zoom(0.7, k),
        leftShoulderX: zoom(0.22, k),
      }),
    ];
    const near = computeShoulderAbductionReachDerivedFeatures(buildFrames(1), "right");
    const far = computeShoulderAbductionReachDerivedFeatures(buildFrames(2), "right");
    assert.ok(near.peakNormalizedTrunkDriftRatio !== null);
    assert.ok(far.peakNormalizedTrunkDriftRatio !== null);
    assert.ok(
      Math.abs(near.peakNormalizedTrunkDriftRatio! - far.peakNormalizedTrunkDriftRatio!) < 1e-9,
    );
  });

  it("computes a peak angular velocity from the largest frame-to-frame angle change", () => {
    const frames = [
      frame(0, 0, { elbowY: 0.5 }), // near-resting angle
      frame(1, 100, { elbowY: 0.1 }), // arm raised toward overhead 100ms later
    ];
    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.ok(features.peakAngularVelocityDegPerSec !== null);
    assert.ok(features.peakAngularVelocityDegPerSec! > 0);
  });

  it("excludes a near-zero-dt transition from the velocity calculation instead of producing a spurious spike (Slice 1.1 numerical safety)", () => {
    // elbowX is offset from shoulderX (0.8 vs 0.6) so varying elbowY produces a real,
    // non-collinear angle change (frame()'s default elbowX=shoulderX would make every
    // elbowY below the shoulder collinear with the hip, i.e. angle 0 regardless of y).
    const off = (elbowY: number) => ({ elbowX: 0.8, elbowY });
    const frames = [
      frame(0, 0, off(0.35)),
      // A second sample 0.1ms later, almost identical angle — physically meaningless as
      // an independent observation. Without the dt floor, dividing this tiny angle
      // change by a near-zero time base would produce a huge spurious deg/s value.
      frame(1, 0.1, off(0.335)),
      frame(2, 33, off(0.30)), // a real, modest change over a real (~33ms) time base
    ];
    const angleTrace = computeCapturedAngleTrace(frames, "right");
    const degenerateTransitionVelocity =
      Math.abs(angleTrace[1]! - angleTrace[0]!) /
      ((frames[1].relativeTimestampMs - frames[0].relativeTimestampMs) / 1000);
    const realTransitionVelocity =
      Math.abs(angleTrace[2]! - angleTrace[1]!) /
      ((frames[2].relativeTimestampMs - frames[1].relativeTimestampMs) / 1000);
    // Confirms the fixture actually exercises the bug this test guards against: without
    // the dt floor, the degenerate transition would dominate the real one.
    assert.ok(degenerateTransitionVelocity > realTransitionVelocity * 10);

    const features = computeShoulderAbductionReachDerivedFeatures(frames, "right");
    assert.ok(features.peakAngularVelocityDegPerSec !== null);
    assert.ok(Math.abs(features.peakAngularVelocityDegPerSec! - realTransitionVelocity) < 1e-6);
  });
});
