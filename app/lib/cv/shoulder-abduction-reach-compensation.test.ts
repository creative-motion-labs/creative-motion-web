/**
 * Run: npx tsx --test app/lib/cv/shoulder-abduction-reach-compensation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence";
import {
  computeShoulderAbductionReachNormalizedTrunkDrift,
  createShoulderAbductionReachCompensationState,
  DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS,
  MIN_USABLE_SHOULDER_WIDTH_NORMALIZED,
  updateShoulderAbductionReachCompensation,
} from "./shoulder-abduction-reach-compensation";

function syntheticFrame(
  joints: Partial<Record<JointId, { x: number; y: number; visibility?: number }>>,
): NormalizedMotionFrame {
  const mapped = Object.fromEntries(
    Object.entries(joints).map(([jointId, landmark]) => [
      jointId,
      {
        landmark: { x: landmark.x, y: landmark.y },
        confidence: { visibility: landmark.visibility ?? 0.9, present: true },
      },
    ]),
  ) as NormalizedMotionFrame["joints"];

  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: { kind: "web_camera_pose", capturedAtMs: 1_000, frameIndex: 0, coordinateSpace: "normalized_2d" },
    joints: mapped,
  };
}

function frameWithHipShoulder(hipX: number, shoulderX: number): NormalizedMotionFrame {
  return syntheticFrame({
    left_hip: { x: hipX, y: 0.6 },
    left_shoulder: { x: shoulderX, y: 0.3 },
  });
}

describe("updateShoulderAbductionReachCompensation", () => {
  it("returns unavailable when required joints are missing", () => {
    const state = createShoulderAbductionReachCompensationState();
    const frame = syntheticFrame({ left_hip: { x: 0.5, y: 0.6 } });
    const status = updateShoulderAbductionReachCompensation(state, frame, "left", true);
    assert.equal(status, "unavailable");
  });

  it("captures a baseline only during the resting phase", () => {
    const state = createShoulderAbductionReachCompensationState();
    const frame = frameWithHipShoulder(0.5, 0.5);

    const notResting = updateShoulderAbductionReachCompensation(state, frame, "left", false);
    assert.equal(notResting, "unavailable");
    assert.equal(state.baselineDeltaX, null);

    const resting = updateShoulderAbductionReachCompensation(state, frame, "left", true);
    assert.equal(resting, "baseline_captured");
    assert.equal(state.baselineDeltaX, 0);
  });

  it("stays clear when drift is within threshold", () => {
    const state = createShoulderAbductionReachCompensationState();
    updateShoulderAbductionReachCompensation(state, frameWithHipShoulder(0.5, 0.5), "left", true);

    const status = updateShoulderAbductionReachCompensation(
      state,
      frameWithHipShoulder(0.5, 0.52),
      "left",
      false,
    );
    assert.equal(status, "clear");
    assert.equal(state.flagged, false);
  });

  it("flags once drift crosses the threshold, and clears with hysteresis", () => {
    const state = createShoulderAbductionReachCompensationState();
    updateShoulderAbductionReachCompensation(state, frameWithHipShoulder(0.5, 0.5), "left", true);

    const flagged = updateShoulderAbductionReachCompensation(
      state,
      frameWithHipShoulder(0.5, 0.6),
      "left",
      false,
    );
    assert.equal(flagged, "flagged");
    assert.equal(state.flagged, true);

    const stillFlagged = updateShoulderAbductionReachCompensation(
      state,
      frameWithHipShoulder(0.5, 0.58),
      "left",
      false,
    );
    assert.equal(stillFlagged, "flagged", "hysteresis keeps it flagged just below the raise threshold");

    const cleared = updateShoulderAbductionReachCompensation(
      state,
      frameWithHipShoulder(0.5, 0.51),
      "left",
      false,
    );
    assert.equal(cleared, "clear");
    assert.equal(state.flagged, false);
  });

  it("uses independent state per side", () => {
    const state = createShoulderAbductionReachCompensationState();
    updateShoulderAbductionReachCompensation(state, frameWithHipShoulder(0.5, 0.5), "left", true);
    assert.equal(state.baselineDeltaX, 0);
    // A fresh state object is required per side by callers — this test documents that
    // one state instance tracks exactly one side, not both.
  });

  it("does not change the existing raw threshold defaults", () => {
    // Locks the v0 placeholder values in place — the normalized ratio added in
    // Slice 1 of the RASQ ML bridge (2026-08-19) is deliberately additive and
    // must never silently recalibrate this threshold. See project report.
    assert.equal(DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS.trunkLeanFlagDelta, 0.08);
    assert.equal(DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS.clearHysteresis, 0.02);
    assert.equal(DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS.minConfidence, 0.4);
  });
});

/** Zooms a coordinate toward/away from a fixed center — simulates the patient standing
 * closer to or farther from the camera. `zoom(a, k) - zoom(b, k) === k * (a - b)` for any
 * two coordinates, which is what makes the invariance test below exact. */
function zoom(x: number, k: number, center = 0.5): number {
  return center + (x - center) * k;
}

