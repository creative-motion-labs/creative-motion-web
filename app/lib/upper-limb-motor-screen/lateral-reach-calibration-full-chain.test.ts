/**
 * Lateral Reach — Slice 13: TEST-ONLY full-chain calibration integration.
 *
 * Proves composition of REAL Slice 12 adapter + REAL Slice 11 controller with
 * already-merged Slices 2–6 / 8–10 primitives.
 *
 * ALL numeric values below are private TEST VECTORS ONLY.
 * They are not lab defaults, production defaults, clinically validated values,
 * or device-validated thresholds.
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/lateral-reach-calibration-full-chain.test.ts"
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence/types";
import { resolveLateralReachCalibrationSampleFromFrame } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-camera-sample-adapter";
import {
  cancelLateralReachCalibrationAttempt,
  createLateralReachCalibrationController,
  getLateralReachCalibrationOutcome,
  startLateralReachCalibrationAttempt,
  submitLateralReachCalibrationSample,
  type LateralReachCalibrationControllerInput,
  type LateralReachCalibrationControllerState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

// ---------------------------------------------------------------------------
// Private TEST VECTORS ONLY (never exported; not production/lab policy)
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

/** Oversized radii chosen solely to force geometry_not_constructible. */
const TEST_OVERLAPPING_ZONE_RADII = {
  startingZoneRadius: 0.4,
  fixedTargetRadius: 0.4,
};

const TEST_NOISE_FLOOR = 0.05;

/** Explicit test-scenario plan vector — not a product default. */
const TEST_PLAN_POSITIVE_X = {
  screenHorizontalDirection: "positive_x" as const,
};

const TEST_START_WRIST = { x: 0.3, y: 0.5 };
const TEST_ENDPOINT_POSITIVE = { x: 0.55, y: 0.5 };
/** 0.125 is binary-exact so mean-of-identical samples stays exact. */
const TEST_ENDPOINT_NEGATIVE = { x: 0.125, y: 0.5 };

const TEST_START_TIMES_MS = [0, 50, 100] as const;
const TEST_ENDPOINT_TIMES_MS = [200, 250, 300] as const;

// ---------------------------------------------------------------------------
// Private frame builder (test-local; not a production utility)
// ---------------------------------------------------------------------------

type TestWristOverrides = {
  x?: number;
  y?: number;
  visibility?: number;
  present?: boolean;
};

