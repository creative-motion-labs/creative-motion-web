/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-tracking.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { createPreviewPositionProcessor, createShoulderFlexionProcessor } from "./battery-frame-processors";
import {
  evaluateBatteryArmTracking,
  isBatteryProcessorTrackingUsable,
  readArmVisibility,
} from "./battery-tracking";
import { computeShoulderFlexionElevationFromPoseLandmarks } from "./shoulder-flexion-metrics";
import { DEFAULT_SHOULDER_FLEXION_THRESHOLDS } from "./shoulder-flexion-contract";

function baseLandmarks(): PoseLandmark[] {
  const landmarks: PoseLandmark[] = [];
  for (let i = 0; i < 33; i += 1) {
    landmarks.push({ x: 0.5, y: 0.5, visibility: 0.9 });
  }
  landmarks[12] = { x: 0.7, y: 0.45, visibility: 0.85 };
  landmarks[14] = { x: 0.72, y: 0.65, visibility: 0.82 };
  landmarks[16] = { x: 0.74, y: 0.8, visibility: 0.15 };
  return landmarks;
}

describe("battery tracking gate", () => {
  it("uses tested-side shoulder and elbow for flexion without requiring wrist visibility", () => {
    const landmarks = baseLandmarks();
    const evaluation = evaluateBatteryArmTracking({
      landmarks,
      side: "right",
      requiredParts: ["shoulder", "elbow"],
      metricReady: true,
    });
    assert.equal(evaluation.ready, true);
    assert.notEqual(evaluation.quality, "poor");
  });

  it("rejects flexion when wrist is included but elbow is weak", () => {
    const landmarks = baseLandmarks();
    landmarks[14] = { x: 0.72, y: 0.65, visibility: 0.1 };
    const evaluation = evaluateBatteryArmTracking({
      landmarks,
      side: "right",
      requiredParts: ["shoulder", "elbow"],
      metricReady: false,
    });
    assert.equal(evaluation.ready, false);
    assert.match(evaluation.rejectionReason ?? "", /metric_unavailable/);
  });

  it("shoulder flexion processor stays usable in side view when wrist is occluded", () => {
    const processor = createShoulderFlexionProcessor("right");
    const snapshot = processor.processFrame(baseLandmarks(), { frameIndex: 0, capturedAtMs: 0 });
    assert.equal(isBatteryProcessorTrackingUsable(snapshot), true);
    assert.equal(snapshot.repCount, 0);
  });

  it("preview processor uses tested side landmarks", () => {
    const landmarks = baseLandmarks();
    landmarks[11] = { x: 0.3, y: 0.45, visibility: 0.9 };
    landmarks[13] = { x: 0.32, y: 0.65, visibility: 0.9 };
    landmarks[12] = { x: 0.7, y: 0.45, visibility: 0.1 };
    landmarks[14] = { x: 0.72, y: 0.65, visibility: 0.1 };

    const leftPreview = createPreviewPositionProcessor("left").processFrame(landmarks, {
      frameIndex: 0,
      capturedAtMs: 0,
    });
    assert.equal(leftPreview.trackingReady, true);

    const rightPreview = createPreviewPositionProcessor("right").processFrame(landmarks, {
      frameIndex: 0,
      capturedAtMs: 0,
    });
    assert.equal(rightPreview.trackingReady, false);
  });

  it("raw landmark fallback computes elevation when normalized frame would omit edge joints", () => {
    const landmarks = baseLandmarks();
    landmarks[14] = { x: 1.02, y: 0.65, visibility: 0.8 };
    const elevation = computeShoulderFlexionElevationFromPoseLandmarks(
      landmarks,
      "right",
      DEFAULT_SHOULDER_FLEXION_THRESHOLDS.minJointConfidence,
    );
    assert.notEqual(elevation, null);
  });

  it("readArmVisibility reports anatomical right and left separately", () => {
    const landmarks = baseLandmarks();
    landmarks[11] = { x: 0.3, y: 0.45, visibility: 0.2 };
    landmarks[13] = { x: 0.32, y: 0.65, visibility: 0.2 };
    const right = readArmVisibility(landmarks, "right");
    const left = readArmVisibility(landmarks, "left");
    assert.ok(right.elbow > left.elbow);
    assert.ok(right.wrist < 0.2);
  });
});
