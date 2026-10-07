/**
 * Run: npx tsx --test app/lib/posture-analyzer.test.ts
 *
 * Phase-1 freeze tests: lock measured thresholds and persistence-facing
 * score/label semantics before clinical-safety adjustments.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormLandmark } from "./body-axis-acl-squat";
import {
  aggregatePostureResults,
  analysePostureFrame,
  type PostureCheckResult,
} from "./posture-analyzer";

function lm(
  x: number,
  y: number,
  visibility = 1
): NormLandmark {
  return { x, y, visibility };
}

/** Level shoulders/hips, nose and trunk centred — expected high score. */
function alignedLandmarks(): NormLandmark[] {
  const landmarks: NormLandmark[] = Array.from({ length: 33 }, () => lm(0, 0, 0));
  landmarks[0] = lm(0.5, 0.2); // nose
  landmarks[11] = lm(0.4, 0.35); // L shoulder
  landmarks[12] = lm(0.6, 0.35); // R shoulder
  landmarks[23] = lm(0.4, 0.65); // L hip
  landmarks[24] = lm(0.6, 0.65); // R hip
  return landmarks;
}

function withShoulderTilt(tiltDeg: number): NormLandmark[] {
  const landmarks = alignedLandmarks();
  // Keep midpoint at 0.5; introduce vertical delta for tilt ≈ atan2(dy, dx)
  const halfWidth = 0.1;
  const dy = Math.tan((tiltDeg * Math.PI) / 180) * (halfWidth * 2);
  landmarks[11] = lm(0.4, 0.35);
  landmarks[12] = lm(0.6, 0.35 + dy);
  return landmarks;
}

describe("analysePostureFrame — freeze measured behavior", () => {
  it("returns null when key landmarks are missing", () => {
    const landmarks: NormLandmark[] = Array.from({ length: 10 }, () => lm(0.5, 0.5));
    assert.equal(analysePostureFrame(landmarks), null);
  });

  it("returns null when key landmark visibility is below 0.3", () => {
    const landmarks = alignedLandmarks();
    landmarks[0] = lm(0.5, 0.2, 0.29);
    assert.equal(analysePostureFrame(landmarks), null);
  });

  it("returns score 100 and Good alignment for a centred, level frame", () => {
    const result = analysePostureFrame(alignedLandmarks());
    assert.ok(result);
    assert.equal(result.score, 100);
    assert.equal(result.label, "Good alignment");
    assert.ok(result.shoulderTilt < 1);
    assert.ok(result.hipTilt < 1);
    assert.ok(result.headOffset < 0.01);
    assert.ok(result.trunkOffset < 0.01);
    assert.match(result.details, /No significant deviations detected/);
  });

  it("applies mild shoulder-tilt deduction (>4°, ≤8°)", () => {
    const result = analysePostureFrame(withShoulderTilt(5));
    assert.ok(result);
    assert.ok(result.shoulderTilt > 4 && result.shoulderTilt <= 8);
    assert.equal(result.score, 88); // 100 - 12
    assert.equal(result.label, "Good alignment");
    assert.match(result.details, /shoulder tilt/);
  });

  it("applies marked shoulder-tilt deduction (>8°)", () => {
    const result = analysePostureFrame(withShoulderTilt(10));
    assert.ok(result);
    assert.ok(result.shoulderTilt > 8);
    assert.equal(result.score, 75); // 100 - 25
    assert.equal(result.label, "Mild asymmetry detected");
  });

  it("applies head-offset deductions at 0.03 and 0.06 thresholds", () => {
    const mild = alignedLandmarks();
    mild[0] = lm(0.54, 0.2); // offset 0.04 from mid 0.5
    const mildResult = analysePostureFrame(mild);
    assert.ok(mildResult);
    assert.ok(mildResult.headOffset > 0.03 && mildResult.headOffset <= 0.06);
    assert.equal(mildResult.score, 90); // 100 - 10

    const marked = alignedLandmarks();
    marked[0] = lm(0.58, 0.2); // offset 0.08
    const markedResult = analysePostureFrame(marked);
    assert.ok(markedResult);
    assert.ok(markedResult.headOffset > 0.06);
    assert.equal(markedResult.score, 80); // 100 - 20
  });

  it("treats visibility exactly 0.3 as usable", () => {
    const landmarks = alignedLandmarks();
    for (const idx of [0, 11, 12, 23, 24]) {
      landmarks[idx] = { ...landmarks[idx], visibility: 0.3 };
    }
    assert.ok(analysePostureFrame(landmarks));
  });
});

describe("aggregatePostureResults — freeze persistence-facing score/label", () => {
  it("keeps empty-frame score 75 and Mild asymmetry label for persistence compatibility", () => {
    const agg = aggregatePostureResults([]);
    assert.equal(agg.score, 75);
    assert.equal(agg.label, "Mild asymmetry detected");
    assert.equal(agg.dataSufficiency, "insufficient");
    assert.match(agg.summary, /[Ii]nsufficient/);
    assert.match(agg.summary, /placeholder/i);
  });

  it("averages frame scores and maps labels by existing thresholds", () => {
    const frames: PostureCheckResult[] = [
      {
        shoulderTilt: 0,
        headOffset: 0,
        trunkOffset: 0,
        hipTilt: 0,
        score: 100,
        label: "Good alignment",
        details: "No significant deviations detected.",
      },
      {
        shoulderTilt: 5,
        headOffset: 0,
        trunkOffset: 0,
        hipTilt: 0,
        score: 80,
        label: "Good alignment",
        details: "Flags: shoulder tilt 5.0°.",
      },
    ];
    const agg = aggregatePostureResults(frames);
    assert.equal(agg.score, 90);
    assert.equal(agg.label, "Good alignment");
    assert.equal(agg.dataSufficiency, "sufficient");
    assert.match(agg.summary, /Overall postural score: 90%/);
    assert.match(agg.summary, /shoulder tilt/);
  });

  it("maps aggregated score < 60 to Postural deviation observed", () => {
    const frames: PostureCheckResult[] = [
      {
        shoulderTilt: 10,
        headOffset: 0.08,
        trunkOffset: 0.08,
        hipTilt: 10,
        score: 30,
        label: "Postural deviation observed",
        details: "Flags: shoulder tilt 10.0°, head offset, hip tilt 10.0°, trunk shift.",
      },
    ];
    const agg = aggregatePostureResults(frames);
    assert.equal(agg.score, 30);
    assert.equal(agg.label, "Postural deviation observed");
    assert.equal(agg.dataSufficiency, "sufficient");
  });
});
