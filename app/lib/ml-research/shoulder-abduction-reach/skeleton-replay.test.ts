/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/skeleton-replay.test.ts
 *
 * Only the pure numeric helpers are covered here — drawShoulderAbductionSkeletonFrame /
 * drawAnatomicalGuideOverlay need a real CanvasRenderingContext2D and are verified
 * manually in the browser (consistent with how canvas-drawing code elsewhere in this
 * codebase is tested).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCurrentTrunkAxis,
  computeHipMidpoint,
  computeInitialBodyMidline,
  computePelvicLine,
  computeReplayDurationMs,
  computeShoulderLine,
  computeShoulderMidpoint,
  computeWristTrail,
  resolveFrameIndexForElapsedMs,
} from "@/app/lib/ml-research/shoulder-abduction-reach/skeleton-replay";
import type {
  MlResearchCapturedJoints,
  ShoulderAbductionReachCapturedFrame,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";

function frame(relativeTimestampMs: number, frameIndex: number): ShoulderAbductionReachCapturedFrame {
  return { relativeTimestampMs, frameIndex, joints: {} };
}

function j(x: number, y: number, visible = true) {
  return { landmark: { x, y }, confidence: { visibility: visible ? 0.9 : 0.1, present: visible } };
}

function bodyJoints(overrides: Partial<MlResearchCapturedJoints> = {}): MlResearchCapturedJoints {
  return {
    left_shoulder: j(0.4, 0.3),
    right_shoulder: j(0.6, 0.3),
    left_hip: j(0.42, 0.6),
    right_hip: j(0.58, 0.6),
    left_wrist: j(0.35, 0.35),
    right_wrist: j(0.65, 0.35),
    ...overrides,
  };
}

function frameWithJoints(
  relativeTimestampMs: number,
  frameIndex: number,
  joints: MlResearchCapturedJoints,
): ShoulderAbductionReachCapturedFrame {
  return { relativeTimestampMs, frameIndex, joints };
}

describe("resolveFrameIndexForElapsedMs", () => {
  it("returns -1 for an empty frame list", () => {
    assert.equal(resolveFrameIndexForElapsedMs([], 100), -1);
  });

  it("returns 0 when elapsed is before the first frame", () => {
    const frames = [frame(0, 0), frame(100, 1), frame(200, 2)];
    assert.equal(resolveFrameIndexForElapsedMs(frames, -5), 0);
  });

  it("returns the exact matching frame", () => {
    const frames = [frame(0, 0), frame(100, 1), frame(200, 2)];
    assert.equal(resolveFrameIndexForElapsedMs(frames, 100), 1);
  });

  it("returns the last frame at or before elapsed, for a value between frames", () => {
    const frames = [frame(0, 0), frame(100, 1), frame(200, 2)];
    assert.equal(resolveFrameIndexForElapsedMs(frames, 150), 1);
  });

  it("clamps to the last frame once elapsed exceeds the final timestamp", () => {
    const frames = [frame(0, 0), frame(100, 1), frame(200, 2)];
    assert.equal(resolveFrameIndexForElapsedMs(frames, 999), 2);
  });
});

describe("computeReplayDurationMs", () => {
  it("is 0 for an empty frame list", () => {
    assert.equal(computeReplayDurationMs([]), 0);
  });

  it("is the last frame's relativeTimestampMs", () => {
    const frames = [frame(0, 0), frame(100, 1), frame(912, 2)];
    assert.equal(computeReplayDurationMs(frames), 912);
  });
});

describe("computeShoulderMidpoint", () => {
  it("averages left_shoulder and right_shoulder", () => {
    const mid = computeShoulderMidpoint(bodyJoints());
    assert.ok(mid);
    assert.ok(Math.abs(mid.x - 0.5) < 1e-9);
    assert.ok(Math.abs(mid.y - 0.3) < 1e-9);
  });

  it("returns null when either shoulder is missing", () => {
    assert.equal(computeShoulderMidpoint(bodyJoints({ left_shoulder: undefined })), null);
    assert.equal(computeShoulderMidpoint(bodyJoints({ right_shoulder: undefined })), null);
  });

  it("returns null when a shoulder is present but below the presence rule", () => {
    assert.equal(computeShoulderMidpoint(bodyJoints({ left_shoulder: j(0.4, 0.3, false) })), null);
  });
});

describe("computeHipMidpoint", () => {
  it("averages left_hip and right_hip", () => {
    const mid = computeHipMidpoint(bodyJoints());
    assert.ok(mid);
    assert.ok(Math.abs(mid.x - 0.5) < 1e-9);
    assert.ok(Math.abs(mid.y - 0.6) < 1e-9);
  });

  it("returns null when either hip is missing", () => {
    assert.equal(computeHipMidpoint(bodyJoints({ left_hip: undefined })), null);
  });
});

describe("computeShoulderLine / computePelvicLine — left/right landmark identity preserved", () => {
  it("shoulder line always runs from the actual left_shoulder to the actual right_shoulder, never swapped", () => {
    const line = computeShoulderLine(bodyJoints());
    assert.ok(line);
    assert.deepEqual(line.from, { x: 0.4, y: 0.3 });
    assert.deepEqual(line.to, { x: 0.6, y: 0.3 });
  });

  it("pelvic line always runs from the actual left_hip to the actual right_hip, never swapped", () => {
    const line = computePelvicLine(bodyJoints());
    assert.ok(line);
    assert.deepEqual(line.from, { x: 0.42, y: 0.6 });
    assert.deepEqual(line.to, { x: 0.58, y: 0.6 });
  });

  it("returns null for the shoulder line when a shoulder is missing", () => {
    assert.equal(computeShoulderLine(bodyJoints({ right_shoulder: undefined })), null);
  });

  it("returns null for the pelvic line when a hip is missing", () => {
    assert.equal(computePelvicLine(bodyJoints({ left_hip: undefined })), null);
  });
});

describe("computeCurrentTrunkAxis — updates frame-by-frame", () => {
  it("runs from hip midpoint to shoulder midpoint for a single frame", () => {
    const axis = computeCurrentTrunkAxis(bodyJoints());
    assert.ok(axis);
    assert.ok(Math.abs(axis.from.x - 0.5) < 1e-9); // hip midpoint
    assert.ok(Math.abs(axis.to.x - 0.5) < 1e-9); // shoulder midpoint
  });

  it("reflects a lean in the frame it's computed from (live, not fixed)", () => {
    const upright = computeCurrentTrunkAxis(bodyJoints());
    const leaned = computeCurrentTrunkAxis(
      bodyJoints({ left_shoulder: j(0.55, 0.3), right_shoulder: j(0.75, 0.3) }), // shoulders shifted right
    );
    assert.ok(upright && leaned);
    assert.notEqual(upright.to.x, leaned.to.x, "the live axis must move when the current frame's shoulders move");
  });

  it("returns null when the trunk cannot be computed", () => {
    assert.equal(computeCurrentTrunkAxis(bodyJoints({ left_hip: undefined })), null);
  });
});

describe("computeInitialBodyMidline — static baseline anchoring", () => {
  it("anchors to frame 0 when it has a usable shoulder and hip midpoint", () => {
    const frames = [
      frameWithJoints(0, 0, bodyJoints()),
      frameWithJoints(33, 1, bodyJoints({ left_shoulder: j(0.6, 0.3), right_shoulder: j(0.9, 0.3) })), // leaned later
    ];
    const midline = computeInitialBodyMidline(frames);
    assert.ok(midline);
    assert.equal(midline.baselineFrameIndex, 0);
    // x is the mean of frame 0's shoulder-mid (0.5) and hip-mid (0.5) — both 0.5 in the fixture.
    assert.ok(Math.abs(midline.x - 0.5) < 1e-9);
  });

  it("does NOT move when later frames contain a trunk lean (the whole point of a static reference)", () => {
    const baselineFrames = [frameWithJoints(0, 0, bodyJoints())];
    const midlineFromBaselineAlone = computeInitialBodyMidline(baselineFrames);

    const framesWithLaterLean = [
      frameWithJoints(0, 0, bodyJoints()),
      frameWithJoints(33, 1, bodyJoints({ left_hip: j(0.7, 0.6), right_hip: j(0.9, 0.6) })), // hips shifted far right
      frameWithJoints(66, 2, bodyJoints({ left_shoulder: j(0.8, 0.3), right_shoulder: j(1.0, 0.3) })), // shoulders shifted far right
    ];
    const midlineWithLeanPresent = computeInitialBodyMidline(framesWithLaterLean);

    assert.ok(midlineFromBaselineAlone && midlineWithLeanPresent);
    assert.equal(
      midlineWithLeanPresent.x,
      midlineFromBaselineAlone.x,
      "the static midline must be identical whether or not later frames in the same repetition lean — it only ever reads the baseline frame",
    );
    assert.equal(midlineWithLeanPresent.baselineFrameIndex, 0);
  });

  it("falls back to the earliest frame with a usable baseline when frame 0 is unusable", () => {
    const frames = [
      frameWithJoints(0, 0, bodyJoints({ left_shoulder: undefined })), // frame 0 unusable — missing joint
      frameWithJoints(33, 1, bodyJoints({ left_hip: j(0.4, 0.6, false) })), // frame 1 unusable — below presence rule
      frameWithJoints(66, 2, bodyJoints()), // frame 2 usable
    ];
    const midline = computeInitialBodyMidline(frames);
    assert.ok(midline);
    assert.equal(midline.baselineFrameIndex, 2, "must skip unusable frames using the existing presence rule, not a new threshold");
  });

  it("returns null when no frame in the whole repetition has a usable baseline", () => {
    const frames = [
      frameWithJoints(0, 0, bodyJoints({ left_shoulder: undefined })),
      frameWithJoints(33, 1, bodyJoints({ right_hip: undefined })),
    ];
    assert.equal(computeInitialBodyMidline(frames), null);
  });

  it("returns null for an empty frame list", () => {
    assert.equal(computeInitialBodyMidline([]), null);
  });
});

describe("computeWristTrail", () => {
  it("uses the selected side's wrist, not the other side's", () => {
    const frames = [
      frameWithJoints(0, 0, bodyJoints({ left_wrist: j(0.1, 0.1), right_wrist: j(0.9, 0.9) })),
    ];
    const rightTrail = computeWristTrail(frames, "right", 0);
    const leftTrail = computeWristTrail(frames, "left", 0);
    assert.deepEqual(rightTrail, [{ x: 0.9, y: 0.9 }]);
    assert.deepEqual(leftTrail, [{ x: 0.1, y: 0.1 }]);
  });

  it("is short by design — respects trailLength", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frameWithJoints(i * 33, i, bodyJoints()));
    const trail = computeWristTrail(frames, "right", 19, 8);
    assert.equal(trail.length, 8);
  });

  it("skips frames with no usable wrist landmark rather than breaking", () => {
    const frames = [
      frameWithJoints(0, 0, bodyJoints()),
      frameWithJoints(33, 1, bodyJoints({ right_wrist: undefined })),
      frameWithJoints(66, 2, bodyJoints()),
    ];
    const trail = computeWristTrail(frames, "right", 2, 8);
    assert.equal(trail.length, 2, "the missing-wrist frame is skipped, not included as a gap");
  });

  it("returns an empty array when uptoFrameIndex is before any frames", () => {
    assert.deepEqual(computeWristTrail([], "right", -1), []);
  });
});