function bilateralFrame(input: {
  rightHipX: number;
  rightShoulderX: number;
  leftShoulderX: number;
}): NormalizedMotionFrame {
  return syntheticFrame({
    right_hip: { x: input.rightHipX, y: 0.62 },
    right_shoulder: { x: input.rightShoulderX, y: 0.3 },
    left_shoulder: { x: input.leftShoulderX, y: 0.3 },
  });
}

describe("computeShoulderAbductionReachNormalizedTrunkDrift", () => {
  it("returns null when a required joint is missing", () => {
    const frame = syntheticFrame({ right_hip: { x: 0.6, y: 0.6 }, right_shoulder: { x: 0.7, y: 0.3 } });
    const result = computeShoulderAbductionReachNormalizedTrunkDrift(frame, "right", 0.1);
    assert.equal(result, null, "left_shoulder is missing, so shoulder width cannot be computed");
  });

  it("returns null when the shoulders are too close together to trust as a scale reference", () => {
    const frame = bilateralFrame({
      rightHipX: 0.6,
      rightShoulderX: 0.5 + MIN_USABLE_SHOULDER_WIDTH_NORMALIZED / 4,
      leftShoulderX: 0.5 - MIN_USABLE_SHOULDER_WIDTH_NORMALIZED / 4,
    });
    const result = computeShoulderAbductionReachNormalizedTrunkDrift(frame, "right", 0.1);
    assert.equal(result, null);
  });

  it("computes drift as a fraction of inter-shoulder distance", () => {
    const frame = bilateralFrame({ rightHipX: 0.6, rightShoulderX: 0.78, leftShoulderX: 0.3 });
    const result = computeShoulderAbductionReachNormalizedTrunkDrift(frame, "right", 0.1);
    assert.ok(result);
    // offset.deltaX = 0.78 - 0.6 = 0.18; drift = |0.18 - 0.1| = 0.08; width = |0.78 - 0.3| = 0.48
    assert.ok(Math.abs(result.shoulderWidthNormalized - 0.48) < 1e-9);
    assert.ok(Math.abs(result.ratio - 0.08 / 0.48) < 1e-9);
  });

  it("is invariant to uniform coordinate scaling (camera-distance changes)", () => {
    const near = { rightHipX: 0.6, rightShoulderX: 0.78, leftShoulderX: 0.3 };
    const nearBaselineDeltaX = 0.1;
    const nearResult = computeShoulderAbductionReachNormalizedTrunkDrift(
      bilateralFrame(near),
      "right",
      nearBaselineDeltaX,
    );
    assert.ok(nearResult);

    for (const k of [0.5, 2, 3]) {
      const far = {
        rightHipX: zoom(near.rightHipX, k),
        rightShoulderX: zoom(near.rightShoulderX, k),
        leftShoulderX: zoom(near.leftShoulderX, k),
      };
      const farResult = computeShoulderAbductionReachNormalizedTrunkDrift(
        bilateralFrame(far),
        "right",
        nearBaselineDeltaX * k,
      );
      assert.ok(farResult, `expected a result at scale ${k}`);
      assert.ok(
        Math.abs(farResult.ratio - nearResult.ratio) < 1e-9,
        `ratio should be scale-invariant: got ${farResult.ratio} at k=${k}, expected ${nearResult.ratio}`,
      );
    }
  });

  it("the raw (unnormalized) signal is NOT scale-invariant — this is the confound being fixed", () => {
    // Documents the problem this feature solves: for the exact same real-world trunk
    // lean, the existing raw drift used by updateShoulderAbductionReachCompensation
    // reports a different number depending on how close the patient stands to the
    // camera. Baseline hip=0.45/shoulder=0.5 (deltaX=0.05); after leaning, deltaX=0.1
    // in both cases (a "2x" real lean relative to baseline). Zoomed by k=2 around the
    // frame center, the same real movement reports as a doubled raw drift.
    const nearState = createShoulderAbductionReachCompensationState();
    const farState = createShoulderAbductionReachCompensationState();
    updateShoulderAbductionReachCompensation(nearState, frameWithHipShoulder(0.45, 0.5), "left", true);
    updateShoulderAbductionReachCompensation(
      farState,
      frameWithHipShoulder(zoom(0.45, 2), zoom(0.5, 2)),
      "left",
      true,
    );
    assert.ok(Math.abs(nearState.baselineDeltaX! - 0.05) < 1e-9);
    assert.ok(Math.abs(farState.baselineDeltaX! - 0.1) < 1e-9);

    updateShoulderAbductionReachCompensation(nearState, frameWithHipShoulder(0.5, 0.6), "left", false);
    updateShoulderAbductionReachCompensation(
      farState,
      frameWithHipShoulder(zoom(0.5, 2), zoom(0.6, 2)),
      "left",
      false,
    );
    const nearDrift = Math.abs(0.6 - 0.5 - nearState.baselineDeltaX!);
    const farDrift = Math.abs(zoom(0.6, 2) - zoom(0.5, 2) - farState.baselineDeltaX!);
    assert.ok(Math.abs(nearDrift - 0.05) < 1e-9);
    assert.ok(Math.abs(farDrift - 0.1) < 1e-9);
    assert.notEqual(nearDrift, farDrift, "same real-world lean, different raw drift depending on camera distance");
  });
});
