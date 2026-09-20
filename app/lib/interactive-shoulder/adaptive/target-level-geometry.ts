/**
 * Adaptive target-placement geometry, anchored on the affected shoulder (CHANGE-002).
 *
 * CLINICAL SAFETY BOUNDARY
 * ------------------------
 * `levelDegrees` here is TARGET-PLACEMENT GEOMETRY: it is the angle at which a
 * reach target is positioned around the affected shoulder anchor. It is NOT a
 * clinically validated range-of-motion measurement, NOT a measured shoulder
 * abduction angle, NOT a diagnosis, NOT a clinical outcome, and NOT a regulatory
 * claim. The measured abduction angle is produced separately and independently by
 * `computeShoulderAbductionAngle` in the shoulder-rehabilitation module; this file
 * never reads it, never writes it, and must never be presented as equivalent to it.
 * The repository does not currently define or validate any relationship between a
 * placement level and a measured angle, so this module deliberately asserts none.
 *
 * No clinical threshold is embedded here. The caller supplies
 * `minimumLevelDegrees` / `maximumLevelDegrees`, which require therapist or
 * clinical-team approval. The only constant defined below is a geometric guard.
 *
 * COORDINATE CONVENTION (single documented convention, verified in-repo)
 * ---------------------------------------------------------------------
 * Normalized preview space, both axes in [0, 1] — the same space as
 * `primaryWristNormalized`, `SafeTargetBounds`, and the target generator.
 *
 *   - `x` increases toward SCREEN RIGHT, which is the patient's RIGHT side.
 *     The preview is a mirrored (selfie) view. This is confirmed by three
 *     independent existing sources: the detector's synthetic landmark fixtures
 *     place `right_shoulder` at a higher x than `left_shoulder` and abduct the
 *     right arm toward higher x; `resolveSideBiasedBounds` biases the "right"
 *     side to the high-x half; and `mirrorX` in motion-pattern-types treats
 *     "right" as identity and mirrors "left" via `1 - x`.
 *   - `y` increases DOWNWARD (browser / MediaPipe convention). A smaller y is
 *     higher on screen.
 *
 * MATHEMATICAL MAPPING
 * --------------------
 * `levelDegrees` is measured at the shoulder, starting from the arm-at-rest
 * direction (straight down the trunk) and opening toward the patient's affected
 * side. This matches the existing measured-angle convention documented in
 * `shoulder-abduction-reach-metrics.ts`, where the angle is read between the
 * shoulder→hip vector and the shoulder→elbow vector: ~0° at rest, ~90° with the
 * arm horizontal, approaching 180° overhead.
 *
 * With `lateral = +1` for the right side and `-1` for the left side:
 *
 *   x = anchor.x + lateral * radius * sin(levelDegrees)
 *   y = anchor.y +           radius * cos(levelDegrees)
 *
 * Because y grows downward, `+cos` places 0° BELOW the shoulder (arm at rest) and
 * 180° ABOVE it (arm overhead), while `lateral` mirrors the sweep between sides:
 *
 *   0°   → directly below the shoulder anchor
 *   90°  → horizontal, on the affected side
 *   180° → directly above the shoulder anchor
 *
 * The module is pure and deterministic: no clock, no randomness, no browser API,
 * no React, no persistence, and no input mutation.
 */

import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import { clampToSafeBounds, resolveSideBiasedBounds } from "../target-generator";
import type { NormalizedPoint, SafeTargetBounds } from "../types";

/**
 * Geometric guard only — NOT a clinical threshold. Keeps a resolved target from
 * collapsing onto the shoulder anchor, which would make the reach meaningless and
 * could register an immediate false hit.
 */
export const MIN_TARGET_ANCHOR_SEPARATION_NORMALIZED = 0.04;

export type TargetLevelGeometryInput = {
  /** Required explicitly — this module never assumes a side. */
  affectedSide: ShoulderAbductionReachSide;
  /** Verified affected-side shoulder anchor, or null when unavailable. */
  shoulderAnchorNormalized: NormalizedPoint | null;
  /** Patient-relative reach scale (typically the estimated arm length), or null. */
  reachRadiusNormalized: number | null;
  /** Requested target-placement level in degrees. */
  levelDegrees: number;
  /** Therapist-approved lower placement limit. */
  minimumLevelDegrees: number;
  /** Therapist-approved upper placement limit. */
  maximumLevelDegrees: number;
  /** Existing safe normalized bounds the target must stay inside. */
  bounds: SafeTargetBounds;
  /** Opt-in to the existing `resolveSideBiasedBounds` movement bias. Default false. */
  applySideBias?: boolean;
};

