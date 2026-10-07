/**
 * Run: npx tsx --test app/lib/posture-screen/posture-frame-bridge.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormLandmark } from "@/app/lib/body-axis-acl-squat";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence";
import { analysePostureFrame } from "@/app/lib/posture-analyzer";
import {
  analysePostureNormalizedFrame,
  POSTURE_MIN_JOINT_VISIBILITY,
  POSTURE_REQUIRED_JOINT_IDS,
} from "./posture-frame-bridge";

function lm(x: number, y: number, visibility = 1): NormLandmark {
  return { x, y, visibility };
}

function alignedNormLandmarks(): NormLandmark[] {
  const landmarks: NormLandmark[] = Array.from({ length: 33 }, () => lm(0, 0, 0));
  landmarks[0] = lm(0.5, 0.2);
  landmarks[11] = lm(0.4, 0.35);
  landmarks[12] = lm(0.6, 0.35);
  landmarks[23] = lm(0.4, 0.65);
  landmarks[24] = lm(0.6, 0.65);
  return landmarks;
}

function withShoulderTiltNorm(tiltDeg: number): NormLandmark[] {
  const landmarks = alignedNormLandmarks();
  const halfWidth = 0.1;
  const dy = Math.tan((tiltDeg * Math.PI) / 180) * (halfWidth * 2);
  landmarks[11] = lm(0.4, 0.35);
  landmarks[12] = lm(0.6, 0.35 + dy);
  return landmarks;
}

function frameFromNormLandmarks(
  landmarks: NormLandmark[],
  opts?: { presentOverride?: boolean }
): NormalizedMotionFrame {
  const indexToJoint: Record<number, JointId> = {
    0: "nose",
    11: "left_shoulder",
    12: "right_shoulder",
    23: "left_hip",
    24: "right_hip",
  };

  const joints: NormalizedMotionFrame["joints"] = {};
  for (const [indexStr, jointId] of Object.entries(indexToJoint)) {
    const index = Number(indexStr);
    const landmark = landmarks[index];
    if (!landmark) continue;
    const visibility = landmark.visibility ?? 1;
    joints[jointId] = {
      landmark: { x: landmark.x, y: landmark.y },
      confidence: {
        visibility,
        // Deliberately set present using adapter-like 0.2 rule when not overridden,
        // to prove the bridge ignores present and uses visibility >= 0.3.
        present:
          opts?.presentOverride ?? visibility >= 0.2,
      },
    };
  }

  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      kind: "web_camera_pose",
      capturedAtMs: 1_000,
      frameIndex: 0,
      coordinateSpace: "normalized_2d",
    },
    joints,
  };
}

describe("analysePostureNormalizedFrame — required joints / visibility", () => {
  it("exports Phase-1 posture visibility threshold 0.3", () => {
    assert.equal(POSTURE_MIN_JOINT_VISIBILITY, 0.3);
    assert.deepEqual(POSTURE_REQUIRED_JOINT_IDS, [
      "nose",
      "left_shoulder",
      "right_shoulder",
      "left_hip",
      "right_hip",
    ]);
  });

  it("returns null when a required joint is missing", () => {
    const frame = frameFromNormLandmarks(alignedNormLandmarks());
    delete frame.joints.left_hip;
    assert.equal(analysePostureNormalizedFrame(frame), null);
  });

  it("returns null when visibility is 0.29", () => {
    const landmarks = alignedNormLandmarks();
    landmarks[0] = lm(0.5, 0.2, 0.29);
    const frame = frameFromNormLandmarks(landmarks);
    // present would be true at 0.29 under adapter rule — bridge must still reject.
    assert.equal(frame.joints.nose?.confidence.present, true);
    assert.equal(analysePostureNormalizedFrame(frame), null);
  });

  it("returns usable result when visibility is exactly 0.30", () => {
    const landmarks = alignedNormLandmarks();
    for (const idx of [0, 11, 12, 23, 24]) {
      landmarks[idx] = { ...landmarks[idx], visibility: 0.3 };
    }
    const frame = frameFromNormLandmarks(landmarks);
    const result = analysePostureNormalizedFrame(frame);
    assert.ok(result);
    assert.equal(result.score, 100);
    assert.equal(result.label, "Good alignment");
  });

  it("does not treat confidence.present as the posture gate", () => {
    const landmarks = alignedNormLandmarks();
    landmarks[0] = lm(0.5, 0.2, 0.25);
    const frame = frameFromNormLandmarks(landmarks, { presentOverride: true });
    assert.equal(frame.joints.nose?.confidence.present, true);
    assert.equal(frame.joints.nose?.confidence.visibility, 0.25);
    assert.equal(analysePostureNormalizedFrame(frame), null);
  });
});

describe("analysePostureNormalizedFrame — equivalence with analysePostureFrame", () => {
  it("matches aligned NormLandmark analysis", () => {
    const landmarks = alignedNormLandmarks();
    const direct = analysePostureFrame(landmarks);
    const bridged = analysePostureNormalizedFrame(frameFromNormLandmarks(landmarks));
    assert.deepEqual(bridged, direct);
  });

  it("matches mild shoulder-tilt analysis (score 88)", () => {
    const landmarks = withShoulderTiltNorm(5);
    const direct = analysePostureFrame(landmarks);
    const bridged = analysePostureNormalizedFrame(frameFromNormLandmarks(landmarks));
    assert.ok(direct);
    assert.ok(bridged);
    assert.equal(bridged.score, 88);
    assert.equal(bridged.label, "Good alignment");
    assert.deepEqual(bridged, direct);
  });

  it("matches marked shoulder-tilt analysis (score 75)", () => {
    const landmarks = withShoulderTiltNorm(10);
    const direct = analysePostureFrame(landmarks);
    const bridged = analysePostureNormalizedFrame(frameFromNormLandmarks(landmarks));
    assert.ok(direct);
    assert.ok(bridged);
    assert.equal(bridged.score, 75);
    assert.equal(bridged.label, "Mild asymmetry detected");
    assert.deepEqual(bridged, direct);
  });
});