function buildTestNormalizedMotionFrame(
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

// ---------------------------------------------------------------------------
// Private driver (test-local composition through REAL public APIs)
// ---------------------------------------------------------------------------

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

function submitAdapterFrame(
  state: LateralReachCalibrationControllerState,
  frame: NormalizedMotionFrame,
  testedSide: UpperLimbSide,
): {
  state: LateralReachCalibrationControllerState;
  disposition: "applied" | "ignored_terminal";
} {
  const sample = resolveLateralReachCalibrationSampleFromFrame(
    frame,
    testedSide,
    TEST_MIN_WRIST_VISIBILITY,
  );
  return submitLateralReachCalibrationSample(state, sample);
}

function driveAdapterFrames(
  state: LateralReachCalibrationControllerState,
  frames: readonly NormalizedMotionFrame[],
  testedSide: UpperLimbSide,
): LateralReachCalibrationControllerState {
  let current = state;
  for (const frame of frames) {
    const submitted = submitAdapterFrame(current, frame, testedSide);
    assert.equal(submitted.disposition, "applied");
    current = submitted.state;
  }
  return current;
}

function stableWristFrames(
  testedSide: UpperLimbSide,
  wrist: { x: number; y: number },
  timesMs: readonly number[],
): NormalizedMotionFrame[] {
  return timesMs.map((atMs) =>
    buildTestNormalizedMotionFrame(atMs, wristOptionsForSide(testedSide, wrist)),
  );
}

function runStableCaptureChain(
  testedSide: UpperLimbSide,
  startWrist: { x: number; y: number },
  endpointWrist: { x: number; y: number },
  overrides: Partial<LateralReachCalibrationControllerInput> = {},
): LateralReachCalibrationControllerState {
  const started = startTestAttempt(testedSide, overrides, 0);
  const afterStart = driveAdapterFrames(
    started,
    stableWristFrames(testedSide, startWrist, TEST_START_TIMES_MS),
    testedSide,
  );
  assert.equal(afterStart.phase, "capturing_endpoint");
  return driveAdapterFrames(
    afterStart,
    stableWristFrames(testedSide, endpointWrist, TEST_ENDPOINT_TIMES_MS),
    testedSide,
  );
}

// ---------------------------------------------------------------------------
// Source-contract guard (narrow; primary proof remains semantic)
// ---------------------------------------------------------------------------

describe("Slice 13 source-contract guard", () => {
  it("does not import engine, Slice 7 adapter, camera detector, or React", () => {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");

    assert.equal(/lateral-reach-engine/.test(importLines), false);
    assert.equal(/engine-config-adapter/.test(importLines), false);
    assert.equal(/buildLateralReachEngineConfig/.test(importLines), false);
    assert.equal(/validateLateralReachConfig/.test(importLines), false);
    assert.equal(/applyLateralReachCommand/.test(importLines), false);
    assert.equal(/lateral-reach-camera-detector/.test(importLines), false);
    assert.equal(/PoseLandmark/.test(importLines), false);
    assert.equal(/PoseLandmarker/.test(importLines), false);
    assert.equal(/getUserMedia/.test(importLines), false);
    assert.equal(/HTMLVideoElement/.test(importLines), false);
    assert.equal(/from ["']react["']/.test(importLines), false);
    assert.equal(/from ["']next\//.test(importLines), false);
  });
});

// ---------------------------------------------------------------------------
// Scenario A — geometry-ready success (+ post-terminal ignored)
// ---------------------------------------------------------------------------

describe("Scenario A — geometry-ready full chain via Slice 12 → Slice 11", () => {
  it("captures start/endpoint and assembles geometry-ready result without inversion", () => {
    const testedSide: UpperLimbSide = "left";
    const terminal = runStableCaptureChain(
      testedSide,
      TEST_START_WRIST,
      TEST_ENDPOINT_POSITIVE,
    );

    assert.equal(terminal.phase, "terminal");
    const outcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(outcome !== null);
    assert.equal(outcome.kind, "result");
    if (outcome.kind !== "result") return;

    const { result } = outcome;
    assert.equal(result.captureOutcome, "valid");
    assert.equal(result.geometryOutcome, "ready");
    assert.equal(result.testedSide, testedSide);

    if (result.geometryOutcome !== "ready") return;

    assert.deepEqual(result.observations.startWrist, TEST_START_WRIST);
    assert.deepEqual(result.observations.heldEndpoint, TEST_ENDPOINT_POSITIVE);

    // Slice 10 plan positive_x → Slice 8 sign +1 reached through controller.
    assert.equal(result.derivedMeasurements.expectedHorizontalDirectionSign, 1);
    assert.equal(
      result.derivedMeasurements.rawDeltaX,
      TEST_ENDPOINT_POSITIVE.x - TEST_START_WRIST.x,
    );
    assert.ok(result.derivedMeasurements.directionAlignedMagnitude > 0);

    assert.deepEqual(
      result.frozenGeometry.startingZone.point,
      TEST_START_WRIST,
    );
    assert.deepEqual(
      result.frozenGeometry.fixedTarget.point,
      TEST_ENDPOINT_POSITIVE,
    );
    assert.equal(
      result.frozenGeometry.startingZone.radius,
      TEST_ZONE_RADII.startingZoneRadius,
    );
    assert.equal(
      result.frozenGeometry.fixedTarget.radius,
      TEST_ZONE_RADII.fixedTargetRadius,
    );

    // Coordinates forwarded without inversion/mirroring.
    assert.ok(
      result.frozenGeometry.fixedTarget.point.x >
        result.frozenGeometry.startingZone.point.x,
    );
    assert.equal(
      result.frozenGeometry.fixedTarget.point.x,
      TEST_ENDPOINT_POSITIVE.x,
    );
  });

  it("ignores post-terminal adapter sample with disposition ignored_terminal", () => {
    const testedSide: UpperLimbSide = "left";
    const terminal = runStableCaptureChain(
      testedSide,
      TEST_START_WRIST,
      TEST_ENDPOINT_POSITIVE,
    );
    const beforeOutcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(beforeOutcome !== null && beforeOutcome.kind === "result");

    const postFrame = buildTestNormalizedMotionFrame(
      999,
      wristOptionsForSide(testedSide, { x: 0.9, y: 0.9 }),
    );
    const after = submitAdapterFrame(terminal, postFrame, testedSide);

    assert.equal(after.disposition, "ignored_terminal");
    // Slice 11 returns the same terminal state reference on ignored_terminal.
    assert.equal(after.state, terminal);
    assert.deepEqual(
      getLateralReachCalibrationOutcome(after.state),
      beforeOutcome,
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario D — wrong direction (same plan; both testedSide values)
// ---------------------------------------------------------------------------

describe("Scenario D — wrong_direction_reach with testedSide independence", () => {
  for (const testedSide of ["left", "right"] as const) {
    it(`fails wrong_direction_reach for testedSide=${testedSide} with SAME positive_x plan`, () => {
      const terminal = runStableCaptureChain(
        testedSide,
        TEST_START_WRIST,
        TEST_ENDPOINT_NEGATIVE,
        { plan: TEST_PLAN_POSITIVE_X },
      );

      assert.equal(terminal.phase, "terminal");
      const outcome = getLateralReachCalibrationOutcome(terminal);
      assert.ok(outcome !== null);
      assert.equal(outcome.kind, "result");
      if (outcome.kind !== "result") return;

      const { result } = outcome;
      assert.equal(result.testedSide, testedSide);
      assert.equal(result.captureOutcome, "failed");
      assert.equal(result.geometryOutcome, "not_applicable");
      assert.ok(result.failureReasons.includes("wrong_direction_reach"));

      if (result.captureOutcome === "failed") {
        assert.deepEqual(result.observations?.startWrist, TEST_START_WRIST);
        assert.deepEqual(result.observations?.heldEndpoint, TEST_ENDPOINT_NEGATIVE);
      }
    });
  }

  it("uses identical plan direction semantics for left and right testedSide", () => {
    const left = runStableCaptureChain(
      "left",
      TEST_START_WRIST,
      TEST_ENDPOINT_NEGATIVE,
    );
    const right = runStableCaptureChain(
      "right",
      TEST_START_WRIST,
      TEST_ENDPOINT_NEGATIVE,
    );

    const leftOutcome = getLateralReachCalibrationOutcome(left);
    const rightOutcome = getLateralReachCalibrationOutcome(right);
    assert.ok(leftOutcome?.kind === "result" && rightOutcome?.kind === "result");
    if (leftOutcome?.kind !== "result" || rightOutcome?.kind !== "result") return;

    assert.equal(leftOutcome.result.captureOutcome, "failed");
    assert.equal(rightOutcome.result.captureOutcome, "failed");
    if (
      leftOutcome.result.captureOutcome !== "failed" ||
      rightOutcome.result.captureOutcome !== "failed"
    ) {
      return;
    }

    assert.deepEqual(
      leftOutcome.result.failureReasons,
      rightOutcome.result.failureReasons,
    );
    assert.ok(
      leftOutcome.result.failureReasons.includes("wrong_direction_reach"),
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario E — geometry not constructible
// ---------------------------------------------------------------------------

describe("Scenario E — geometry not_constructible via TEST-ONLY zone radii", () => {
  it("keeps capture valid while frozen geometry is not constructible", () => {
    const testedSide: UpperLimbSide = "right";
    const terminal = runStableCaptureChain(
      testedSide,
      TEST_START_WRIST,
      TEST_ENDPOINT_POSITIVE,
      { zoneRadii: TEST_OVERLAPPING_ZONE_RADII },
    );

    const outcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(outcome !== null && outcome.kind === "result");
    if (outcome?.kind !== "result") return;

    const { result } = outcome;
    assert.equal(result.captureOutcome, "valid");
    assert.equal(result.geometryOutcome, "not_constructible");

    if (result.geometryOutcome !== "not_constructible") return;

    assert.deepEqual(result.observations, {
      startWrist: TEST_START_WRIST,
      heldEndpoint: TEST_ENDPOINT_POSITIVE,
    });
    assert.equal(result.derivedMeasurements.expectedHorizontalDirectionSign, 1);
    assert.deepEqual(result.geometryBlockers, [
      "geometry_constraints_unsatisfied",
    ]);
    assert.equal("frozenGeometry" in result, false);
  });
});

// ---------------------------------------------------------------------------
// Scenario F — cancellation
// ---------------------------------------------------------------------------

describe("Scenario F — cancel active capture", () => {
  it("cancels capturing_start to { kind: 'cancelled' } without fabricating a result", () => {
    const testedSide: UpperLimbSide = "left";
    const started = startTestAttempt(testedSide, {}, 0);
    assert.equal(started.phase, "capturing_start");

    // Enter active capture evidence, then cancel before terminal success/failure.
    const collecting = submitAdapterFrame(
      started,
      buildTestNormalizedMotionFrame(
        0,
        wristOptionsForSide(testedSide, TEST_START_WRIST),
      ),
      testedSide,
    );
    assert.equal(collecting.disposition, "applied");
    assert.equal(collecting.state.phase, "capturing_start");

    const cancelled = cancelLateralReachCalibrationAttempt(collecting.state);
    assert.equal(cancelled.phase, "terminal");

    const outcome = getLateralReachCalibrationOutcome(cancelled);
    assert.deepEqual(outcome, { kind: "cancelled" });
    assert.equal(outcome !== null && "result" in outcome, false);
  });
});

// ---------------------------------------------------------------------------
// Scenario H — adapter-driven tracking failure seam
// ---------------------------------------------------------------------------

describe("Scenario H — Slice 12 low-confidence/missing wrist → capture failure", () => {
  it("reaches wrist_tracking_invalid from adapter samples only (no handcrafted null wrist)", () => {
    const testedSide: UpperLimbSide = "left";
    const shortStartConfig = {
      minStableDurationMs: 100,
      maxJitterRadius: 0.05,
      minStableSampleCount: 3,
      totalTimeoutMs: 100,
    };

    let state = startTestAttempt(
      testedSide,
      { startCaptureConfig: shortStartConfig },
      0,
    );

    // Missing tested-side wrist → Slice 12 yields wrist:null / trackingValid:false.
    const missingWristFrame = buildTestNormalizedMotionFrame(0, {
      left: null,
      right: { x: 0.8, y: 0.5, visibility: 0.99 },
    });
    const fromMissing = resolveLateralReachCalibrationSampleFromFrame(
      missingWristFrame,
      testedSide,
      TEST_MIN_WRIST_VISIBILITY,
    );
    assert.equal(fromMissing.wrist, null);
    assert.equal(fromMissing.trackingValid, false);

    state = submitLateralReachCalibrationSample(state, fromMissing).state;
    assert.equal(state.phase, "capturing_start");

    // Low-confidence tested-side wrist at exact timeout → fail with tracking reason.
    const lowConfidenceFrame = buildTestNormalizedMotionFrame(100, {
      left: {
        x: TEST_START_WRIST.x,
        y: TEST_START_WRIST.y,
        visibility: 0.05,
        present: true,
      },
      right: null,
    });
    const fromLow = resolveLateralReachCalibrationSampleFromFrame(
      lowConfidenceFrame,
      testedSide,
      TEST_MIN_WRIST_VISIBILITY,
    );
    assert.equal(fromLow.wrist, null);
    assert.equal(fromLow.trackingValid, false);

    const terminalSubmit = submitLateralReachCalibrationSample(state, fromLow);
    assert.equal(terminalSubmit.disposition, "applied");
    assert.equal(terminalSubmit.state.phase, "terminal");

    const outcome = getLateralReachCalibrationOutcome(terminalSubmit.state);
    assert.ok(outcome !== null && outcome.kind === "result");
    if (outcome?.kind !== "result") return;

    assert.equal(outcome.result.captureOutcome, "failed");
    assert.equal(outcome.result.geometryOutcome, "not_applicable");
    assert.ok(outcome.result.failureReasons.includes("wrist_tracking_invalid"));
    assert.ok(outcome.result.failureReasons.includes("start_timeout"));
  });
});
