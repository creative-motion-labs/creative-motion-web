/**
 * Lateral Reach interaction-calibration — Slice 8: attempt intention.
 *
 * Pre-movement screen-space expected horizontal direction for one calibration
 * attempt. Established upstream BEFORE observed calibration movement.
 *
 * This is NOT wrist-side metadata, anatomical side, observed motion, frozen
 * geometry direction, or engine technical direction.
 *
 * Does NOT:
 * - infer direction from wrist-side metadata, observations, or geometry
 * - invent defaults
 * - import engine, capture devices, or view layers
 */

export type LateralReachCalibrationAttemptIntention = {
  readonly expectedHorizontalDirectionSign: 1 | -1;
};

/**
 * Canonical minting/validation gate for calibration attempt intention.
 * Accepts only exact runtime values 1 and -1; everything else fails closed.
 */
export function createLateralReachCalibrationAttemptIntention(
  expectedHorizontalDirectionSign: unknown,
): LateralReachCalibrationAttemptIntention {
  if (
    expectedHorizontalDirectionSign !== 1 &&
    expectedHorizontalDirectionSign !== -1
  ) {
    throw new RangeError(
      "expectedHorizontalDirectionSign must be exactly 1 or -1",
    );
  }

  return {
    expectedHorizontalDirectionSign,
  };
}
