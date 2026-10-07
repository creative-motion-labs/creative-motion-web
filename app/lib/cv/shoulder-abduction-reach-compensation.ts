/**
 * Shoulder Abduction Reach — trunk-lean compensation proxy (v0).
 *
 * A minimal, clearly-labeled proxy: horizontal drift of the same-side
 * hip→shoulder offset away from a resting-phase baseline. This is a
 * technical geometric observation from a single camera view — not a
 * validated clinical compensation measure. Threshold defaults are neutral
 * placeholders and require clinical calibration before any production use
 * (matching the disclaimer pattern already used by
 * `postural-alignment-proxy.ts` elsewhere in this codebase).
 *
 * Deliberately does not attempt bilateral hip/shoulder midpoint tracking —
 * that would be a more complete trunk-lean signal, but the same-side
 * hip→shoulder vector already used by this exercise's own angle
 * computation is the smallest signal that says something real about trunk
 * displacement without introducing new joint dependencies.
 */

import {
  computeJointDistance,
  computeRelativeJointOffset,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence";
import {
  SHOULDER_ABDUCTION_REACH_CORE_JOINTS,
  type ShoulderAbductionReachSide,
} from "@/app/lib/shoulder-rehabilitation";

export type ShoulderAbductionReachCompensationThresholds = {
  /** Horizontal hip->shoulder offset drift (normalized 0-1 units) beyond baseline that flags compensation. PLACEHOLDER — requires clinical calibration. */
  trunkLeanFlagDelta: number;
  /** Hysteresis: drift must fall back below (flagDelta - clearHysteresis) to clear. */
  clearHysteresis: number;
  /** Minimum joint confidence to trust the offset. */
  minConfidence: number;
};

/** PLACEHOLDER defaults — not clinically validated. See module doc comment. */
export const DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS: ShoulderAbductionReachCompensationThresholds =
  {
    trunkLeanFlagDelta: 0.08,
    clearHysteresis: 0.02,
    minConfidence: 0.4,
  };

export type ShoulderAbductionReachCompensationState = {
  /** Resting-phase hip->shoulder deltaX, captured once per session per side. Null until captured. */
  baselineDeltaX: number | null;
  flagged: boolean;
};

export function createShoulderAbductionReachCompensationState(): ShoulderAbductionReachCompensationState {
  return { baselineDeltaX: null, flagged: false };
}

export type ShoulderAbductionReachCompensationStatus =
  | "unavailable"
  | "baseline_captured"
  | "clear"
  | "flagged";

/**
 * Advance the compensation proxy by one frame. Mutates `state` in place,
 * matching the mutate-in-place convention already used by
 * `tickShoulderAbductionReachPhase`. Returns the current status — callers
 * (e.g. the pose-detector wrapper) are responsible for diffing against the
 * previous call's status to emit discrete "detected"/"cleared" events; this
 * function itself is a pure status read, not an event emitter.
 *
 * `isRestingPhase` must be supplied by the caller (from the existing phase
 * state machine) — this module has no knowledge of phase/angle logic,
 * matching `shoulder-abduction-reach-phase.ts`'s existing separation of
 * concerns.
 */
export function updateShoulderAbductionReachCompensation(
  state: ShoulderAbductionReachCompensationState,
  frame: NormalizedMotionFrame,
  side: ShoulderAbductionReachSide,
  isRestingPhase: boolean,
  thresholds: ShoulderAbductionReachCompensationThresholds = DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS,
): ShoulderAbductionReachCompensationStatus {
  const { hip, shoulder } = SHOULDER_ABDUCTION_REACH_CORE_JOINTS[side];
  const offset = computeRelativeJointOffset(frame, hip, shoulder, {
    minVisibility: thresholds.minConfidence,
  });

  if (!offset) {
    return "unavailable";
  }

  if (state.baselineDeltaX === null) {
    if (isRestingPhase) {
      state.baselineDeltaX = offset.deltaX;
      return "baseline_captured";
    }
    return "unavailable";
  }

  const drift = Math.abs(offset.deltaX - state.baselineDeltaX);
  const clearThreshold = Math.max(0, thresholds.trunkLeanFlagDelta - thresholds.clearHysteresis);

  if (state.flagged) {
    if (drift <= clearThreshold) {
      state.flagged = false;
      return "clear";
    }
    return "flagged";
  }

  if (drift >= thresholds.trunkLeanFlagDelta) {
    state.flagged = true;
    return "flagged";
  }

  return "clear";
}

/**
 * Minimum usable inter-shoulder distance (normalized 0-1 units) before a
 * normalized ratio is considered reliable. Guards against a near-zero
 * denominator when the shoulders are heavily foreshortened (e.g. the
 * patient turned near-sideways to the camera), which would blow the ratio
 * up arbitrarily instead of reflecting real trunk drift.
 */
export const MIN_USABLE_SHOULDER_WIDTH_NORMALIZED = 0.05;

export type ShoulderAbductionReachNormalizedTrunkDrift = {
  /** abs(hip->shoulder deltaX drift from baseline) / inter-shoulder distance, same frame. Unitless. */
  ratio: number;
  /** Inter-shoulder distance used as the scale reference (normalized 0-1 units). */
  shoulderWidthNormalized: number;
};

/**
 * Scale-normalized trunk-drift feature — RESEARCH/ML USE ONLY. Not wired
 * into `updateShoulderAbductionReachCompensation`'s flagging state machine
 * or its threshold. Slice 1 of the RASQ ML bridge (2026-08-19) adds this as
 * a separate, additive feature specifically so the existing flag/threshold
 * behavior above does not change; see the project report for why.
 *
 * WHY THIS NORMALIZATION IS NEEDED
 * ---------------------------------
 * The raw signal above (`offset.deltaX - baselineDeltaX`) is a horizontal
 * drift in normalized IMAGE-space pixels, with no notion of how close the
 * patient is to the camera or how large they appear on screen. The same
 * real-world trunk lean produces a bigger raw number for a patient standing
 * closer to the camera and a smaller one farther away — camera distance and
 * body size are confounded with the thing being measured. That confound has
 * to be divided out before this signal is trustworthy ML training input.
 *
 * WHY INTER-SHOULDER DISTANCE AS THE SCALE REFERENCE
 * ----------------------------------------------------
 * Two other readily available candidates were rejected:
 *  - Torso length (hip<->shoulder) reuses the same joints as the drift
 *    signal's own numerator (`offset` is a hip->shoulder vector), so a
 *    genuine lean would shift the scale reference at the same time it
 *    shifts the numerator — a self-defeating, non-independent measure.
 *  - Estimated arm length (`estimateShoulderAbductionReachArmLength`)
 *    foreshortens as the reaching arm moves through depth during the very
 *    rep being measured, so it is not stable *during* the movement this
 *    feature characterizes.
 * Inter-shoulder distance (`left_shoulder` <-> `right_shoulder`) uses two
 * joints unrelated to the drift calculation, stays close to constant while
 * one arm reaches out to the side, and scales linearly with both camera
 * distance and body size — exactly the two confounds this normalization
 * needs to cancel.
 *
 * Returns null (never a fabricated or clamped value) when either joint pair
 * is unavailable, or when inter-shoulder distance falls below
 * `MIN_USABLE_SHOULDER_WIDTH_NORMALIZED`.
 *
 * `baselineDeltaX` is supplied by the caller — this function does not
 * capture or store a baseline itself, matching the existing separation of
 * concerns where phase/baseline state lives with the caller (compare
 * `updateShoulderAbductionReachCompensation`, which owns its own baseline
 * capture because it is a stateful session-long proxy; this function is a
 * stateless per-frame reader so a research recorder can supply whatever
 * baseline convention it needs without this module owning session state).
 */
export function computeShoulderAbductionReachNormalizedTrunkDrift(
  frame: NormalizedMotionFrame,
  side: ShoulderAbductionReachSide,
  baselineDeltaX: number,
  minConfidence: number = DEFAULT_SHOULDER_ABDUCTION_REACH_COMPENSATION_THRESHOLDS.minConfidence,
): ShoulderAbductionReachNormalizedTrunkDrift | null {
  const { hip, shoulder } = SHOULDER_ABDUCTION_REACH_CORE_JOINTS[side];
  const offset = computeRelativeJointOffset(frame, hip, shoulder, { minVisibility: minConfidence });
  if (!offset) {
    return null;
  }

  const shoulderWidthNormalized = computeJointDistance(frame, "left_shoulder", "right_shoulder", {
    minVisibility: minConfidence,
  });
  if (
    shoulderWidthNormalized === null ||
    shoulderWidthNormalized < MIN_USABLE_SHOULDER_WIDTH_NORMALIZED
  ) {
    return null;
  }

  const drift = Math.abs(offset.deltaX - baselineDeltaX);
  return {
    ratio: drift / shoulderWidthNormalized,
    shoulderWidthNormalized,
  };
}
