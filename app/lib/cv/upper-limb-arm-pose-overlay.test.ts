/**
 * Run: npx tsx --test app/lib/cv/upper-limb-arm-pose-overlay.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drawUpperLimbArmMotionGuidanceOverlay,
  isUpperLimbArmOverlayReady,
} from "./upper-limb-arm-pose-overlay";

function landmark(x: number, y: number, visibility = 0.9) {
  return { x, y, visibility };
}

describe("upper-limb-arm-pose-overlay", () => {
  it("requires shoulder, elbow, and wrist visibility before drawing", () => {
    const sparse = Array.from({ length: 17 }, () => landmark(0, 0, 0));
    assert.equal(isUpperLimbArmOverlayReady(sparse, "right"), false);

    const landmarks = [...sparse];
    landmarks[12] = landmark(0.5, 0.3);
    landmarks[14] = landmark(0.55, 0.45);
    landmarks[16] = landmark(0.6, 0.6);
    assert.equal(isUpperLimbArmOverlayReady(landmarks, "right"), true);
  });

  it("does not draw when tracking is incomplete", () => {
    const landmarks = Array.from({ length: 17 }, () => landmark(0, 0, 0));
    landmarks[12] = landmark(0.5, 0.3);
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      arc() {},
      fill() {},
    } as CanvasRenderingContext2D;
    assert.equal(
      drawUpperLimbArmMotionGuidanceOverlay(ctx, landmarks, 640, 480, "right"),
      false,
    );
  });
});
