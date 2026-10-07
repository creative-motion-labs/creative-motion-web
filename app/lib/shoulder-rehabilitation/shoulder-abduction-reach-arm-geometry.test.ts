/**
 * Run: npx tsx --test app/lib/shoulder-rehabilitation/shoulder-abduction-reach-arm-geometry.test.ts
 *
 * Uses the same synthetic BlazePose landmark pattern as
 * `shoulder-abduction-reach-pose-detector.test.ts`, normalized through the real
 * acquisition adapter so the existing presence rule is exercised, not re-implemented.
 *
 * CLINICAL SAFETY: the estimated arm length asserted here is a normalized on-screen
 * segment sum, not an anthropometric limb measurement and not a clinical value.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition";
import { MIN_PRESENT_VISIBILITY } from "@/app/lib/cv/motion-quality-confidence";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY,
  estimateShoulderAbductionReachArmLength,
  extractShoulderAbductionReachArmGeometry,
} from "./shoulder-abduction-reach-arm-geometry";

// BlazePose indices, matching the detector test fixtures.
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;

function blankLandmarks(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
}

/**
 * Distinct right and left arms so a side-selection mistake cannot pass.
 * Right arm segments: shoulder→elbow 0.2, elbow→wrist 0.3 (sum 0.5).
 * Left arm segments:  shoulder→elbow 0.1, elbow→wrist 0.1 (sum 0.2).
 */
function armLandmarks(): PoseLandmark[] {
  const lm = blankLandmarks();
  lm[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };
  lm[R_ELBOW] = { x: 0.55, y: 0.5, visibility: 0.95 };
  lm[R_WRIST] = { x: 0.55, y: 0.8, visibility: 0.9 };
  lm[L_SHOULDER] = { x: 0.45, y: 0.3, visibility: 0.95 };
  lm[L_ELBOW] = { x: 0.45, y: 0.4, visibility: 0.95 };
  lm[L_WRIST] = { x: 0.45, y: 0.5, visibility: 0.9 };
  return lm;
}

function normalize(landmarks: PoseLandmark[]): NormalizedMotionFrame {
  const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, {
    frameIndex: 0,
    capturedAtMs: 1_000,
  });
  assert.ok(frame, "expected the acquisition adapter to produce a frame");
  return frame;
}

