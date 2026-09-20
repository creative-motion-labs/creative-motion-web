/**
 * Shoulder Flexion — phase and rep FSM.
 * Same threshold-crossing pattern as abduction, distinct elevation metric.
 */

import type {
  ShoulderFlexionPhase,
  ShoulderFlexionThresholds,
} from "./shoulder-flexion-contract";

export type ShoulderFlexionPhaseState = {
  phase: ShoulderFlexionPhase;
  repCount: number;
  peakElevationDegrees: number | null;
  hasReachedPeakThisRep: boolean;
  consecutiveUnusableFrames: number;
  completedPeaksDeg: number[];
};

export function createShoulderFlexionPhaseState(): ShoulderFlexionPhaseState {
  return {
    phase: "resting",
    repCount: 0,
    peakElevationDegrees: null,
    hasReachedPeakThisRep: false,
    consecutiveUnusableFrames: 0,
    completedPeaksDeg: [],
  };
}

export function resetShoulderFlexionPhaseState(state: ShoulderFlexionPhaseState): void {
  state.phase = "resting";
  state.repCount = 0;
  state.peakElevationDegrees = null;
  state.hasReachedPeakThisRep = false;
  state.consecutiveUnusableFrames = 0;
  state.completedPeaksDeg = [];
}

function updatePeak(state: ShoulderFlexionPhaseState, elevationDegrees: number): void {
  state.peakElevationDegrees =
    state.peakElevationDegrees === null
      ? elevationDegrees
      : Math.max(state.peakElevationDegrees, elevationDegrees);
}

export function tickShoulderFlexionPhase(
  state: ShoulderFlexionPhaseState,
  elevationDegrees: number | null,
  thresholds: ShoulderFlexionThresholds,
): void {
  if (elevationDegrees === null) {
    state.consecutiveUnusableFrames += 1;
    if (state.consecutiveUnusableFrames >= thresholds.poseLostUnknownMinTicks) {
      state.phase = "unknown";
    }
    return;
  }

  state.consecutiveUnusableFrames = 0;
  const peakLowerThreshold =
    thresholds.peakMinElevationDegrees - thresholds.peakLowerHysteresisDegrees;

  switch (state.phase) {
    case "resting":
    case "unknown": {
      if (elevationDegrees > thresholds.restingMaxElevationDegrees) {
        state.phase = "raising";
        state.peakElevationDegrees = elevationDegrees;
        state.hasReachedPeakThisRep = false;
      } else {
        state.phase = "resting";
      }
      break;
    }
    case "raising": {
      updatePeak(state, elevationDegrees);
      if (elevationDegrees >= thresholds.peakMinElevationDegrees) {
        state.phase = "peak_flexion";
        state.hasReachedPeakThisRep = true;
      } else if (elevationDegrees <= thresholds.restingMaxElevationDegrees) {
        state.phase = "resting";
      }
      break;
    }
    case "peak_flexion": {
      updatePeak(state, elevationDegrees);
      if (elevationDegrees < peakLowerThreshold) {
        state.phase = "lowering";
      }
      break;
    }
    case "lowering": {
      updatePeak(state, elevationDegrees);
      if (elevationDegrees >= thresholds.peakMinElevationDegrees) {
        state.phase = "peak_flexion";
      } else if (elevationDegrees <= thresholds.restingMaxElevationDegrees) {
        state.phase = "resting";
        if (state.hasReachedPeakThisRep) {
          state.repCount += 1;
          if (state.peakElevationDegrees !== null) {
            state.completedPeaksDeg.push(state.peakElevationDegrees);
          }
        }
        state.hasReachedPeakThisRep = false;
      }
      break;
    }
  }
}
