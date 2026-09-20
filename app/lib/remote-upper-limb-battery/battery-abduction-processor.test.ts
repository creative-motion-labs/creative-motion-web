/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-abduction-processor.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { createShoulderAbductionProcessor } from "./battery-frame-processors";

const R_SHOULDER = 12;
const R_ELBOW = 14;
const R_HIP = 24;

function baseLandmarks(): PoseLandmark[] {
  const landmarks: PoseLandmark[] = [];
  for (let i = 0; i < 33; i += 1) {
    landmarks.push({ x: 0.5, y: 0.5, visibility: 0.9 });
  }
  landmarks[R_HIP] = { x: 0.3, y: 0.7, visibility: 0.9 };
  landmarks[R_SHOULDER] = { x: 0.3, y: 0.5, visibility: 0.9 };
  landmarks[R_ELBOW] = { x: 0.3, y: 0.68, visibility: 0.9 };
  return landmarks;
}

function withRightAbductionAngle(angleDeg: 0 | 90 | 180): PoseLandmark[] {
  const landmarks = baseLandmarks();
  if (angleDeg === 0) {
    landmarks[R_ELBOW] = { x: 0.3, y: 0.68, visibility: 0.9 };
  } else if (angleDeg === 90) {
    landmarks[R_ELBOW] = { x: 0.5, y: 0.5, visibility: 0.9 };
  } else {
    landmarks[R_ELBOW] = { x: 0.3, y: 0.3, visibility: 0.9 };
  }
  return landmarks;
}

function ctx(frameIndex: number) {
  return { frameIndex, capturedAtMs: frameIndex * 33 };
}

describe("shoulder abduction battery processor", () => {
  it("does not accumulate reps before movement tracking is armed", () => {
    const processor = createShoulderAbductionProcessor("right");
    const cycle: (0 | 90 | 180)[] = [0, 0, 90, 180, 180, 90, 0, 0];
    for (const [index, angle] of cycle.entries()) {
      const snapshot = processor.processFrame(withRightAbductionAngle(angle), ctx(index));
      assert.equal(snapshot.repCount, 0);
      assert.equal(processor.isMovementTrackingEnabled(), false);
    }
  });

  it("counts exactly three valid right-side reps", () => {
    const processor = createShoulderAbductionProcessor("right");
    processor.beginMovementTracking();
    const cycle: (0 | 90 | 180)[] = [0, 0, 90, 180, 180, 90, 0, 0];
    let lastRepCount = 0;

    for (let rep = 0; rep < 3; rep += 1) {
      for (const [index, angle] of cycle.entries()) {
        const snapshot = processor.processFrame(withRightAbductionAngle(angle), ctx(rep * cycle.length + index));
        lastRepCount = snapshot.repCount;
      }
    }

    assert.equal(lastRepCount, 3);
    const finalSnapshot = processor.processFrame(withRightAbductionAngle(0), ctx(999));
    assert.equal(finalSnapshot.completedPeaksDeg.length, 3);
  });
});
