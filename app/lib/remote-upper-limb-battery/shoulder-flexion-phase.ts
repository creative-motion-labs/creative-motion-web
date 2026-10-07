/**
 * Shoulder Flexion — phase and rep FSM.
 * Same threshold-crossing pattern as abduction, distinct elevation metric.
 * Reps require confirmed rest, then confirmed peak, then confirmed return.
 */

import {
  createMovementRepConfirmationState,
  noteUnusableConfirmationFrame,
  noteUsableRestPeakFrame,
  resetMovementRepConfirmation,
} from "@/app/lib/movement-rep-confirmation";
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
  restStreak: number;
  peakStreak: number;
  cycleArmed: boolean;
};

export function createShoulderFlexionPhaseState(): ShoulderFlexionPhaseState {
  return {
    phase: "resting",
    repCount: 0,
    peakElevationDegrees: null,
    hasReachedPeakThisRep: false,
    consecutiveUnusableFrames: 0,
    completedPeaksDeg: [],
    ...createMovementRepConfirmationState(),
  };
}

export function resetShoulderFlexionPhaseState(state: ShoulderFlexionPhaseState): void {
  state.phase = "resting";
  state.repCount = 0;
  state.peakElevationDegrees = null;
  state.completedPeaksDeg = [];
  resetMovementRepConfirmation(state);
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
    if (noteUnusableConfirmationFrame(state, thresholds.poseLostUnknownMinTicks)) {
      state.phase = "unknown";
    }
    return;
  }

  const inRest = elevationDegrees <= thresholds.restingMaxElevationDegrees;
  const inPeak = elevationDegrees >= thresholds.peakMinElevationDegrees;
  if (!inRest) {
    if (state.phase === "resting" || state.phase === "unknown") {
      state.peakElevationDegrees = elevationDegrees;
    } else {
      updatePeak(state, elevationDegrees);
    }
  }

  const { peakConfirmed, shouldCountRep } = noteUsableRestPeakFrame(state, {
    inRest,
    inPeak,
  });

  if (shouldCountRep) {
    state.repCount += 1;
    if (state.peakElevationDegrees !== null) {
      state.completedPeaksDeg.push(state.peakElevationDegrees);
    }
  }

  if (inRest) {
    state.phase = "resting";
    return;
  }
  if (peakConfirmed) {
    state.phase = "peak_flexion";
    return;
  }
  if (state.hasReachedPeakThisRep) {
    state.phase = "lowering";
    return;
  }
  if (!inRest) {
    state.phase = "raising";
  }
}
