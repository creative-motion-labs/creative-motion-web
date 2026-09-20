/**
 * Lateral Reach Camera Lab — Slice 19 TEST: calibration frame bridge.
 *
 * Proves composition: acquisition observation → Slice 12 sample adapter →
 * Slice 11 controller, including the frame:null branch and the
 * controller-owns-testedSide guarantee.
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/calibration-frame-bridge.test.ts"
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { LateralReachCameraAcquisitionObservation } from "@/app/lib/cv/lateral-reach-camera-detector";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence/types";
import { resolveLateralReachCalibrationSampleFromFrame } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-camera-sample-adapter";
import {
  createLateralReachCalibrationController,
  getLateralReachCalibrationOutcome,
  startLateralReachCalibrationAttempt,
  submitLateralReachCalibrationSample,
  type LateralReachCalibrationControllerInput,
  type LateralReachCalibrationControllerState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";
import {
  resolveLateralReachCalibrationSampleFromObservation,
  submitLateralReachCalibrationObservation,
} from "./calibration-frame-bridge";

// ---------------------------------------------------------------------------
// Private TEST VECTORS ONLY (not lab defaults, not production policy)
// ---------------------------------------------------------------------------

const TEST_MIN_WRIST_VISIBILITY = 0.2;

const TEST_START_CAPTURE_CONFIG = {
  minStableDurationMs: 100,
  maxJitterRadius: 0.05,
  minStableSampleCount: 3,
  totalTimeoutMs: 1000,
};

const TEST_ENDPOINT_CAPTURE_CONFIG = {
  minStableDurationMs: 100,
  maxJitterRadius: 0.05,
  minStableSampleCount: 3,
  totalTimeoutMs: 1000,
  minDisplacementFromStart: 0.1,
};

const TEST_ZONE_RADII = {
  startingZoneRadius: 0.05,
  fixedTargetRadius: 0.05,
};

const TEST_NOISE_FLOOR = 0.05;

const TEST_PLAN_POSITIVE_X = {
  screenHorizontalDirection: "positive_x" as const,
};

const TEST_START_WRIST = { x: 0.3, y: 0.5 };
const TEST_ENDPOINT_POSITIVE = { x: 0.55, y: 0.5 };

const TEST_START_TIMES_MS = [0, 50, 100] as const;
const TEST_ENDPOINT_TIMES_MS = [200, 250, 300] as const;

// ---------------------------------------------------------------------------
// Private helpers (test-local; not production utilities)
// ---------------------------------------------------------------------------

type TestWristOverrides = {
  x?: number;
  y?: number;
  visibility?: number;
  present?: boolean;
};

function buildTestFrame(
  capturedAtMs: number,
  options: {
    left?: TestWristOverrides | null;
    right?: TestWristOverrides | null;
  } = {},
): NormalizedMotionFrame {
  const joints: NormalizedMotionFrame["joints"] = {};

  for (const [side, overrides] of [
    ["left", options.left],
    ["right", options.right],
  ] as const) {
    if (overrides === null || overrides === undefined) continue;
    const jointId: JointId = side === "left" ? "left_wrist" : "right_wrist";
    joints[jointId] = {
      landmark: {
        x: overrides.x ?? TEST_START_WRIST.x,
        y: overrides.y ?? TEST_START_WRIST.y,
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
      capturedAtMs,
      frameIndex: 0,
      coordinateSpace: "normalized_2d",
    },
    joints,
  };
}

function wristOptionsForSide(
  testedSide: UpperLimbSide,
  wrist: { x: number; y: number },
  visibility = 0.9,
): { left?: TestWristOverrides | null; right?: TestWristOverrides | null } {
  if (testedSide === "left") {
    return { left: { ...wrist, visibility }, right: null };
  }
  return { left: null, right: { ...wrist, visibility } };
}

function createTestController(
  testedSide: UpperLimbSide,
  overrides: Partial<LateralReachCalibrationControllerInput> = {},
): LateralReachCalibrationControllerState {
  return createLateralReachCalibrationController({
    testedSide,
    plan: TEST_PLAN_POSITIVE_X,
    startCaptureConfig: TEST_START_CAPTURE_CONFIG,
    endpointCaptureConfig: TEST_ENDPOINT_CAPTURE_CONFIG,
    noiseFloor: TEST_NOISE_FLOOR,
    zoneRadii: TEST_ZONE_RADII,
    ...overrides,
  });
}

function startTestAttempt(
  testedSide: UpperLimbSide,
  overrides: Partial<LateralReachCalibrationControllerInput> = {},
  nowMs = 0,
): LateralReachCalibrationControllerState {
  return startLateralReachCalibrationAttempt(
    createTestController(testedSide, overrides),
    nowMs,
  );
}

// ---------------------------------------------------------------------------
// resolveLateralReachCalibrationSampleFromObservation
// ---------------------------------------------------------------------------

describe("resolveLateralReachCalibrationSampleFromObservation", () => {
  it("frame !== null matches Slice 12 resolveLateralReachCalibrationSampleFromFrame exactly", () => {
    const frame = buildTestFrame(
      123,
      wristOptionsForSide("right", { x: 0.42, y: 0.61 }),
    );
    const observation: LateralReachCameraAcquisitionObservation = {
      capturedAtMs: 123,
      frame,
    };

    const viaBridge = resolveLateralReachCalibrationSampleFromObservation(
      observation,
      "right",
      TEST_MIN_WRIST_VISIBILITY,
    );
    const viaAdapterDirect = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "right",
      TEST_MIN_WRIST_VISIBILITY,
    );

    assert.deepEqual(viaBridge, viaAdapterDirect);
    assert.deepEqual(viaBridge, {
      atMs: 123,
      wrist: { x: 0.42, y: 0.61 },
      trackingValid: true,
    });
  });

  it("frame === null returns wrist:null trackingValid:false using capturedAtMs", () => {
    const observation: LateralReachCameraAcquisitionObservation = {
      capturedAtMs: 999,
      frame: null,
    };

    const sample = resolveLateralReachCalibrationSampleFromObservation(
      observation,
      "left",
      TEST_MIN_WRIST_VISIBILITY,
    );

    assert.deepEqual(sample, { atMs: 999, wrist: null, trackingValid: false });
  });

  it("frame === null does not validate minWristVisibility (unused in this branch)", () => {
    const observation: LateralReachCameraAcquisitionObservation = {
      capturedAtMs: 1,
      frame: null,
    };

    assert.doesNotThrow(() =>
      resolveLateralReachCalibrationSampleFromObservation(
        observation,
        "right",
        Number.NaN,
      ),
    );
  });

  it("frame !== null propagates Slice 12 minWristVisibility validation", () => {
    const frame = buildTestFrame(0, wristOptionsForSide("right", TEST_START_WRIST));
    const observation: LateralReachCameraAcquisitionObservation = {
      capturedAtMs: 0,
      frame,
    };

    assert.throws(() =>
      resolveLateralReachCalibrationSampleFromObservation(observation, "right", 1.5),
    );
  });
});

// ---------------------------------------------------------------------------
// submitLateralReachCalibrationObservation
// ---------------------------------------------------------------------------

describe("submitLateralReachCalibrationObservation", () => {
  it("drives a full capturing_start → capturing_endpoint → terminal chain via observations", () => {
    const testedSide: UpperLimbSide = "left";
    let state = startTestAttempt(testedSide);

    for (const atMs of TEST_START_TIMES_MS) {
      const observation: LateralReachCameraAcquisitionObservation = {
        capturedAtMs: atMs,
        frame: buildTestFrame(atMs, wristOptionsForSide(testedSide, TEST_START_WRIST)),
      };
      const result = submitLateralReachCalibrationObservation(
        state,
        observation,
        TEST_MIN_WRIST_VISIBILITY,
      );
      assert.equal(result.disposition, "applied");
      state = result.state;
    }
    assert.equal(state.phase, "capturing_endpoint");

    for (const atMs of TEST_ENDPOINT_TIMES_MS) {
      const observation: LateralReachCameraAcquisitionObservation = {
        capturedAtMs: atMs,
        frame: buildTestFrame(
          atMs,
          wristOptionsForSide(testedSide, TEST_ENDPOINT_POSITIVE),
        ),
      };
      const result = submitLateralReachCalibrationObservation(
        state,
        observation,
        TEST_MIN_WRIST_VISIBILITY,
      );
      assert.equal(result.disposition, "applied");
      state = result.state;
    }

    assert.equal(state.phase, "terminal");
    const outcome = getLateralReachCalibrationOutcome(state);
    assert.ok(outcome !== null && outcome.kind === "result");
    if (outcome?.kind !== "result") return;
    assert.equal(outcome.result.captureOutcome, "valid");
    assert.equal(outcome.result.testedSide, testedSide);
  });

  it("uses controller.testedSide, not a separately supplied side", () => {
    const testedSide: UpperLimbSide = "right";
    const state = startTestAttempt(testedSide);

    // Frame carries BOTH wrists; bridge must resolve using state.testedSide
    // (right) exactly as calling the Slice 12 adapter directly would.
    const frame = buildTestFrame(0, {
      left: { x: 0.9, y: 0.9, visibility: 0.9 },
      right: { ...TEST_START_WRIST, visibility: 0.9 },
    });

    const viaBridge = submitLateralReachCalibrationObservation(
      state,
      { capturedAtMs: 0, frame },
      TEST_MIN_WRIST_VISIBILITY,
    );

    const expectedSample = resolveLateralReachCalibrationSampleFromFrame(
      frame,
      "right",
      TEST_MIN_WRIST_VISIBILITY,
    );
    const expected = submitLateralReachCalibrationSample(state, expectedSample);

    assert.deepEqual(viaBridge.state, expected.state);
    assert.equal(viaBridge.disposition, expected.disposition);
  });

  it("frame:null observation submits an unusable sample without throwing", () => {
    const testedSide: UpperLimbSide = "left";
    const state = startTestAttempt(testedSide);

    const result = submitLateralReachCalibrationObservation(
      state,
      { capturedAtMs: 0, frame: null },
      TEST_MIN_WRIST_VISIBILITY,
    );

    assert.equal(result.disposition, "applied");
    assert.equal(result.state.phase, "capturing_start");
  });

  it("post-terminal observation returns ignored_terminal without mutating outcome", () => {
    const testedSide: UpperLimbSide = "right";
    let state = startTestAttempt(testedSide);

    for (const atMs of TEST_START_TIMES_MS) {
      state = submitLateralReachCalibrationObservation(
        state,
        {
          capturedAtMs: atMs,
          frame: buildTestFrame(atMs, wristOptionsForSide(testedSide, TEST_START_WRIST)),
        },
        TEST_MIN_WRIST_VISIBILITY,
      ).state;
    }
    for (const atMs of TEST_ENDPOINT_TIMES_MS) {
      state = submitLateralReachCalibrationObservation(
        state,
        {
          capturedAtMs: atMs,
          frame: buildTestFrame(
            atMs,
            wristOptionsForSide(testedSide, TEST_ENDPOINT_POSITIVE),
          ),
        },
        TEST_MIN_WRIST_VISIBILITY,
      ).state;
    }
    assert.equal(state.phase, "terminal");
    const beforeOutcome = getLateralReachCalibrationOutcome(state);

    const after = submitLateralReachCalibrationObservation(
      state,
      { capturedAtMs: 9999, frame: null },
      TEST_MIN_WRIST_VISIBILITY,
    );

    assert.equal(after.disposition, "ignored_terminal");
    assert.equal(after.state, state);
    assert.deepEqual(getLateralReachCalibrationOutcome(after.state), beforeOutcome);
  });
});

// ---------------------------------------------------------------------------
// Source-contract guard — no ENGINE activation, no React
// ---------------------------------------------------------------------------

describe("Slice 19 source-contract guard", () => {
  it("does not import the engine, Slice 7 adapter, camera runtime, or React; never starts the engine", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./calibration-frame-bridge.ts", import.meta.url)),
      "utf8",
    );
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");

    assert.equal(/lateral-reach-engine/.test(importLines), false);
    assert.equal(/engine-config-adapter/.test(importLines), false);
    assert.equal(/buildLateralReachEngineConfig/.test(importLines), false);
    assert.equal(/startEngine/.test(source), false);
    assert.equal(/from ["']react["']/.test(importLines), false);
    assert.equal(/from ["']next\//.test(importLines), false);
  });
});
