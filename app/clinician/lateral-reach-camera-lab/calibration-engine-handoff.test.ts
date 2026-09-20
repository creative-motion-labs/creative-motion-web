/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/calibration-engine-handoff.test.ts"
 *
 * Lateral Reach Camera Lab — Slice 20 TEST: calibration → engine handoff
 * eligibility.
 *
 * Proves fail-closed eligibility narrowing only. Does not exercise
 * buildLateralReachEngineConfig or detector.startEngine — those remain owned
 * by Slice 7 and the camera detector respectively.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  type LateralReachCalibrationCaptureFailedResult,
  type LateralReachCalibrationGeometryNotConstructibleResult,
  type LateralReachCalibrationGeometryReadyResult,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import type { LateralReachCalibrationControllerOutcome } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { LateralReachCameraStatus } from "@/app/lib/cv/lateral-reach-camera-detector";
import { lockLateralReachLabTechnicalConfig } from "./technical-config-intake";
import {
  classifyCalibrationHandoffReadiness,
  resolveLateralReachEngineHandoffInputs,
  shouldRetainDetectorAcquisitionForTerminalCalibration,
  type LateralReachEngineHandoffInputs,
} from "./calibration-engine-handoff";

// ---------------------------------------------------------------------------
// Fixtures — test-only, not production values
// ---------------------------------------------------------------------------

const READY_RESULT: LateralReachCalibrationGeometryReadyResult = {
  schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  testedSide: "right",
  captureOutcome: "valid",
  geometryOutcome: "ready",
  observations: {
    startWrist: { x: 0.3, y: 0.5 },
    heldEndpoint: { x: 0.7, y: 0.5 },
  },
  derivedMeasurements: {
    rawDeltaX: 0.4,
    expectedHorizontalDirectionSign: 1,
    directionAlignedMagnitude: 0.4,
  },
  frozenGeometry: {
    startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
    fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
  },
};

const CAPTURE_FAILED_RESULT: LateralReachCalibrationCaptureFailedResult = {
  schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  testedSide: "right",
  captureOutcome: "failed",
  geometryOutcome: "not_applicable",
  failureReasons: ["start_timeout"],
};

const NOT_CONSTRUCTIBLE_RESULT: LateralReachCalibrationGeometryNotConstructibleResult = {
  schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  testedSide: "right",
  captureOutcome: "valid",
  geometryOutcome: "not_constructible",
  observations: {
    startWrist: { x: 0.3, y: 0.5 },
    heldEndpoint: { x: 0.31, y: 0.5 },
  },
  derivedMeasurements: {
    rawDeltaX: 0.01,
    expectedHorizontalDirectionSign: 1,
    directionAlignedMagnitude: 0.01,
  },
  geometryBlockers: ["geometry_constraints_unsatisfied"],
};

// Test-only fixture — NOT production values.
const VALID_TECHNICAL_CONFIG = {
  startCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 10,
    totalTimeoutMs: 3000,
  },
  endpointCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 10,
    totalTimeoutMs: 3000,
    minDisplacementFromStart: 0.15,
  },
  zoneRadii: {
    startingZoneRadius: 0.05,
    fixedTargetRadius: 0.05,
  },
  noiseFloor: {
    minDirectionAlignedMagnitude: 0.08,
  },
  tracking: {
    minWristVisibility: 0.3,
    maxAllowedGapMs: 300,
  },
  timing: {
    onsetConfirmationMs: 100,
    dwellDurationMs: 200,
    returnConfirmationMs: 150,
  },
};

const CONFIG_LOCK = lockLateralReachLabTechnicalConfig(VALID_TECHNICAL_CONFIG);

const READY_OUTCOME: LateralReachCalibrationControllerOutcome = {
  kind: "result",
  result: READY_RESULT,
};

const CANCELLED_OUTCOME: LateralReachCalibrationControllerOutcome = {
  kind: "cancelled",
};

