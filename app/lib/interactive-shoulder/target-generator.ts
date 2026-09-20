import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { NormalizedPoint, SafeTargetBounds, TherapeuticTarget } from "./types";

export const DEFAULT_SAFE_TARGET_BOUNDS: SafeTargetBounds = {
  minX: 0.18,
  maxX: 0.82,
  minY: 0.12,
  maxY: 0.72,
};

const EDGE_MARGIN = 0.06;
const MIN_TARGET_SEPARATION = 0.12;

export function clampToSafeBounds(point: NormalizedPoint, bounds: SafeTargetBounds): NormalizedPoint {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
  };
}

export function isPointInsideSafeBounds(point: NormalizedPoint, bounds: SafeTargetBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/** Clinically relevant side bias — targets appear on the patient's active reach side. */
export function resolveSideBiasedBounds(
  bounds: SafeTargetBounds,
  side: ShoulderAbductionReachSide,
): SafeTargetBounds {
  if (side === "left") {
    return { ...bounds, minX: bounds.minX, maxX: bounds.minX + (bounds.maxX - bounds.minX) * 0.55 };
  }
  return { ...bounds, minX: bounds.minX + (bounds.maxX - bounds.minX) * 0.45, maxX: bounds.maxX };
}

export type TargetGeneratorInput = {
  bounds: SafeTargetBounds;
  side: ShoulderAbductionReachSide;
  nowMs: number;
  sequence: number;
  previousTarget?: NormalizedPoint | null;
  random?: () => number;
  /**
   * A position the caller has already resolved deliberately — today, adaptive
   * shoulder-anchored placement (CHANGE-007). OPTIONAL, NEVER DEFAULTED: omitted or null
   * means the random search below runs exactly as it always has, which is what every
   * caller with adaptive difficulty disabled supplies.
   *
   * This generator stays the single target-construction authority; the parameter only
   * replaces WHERE the point comes from, never the fact that a target is built here.
   */
  preferredPosition?: NormalizedPoint | null;
};

/**
 * Whether a caller-supplied preferred position can be used at all.
 *
 * Non-finite coordinates are the one rejection: they cannot be clamped into anything
 * meaningful and would produce a target the patient can never reach and the hit test can
 * never evaluate. A position merely OUTSIDE the safe bounds is not rejected — it is
 * clamped, which is the generator's existing, established treatment of every candidate
 * point it handles.
 */
function isUsablePreferredPosition(
  point: NormalizedPoint | null | undefined,
): point is NormalizedPoint {
  return (
    point !== null &&
    point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

export function generateTherapeuticTarget(input: TargetGeneratorInput): TherapeuticTarget {
  // DELIBERATE PLACEMENT SHORT-CIRCUIT.
  //
  // The loop below is a rejection sampler: it re-rolls a RANDOM candidate until one is
  // clear of the edges and of the previous target. Neither guard is meaningful for a
  // position that was computed rather than sampled — re-rolling would discard the caller's
  // geometry entirely, and the separation guard would reject the (correct) case of two
  // consecutive attempts at the same adaptive level, which must land in the same place.
  //
  // What is kept is the guard that actually protects the patient: the safe-bounds clamp,
  // applied against the caller's own `bounds`. The side bias is intentionally NOT applied
  // here — it is the random path's heuristic for landing on the reach side, whereas a
  // preferred position is already anchored on the affected shoulder, and clamping it into
  // the biased half would drag legitimate placements toward the midline.
  //
  // The false-immediate-hit risk created by two identical consecutive positions is handled
  // by `target-lifecycle.ts`, which seeds a new target's wrist-entry state from where the
  // wrist actually is. It is not handled by moving the target.
  if (isUsablePreferredPosition(input.preferredPosition)) {
    return {
      id: `target-${input.sequence}-${input.nowMs}`,
      spawnedAtMs: input.nowMs,
      ...clampToSafeBounds(input.preferredPosition, input.bounds),
    };
  }

  const biased = resolveSideBiasedBounds(input.bounds, input.side);
  const rand = input.random ?? Math.random;
  let attempt = 0;
  let point: NormalizedPoint = {
    x: biased.minX + (biased.maxX - biased.minX) * rand(),
    y: biased.minY + (biased.maxY - biased.minY) * rand(),
  };

  while (attempt < 8) {
    point = clampToSafeBounds(point, biased);
    const awayFromEdges =
      point.x >= biased.minX + EDGE_MARGIN &&
      point.x <= biased.maxX - EDGE_MARGIN &&
      point.y >= biased.minY + EDGE_MARGIN &&
      point.y <= biased.maxY - EDGE_MARGIN;
    const awayFromPrevious =
      !input.previousTarget ||
      Math.hypot(point.x - input.previousTarget.x, point.y - input.previousTarget.y) >=
        MIN_TARGET_SEPARATION;
    if (awayFromEdges && awayFromPrevious) break;
    point = {
      x: biased.minX + (biased.maxX - biased.minX) * rand(),
      y: biased.minY + (biased.maxY - biased.minY) * rand(),
    };
    attempt += 1;
  }

  return {
    id: `target-${input.sequence}-${input.nowMs}`,
    spawnedAtMs: input.nowMs,
    ...clampToSafeBounds(point, biased),
  };
}
