/**
 * Elbow Flexion — phase and rep FSM.
 * Tracks decreasing interior angle for flexion, increasing for return.
 */

import type { ElbowFlexionPhase, ElbowFlexionThresholds } from "./elbow-flexion-contract";

export type ElbowFlexionPhaseState = {
  phase: ElbowFlexionPhase;
  repCount: number;
  peakFlexionAngleDegrees: number | null;
  hasReachedPeakThisRep: boolean;
  consecutiveUnusableFrames: number;
  completedPeaksDeg: number[];
};

export function createElbowFlexionPhaseState(): ElbowFlexionPhaseState {
  return {
    phase: "resting",
    repCount: 0,
    peakFlexionAngleDegrees: null,
    hasReachedPeakThisRep: false,
    consecutiveUnusableFrames: 0,
    completedPeaksDeg: [],
  };
}

export function resetElbowFlexionPhaseState(state: ElbowFlexionPhaseState): void {
  state.phase = "resting";
  state.repCount = 0;
  state.peakFlexionAngleDegrees = null;
  state.hasReachedPeakThisRep = false;
  state.consecutiveUnusableFrames = 0;
  state.completedPeaksDeg = [];
}

function updatePeak(state: ElbowFlexionPhaseState, angleDegrees: number): void {
  state.peakFlexionAngleDegrees =
    state.peakFlexionAngleDegrees === null
      ? angleDegrees
      : Math.min(state.peakFlexionAngleDegrees, angleDegrees);
}

export function tickElbowFlexionPhase(
  state: ElbowFlexionPhaseState,
  interiorAngleDegrees: number | null,
  thresholds: ElbowFlexionThresholds,
): void {
  if (interiorAngleDegrees === null) {
    state.consecutiveUnusableFrames += 1;
    if (state.consecutiveUnusableFrames >= thresholds.poseLostUnknownMinTicks) {
      state.phase = "unknown";
    }
    return;
  }

  state.consecutiveUnusableFrames = 0;
  const peakRaiseThreshold =
    thresholds.peakMaxInteriorAngleDegrees + thresholds.peakRaiseHysteresisDegrees;

  switch (state.phase) {
    case "resting":
    case "unknown": {
      if (interiorAngleDegrees < thresholds.restingMinInteriorAngleDegrees) {
        state.phase = "flexing";
        state.peakFlexionAngleDegrees = interiorAngleDegrees;
        state.hasReachedPeakThisRep = false;
      } else {
        state.phase = "resting";
      }
      break;
    }
    case "flexing": {
      updatePeak(state, interiorAngleDegrees);
      if (interiorAngleDegrees <= thresholds.peakMaxInteriorAngleDegrees) {
        state.phase = "peak_flexion";
        state.hasReachedPeakThisRep = true;
      } else if (interiorAngleDegrees >= thresholds.restingMinInteriorAngleDegrees) {
        state.phase = "resting";
      }
      break;
    }
    case "peak_flexion": {
      updatePeak(state, interiorAngleDegrees);
      if (interiorAngleDegrees > peakRaiseThreshold) {
        state.phase = "extending";
      }
      break;
    }
    case "extending": {
      updatePeak(state, interiorAngleDegrees);
      if (interiorAngleDegrees <= thresholds.peakMaxInteriorAngleDegrees) {
        state.phase = "peak_flexion";
      } else if (interiorAngleDegrees >= thresholds.restingMinInteriorAngleDegrees) {
        state.phase = "resting";
        if (state.hasReachedPeakThisRep) {
          state.repCount += 1;
          if (state.peakFlexionAngleDegrees !== null) {
            state.completedPeaksDeg.push(state.peakFlexionAngleDegrees);
          }
        }
        state.hasReachedPeakThisRep = false;
      }
      break;
    }
  }
}
