/**
 * Lateral Reach Camera Lab — endpoint capture diagnostics (lab only).
 *
 * Read-only evidence assembly from existing endpoint-capture state exposed on
 * the calibration controller. Does not mutate endpoint-capture logic.
 */

import type { LateralReachEndpointCaptureState } from "@/app/lib/interaction-calibration/lateral-reach/endpoint-capture";
import type { LateralReachCalibrationControllerState } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";

export type CalibrationEndpointDiagnostic = {
  readonly capturedAtMs: number;
  readonly maxDisplacementFromStartSeen: number;
  readonly currentStableSampleCount: number;
  readonly maxStableSampleCountSeen: number;
  readonly endpointElapsedMs: number;
  readonly minDisplacementFromStart: number;
  readonly maxJitterRadius: number;
  readonly minStableDurationMs: number;
  readonly minStableSampleCount: number;
  readonly totalTimeoutMs: number;
  readonly sawSpatialReset: boolean;
  readonly sawTrackingInvalid: boolean;
  readonly sawFramingInvalid: boolean;
};

/**
 * Assemble read-only endpoint capture diagnostics from one endpoint-capture
 * state snapshot and the observation timestamp for elapsed-time evidence.
 */
export function resolveCalibrationEndpointDiagnostics(
  endpointCaptureState: LateralReachEndpointCaptureState,
  capturedAtMs: number,
): CalibrationEndpointDiagnostic {
  const { config } = endpointCaptureState;

  return {
    capturedAtMs,
    maxDisplacementFromStartSeen: endpointCaptureState.maxDisplacementFromStartSeen,
    currentStableSampleCount: endpointCaptureState.currentStableSamples.length,
    maxStableSampleCountSeen: endpointCaptureState.maxStableSampleCountSeen,
    endpointElapsedMs: capturedAtMs - endpointCaptureState.startedAtMs,
    minDisplacementFromStart: config.minDisplacementFromStart,
    maxJitterRadius: config.maxJitterRadius,
    minStableDurationMs: config.minStableDurationMs,
    minStableSampleCount: config.minStableSampleCount,
    totalTimeoutMs: config.totalTimeoutMs,
    sawSpatialReset: endpointCaptureState.sawSpatialReset,
    sawTrackingInvalid: endpointCaptureState.sawTrackingInvalid,
    sawFramingInvalid: endpointCaptureState.sawFramingInvalid,
  };
}

export type ResolveCalibrationEndpointDiagnosticsAfterObservationInput = {
  readonly controllerBeforeSubmit: LateralReachCalibrationControllerState;
  readonly controllerAfterSubmit: LateralReachCalibrationControllerState;
  readonly capturedAtMs: number;
};

/**
 * Select the endpoint-capture evidence snapshot to surface after one
 * observation submit. Prefers post-submit state while still collecting;
 * on endpoint terminal failure uses pre-submit state (the evidence available
 * without changing endpoint-capture failure returns).
 */
export function resolveCalibrationEndpointDiagnosticsAfterObservation(
  input: ResolveCalibrationEndpointDiagnosticsAfterObservationInput,
): CalibrationEndpointDiagnostic | null {
  if (input.controllerAfterSubmit.phase === "capturing_endpoint") {
    return resolveCalibrationEndpointDiagnostics(
      input.controllerAfterSubmit.endpointCaptureState,
      input.capturedAtMs,
    );
  }

  if (
    input.controllerBeforeSubmit.phase === "capturing_endpoint" &&
    input.controllerAfterSubmit.phase === "terminal"
  ) {
    return resolveCalibrationEndpointDiagnostics(
      input.controllerBeforeSubmit.endpointCaptureState,
      input.capturedAtMs,
    );
  }

  return null;
}
