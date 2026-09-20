/**
 * Lateral Reach interaction-calibration — Slice 5: frozen interaction geometry.
 *
 * Constructs attempt-frozen startingZone / fixedTarget from accepted calibration
 * observations, an externally supplied expectedHorizontalDirectionSign, noise
 * floor, and explicit zone radii.
 *
 * Interaction personalization only. Not clinical ROM, maximal/comfortable/safe
 * reach, strength, impairment, diagnosis, prognosis, or clinical outcome.
 *
 * Direction invariant: after Slice 4 validates
 * expectedHorizontalDirectionSign * rawDeltaX > 0, and this module sets
 * startingZone.x = startWrist.x and fixedTarget.x = heldEndpoint.x, the
 * geometry horizontal delta is identically rawDeltaX. No second sign-from-
 * geometry derivation of expected direction is performed.
 *
 * Does NOT:
 * - assemble the calibration outcome union
 * - build full engine attempt configuration
 * - call engine config validation
 * - emit engine-config blockers
 * - import MediaPipe, camera, React, or the Lateral Reach engine
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import { validateLateralReachDirectionAndMagnitude } from "./derived-measurements";
import type {
  LateralReachGeometryBlocker,
  LateralReachNoiseFloorConfig,
} from "./types";

type FrozenZone = {
  point: NormalizedPoint;
  radius: number;
};

function isPositiveFiniteRadius(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isInUnitInterval(value: number): boolean {
  return value >= 0 && value <= 1;
}

function distanceNormalized(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function geometryNotConstructible(): {
  ok: false;
  kind: "geometry_not_constructible";
  geometryBlockers: LateralReachGeometryBlocker[];
} {
  return {
    ok: false,
    kind: "geometry_not_constructible",
    geometryBlockers: ["geometry_constraints_unsatisfied"],
  };
}

/**
 * Construct frozen startingZone / fixedTarget for one attempt.
 *
 * Validation order is locked:
 * 1) zone radii
 * 2) Slice 4 direction/magnitude revalidation
 * 3) inclusive [0,1] point bounds
 * 4) Euclidean overlap/touch
 * 5) horizontal separation
 * 6) success
 */
export function constructLateralReachFrozenGeometry(
  startWrist: NormalizedPoint,
  heldEndpoint: NormalizedPoint,
  expectedHorizontalDirectionSign: 1 | -1,
  noiseFloor: LateralReachNoiseFloorConfig,
  zoneRadii: {
    startingZoneRadius: number;
    fixedTargetRadius: number;
  },
):
  | {
      ok: true;
      startingZone: FrozenZone;
      fixedTarget: FrozenZone;
    }
  | {
      ok: false;
      kind: "calibration_invalid";
      reason:
        | "wrong_direction_reach"
        | "direction_aligned_magnitude_not_positive"
        | "displacement_indistinguishable_from_noise";
    }
  | {
      ok: false;
      kind: "geometry_not_constructible";
      geometryBlockers: LateralReachGeometryBlocker[];
    } {
  const { startingZoneRadius, fixedTargetRadius } = zoneRadii;

  if (!isPositiveFiniteRadius(startingZoneRadius)) {
    throw new RangeError(
      "startingZoneRadius must be a finite number greater than 0",
    );
  }
  if (!isPositiveFiniteRadius(fixedTargetRadius)) {
    throw new RangeError(
      "fixedTargetRadius must be a finite number greater than 0",
    );
  }

  const directionResult = validateLateralReachDirectionAndMagnitude(
    startWrist,
    heldEndpoint,
    expectedHorizontalDirectionSign,
    noiseFloor,
  );
  if (!directionResult.ok) {
    return {
      ok: false,
      kind: "calibration_invalid",
      reason: directionResult.reason,
    };
  }

  if (
    !isInUnitInterval(startWrist.x) ||
    !isInUnitInterval(startWrist.y) ||
    !isInUnitInterval(heldEndpoint.x) ||
    !isInUnitInterval(heldEndpoint.y)
  ) {
    return geometryNotConstructible();
  }

  const startingPoint = Object.freeze({
    x: startWrist.x,
    y: startWrist.y,
  });
  const targetPoint = Object.freeze({
    x: heldEndpoint.x,
    y: heldEndpoint.y,
  });

  const startingZone = Object.freeze({
    point: startingPoint,
    radius: startingZoneRadius,
  });
  const fixedTarget = Object.freeze({
    point: targetPoint,
    radius: fixedTargetRadius,
  });

  const euclideanDistance = distanceNormalized(startingZone.point, fixedTarget.point);
  const radiusSum = startingZone.radius + fixedTarget.radius;

  if (euclideanDistance <= radiusSum) {
    return geometryNotConstructible();
  }

  const horizontalSeparation = Math.abs(
    fixedTarget.point.x - startingZone.point.x,
  );
  if (horizontalSeparation <= radiusSum) {
    return geometryNotConstructible();
  }

  return Object.freeze({
    ok: true as const,
    startingZone,
    fixedTarget,
  });
}
