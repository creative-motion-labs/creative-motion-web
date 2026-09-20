/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-processor-arming.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  createElbowFlexionProcessor,
  createShoulderFlexionProcessor,
} from "./battery-frame-processors";

function baseLandmarks(): PoseLandmark[] {
  const landmarks: PoseLandmark[] = [];
  for (let i = 0; i < 33; i += 1) {
    landmarks.push({ x: 0.5, y: 0.5, visibility: 0.9 });
  }
  return landmarks;
}

function rightFlexionLandmarks(mode: "rest" | "peak"): PoseLandmark[] {
  const landmarks = baseLandmarks();
  landmarks[12] = { x: 0.4, y: 0.45, visibility: 0.9 };
  landmarks[14] =
    mode === "rest"
      ? { x: 0.4, y: 0.72, visibility: 0.9 }
      : { x: 0.58, y: 0.18, visibility: 0.9 };
  return landmarks;
}

function rightElbowLandmarks(mode: "extended" | "flexed"): PoseLandmark[] {
  const landmarks = baseLandmarks();
  landmarks[12] = { x: 0.4, y: 0.35, visibility: 0.9 };
  landmarks[14] = { x: 0.4, y: 0.55, visibility: 0.9 };
  landmarks[16] =
    mode === "extended"
      ? { x: 0.4, y: 0.75, visibility: 0.9 }
      : { x: 0.58, y: 0.38, visibility: 0.9 };
  return landmarks;
}

function ctx(frameIndex: number) {
  return { frameIndex, capturedAtMs: frameIndex * 33 };
}

function feedFlexionCycle(
  processor: ReturnType<typeof createShoulderFlexionProcessor>,
  startFrame: number,
) {
  const sequence: Array<"rest" | "peak"> = ["rest", "rest", "peak", "peak", "peak", "rest", "rest"];
  let snapshot = processor.processFrame(rightFlexionLandmarks("rest"), ctx(startFrame));
  for (const [index, mode] of sequence.entries()) {
    snapshot = processor.processFrame(rightFlexionLandmarks(mode), ctx(startFrame + index + 1));
  }
  return snapshot;
}

function feedElbowCycle(
  processor: ReturnType<typeof createElbowFlexionProcessor>,
  startFrame: number,
) {
  const sequence: Array<"extended" | "flexed"> = [
    "extended",
    "extended",
    "flexed",
    "flexed",
    "flexed",
    "extended",
    "extended",
  ];
  let snapshot = processor.processFrame(rightElbowLandmarks("extended"), ctx(startFrame));
  for (const [index, mode] of sequence.entries()) {
    snapshot = processor.processFrame(rightElbowLandmarks(mode), ctx(startFrame + index + 1));
  }
  return snapshot;
}

describe("battery processor pre-start arming", () => {
  it("shoulder flexion does not count reps before arming", () => {
    const processor = createShoulderFlexionProcessor("right");
    const before = feedFlexionCycle(processor, 0);
    assert.equal(before.repCount, 0);
    assert.equal(processor.isMovementTrackingEnabled(), false);
    processor.beginMovementTracking();
    const after = feedFlexionCycle(processor, 20);
    assert.equal(after.repCount, 1);
  });

  it("elbow flexion does not count reps before arming", () => {
    const processor = createElbowFlexionProcessor("right");
    const before = feedElbowCycle(processor, 0);
    assert.equal(before.repCount, 0);
    assert.equal(processor.isMovementTrackingEnabled(), false);
    processor.beginMovementTracking();
    const after = feedElbowCycle(processor, 20);
    assert.equal(after.repCount, 1);
  });
});
