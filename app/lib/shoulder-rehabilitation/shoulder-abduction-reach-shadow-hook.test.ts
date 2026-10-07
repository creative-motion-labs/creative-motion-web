/**
 * Run: npx tsx --test app/lib/shoulder-rehabilitation/shoulder-abduction-reach-shadow-hook.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { MOVEMENT_REP_CONFIRM_MIN_TICKS } from "@/app/lib/movement-rep-confirmation";
import {
  createShoulderAbductionReachShadowState,
  runShoulderAbductionReachShadowFrame,
} from "./shoulder-abduction-reach-shadow-hook";

function landmarks(): PoseLandmark[] {
  const result: PoseLandmark[] = [];
  for (let i = 0; i < 33; i += 1) {
    result.push({ x: 0.5, y: 0.5, visibility: 0.9 });
  }
  result[23] = { x: 0.5, y: 0.7, visibility: 0.9 }; // left_hip
  result[11] = { x: 0.5, y: 0.5, visibility: 0.9 }; // left_shoulder
  result[13] = { x: 0.7, y: 0.5, visibility: 0.9 }; // left_elbow (~90 degrees)
  return result;
}

const ctx = { frameIndex: 0, capturedAtMs: 0 };
const disabled = () => false;
const enabled = () => true;

describe("runShoulderAbductionReachShadowFrame — disabled (default)", () => {
  it("returns null and does not run the detector when disabled", () => {
    const state = createShoulderAbductionReachShadowState();
    const result = runShoulderAbductionReachShadowFrame(state, landmarks(), ctx, undefined, disabled);

    assert.equal(result, null);
    assert.equal(state.log.frameCount, 0);
    assert.equal(state.detectorState.left.repCount, 0);
  });

  it("defaults to disabled when no isEnabled override is provided (no window global in this test environment)", () => {
    assert.equal(typeof window, "undefined");
    const state = createShoulderAbductionReachShadowState();
    const result = runShoulderAbductionReachShadowFrame(state, landmarks(), ctx);
    assert.equal(result, null);
  });
});

describe("runShoulderAbductionReachShadowFrame — enabled", () => {
  it("runs the detector and returns a frame result", () => {
    const state = createShoulderAbductionReachShadowState();
    const result = runShoulderAbductionReachShadowFrame(state, landmarks(), ctx, undefined, enabled);

    assert.ok(result);
    assert.ok(result.left.abductionAngleDegrees !== null);
    assert.ok(Math.abs(result.left.abductionAngleDegrees - 90) < 1e-6);
  });

  it("records the frame into the shadow log", () => {
    const state = createShoulderAbductionReachShadowState();
    runShoulderAbductionReachShadowFrame(state, landmarks(), ctx, undefined, enabled);
    assert.equal(state.log.frameCount, 1);
  });

  it("advances detector state across multiple calls, enabling rep detection over a session", () => {
    const state = createShoulderAbductionReachShadowState();

    const frames: PoseLandmark[][] = [
      ...Array.from({ length: MOVEMENT_REP_CONFIRM_MIN_TICKS }, () => 0 as const),
      ...Array.from({ length: MOVEMENT_REP_CONFIRM_MIN_TICKS }, () => 180 as const),
      ...Array.from({ length: MOVEMENT_REP_CONFIRM_MIN_TICKS }, () => 0 as const),
    ].map((elbowAngle) => {
      const lm = landmarks();
      if (elbowAngle === 0) lm[13] = { x: 0.5, y: 0.68, visibility: 0.9 };
      else if (elbowAngle === 90) lm[13] = { x: 0.7, y: 0.5, visibility: 0.9 };
      else lm[13] = { x: 0.5, y: 0.3, visibility: 0.9 };
      return lm;
    });

    for (const [i, lm] of frames.entries()) {
      runShoulderAbductionReachShadowFrame(
        state,
        lm,
        { frameIndex: i, capturedAtMs: i * 33 },
        undefined,
        enabled,
      );
    }

    assert.equal(state.detectorState.left.repCount, 1);
    assert.equal(state.log.repCompletedCount.left, 1);
    assert.equal(state.log.frameCount, frames.length);
  });
});
