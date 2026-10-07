/**
 * RASQ Lateral Reach — patient interaction-calibration domain contracts (Slice 1).
 *
 * Foundational vocabulary only: closed `as const` enumerations, observation vs
 * derived-measurement boundaries, and outcome discriminants that make illegal
 * capture/geometry combinations unrepresentable at the TypeScript type level.
 *
 * This module does NOT:
 * - provide runtime JSON/object validators for speculative parsing
 * - capture start/endpoint samples
 * - build startingZone / fixedTarget / LateralReachConfig
 * - encode interactionFraction or geometry-construction algorithms
 * - call or alter lateral-reach-engine
 * - access camera / MediaPipe / React UI
 * - invent clinical ROM, impairment, ability tiers, or comfort-as-fact labels
 *
 * Coordinates remain raw camera-space normalized points (same convention as
 * NormalizedMotionFrame). No mirroring transforms here.
 *
 * MVP capture preference (one held calibration reach + one technical retry) is a
 * product policy for later slices. This contract records an accepted held
 * endpoint for a calibration result and does not permanently forbid future
 * multi-reach aggregation upstream of that accepted value.
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

export type { NormalizedPoint, UpperLimbSide };

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const LATERAL_REACH_CALIBRATION_SCHEMA_VERSION = "lateral-reach-calibration/v1" as const;
export type LateralReachCalibrationSchemaVersion =
  typeof LATERAL_REACH_CALIBRATION_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Capture failure reasons (technical observation invalidity only)
// ---------------------------------------------------------------------------

export const LATERAL_REACH_CAPTURE_FAILURE_REASONS = [
  "framing_not_acceptable",
  "wrist_tracking_invalid",
  "start_unstable",
  "start_timeout",
  "insufficient_start_samples",
  "wrong_direction_reach",
  "endpoint_hold_not_confirmed",
  "direction_aligned_magnitude_not_positive",
  "displacement_indistinguishable_from_noise",
  "calibration_timeout",
] as const;

export type LateralReachCaptureFailureReason =
  (typeof LATERAL_REACH_CAPTURE_FAILURE_REASONS)[number];

// ---------------------------------------------------------------------------
// Geometry blockers (valid capture; geometry could not be constructed)
//
// Intentionally minimal and algorithm-agnostic. Slice 1 must not encode a
// not-yet-built geometry builder (circle radii, fraction reduction, etc.).
// ---------------------------------------------------------------------------

export const LATERAL_REACH_GEOMETRY_BLOCKERS = [
  "geometry_constraints_unsatisfied",
  "engine_config_invalid",
] as const;

export type LateralReachGeometryBlocker = (typeof LATERAL_REACH_GEOMETRY_BLOCKERS)[number];

// ---------------------------------------------------------------------------
// Noise floor config (device-QA parameter shape; no validated numeric default)
// ---------------------------------------------------------------------------

export const LATERAL_REACH_NOISE_FLOOR_KIND = "direction_aligned_magnitude_noise_floor" as const;

/**
 * Device-QA configuration shape for distinguishing pose jitter from a
 * trustworthy observed interaction displacement. Numeric thresholds are NOT
 * clinically validated in Slice 1 and are not hardcoded as production defaults.
 */
export type LateralReachNoiseFloorConfig = {
  kind: typeof LATERAL_REACH_NOISE_FLOOR_KIND;
  minDirectionAlignedMagnitude: number;
};

// ---------------------------------------------------------------------------
// Observations vs derived measurements
// ---------------------------------------------------------------------------

/**
 * Factual captured points only.
 *
 * `heldEndpoint` is the accepted held/stable calibration endpoint for this
 * result. The system may establish that it was tracked, direction-valid,
 * held/stable, and above configured noise uncertainty. It does not establish
 * comfort, safety, maximal reach, or clinical ROM validity.
 */
export type LateralReachCalibrationObservations = {
  startWrist: NormalizedPoint;
  heldEndpoint: NormalizedPoint;
};

/**
 * Derived measurement math from observations + expected horizontal direction.
 * Not clinical ROM. Field names intentionally avoid ambiguous "signed displacement".
 *
 * rawDeltaX = heldEndpoint.x - startWrist.x
 * directionAlignedMagnitude = expectedHorizontalDirectionSign * rawDeltaX
 * (valid capture paths require directionAlignedMagnitude > 0)
 */
export type LateralReachDerivedMeasurements = {
  rawDeltaX: number;
  expectedHorizontalDirectionSign: 1 | -1;
  directionAlignedMagnitude: number;
};

// ---------------------------------------------------------------------------
// Outcome discriminants — illegal combinations are unrepresentable
//
// Allowed only:
//   A) capture failed  + geometry not_applicable
//   B) capture valid   + geometry not_constructible
//   C) capture valid   + geometry ready
//
// No stored top-level convenience "status". No "degraded" calibration state.
// No interactionFraction / technical geometry-adjustment algorithm fields.
// startingZone / fixedTarget / LateralReachConfig arrive in a later slice.
// ---------------------------------------------------------------------------

type LateralReachCalibrationResultBase = {
  schemaVersion: LateralReachCalibrationSchemaVersion;
  testedSide: UpperLimbSide;
};

export type LateralReachCalibrationCaptureFailedResult = LateralReachCalibrationResultBase & {
  captureOutcome: "failed";
  geometryOutcome: "not_applicable";
  failureReasons: LateralReachCaptureFailureReason[];
  /** Optional factual scraps only; never invented geometry. */
  observations?: Partial<LateralReachCalibrationObservations>;
};

/**
 * Capture succeeded, but interaction geometry could not be constructed under
 * current constraints. No engine attempt config is implied.
 */
export type LateralReachCalibrationGeometryNotConstructibleResult =
  LateralReachCalibrationResultBase & {
    captureOutcome: "valid";
    geometryOutcome: "not_constructible";
    observations: LateralReachCalibrationObservations;
    derivedMeasurements: LateralReachDerivedMeasurements;
    geometryBlockers: LateralReachGeometryBlocker[];
  };

/**
 * Frozen interaction geometry zones produced by calibration Slice 5/6.
 * Technical personalization only — not clinical ROM or ability claims.
 * Distinct from engine LateralReachZone; no engine import.
 */
export type LateralReachFrozenZone = {
  readonly point: Readonly<NormalizedPoint>;
  readonly radius: number;
};

/**
 * Capture succeeded and interaction geometry is ready for a later engine
 * config adapter. Carries attempt-frozen startingZone / fixedTarget only —
 * not full engine attempt configuration.
 */
export type LateralReachCalibrationGeometryReadyResult = LateralReachCalibrationResultBase & {
  captureOutcome: "valid";
  geometryOutcome: "ready";
  observations: LateralReachCalibrationObservations;
  derivedMeasurements: LateralReachDerivedMeasurements;
  readonly frozenGeometry: {
    readonly startingZone: LateralReachFrozenZone;
    readonly fixedTarget: LateralReachFrozenZone;
  };
};

export type LateralReachCalibrationResult =
  | LateralReachCalibrationCaptureFailedResult
  | LateralReachCalibrationGeometryNotConstructibleResult
  | LateralReachCalibrationGeometryReadyResult;
