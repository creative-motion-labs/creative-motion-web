/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/calibration-endpoint-diagnostics.test.ts"
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLateralReachEndpointCaptureState,
  updateLateralReachEndpointCapture,
  type LateralReachEndpointCaptureConfig,
} from "@/app/lib/interaction-calibration/lateral-reach/endpoint-capture";
import { assembleLateralReachCalibrationResult } from "@/app/lib/interaction-calibration/lateral-reach/result-assembly";
import type { LateralReachCalibrationControllerState } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import {
  resolveCalibrationEndpointDiagnostics,
  resolveCalibrationEndpointDiagnosticsAfterObservation,
} from "./calibration-endpoint-diagnostics";

const START_WRIST = { x: 0.3, y: 0.5 };

const ENDPOINT_CONFIG: LateralReachEndpointCaptureConfig = {
  minStableDurationMs: 500,
  maxJitterRadius: 0.02,
  minStableSampleCount: 3,
  totalTimeoutMs: 3000,
  minDisplacementFromStart: 0.15,
};

const BASE_CONTROLLER_FIELDS = {
  testedSide: "right" as const,
  intention: {
    screenHorizontalDirection: "positive_x" as const,
    expectedHorizontalDirectionSign: 1 as const,
  },
  startCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 3,
    totalTimeoutMs: 3000,
  },
  endpointCaptureConfig: ENDPOINT_CONFIG,
  noiseFloor: {
    kind: "direction_aligned_magnitude_noise_floor" as const,
    minDirectionAlignedMagnitude: 0.08,
  },
  zoneRadii: {
    startingZoneRadius: 0.05,
    fixedTargetRadius: 0.05,
  },
};

function capturingEndpointState(
  endpointCaptureState = createLateralReachEndpointCaptureState(
    1000,
    START_WRIST,
    ENDPOINT_CONFIG,
  ),
): Extract<LateralReachCalibrationControllerState, { phase: "capturing_endpoint" }> {
  return {
    ...BASE_CONTROLLER_FIELDS,
    phase: "capturing_endpoint",
    startWrist: START_WRIST,
    endpointCaptureState,
  };
}

function terminalEndpointFailedState(): Extract<
  LateralReachCalibrationControllerState,
  { phase: "terminal" }
> {
  const result = assembleLateralReachCalibrationResult({
    testedSide: "right",
    stage: "endpoint_failed",
    startWrist: START_WRIST,
    failureReasons: ["calibration_timeout", "displacement_indistinguishable_from_noise"],
  });
  return {
    ...BASE_CONTROLLER_FIELDS,
    phase: "terminal",
    outcome: { kind: "result", result },
  };
}

describe("resolveCalibrationEndpointDiagnostics — evidence assembly", () => {
  it("copies endpoint-capture state and frozen config fields read-only", () => {
    let endpointState = createLateralReachEndpointCaptureState(1000, START_WRIST, ENDPOINT_CONFIG);
    endpointState = updateLateralReachEndpointCapture(endpointState, {
      atMs: 1200,
      wrist: { x: 0.31, y: 0.5 },
      trackingValid: false,
    }).state;
    endpointState = updateLateralReachEndpointCapture(endpointState, {
      atMs: 1400,
      wrist: { x: 0.32, y: 0.5 },
      trackingValid: true,
    }).state;

    const diagnostic = resolveCalibrationEndpointDiagnostics(endpointState, 1400);

    assert.equal(diagnostic.capturedAtMs, 1400);
    assert.equal(diagnostic.maxDisplacementFromStartSeen, endpointState.maxDisplacementFromStartSeen);
    assert.equal(
      diagnostic.currentStableSampleCount,
      endpointState.currentStableSamples.length,
    );
    assert.equal(diagnostic.maxStableSampleCountSeen, endpointState.maxStableSampleCountSeen);
    assert.equal(diagnostic.endpointElapsedMs, 400);
    assert.equal(diagnostic.minDisplacementFromStart, ENDPOINT_CONFIG.minDisplacementFromStart);
    assert.equal(diagnostic.maxJitterRadius, ENDPOINT_CONFIG.maxJitterRadius);
    assert.equal(diagnostic.minStableDurationMs, ENDPOINT_CONFIG.minStableDurationMs);
    assert.equal(diagnostic.minStableSampleCount, ENDPOINT_CONFIG.minStableSampleCount);
    assert.equal(diagnostic.totalTimeoutMs, ENDPOINT_CONFIG.totalTimeoutMs);
    assert.equal(diagnostic.sawSpatialReset, endpointState.sawSpatialReset);
    assert.equal(diagnostic.sawTrackingInvalid, endpointState.sawTrackingInvalid);
    assert.equal(diagnostic.sawFramingInvalid, endpointState.sawFramingInvalid);
  });
});

