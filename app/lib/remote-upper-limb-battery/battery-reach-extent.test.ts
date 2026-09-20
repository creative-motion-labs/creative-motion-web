/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-reach-extent.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  computeBatteryReachExtent,
  computeReachDisplacementFromBaseline,
} from "./battery-reach-extent";

function landmarksWithArm(
  side: "left" | "right",
  shoulderX: number,
  wristX: number,
): PoseLandmark[] {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.9,
  }));
  if (side === "right") {
    landmarks[12] = { x: shoulderX, y: 0.32, visibility: 0.9 };
    landmarks[16] = { x: wristX, y: 0.38, visibility: 0.9 };
  } else {
    landmarks[11] = { x: shoulderX, y: 0.32, visibility: 0.9 };
    landmarks[15] = { x: wristX, y: 0.38, visibility: 0.9 };
  }
  return landmarks;
}

describe("battery reach extent normalization", () => {
  it("keeps right-side decrease-as-reach polarity", () => {
    const rest = computeBatteryReachExtent(landmarksWithArm("right", 0.42, 0.52), "right");
    const reach = computeBatteryReachExtent(landmarksWithArm("right", 0.42, 0.44), "right");
    assert.ok(rest !== null && reach !== null);
    assert.ok(Math.abs(rest - 0.1) < 1e-9);
    assert.ok(Math.abs(reach - 0.02) < 1e-9);
    assert.ok(reach < rest);
  });

  it("inverts left-side wrist–shoulder X so forward reach decreases the signal", () => {
    const rest = computeBatteryReachExtent(landmarksWithArm("left", 0.42, 0.52), "left");
    const reach = computeBatteryReachExtent(landmarksWithArm("left", 0.42, 0.67), "left");
    assert.ok(rest !== null && reach !== null);
    assert.ok(Math.abs(rest - -0.1) < 1e-9);
    assert.ok(Math.abs(reach - -0.25) < 1e-9);
    assert.ok(reach < rest);
  });

  it("persists displacement from baseline, not the rest extrema", () => {
    assert.equal(computeReachDisplacementFromBaseline(0.1, 0.02), 0.08);
    assert.equal(computeReachDisplacementFromBaseline(-0.1, -0.25), 0.15);
    assert.equal(computeReachDisplacementFromBaseline(0.1, 0.1), 0);
  });
});