function validInputs(
  overrides: Partial<LateralReachEngineHandoffInputs> = {},
): LateralReachEngineHandoffInputs {
  return {
    calibrationOutcome: READY_OUTCOME,
    configLock: CONFIG_LOCK,
    detectorStatus: "acquiring",
    engineActive: false,
    calibrationLifecycle: "idle",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ready valid path
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — ready valid path", () => {
  it("resolves ok:true with readyResult + locked tracking + locked timing", () => {
    const result = resolveLateralReachEngineHandoffInputs(validInputs());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.readyResult, READY_RESULT);
    assert.equal(result.tracking, CONFIG_LOCK.lockedConfig.tracking);
    assert.equal(result.timing, CONFIG_LOCK.lockedConfig.timing);
  });

  it("passes locked tracking through exactly (reference + values)", () => {
    const result = resolveLateralReachEngineHandoffInputs(validInputs());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.tracking, CONFIG_LOCK.lockedConfig.tracking);
    assert.deepEqual(result.tracking, VALID_TECHNICAL_CONFIG.tracking);
  });

  it("passes locked timing through exactly (reference + values)", () => {
    const result = resolveLateralReachEngineHandoffInputs(validInputs());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.timing, CONFIG_LOCK.lockedConfig.timing);
    assert.deepEqual(result.timing, VALID_TECHNICAL_CONFIG.timing);
  });
});

// ---------------------------------------------------------------------------
// Calibration outcome eligibility
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — calibration outcome", () => {
  it("blocks null outcome with no_calibration_outcome", () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({ calibrationOutcome: null }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "no_calibration_outcome");
  });

  it("blocks cancelled outcome with calibration_cancelled", () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({ calibrationOutcome: CANCELLED_OUTCOME }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "calibration_cancelled");
  });

  it("blocks capture-failed result with capture_failed", () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({
        calibrationOutcome: { kind: "result", result: CAPTURE_FAILED_RESULT },
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "capture_failed");
  });

  it("blocks geometry-not-constructible result with geometry_not_constructible", () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({
        calibrationOutcome: { kind: "result", result: NOT_CONSTRUCTIBLE_RESULT },
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "geometry_not_constructible");
  });
});

// ---------------------------------------------------------------------------
// Config lock eligibility
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — config lock", () => {
  it("blocks missing config lock with config_lock_missing", () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({ configLock: null }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "config_lock_missing");
  });
});

// ---------------------------------------------------------------------------
// Detector status eligibility
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — detector status", () => {
  const nonAcquiringStatuses: LateralReachCameraStatus[] = [
    "idle",
    "initializing",
    "running",
    "error",
  ];

  for (const status of nonAcquiringStatuses) {
    it(`blocks detector status "${status}" with detector_not_acquiring`, () => {
      const result = resolveLateralReachEngineHandoffInputs(
        validInputs({ detectorStatus: status }),
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, "detector_not_acquiring");
    });
  }
});

// ---------------------------------------------------------------------------
// Engine activity eligibility
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — engine activity", () => {
  it("blocks an already-active engine with engine_already_active", () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({ engineActive: true }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "engine_already_active");
  });
});

// ---------------------------------------------------------------------------
// Calibration lifecycle eligibility
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — calibration lifecycle", () => {
  it('blocks lifecycle "starting" with calibration_lifecycle_not_idle', () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({ calibrationLifecycle: "starting" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "calibration_lifecycle_not_idle");
  });

  it('blocks lifecycle "active" with calibration_lifecycle_not_idle', () => {
    const result = resolveLateralReachEngineHandoffInputs(
      validInputs({ calibrationLifecycle: "active" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "calibration_lifecycle_not_idle");
  });
});

// ---------------------------------------------------------------------------
// Shared calibration-outcome classification
// ---------------------------------------------------------------------------

