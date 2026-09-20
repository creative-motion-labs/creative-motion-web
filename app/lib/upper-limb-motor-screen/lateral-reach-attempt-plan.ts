/**
 * Lateral Reach — Slice 10: pre-movement calibration attempt plan producer.
 *
 * Product session/attempt configuration boundary that resolves a typed
 * screen-space horizontal direction into the Slice 8 calibration intention.
 *
 * SCREEN-SPACE only (raw normalized camera/screen x). Not anatomical side,
 * limb-side metadata, free-text placement fields, or clinical terminology.
 *
 * Does NOT:
 * - invent defaults or fallbacks
 * - map free-text placement or limb-side metadata
 * - inspect geometry, observations, or engine config
 * - import the calibration barrel, engine, camera, or capture reducers
 */

import {
  createLateralReachCalibrationAttemptIntention,
  type LateralReachCalibrationAttemptIntention,
} from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";

export type LateralReachCalibrationAttemptPlan = {
  readonly screenHorizontalDirection: "positive_x" | "negative_x";
};

const RANGE_ERROR_MESSAGE =
  'screenHorizontalDirection must be exactly "positive_x" or "negative_x"';

/**
 * Resolve a pre-movement attempt plan into the canonical Slice 8 intention.
 * Reads only screenHorizontalDirection; unrelated extra fields are ignored.
 */
export function resolveLateralReachCalibrationAttemptIntentionFromPlan(
  plan: unknown,
): LateralReachCalibrationAttemptIntention {
  const direction =
    plan !== null && typeof plan === "object" && !Array.isArray(plan)
      ? (plan as { screenHorizontalDirection?: unknown }).screenHorizontalDirection
      : undefined;

  let sign: 1 | -1;
  if (direction === "positive_x") {
    sign = 1;
  } else if (direction === "negative_x") {
    sign = -1;
  } else {
    throw new RangeError(RANGE_ERROR_MESSAGE);
  }

  return createLateralReachCalibrationAttemptIntention(sign);
}
