/**
 * Lateral Reach interaction-calibration — Slice 6: calibration result assembly.
 *
 * Assembles LateralReachCalibrationResult from stage outcomes of Slices 2–5.
 * Interaction calibration only — not clinical ROM, maximal/comfortable/safe
 * reach, strength, impairment, ability, diagnosis, prognosis, or outcome.
 *
 * Does NOT:
 * - build full engine attempt configuration
 * - call engine config validation
 * - emit engine-config blockers
 * - derive expected direction from testedSide or observations
 * - import MediaPipe, camera, React, or the Lateral Reach engine
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import {
  isValidUpperLimbSide,
  type UpperLimbSide,
} from "@/app/lib/upper-limb-motor-screen/types";
import {
  createLateralReachCalibrationAttemptIntention,
  type LateralReachCalibrationAttemptIntention,
} from "./attempt-intention";
import { deriveLateralReachMeasurements } from "./derived-measurements";
import { constructLateralReachFrozenGeometry } from "./frozen-geometry";
import {
  createLateralReachCalibrationNoiseFloor,
  createLateralReachCalibrationZoneRadii,
  type LateralReachCalibrationZoneRadii,
} from "./technical-parameters";
import {
  LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  type LateralReachCalibrationResult,
  type LateralReachCaptureFailureReason,
  type LateralReachNoiseFloorConfig,
} from "./types";

export type LateralReachResultAssemblyInput =
  | {
      testedSide: UpperLimbSide;
      stage: "start_failed";
      failureReasons: LateralReachCaptureFailureReason[];
    }
  | {
      testedSide: UpperLimbSide;
      stage: "endpoint_failed";
      startWrist: NormalizedPoint;
      failureReasons: LateralReachCaptureFailureReason[];
    }
  | {
      testedSide: UpperLimbSide;
      stage: "captured";
      startWrist: NormalizedPoint;
      heldEndpoint: NormalizedPoint;
      intention: LateralReachCalibrationAttemptIntention;
      noiseFloor: LateralReachNoiseFloorConfig;
      zoneRadii: LateralReachCalibrationZoneRadii;
    };

function clonePoint(point: NormalizedPoint): NormalizedPoint {
  return { x: point.x, y: point.y };
}

function assertTestedSide(testedSide: unknown): asserts testedSide is UpperLimbSide {
  if (!isValidUpperLimbSide(testedSide)) {
    throw new RangeError('testedSide must be exactly "left" or "right"');
  }
}

/**
 * Runtime-canonicalize captured-stage intention through the Slice 8 gate.
 * Avoids property-access TypeError on null/non-objects before RangeError.
 */
function resolveCapturedIntention(
  intention: unknown,
): LateralReachCalibrationAttemptIntention {
  const rawSign =
    intention !== null && typeof intention === "object"
      ? (intention as { expectedHorizontalDirectionSign?: unknown })
          .expectedHorizontalDirectionSign
      : undefined;

  return createLateralReachCalibrationAttemptIntention(rawSign);
}

/**
 * Runtime-canonicalize captured-stage noise floor through the Slice 9 gate.
 * Extracts magnitude only; does not introduce kind rejection.
 */
function resolveCapturedNoiseFloor(
  noiseFloor: unknown,
): LateralReachNoiseFloorConfig {
  const rawMagnitude =
    noiseFloor !== null && typeof noiseFloor === "object"
      ? (noiseFloor as { minDirectionAlignedMagnitude?: unknown })
          .minDirectionAlignedMagnitude
      : undefined;

  return createLateralReachCalibrationNoiseFloor(rawMagnitude);
}

/**
 * Assemble a LateralReachCalibrationResult from stage-level calibration inputs.
 *
 * Captured path call order is locked:
 * testedSide → intention → zone radii → noise floor → Slice 5 → derive.
 */
export function assembleLateralReachCalibrationResult(
  input: LateralReachResultAssemblyInput,
): LateralReachCalibrationResult {
  assertTestedSide(input.testedSide);

  const schemaVersion = LATERAL_REACH_CALIBRATION_SCHEMA_VERSION;

  if (input.stage === "start_failed") {
    return {
      schemaVersion,
      testedSide: input.testedSide,
      captureOutcome: "failed",
      geometryOutcome: "not_applicable",
      failureReasons: [...input.failureReasons],
    };
  }

  if (input.stage === "endpoint_failed") {
    return {
      schemaVersion,
      testedSide: input.testedSide,
      captureOutcome: "failed",
      geometryOutcome: "not_applicable",
      failureReasons: [...input.failureReasons],
      observations: {
        startWrist: clonePoint(input.startWrist),
      },
    };
  }

  // stage === "captured"
  const intention = resolveCapturedIntention(input.intention);
  const expectedHorizontalDirectionSign =
    intention.expectedHorizontalDirectionSign;

  const zoneRadii = createLateralReachCalibrationZoneRadii(input.zoneRadii);
  const noiseFloor = resolveCapturedNoiseFloor(input.noiseFloor);

  const geometryResult = constructLateralReachFrozenGeometry(
    input.startWrist,
    input.heldEndpoint,
    expectedHorizontalDirectionSign,
    noiseFloor,
    zoneRadii,
  );

  if (!geometryResult.ok && geometryResult.kind === "calibration_invalid") {
    return {
      schemaVersion,
      testedSide: input.testedSide,
      captureOutcome: "failed",
      geometryOutcome: "not_applicable",
      failureReasons: [geometryResult.reason],
      observations: {
        startWrist: clonePoint(input.startWrist),
        heldEndpoint: clonePoint(input.heldEndpoint),
      },
    };
  }

  const derivedMeasurements = deriveLateralReachMeasurements(
    input.startWrist,
    input.heldEndpoint,
    expectedHorizontalDirectionSign,
  );

  const observations = {
    startWrist: clonePoint(input.startWrist),
    heldEndpoint: clonePoint(input.heldEndpoint),
  };

  if (!geometryResult.ok && geometryResult.kind === "geometry_not_constructible") {
    return {
      schemaVersion,
      testedSide: input.testedSide,
      captureOutcome: "valid",
      geometryOutcome: "not_constructible",
      observations,
      derivedMeasurements,
      geometryBlockers: geometryResult.geometryBlockers,
    };
  }

  if (!geometryResult.ok) {
    // Exhaustiveness guard — unreachable under locked Slice 5 result kinds.
    throw new Error("unexpected frozen-geometry failure kind");
  }

  const frozenGeometry = Object.freeze({
    startingZone: geometryResult.startingZone,
    fixedTarget: geometryResult.fixedTarget,
  });

  return {
    schemaVersion,
    testedSide: input.testedSide,
    captureOutcome: "valid",
    geometryOutcome: "ready",
    observations,
    derivedMeasurements,
    frozenGeometry,
  };
}