describe("classifyCalibrationHandoffReadiness — resolver and acquisition policy agreement", () => {
  const cases: Array<{
    label: string;
    outcome: LateralReachCalibrationControllerOutcome | null;
    expectedReason:
      | "no_calibration_outcome"
      | "calibration_cancelled"
      | "capture_failed"
      | "geometry_not_constructible"
      | null;
  }> = [
    { label: "null outcome", outcome: null, expectedReason: "no_calibration_outcome" },
    { label: "cancelled", outcome: CANCELLED_OUTCOME, expectedReason: "calibration_cancelled" },
    {
      label: "capture failed",
      outcome: { kind: "result", result: CAPTURE_FAILED_RESULT },
      expectedReason: "capture_failed",
    },
    {
      label: "geometry not constructible",
      outcome: { kind: "result", result: NOT_CONSTRUCTIBLE_RESULT },
      expectedReason: "geometry_not_constructible",
    },
    { label: "ready", outcome: READY_OUTCOME, expectedReason: null },
  ];

  for (const testCase of cases) {
    it(`${testCase.label}: resolver and acquisition policy agree`, () => {
      const classified = classifyCalibrationHandoffReadiness(testCase.outcome);
      const retain = shouldRetainDetectorAcquisitionForTerminalCalibration(testCase.outcome);
      const resolved = resolveLateralReachEngineHandoffInputs(
        validInputs({ calibrationOutcome: testCase.outcome }),
      );

      if (testCase.expectedReason === null) {
        assert.equal(classified.ready, true);
        if (classified.ready) {
          assert.equal(classified.result, READY_RESULT);
        }
        assert.equal(retain, true);
        assert.equal(resolved.ok, true);
        if (resolved.ok) {
          assert.equal(resolved.readyResult, READY_RESULT);
        }
        return;
      }

      assert.equal(classified.ready, false);
      if (!classified.ready) {
        assert.equal(classified.reason, testCase.expectedReason);
      }
      assert.equal(retain, false);
      assert.equal(resolved.ok, false);
      if (!resolved.ok) {
        assert.equal(resolved.reason, testCase.expectedReason);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Terminal calibration acquisition policy
// ---------------------------------------------------------------------------

describe("terminal calibration acquisition policy", () => {
  it("capture failed terminal result requires detector stop (does not retain acquisition)", () => {
    const outcome = { kind: "result" as const, result: CAPTURE_FAILED_RESULT };
    assert.equal(shouldRetainDetectorAcquisitionForTerminalCalibration(outcome), false);
    assert.equal(classifyCalibrationHandoffReadiness(outcome).ready, false);
  });

  it("geometry not constructible terminal result requires detector stop", () => {
    const outcome = { kind: "result" as const, result: NOT_CONSTRUCTIBLE_RESULT };
    assert.equal(shouldRetainDetectorAcquisitionForTerminalCalibration(outcome), false);
    assert.equal(classifyCalibrationHandoffReadiness(outcome).ready, false);
  });

  it("geometry ready handoff-ready result retains detector acquisition for Slice 20", () => {
    assert.equal(shouldRetainDetectorAcquisitionForTerminalCalibration(READY_OUTCOME), true);
    assert.equal(classifyCalibrationHandoffReadiness(READY_OUTCOME).ready, true);
  });

  it("outcome diagnostics remain preserved (policy is read-only on outcome)", () => {
    const failedOutcome = {
      kind: "result" as const,
      result: {
        ...CAPTURE_FAILED_RESULT,
        failureReasons: ["start_timeout", "wrist_tracking_invalid", "insufficient_start_samples"],
      },
    };

    assert.equal(shouldRetainDetectorAcquisitionForTerminalCalibration(failedOutcome), false);
    assert.deepEqual(failedOutcome.result.failureReasons, [
      "start_timeout",
      "wrist_tracking_invalid",
      "insufficient_start_samples",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Source contracts — pure helper, no direction derivation, no defaults,
// no React, no camera/detector mutation, no async.
// ---------------------------------------------------------------------------

describe("resolveLateralReachEngineHandoffInputs — source contracts", () => {
  const helperSource = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "calibration-engine-handoff.ts",
    ),
    "utf8",
  );

  it("does not import React", () => {
    assert.equal(/from ["']react["']/i.test(helperSource), false);
  });

  it("does not import or mutate the camera detector / capture devices", () => {
    assert.equal(helperSource.includes("getUserMedia"), false);
    assert.equal(helperSource.includes("MediaStream"), false);
    assert.equal(helperSource.includes("MediaPipe"), false);
    assert.equal(/\bLateralReachCameraDetector\b/.test(helperSource), false);
    assert.equal(helperSource.includes("detectorRef"), false);
  });

  it("does not start the engine", () => {
    assert.equal(helperSource.includes(".startEngine("), false);
  });

  it("does not derive horizontal direction", () => {
    assert.equal(helperSource.includes("Math.sign"), false);
    assert.equal(helperSource.includes("expectedHorizontalDirectionSign"), false);
    assert.equal(helperSource.includes(".point.x"), false);
  });

  it("contains no numeric tracking/timing defaults", () => {
    assert.equal(/\b\d+\.\d+\b/.test(helperSource), false);
    assert.equal(/\bminWristVisibility\s*:\s*\d/.test(helperSource), false);
    assert.equal(/\bonsetConfirmationMs\s*:\s*\d/.test(helperSource), false);
  });

  it("performs no async behavior", () => {
    assert.equal(/\basync\b/.test(helperSource), false);
    assert.equal(helperSource.includes("await "), false);
    assert.equal(helperSource.includes("Promise"), false);
  });
});