const closeTo = (actual: number | null, expected: number, epsilon = 1e-9) => {
  assert.ok(actual !== null, "expected a numeric value, received null");
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

describe("shoulder abduction reach arm geometry — side selection", () => {
  it("selects the right shoulder, elbow and wrist for the right side", () => {
    const geometry = extractShoulderAbductionReachArmGeometry(
      normalize(armLandmarks()),
      "right",
    );

    assert.deepEqual(geometry.shoulder, { x: 0.55, y: 0.3 });
    assert.deepEqual(geometry.elbow, { x: 0.55, y: 0.5 });
    assert.deepEqual(geometry.wrist, { x: 0.55, y: 0.8 });
  });

  it("selects the left shoulder, elbow and wrist for the left side", () => {
    const geometry = extractShoulderAbductionReachArmGeometry(
      normalize(armLandmarks()),
      "left",
    );

    assert.deepEqual(geometry.shoulder, { x: 0.45, y: 0.3 });
    assert.deepEqual(geometry.elbow, { x: 0.45, y: 0.4 });
    assert.deepEqual(geometry.wrist, { x: 0.45, y: 0.5 });
  });

  it("does not mix the two sides", () => {
    const frame = normalize(armLandmarks());
    const right = extractShoulderAbductionReachArmGeometry(frame, "right");
    const left = extractShoulderAbductionReachArmGeometry(frame, "left");

    assert.notDeepEqual(right.shoulder, left.shoulder);
    assert.notEqual(right.estimatedArmLengthNormalized, left.estimatedArmLengthNormalized);
  });
});

describe("shoulder abduction reach arm geometry — arm length estimate", () => {
  it("sums shoulder-to-elbow and elbow-to-wrist distances", () => {
    const frame = normalize(armLandmarks());

    closeTo(extractShoulderAbductionReachArmGeometry(frame, "right").estimatedArmLengthNormalized, 0.5);
    closeTo(extractShoulderAbductionReachArmGeometry(frame, "left").estimatedArmLengthNormalized, 0.2);
  });

  it("handles a diagonal arm using euclidean segment lengths", () => {
    const lm = armLandmarks();
    // 3-4-5 triangles: shoulder→elbow = 0.5, elbow→wrist = 0.5.
    lm[R_SHOULDER] = { x: 0.1, y: 0.1, visibility: 0.95 };
    lm[R_ELBOW] = { x: 0.4, y: 0.5, visibility: 0.95 };
    lm[R_WRIST] = { x: 0.7, y: 0.9, visibility: 0.9 };

    const geometry = extractShoulderAbductionReachArmGeometry(normalize(lm), "right");
    closeTo(geometry.estimatedArmLengthNormalized, 1.0, 1e-9);
  });

  it("returns null rather than a fabricated default when the elbow is missing", () => {
    const lm = armLandmarks();
    lm[R_ELBOW] = { x: 0.55, y: 0.5, visibility: 0 };

    const geometry = extractShoulderAbductionReachArmGeometry(normalize(lm), "right");

    assert.equal(geometry.elbow, null);
    assert.equal(geometry.estimatedArmLengthNormalized, null);
    // Still reports the joints that ARE usable — it does not blank the whole frame.
    assert.deepEqual(geometry.shoulder, { x: 0.55, y: 0.3 });
    assert.deepEqual(geometry.wrist, { x: 0.55, y: 0.8 });
  });

  it("returns null when the shoulder is missing", () => {
    const lm = armLandmarks();
    lm[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0 };

    const geometry = extractShoulderAbductionReachArmGeometry(normalize(lm), "right");

    assert.equal(geometry.shoulder, null);
    assert.equal(geometry.estimatedArmLengthNormalized, null);
  });

  it("returns null when all joints coincide, so the estimate would be zero", () => {
    const lm = armLandmarks();
    lm[R_SHOULDER] = { x: 0.5, y: 0.5, visibility: 0.95 };
    lm[R_ELBOW] = { x: 0.5, y: 0.5, visibility: 0.95 };
    lm[R_WRIST] = { x: 0.5, y: 0.5, visibility: 0.9 };

    const geometry = extractShoulderAbductionReachArmGeometry(normalize(lm), "right");
    assert.equal(geometry.estimatedArmLengthNormalized, null);
  });

  it("estimates directly from points through the exported helper", () => {
    closeTo(
      estimateShoulderAbductionReachArmLength({ x: 0, y: 0 }, { x: 0, y: 0.2 }, { x: 0, y: 0.5 }),
      0.5,
    );
    assert.equal(estimateShoulderAbductionReachArmLength(null, { x: 0, y: 0.2 }, { x: 0, y: 0.5 }), null);
    assert.equal(estimateShoulderAbductionReachArmLength({ x: 0, y: 0 }, null, { x: 0, y: 0.5 }), null);
    assert.equal(estimateShoulderAbductionReachArmLength({ x: 0, y: 0 }, { x: 0, y: 0.2 }, null), null);
    assert.equal(
      estimateShoulderAbductionReachArmLength({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }),
      null,
    );
  });
});

describe("shoulder abduction reach arm geometry — existing confidence rules", () => {
  it("rejects joints below the existing present-visibility rule", () => {
    const lm = armLandmarks();
    const belowRule = MIN_PRESENT_VISIBILITY - 0.01;
    lm[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: belowRule };
    lm[R_ELBOW] = { x: 0.55, y: 0.5, visibility: belowRule };
    lm[R_WRIST] = { x: 0.55, y: 0.8, visibility: belowRule };

    const geometry = extractShoulderAbductionReachArmGeometry(normalize(lm), "right");

    assert.deepEqual(geometry, EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY);
  });

  it("accepts joints at or above the existing present-visibility rule", () => {
    const lm = armLandmarks();
    const atRule = MIN_PRESENT_VISIBILITY;
    lm[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: atRule };
    lm[R_ELBOW] = { x: 0.55, y: 0.5, visibility: atRule };
    lm[R_WRIST] = { x: 0.55, y: 0.8, visibility: atRule };

    const geometry = extractShoulderAbductionReachArmGeometry(normalize(lm), "right");

    assert.deepEqual(geometry.shoulder, { x: 0.55, y: 0.3 });
    closeTo(geometry.estimatedArmLengthNormalized, 0.5);
  });

  it("reports nothing usable for a frame with no visible joints", () => {
    const geometry = extractShoulderAbductionReachArmGeometry(
      normalize(blankLandmarks()),
      "right",
    );

    assert.deepEqual(geometry, EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY);
  });
});

describe("shoulder abduction reach arm geometry — purity", () => {
  it("produces identical output for identical inputs", () => {
    const frame = normalize(armLandmarks());

    assert.deepStrictEqual(
      extractShoulderAbductionReachArmGeometry(frame, "right"),
      extractShoulderAbductionReachArmGeometry(frame, "right"),
    );
  });

  it("does not mutate the frame it reads", () => {
    const frame = normalize(armLandmarks());
    const snapshot = structuredClone(frame);

    extractShoulderAbductionReachArmGeometry(frame, "right");
    extractShoulderAbductionReachArmGeometry(frame, "left");

    assert.deepEqual(frame, snapshot);
  });
});
