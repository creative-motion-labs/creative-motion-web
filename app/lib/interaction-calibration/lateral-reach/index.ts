/**
 * Public exports for Lateral Reach interaction-calibration domain.
 * Slice 1: vocabulary / outcome contracts.
 * Slice 2: stable start capture reducer.
 * Slice 3: held-endpoint capture reducer.
 * Slice 4: derived measurements + direction/magnitude validation.
 * Slice 5: frozen interaction geometry construction.
 * Slice 6: calibration result assembly.
 * Slice 7: engine config adapter.
 * Slice 8: calibration attempt intention.
 * Slice 9: technical-parameter ownership.
 */

export {
  LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  LATERAL_REACH_CAPTURE_FAILURE_REASONS,
  LATERAL_REACH_GEOMETRY_BLOCKERS,
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachCalibrationCaptureFailedResult,
  type LateralReachCalibrationGeometryNotConstructibleResult,
  type LateralReachCalibrationGeometryReadyResult,
  type LateralReachCalibrationObservations,
  type LateralReachCalibrationResult,
  type LateralReachCalibrationSchemaVersion,
  type LateralReachCaptureFailureReason,
  type LateralReachDerivedMeasurements,
  type LateralReachFrozenZone,
  type LateralReachGeometryBlocker,
  type LateralReachNoiseFloorConfig,
  type NormalizedPoint,
  type UpperLimbSide,
} from "./types";

export {
  createLateralReachStartCaptureState,
  updateLateralReachStartCapture,
  validateLateralReachStartCaptureConfig,
  type LateralReachStartCaptureConfig,
  type LateralReachStartCaptureSample,
  type LateralReachStartCaptureState,
  type LateralReachStartCaptureUpdateResult,
} from "./start-capture";

export {
  createLateralReachEndpointCaptureState,
  updateLateralReachEndpointCapture,
  validateLateralReachEndpointCaptureConfig,
  type LateralReachEndpointCaptureConfig,
  type LateralReachEndpointCaptureSample,
  type LateralReachEndpointCaptureState,
  type LateralReachEndpointCaptureUpdateResult,
} from "./endpoint-capture";

export {
  deriveLateralReachMeasurements,
  validateLateralReachDirectionAndMagnitude,
} from "./derived-measurements";

export { constructLateralReachFrozenGeometry } from "./frozen-geometry";

export { assembleLateralReachCalibrationResult } from "./result-assembly";

export { buildLateralReachEngineConfig } from "./engine-config-adapter";

export {
  createLateralReachCalibrationAttemptIntention,
  type LateralReachCalibrationAttemptIntention,
} from "./attempt-intention";

export {
  createLateralReachCalibrationNoiseFloor,
  createLateralReachCalibrationZoneRadii,
  type LateralReachCalibrationZoneRadii,
} from "./technical-parameters";