describe("resolveCalibrationEndpointDiagnosticsAfterObservation — persistence selection", () => {
  it("uses post-submit endpoint state while still collecting", () => {
    const before = capturingEndpointState();
    const afterEndpointState = updateLateralReachEndpointCapture(
      before.endpointCaptureState,
      {
        atMs: 1100,
        wrist: { x: 0.35, y: 0.5 },
        trackingValid: true,
      },
    ).state;
    const after = capturingEndpointState(afterEndpointState);

    const diagnostic = resolveCalibrationEndpointDiagnosticsAfterObservation({
      controllerBeforeSubmit: before,
      controllerAfterSubmit: after,
      capturedAtMs: 1100,
    });

    assert.ok(diagnostic);
    assert.equal(diagnostic.endpointElapsedMs, 100);
    assert.equal(diagnostic.currentStableSampleCount, 1);
    assert.equal(diagnostic.maxDisplacementFromStartSeen, afterEndpointState.maxDisplacementFromStartSeen);
  });

  it("uses pre-submit endpoint state when submit transitions to terminal", () => {
    const before = capturingEndpointState(
      createLateralReachEndpointCaptureState(1000, START_WRIST, ENDPOINT_CONFIG),
    );
    const after = terminalEndpointFailedState();

    const diagnostic = resolveCalibrationEndpointDiagnosticsAfterObservation({
      controllerBeforeSubmit: before,
      controllerAfterSubmit: after,
      capturedAtMs: 4500,
    });

    assert.ok(diagnostic);
    assert.equal(diagnostic.endpointElapsedMs, 3500);
    assert.equal(diagnostic.maxDisplacementFromStartSeen, 0);
    assert.equal(diagnostic.currentStableSampleCount, 0);
    assert.equal(diagnostic.totalTimeoutMs, ENDPOINT_CONFIG.totalTimeoutMs);
  });

  it("returns null outside endpoint capture so prior diagnostic can persist", () => {
    const diagnostic = resolveCalibrationEndpointDiagnosticsAfterObservation({
      controllerBeforeSubmit: {
        ...BASE_CONTROLLER_FIELDS,
        phase: "capturing_start",
        startCaptureState: {
          config: BASE_CONTROLLER_FIELDS.startCaptureConfig,
          startedAtMs: 0,
          lastAcceptedAtMs: null,
          stableSinceMs: null,
          currentStableSamples: [],
          maxStableSampleCountSeen: 0,
          sawTrackingInvalid: false,
          sawFramingInvalid: false,
          sawSpatialReset: false,
        },
      },
      controllerAfterSubmit: {
        ...BASE_CONTROLLER_FIELDS,
        phase: "capturing_start",
        startCaptureState: {
          config: BASE_CONTROLLER_FIELDS.startCaptureConfig,
          startedAtMs: 0,
          lastAcceptedAtMs: 100,
          stableSinceMs: null,
          currentStableSamples: [],
          maxStableSampleCountSeen: 0,
          sawTrackingInvalid: false,
          sawFramingInvalid: false,
          sawSpatialReset: false,
        },
      },
      capturedAtMs: 100,
    });

    assert.equal(diagnostic, null);
  });
});
