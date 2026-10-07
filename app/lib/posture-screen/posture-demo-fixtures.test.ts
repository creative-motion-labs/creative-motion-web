/**
 * Run: npx tsx --test app/lib/posture-screen/posture-demo-fixtures.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition/adapters/motion/blazepose-acquisition-adapter";
import { analysePostureFrame } from "@/app/lib/posture-analyzer";
import type { NormLandmark } from "@/app/lib/body-axis-acl-squat";
import {
  buildAlignedPoseLandmarks,
  buildMissingRequiredJointPoseLandmarks,
  buildShoulderTiltPoseLandmarks,
  normalizePoseLandmarksForPosture,
  runPostureAcquisitionPipeline,
  runPostureDemoScenario,
} from "./posture-demo-fixtures";
import { analysePostureNormalizedFrame } from "./posture-frame-bridge";

function lm(x: number, y: number, visibility = 1): NormLandmark {
  return { x, y, visibility };
}

function alignedNorm(): NormLandmark[] {
  const landmarks: NormLandmark[] = Array.from({ length: 33 }, () => lm(0, 0, 0));
  landmarks[0] = lm(0.5, 0.2);
  landmarks[11] = lm(0.4, 0.35);
  landmarks[12] = lm(0.6, 0.35);
  landmarks[23] = lm(0.4, 0.65);
  landmarks[24] = lm(0.6, 0.65);
  return landmarks;
}

describe("posture demo fixtures — canonical acquisition path", () => {
  it("normalizePoseLandmarksForPosture uses BLAZEPOSE_ACQUISITION_ADAPTER.normalize", () => {
    const landmarks = buildAlignedPoseLandmarks();
    const viaHelper = normalizePoseLandmarksForPosture(landmarks, 2, 2_000);
    const viaAdapter = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, {
      frameIndex: 2,
      capturedAtMs: 2_000,
      deviceLabel: "posture-demo-fixture",
    });
    assert.ok(viaHelper);
    assert.ok(viaAdapter);
    assert.deepEqual(viaHelper, viaAdapter);
    assert.ok(viaHelper.joints.nose);
    assert.ok(viaHelper.joints.left_shoulder);
    assert.ok(viaHelper.joints.right_shoulder);
    assert.ok(viaHelper.joints.left_hip);
    assert.ok(viaHelper.joints.right_hip);
  });

  it("pipeline bridge matches analysePostureFrame for aligned geometry", () => {
    const { frame, result } = runPostureAcquisitionPipeline(buildAlignedPoseLandmarks());
    assert.ok(frame);
    assert.ok(result);
    const direct = analysePostureFrame(alignedNorm());
    assert.deepEqual(result, direct);
    // Bridge on the adapter frame must match the pipeline result.
    assert.deepEqual(analysePostureNormalizedFrame(frame), result);
  });
});

describe("posture demo scenarios", () => {
  it("aligned → score 100, Good alignment, sufficient", () => {
    const scenario = runPostureDemoScenario("aligned");
    assert.equal(scenario.bridgeOutcomes.length, 1);
    assert.ok(scenario.bridgeOutcomes[0]);
    assert.equal(scenario.bridgeOutcomes[0]?.score, 100);
    assert.equal(scenario.bridgeOutcomes[0]?.label, "Good alignment");
    assert.equal(scenario.aggregate.score, 100);
    assert.equal(scenario.aggregate.label, "Good alignment");
    assert.equal(scenario.aggregate.dataSufficiency, "sufficient");
  });

  it("mildShoulderTilt → ~5° tilt, score 88, sufficient", () => {
    const scenario = runPostureDemoScenario("mildShoulderTilt");
    const frameResult = scenario.bridgeOutcomes[0];
    assert.ok(frameResult);
    assert.ok(frameResult.shoulderTilt > 4 && frameResult.shoulderTilt <= 8);
    // Match Phase-1 expected score for 5° tilt geometry.
    assert.equal(frameResult.score, 88);
    assert.equal(frameResult.label, "Good alignment");
    assert.equal(scenario.aggregate.dataSufficiency, "sufficient");
    assert.equal(scenario.aggregate.score, 88);
  });

  it("markedShoulderTilt → ~10° tilt, score 75, Mild asymmetry, sufficient", () => {
    const scenario = runPostureDemoScenario("markedShoulderTilt");
    const frameResult = scenario.bridgeOutcomes[0];
    assert.ok(frameResult);
    assert.ok(frameResult.shoulderTilt > 8);
    assert.equal(frameResult.score, 75);
    assert.equal(frameResult.label, "Mild asymmetry detected");
    assert.equal(scenario.aggregate.score, 75);
    assert.equal(scenario.aggregate.label, "Mild asymmetry detected");
    assert.equal(scenario.aggregate.dataSufficiency, "sufficient");
  });

  it("lowVisibility → bridge null; aggregate keeps Phase-1 insufficient placeholders", () => {
    const scenario = runPostureDemoScenario("lowVisibility");
    assert.equal(scenario.bridgeOutcomes[0], null);
    assert.equal(scenario.frameResults.length, 0);
    assert.equal(scenario.aggregate.score, 75);
    assert.equal(scenario.aggregate.label, "Mild asymmetry detected");
    assert.equal(scenario.aggregate.dataSufficiency, "insufficient");
  });

  it("missingRequiredJoint → bridge null; aggregate insufficient", () => {
    const landmarks = buildMissingRequiredJointPoseLandmarks();
    const frame = normalizePoseLandmarksForPosture(landmarks);
    assert.ok(frame);
    assert.equal(frame.joints.left_hip, undefined);

    const scenario = runPostureDemoScenario("missingRequiredJoint");
    assert.equal(scenario.bridgeOutcomes[0], null);
    assert.equal(scenario.aggregate.score, 75);
    assert.equal(scenario.aggregate.label, "Mild asymmetry detected");
    assert.equal(scenario.aggregate.dataSufficiency, "insufficient");
  });

  it("mixedSequence → averaged score 94, Good alignment, sufficient", () => {
    const scenario = runPostureDemoScenario("mixedSequence");
    assert.equal(scenario.frameResults.length, 2);
    assert.equal(scenario.frameResults[0]?.score, 100);
    assert.equal(scenario.frameResults[1]?.score, 88);
    assert.equal(scenario.aggregate.score, 94);
    assert.equal(scenario.aggregate.label, "Good alignment");
    assert.equal(scenario.aggregate.dataSufficiency, "sufficient");
  });

  it("shoulder-tilt fixtures match Phase-1 NormLandmark geometry through adapter", () => {
    const mildPose = buildShoulderTiltPoseLandmarks(5);
    const { result: mild } = runPostureAcquisitionPipeline(mildPose);
    assert.ok(mild);
    assert.equal(mild.score, analysePostureFrame(
      (() => {
        const landmarks = alignedNorm();
        const halfWidth = 0.1;
        const dy = Math.tan((5 * Math.PI) / 180) * (halfWidth * 2);
        landmarks[11] = lm(0.4, 0.35);
        landmarks[12] = lm(0.6, 0.35 + dy);
        return landmarks;
      })()
    )?.score);
  });
});
