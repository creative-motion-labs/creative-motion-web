/**
 * Lateral Reach interaction-calibration — Slice 4: derived measurements.
 *
 * Pure derivation of direction-aligned horizontal displacement from a frozen
 * startWrist, heldEndpoint, and a PRE-EXISTING expectedHorizontalDirectionSign.
 *
 * Does NOT:
 * - infer expected direction from observed points or personalized geometry
 * - capture start/endpoint
 * - build interaction zones or engine config
 * - import MediaPipe, camera, React, or the Lateral Reach engine
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import type {
  LateralReachDerivedMeasurements,
  LateralReachNoiseFloorConfig,
} from "./types";

function isFiniteNormalizedPoint(value: NormalizedPoint): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function assertFiniteStartWrist(startWrist: NormalizedPoint): void {
  if (!isFiniteNormalizedPoint(startWrist)) {
    throw new RangeError("startWrist must have finite x and y");
  }
}

function assertFiniteHeldEndpoint(heldEndpoint: NormalizedPoint): void {
  if (!isFiniteNormalizedPoint(heldEndpoint)) {
    throw new RangeError("heldEndpoint must have finite x and y");
  }
}

function assertExpectedSign(
  expectedHorizontalDirectionSign: number,
): asserts expectedHorizontalDirectionSign is 1 | -1 {
  if (
    expectedHorizontalDirectionSign !== 1 &&
    expectedHorizontalDirectionSign !== -1
  ) {
    throw new RangeError(
      "expectedHorizontalDirectionSign must be exactly 1 or -1",
    );
  }
}

function assertNoiseFloor(noiseFloor: LateralReachNoiseFloorConfig): void {
  const min = noiseFloor.minDirectionAlignedMagnitude;
  if (!(typeof min === "number" && Number.isFinite(min) && min > 0)) {
    throw new RangeError(
      "minDirectionAlignedMagnitude must be a finite number greater than 0",
    );
  }
}

/**
 * Derive rawDeltaX and directionAlignedMagnitude from observations + expected sign.
 *
 * expectedHorizontalDirectionSign is attempt-level intention established upstream
 * BEFORE endpoint observation. This function never invents it from geometry or side.
 */
export function deriveLateralReachMeasurements(
  startWrist: NormalizedPoint,
  heldEndpoint: NormalizedPoint,
  expectedHorizontalDirectionSign: 1 | -1,
): LateralReachDerivedMeasurements {
  assertFiniteStartWrist(startWrist);
  assertFiniteHeldEndpoint(heldEndpoint);
  assertExpectedSign(expectedHorizontalDirectionSign);

  const rawDeltaX = heldEndpoint.x - startWrist.x;
  const directionAlignedMagnitude =
    expectedHorizontalDirectionSign * rawDeltaX;

  return {
    rawDeltaX,
    expectedHorizontalDirectionSign,
    directionAlignedMagnitude,
  };
}

/**
 * Validate direction and magnitude against a noise floor.
 *
 * Internally derives measurements — does not accept a pre-built derived object.
 * Success/failure results contain no derived measurements payload.
 */
export function validateLateralReachDirectionAndMagnitude(
  startWrist: NormalizedPoint,
  heldEndpoint: NormalizedPoint,
  expectedHorizontalDirectionSign: 1 | -1,
  noiseFloor: LateralReachNoiseFloorConfig,
):
  | { ok: true }
  | {
      ok: false;
      reason:
        | "wrong_direction_reach"
        | "direction_aligned_magnitude_not_positive"
        | "displacement_indistinguishable_from_noise";
    } {
  const derived = deriveLateralReachMeasurements(
    startWrist,
    heldEndpoint,
    expectedHorizontalDirectionSign,
  );
  assertNoiseFloor(noiseFloor);

  const { directionAlignedMagnitude } = derived;
  const floor = noiseFloor.minDirectionAlignedMagnitude;

  // Locked classification order. -0 compares equal to 0 (not < 0).
  if (directionAlignedMagnitude < 0) {
    return { ok: false, reason: "wrong_direction_reach" };
  }
  if (directionAlignedMagnitude === 0) {
    return { ok: false, reason: "direction_aligned_magnitude_not_positive" };
  }
  if (directionAlignedMagnitude < floor) {
    return { ok: false, reason: "displacement_indistinguishable_from_noise" };
  }
  return { ok: true };
}
