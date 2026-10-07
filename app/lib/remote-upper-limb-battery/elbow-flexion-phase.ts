/**
 * Elbow Flexion — phase and rep FSM.
 * Tracks decreasing interior angle for flexion, increasing for return.
 * Reps require confirmed rest, then confirmed peak, then confirmed return.
 */

import {
  createMovementRepConfirmationState,
  noteUnusableConfirmationFrame,
  noteUsableRestPeakFrame,
  resetMovementRepConfirmation,
} from "@/app/lib/movement-rep-confirmation";
import type { ElbowFlexionPhase, ElbowFlexionThresholds } from "./elbow-flexion-contract";

export type ElbowFlexionPhaseState = {
  phase: ElbowFlexionPhase;
  repCount: number;
  peakFlexionAngleDegrees: number | null;
  hasReachedPeakThisRep: boolean;
  consecutiveUnusableFrames: number;
  completedPeaksDeg: number[];
  restStreak: number;
  peakStreak: number;
  cycleArmed: boolean;
};

export function createElbowFlexionPhaseState(): ElbowFlexionPhaseState {
  return {
    phase: "resting",
    repCount: 0,
    peakFlexionAngleDegrees: null,
    hasReachedPeakThisRep: false,
    consecutiveUnusableFrames: 0,
    completedPeaksDeg: [],
    ...createMovementRepConfirmationState(),
  };
}

export function resetElbowFlexionPhaseState(state: ElbowFlexionPhaseState): void {
  state.phase = "resting";
  state.repCount = 0;
  state.peakFlexionAngleDegrees = null;
  state.completedPeaksDeg = [];
  resetMovementRepConfirmation(state);
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
    if (noteUnusableConfirmationFrame(state, thresholds.poseLostUnknownMinTicks)) {
      state.phase = "unknown";
    }
    return;
  }

  const inRest = interiorAngleDegrees >= thresholds.restingMinInteriorAngleDegrees;
  const inPeak = interiorAngleDegrees <= thresholds.peakMaxInteriorAngleDegrees;
  if (!inRest) {
    if (state.phase === "resting" || state.phase === "unknown") {
      state.peakFlexionAngleDegrees = interiorAngleDegrees;
    } else {
      updatePeak(state, interiorAngleDegrees);
    }
  }

  const { peakConfirmed, shouldCountRep } = noteUsableRestPeakFrame(state, {
    inRest,
    inPeak,
  });

  if (shouldCountRep) {
    state.repCount += 1;
    if (state.peakFlexionAngleDegrees !== null) {
      state.completedPeaksDeg.push(state.peakFlexionAngleDegrees);
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
    state.phase = "extending";
    return;
  }
  if (!inRest) {
    state.phase = "flexing";
  }
}
