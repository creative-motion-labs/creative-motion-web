/**
 * Run: npx tsx --test app/lib/shoulder-rehabilitation/shoulder-abduction-reach-detector.test.ts
 *
 * End-to-end: raw BlazePose-shaped landmarks -> Input Acquisition Layer ->
 * Motion Intelligence Core -> this module's metrics/phase logic. No camera
 * or browser required.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { MOVEMENT_REP_CONFIRM_MIN_TICKS } from "@/app/lib/movement-rep-confirmation";
import {
  createShoulderAbductionReachDetectorState,
  updateShoulderAbductionReachDetector,
} from "./shoulder-abduction-reach-detector";

const L_HIP = 23;
const L_SHOULDER = 11;
const L_ELBOW = 13;
const L_WRIST = 15;
const R_HIP = 24;
const R_SHOULDER = 12;
const R_ELBOW = 14;
const R_WRIST = 16;

function baseLandmarks(): PoseLandmark[] {
  const landmarks: PoseLandmark[] = [];
  for (let i = 0; i < 33; i += 1) {
    landmarks.push({ x: 0.5, y: 0.5, visibility: 0.9 });
  }
  // Both arms resting at the side by default.
  landmarks[L_HIP] = { x: 0.5, y: 0.7, visibility: 0.9 };
  landmarks[L_SHOULDER] = { x: 0.5, y: 0.5, visibility: 0.9 };
  landmarks[L_ELBOW] = { x: 0.5, y: 0.68, visibility: 0.9 };
  landmarks[L_WRIST] = { x: 0.5, y: 0.66, visibility: 0.9 };
  landmarks[R_HIP] = { x: 0.3, y: 0.7, visibility: 0.9 };
  landmarks[R_SHOULDER] = { x: 0.3, y: 0.5, visibility: 0.9 };
  landmarks[R_ELBOW] = { x: 0.3, y: 0.68, visibility: 0.9 };
  landmarks[R_WRIST] = { x: 0.3, y: 0.66, visibility: 0.9 };
  return landmarks;
}

function withLeftAbductionAngle(baseAngleDeg: 0 | 90 | 180): PoseLandmark[] {
  const landmarks = baseLandmarks();
  if (baseAngleDeg === 0) {
    landmarks[L_ELBOW] = { x: 0.5, y: 0.68, visibility: 0.9 };
  } else if (baseAngleDeg === 90) {
    landmarks[L_ELBOW] = { x: 0.7, y: 0.5, visibility: 0.9 };
  } else {
    landmarks[L_ELBOW] = { x: 0.5, y: 0.3, visibility: 0.9 };
  }
  return landmarks;
}

function ctx(frameIndex: number) {
  return { frameIndex, capturedAtMs: frameIndex * 33 };
}

function holdAngle(angle: 0 | 90 | 180, ticks = MOVEMENT_REP_CONFIRM_MIN_TICKS): Array<0 | 90 | 180> {
  return Array.from({ length: ticks }, () => angle);
}

function confirmedCycle(): Array<0 | 90 | 180> {
  return [...holdAngle(0), ...holdAngle(180), ...holdAngle(0)];
}

describe("updateShoulderAbductionReachDetector — single frame", () => {
  it("computes both sides' angles from one frame of raw landmarks", () => {
    const state = createShoulderAbductionReachDetectorState();
    const result = updateShoulderAbductionReachDetector(state, withLeftAbductionAngle(90), ctx(0));

    assert.equal(result.frameContractValid, true);
    assert.ok(result.left.abductionAngleDegrees !== null);
    assert.ok(Math.abs(result.left.abductionAngleDegrees - 90) < 1e-6);
    assert.ok(result.right.abductionAngleDegrees !== null);
    assert.ok(Math.abs(result.right.abductionAngleDegrees - 0) < 1e-6);
  });

  it("computes the bilateral angle difference when both sides are tracked", () => {
    const state = createShoulderAbductionReachDetectorState();
    const result = updateShoulderAbductionReachDetector(state, withLeftAbductionAngle(90), ctx(0));
    assert.ok(result.bilateralAngleDifferenceDegrees !== null);
    assert.ok(Math.abs(result.bilateralAngleDifferenceDegrees - 90) < 1e-6);
  });

  it("passes frameIndex and capturedAtMs through", () => {
    const state = createShoulderAbductionReachDetectorState();
    const result = updateShoulderAbductionReachDetector(state, baseLandmarks(), ctx(7));
    assert.equal(result.frameIndex, 7);
    assert.equal(result.capturedAtMs, 231);
  });

  it("returns null angles and stays gracefully unusable for an empty landmark array", () => {
    const state = createShoulderAbductionReachDetectorState();
    const result = updateShoulderAbductionReachDetector(state, [], ctx(0));
    assert.equal(result.frameContractValid, false);
    assert.equal(result.left.abductionAngleDegrees, null);
    assert.equal(result.right.abductionAngleDegrees, null);
    assert.equal(result.bilateralAngleDifferenceDegrees, null);
  });
});

describe("updateShoulderAbductionReachDetector — full session", () => {
  it("counts one left-side rep across a raise-and-lower sequence while the right side stays resting", () => {
    const state = createShoulderAbductionReachDetectorState();
    const sequence = confirmedCycle();

    let last;
    for (const [i, angle] of sequence.entries()) {
      last = updateShoulderAbductionReachDetector(state, withLeftAbductionAngle(angle), ctx(i));
    }

    assert.equal(state.left.repCount, 1);
    assert.equal(state.left.phase, "resting");
    assert.equal(state.right.repCount, 0);
    assert.equal(state.right.phase, "resting");
    assert.ok(last);
    assert.equal(last.left.repCount, 1);
  });

  it("keeps left and right rep counts independent across an asymmetric session", () => {
    const state = createShoulderAbductionReachDetectorState();
    for (const [i, angle] of confirmedCycle().entries()) {
      updateShoulderAbductionReachDetector(state, withLeftAbductionAngle(angle), ctx(i));
    }
    assert.equal(state.left.repCount, 1);
    assert.equal(state.right.repCount, 0);
  });
});
