/**
 * Lateral Reach interaction-calibration — Slice 9: technical-parameter ownership.
 *
 * Explicit fail-closed intake for structurally valid calibration technical
 * parameters: noise floor magnitude and zone radii.
 *
 * STRUCTURALLY VALID does not mean DEVICE/CV-VALIDATED for production.
 * This module never invents numeric defaults or production thresholds.
 *
 * Does NOT:
 * - invent defaults, clamps, or presets
 * - own intention or limb-side metadata
 * - import engine, capture devices, or view layers
 */

import {
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachNoiseFloorConfig,
} from "./types";

export type LateralReachCalibrationZoneRadii = {
  readonly startingZoneRadius: number;
  readonly fixedTargetRadius: number;
};

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Canonical minting gate for calibration noise-floor magnitude.
 * Emits the existing LateralReachNoiseFloorConfig shape with the official kind.
 */
export function createLateralReachCalibrationNoiseFloor(
  minDirectionAlignedMagnitude: unknown,
): LateralReachNoiseFloorConfig {
  if (!isPositiveFiniteNumber(minDirectionAlignedMagnitude)) {
    throw new RangeError(
      "minDirectionAlignedMagnitude must be a finite number greater than 0",
    );
  }

  return {
    kind: LATERAL_REACH_NOISE_FLOOR_KIND,
    minDirectionAlignedMagnitude,
  };
}

/**
 * Canonical minting gate for calibration zone radii.
 * Validates startingZoneRadius before fixedTargetRadius.
 */
export function createLateralReachCalibrationZoneRadii(
  zoneRadii: unknown,
): LateralReachCalibrationZoneRadii {
  const record =
    zoneRadii !== null && typeof zoneRadii === "object"
      ? (zoneRadii as {
          startingZoneRadius?: unknown;
          fixedTargetRadius?: unknown;
        })
      : undefined;

  const startingZoneRadius = record?.startingZoneRadius;
  const fixedTargetRadius = record?.fixedTargetRadius;

  if (!isPositiveFiniteNumber(startingZoneRadius)) {
    throw new RangeError(
      "startingZoneRadius must be a finite number greater than 0",
    );
  }
  if (!isPositiveFiniteNumber(fixedTargetRadius)) {
    throw new RangeError(
      "fixedTargetRadius must be a finite number greater than 0",
    );
  }

  return {
    startingZoneRadius,
    fixedTargetRadius,
  };
}