export type TargetLevelGeometryUnavailableReason =
  | "missingShoulderAnchor"
  | "invalidShoulderAnchor"
  | "missingReachRadius"
  | "invalidReachRadius"
  | "invalidLevelRange"
  | "invalidLevelDegrees"
  | "targetCollapsedOntoAnchor";

export type TargetLevelGeometryResult =
  | {
      available: true;
      /** Resolved target position in normalized preview coordinates. */
      position: NormalizedPoint;
      /** Level actually used after clamping into the approved range. */
      appliedLevelDegrees: number;
      /** True when the requested level fell outside the approved range. */
      levelWasClamped: boolean;
      /** True when safe-bounds clamping moved the geometric position. */
      positionWasClampedToBounds: boolean;
    }
  | { available: false; reason: TargetLevelGeometryUnavailableReason };

function isUsablePoint(point: NormalizedPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** +1 places the target toward the patient's right, -1 toward their left. */
export function lateralDirectionForSide(side: ShoulderAbductionReachSide): 1 | -1 {
  return side === "right" ? 1 : -1;
}

/** Clamps a requested placement level into the therapist-approved range. */
export function clampLevelDegrees(
  levelDegrees: number,
  minimumLevelDegrees: number,
  maximumLevelDegrees: number,
): number {
  return Math.min(Math.max(levelDegrees, minimumLevelDegrees), maximumLevelDegrees);
}

/**
 * Raw polar→normalized projection, before any safe-bounds clamping.
 * Exported so the mapping itself can be asserted directly in tests.
 */
export function projectTargetLevelPosition(
  anchor: NormalizedPoint,
  reachRadiusNormalized: number,
  levelDegrees: number,
  side: ShoulderAbductionReachSide,
): NormalizedPoint {
  const radians = (levelDegrees * Math.PI) / 180;
  const lateral = lateralDirectionForSide(side);
  return {
    x: anchor.x + lateral * reachRadiusNormalized * Math.sin(radians),
    y: anchor.y + reachRadiusNormalized * Math.cos(radians),
  };
}

/**
 * Resolves an adaptive target position around the affected shoulder.
 *
 * Returns an explicit unavailable result — never fabricated coordinates — when the
 * required geometry is missing or unusable.
 */
export function resolveTargetLevelPosition(
  input: TargetLevelGeometryInput,
): TargetLevelGeometryResult {
  const anchor = input.shoulderAnchorNormalized;
  if (anchor === null || anchor === undefined) {
    return { available: false, reason: "missingShoulderAnchor" };
  }
  if (!isUsablePoint(anchor)) {
    return { available: false, reason: "invalidShoulderAnchor" };
  }

  const radius = input.reachRadiusNormalized;
  if (radius === null || radius === undefined) {
    return { available: false, reason: "missingReachRadius" };
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    return { available: false, reason: "invalidReachRadius" };
  }

  if (
    !Number.isFinite(input.minimumLevelDegrees) ||
    !Number.isFinite(input.maximumLevelDegrees) ||
    input.minimumLevelDegrees > input.maximumLevelDegrees
  ) {
    return { available: false, reason: "invalidLevelRange" };
  }
  if (!Number.isFinite(input.levelDegrees)) {
    return { available: false, reason: "invalidLevelDegrees" };
  }

  const appliedLevelDegrees = clampLevelDegrees(
    input.levelDegrees,
    input.minimumLevelDegrees,
    input.maximumLevelDegrees,
  );
  const levelWasClamped = appliedLevelDegrees !== input.levelDegrees;

  const bounds =
    input.applySideBias === true
      ? resolveSideBiasedBounds(input.bounds, input.affectedSide)
      : input.bounds;

  const projected = projectTargetLevelPosition(
    anchor,
    radius,
    appliedLevelDegrees,
    input.affectedSide,
  );
  const position = clampToSafeBounds(projected, bounds);
  const positionWasClampedToBounds = position.x !== projected.x || position.y !== projected.y;

  if (!isUsablePoint(position)) {
    return { available: false, reason: "invalidReachRadius" };
  }

  // A target sitting on the anchor is not a reach — refuse rather than emit it.
  const separation = Math.hypot(position.x - anchor.x, position.y - anchor.y);
  if (separation < MIN_TARGET_ANCHOR_SEPARATION_NORMALIZED) {
    return { available: false, reason: "targetCollapsedOntoAnchor" };
  }

  return {
    available: true,
    position,
    appliedLevelDegrees,
    levelWasClamped,
    positionWasClampedToBounds,
  };
}
