/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/lateral-reach-calibration-camera-sample-adapter.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence/types";
import { resolveLateralReachCalibrationSampleFromFrame } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-camera-sample-adapter";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

const EXACT_VISIBILITY_ERROR =
  "minWristVisibility must be a finite number within [0,1]";

type FrameJointOverrides = {
  x?: number;
  y?: number;
  z?: number;
  visibility?: number;
  present?: boolean;
};

function frameWithWrists(
  atMs: number,
  options: {
    left?: FrameJointOverrides | null;
    right?: FrameJointOverrides | null;
  } = {},
): NormalizedMotionFrame {
  const joints: NormalizedMotionFrame["joints"] = {};

  for (const [side, overrides] of [
    ["left", options.left],
    ["right", options.right],
  ] as const) {
    if (overrides === null) continue;
    if (overrides === undefined) continue;
    const jointId: JointId = side === "left" ? "left_wrist" : "right_wrist";
    joints[jointId] = {
      landmark: {
        x: overrides.x ?? 0.3,
        y: overrides.y ?? 0.5,
        ...(overrides.z !== undefined ? { z: overrides.z } : {}),
      },
      confidence: {
        visibility: overrides.visibility ?? 0.9,
        present: overrides.present ?? true,
      },
    };
  }

  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      kind: "web_camera_pose",
      capturedAtMs: atMs,
      frameIndex: 0,
      coordinateSpace: "normalized_2d",
    },
    joints,
  };
}

function assertVisibilityRangeError(fn: () => unknown) {
  assert.throws(
    fn,
    (err: unknown) =>
      err instanceof RangeError && err.message === EXACT_VISIBILITY_ERROR,
  );
}

describe("resolveLateralReachCalibrationSampleFromFrame — wrist selection", () => {
  it("selects only left_wrist for left testedSide", () => {
    const frame = frameWithWrists(100, {
      left: { x: 0.25, y: 0.4 },
      right: { x: 0.75, y: 0.6 },
    });
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "left",
      0.2,
    );
    assert.deepEqual(sample.wrist, { x: 0.25, y: 0.4 });
    assert.equal(sample.trackingValid, true);
  });

  it("selects only right_wrist for right testedSide", () => {
    const frame = frameWithWrists(100, {
      left: { x: 0.25, y: 0.4 },
      right: { x: 0.75, y: 0.6 },
    });
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "right",
      0.2,
    );
    assert.deepEqual(sample.wrist, { x: 0.75, y: 0.6 });
    assert.equal(sample.trackingValid, true);
  });

  it("changing testedSide changes selection only; no direction-shaped fields", () => {
    const frame = frameWithWrists(50, {
      left: { x: 0.2, y: 0.5 },
      right: { x: 0.8, y: 0.5 },
    });
    const left = resolveLateralReachCalibrationSampleFromFrame(frame, "left", 0.2);
    const right = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "right",
      0.2,
    );
    assert.notDeepEqual(left.wrist, right.wrist);
    for (const sample of [left, right]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          sample,
          "screenHorizontalDirection",
        ),
        false,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          sample,
          "expectedHorizontalDirectionSign",
        ),
        false,
      );
    }
  });

  it("non-tested-side wrist alone cannot satisfy the sample", () => {
    const frame = frameWithWrists(10, {
      left: null,
      right: { x: 0.8, y: 0.5, visibility: 0.99 },
    });
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "left",
      0.2,
    );
    assert.equal(sample.wrist, null);
    assert.equal(sample.trackingValid, false);
  });
});

describe("resolveLateralReachCalibrationSampleFromFrame — minWristVisibility", () => {
  it("rejects invalid thresholds with exact RangeError", () => {
    const frame = frameWithWrists(0, { left: { x: 0.3, y: 0.5 } });
    const invalid: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      1.5,
      "0.2",
      null,
      undefined,
    ];
    for (const minWristVisibility of invalid) {
      assertVisibilityRangeError(() =>
        resolveLateralReachCalibrationSampleFromFrame(
          frame,
          "left",
          minWristVisibility,
        ),
      );
    }
  });

  it("accepts structural bounds 0 and 1 as legal thresholds", () => {
    const atZero = frameWithWrists(1, {
      left: { x: 0.3, y: 0.5, visibility: 0 },
    });
    const zeroSample = resolveLateralReachCalibrationSampleFromFrame(
      atZero,
      "left",
      0,
    );
    assert.equal(zeroSample.trackingValid, true);

    const atOne = frameWithWrists(1, {
      left: { x: 0.3, y: 0.5, visibility: 1 },
    });
    const oneSample = resolveLateralReachCalibrationSampleFromFrame(
      atOne,
      "left",
      1,
    );
    assert.equal(oneSample.trackingValid, true);
  });
});

describe("resolveLateralReachCalibrationSampleFromFrame — confidence", () => {
  it("missing selected wrist → null / false", () => {
    const frame = frameWithWrists(5, { left: null, right: { x: 0.7, y: 0.5 } });
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "left",
      0.3,
    );
    assert.deepEqual(sample, {
      atMs: 5,
      wrist: null,
      trackingValid: false,
    });
  });

  it("confidence.present false → null / false", () => {
    const frame = frameWithWrists(5, {
      left: { x: 0.3, y: 0.5, visibility: 0.9, present: false },
    });
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "left",
      0.3,
    );
    assert.equal(sample.wrist, null);
    assert.equal(sample.trackingValid, false);
  });

  it("visibility below / equal / above threshold", () => {
    const threshold = 0.4;
    const below = resolveLateralReachCalibrationSampleFromFrame(
      frameWithWrists(1, { left: { visibility: 0.399 } }),
      "left",
      threshold,
    );
    assert.equal(below.wrist, null);
    assert.equal(below.trackingValid, false);

    const exact = resolveLateralReachCalibrationSampleFromFrame(
      frameWithWrists(1, { left: { visibility: 0.4 } }),
      "left",
      threshold,
    );
    assert.equal(exact.trackingValid, true);
    assert.ok(exact.wrist);

    const above = resolveLateralReachCalibrationSampleFromFrame(
      frameWithWrists(1, { left: { visibility: 0.41 } }),
      "left",
      threshold,
    );
    assert.equal(above.trackingValid, true);
    assert.ok(above.wrist);
  });
});

describe("resolveLateralReachCalibrationSampleFromFrame — coordinates", () => {
  const cases: Array<{ side: UpperLimbSide; patch: FrameJointOverrides }> = [
    { side: "left", patch: { x: Number.NaN } },
    { side: "left", patch: { x: Number.POSITIVE_INFINITY } },
    { side: "left", patch: { x: -0.01 } },
    { side: "left", patch: { x: 1.01 } },
    { side: "right", patch: { y: Number.NaN } },
    { side: "right", patch: { y: Number.POSITIVE_INFINITY } },
    { side: "right", patch: { y: -0.01 } },
    { side: "right", patch: { y: 1.01 } },
  ];

  for (const { side, patch } of cases) {
    it(`invalid ${JSON.stringify(patch)} → null / false without throw`, () => {
      const frame = frameWithWrists(9, {
        [side]: { x: 0.3, y: 0.5, visibility: 0.9, ...patch },
      });
      const sample = resolveLateralReachCalibrationSampleFromFrame(
        frame,
        side,
        0.2,
      );
      assert.equal(sample.wrist, null);
      assert.equal(sample.trackingValid, false);
      assert.equal(sample.atMs, 9);
    });
  }
});

describe("resolveLateralReachCalibrationSampleFromFrame — valid output", () => {
  it("returns exact x/y/atMs, trackingValid true, no z, no framingValid", () => {
    const frame = frameWithWrists(42, {
      left: { x: 0.31, y: 0.52, z: 0.12, visibility: 0.95 },
    });
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "left",
      0.2,
    );
    assert.deepEqual(sample, {
      atMs: 42,
      wrist: { x: 0.31, y: 0.52 },
      trackingValid: true,
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(sample, "framingValid"),
      false,
    );
    assert.ok(sample.wrist);
    assert.equal(
      Object.prototype.hasOwnProperty.call(sample.wrist, "z"),
      false,
    );
  });

  it("clones wrist point; mutating result does not mutate source landmark", () => {
    const frame = frameWithWrists(7, {
      left: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const landmark = frame.joints.left_wrist!.landmark;
    const sample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "left",
      0.2,
    );
    assert.ok(sample.wrist);
    assert.notEqual(sample.wrist, landmark);
    sample.wrist.x = 0.99;
    assert.equal(landmark.x, 0.3);
  });
});

describe("resolveLateralReachCalibrationSampleFromFrame — timestamp pass-through", () => {
  it("passes capturedAtMs verbatim, including malformed runtime values", () => {
    for (const atMs of [0, 12.5, -3, Number.POSITIVE_INFINITY, Number.NaN]) {
      const frame = frameWithWrists(0, {
        left: { x: 0.3, y: 0.5, visibility: 0.9 },
      });
      // Test-only runtime override of typed capture timestamp.
      (frame.source as { capturedAtMs: number }).capturedAtMs = atMs;
      const sample = resolveLateralReachCalibrationSampleFromFrame(
        frame,
        "left",
        0.2,
      );
      if (Number.isNaN(atMs)) {
        assert.equal(Number.isNaN(sample.atMs), true);
      } else {
        assert.equal(sample.atMs, atMs);
      }
    }
  });
});

describe("resolveLateralReachCalibrationSampleFromFrame — determinism", () => {
  it("identical inputs produce deep-equal outputs", () => {
    const frame = frameWithWrists(11, {
      left: { x: 0.33, y: 0.44, visibility: 0.8 },
    });
    const a = resolveLateralReachCalibrationSampleFromFrame(frame, "left", 0.2);
    const b = resolveLateralReachCalibrationSampleFromFrame(frame, "left", 0.2);
    assert.deepEqual(a, b);
  });
});

describe("lateral-reach-calibration-camera-sample-adapter — source contracts", () => {
  const source = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "lateral-reach-calibration-camera-sample-adapter.ts",
    ),
    "utf8",
  );

  it("forbids direction/engine/camera/controller-runtime dependencies", () => {
    assert.equal(source.includes("screenHorizontalDirection"), false);
    assert.equal(source.includes("attempt-plan"), false);
    assert.equal(source.includes("attempt-intention"), false);
    assert.equal(source.includes("expectedHorizontalDirectionSign"), false);
    assert.equal(source.includes("targetPlacement"), false);
    assert.equal(source.includes("lateral-reach-engine"), false);
    assert.equal(source.includes("engine-config-adapter"), false);
    assert.equal(source.includes("validateLateralReachConfig"), false);
    assert.equal(source.includes("MediaPipe"), false);
    assert.equal(source.includes("PoseLandmark"), false);
    assert.equal(source.includes("camera-detector"), false);
    assert.equal(source.includes("Date.now"), false);
    assert.equal(source.includes("performance.now"), false);
    assert.equal(source.includes("Math.sign"), false);
    assert.equal(
      source.includes("createLateralReachCalibrationController"),
      false,
    );
    assert.equal(
      source.includes("submitLateralReachCalibrationSample"),
      false,
    );
    assert.equal(/minWristVisibility\s*=/.test(source), false);
  });
});
