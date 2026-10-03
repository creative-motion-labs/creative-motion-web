/**
 * Consecutive-frame confirmation for battery-style rest→peak→rest cycles.
 * Angle thresholds stay in each test's own contract; this module only
 * counts valid frames.
 */

export const MOVEMENT_REP_CONFIRM_MIN_TICKS = 5;

export type MovementRepConfirmationState = {
  restStreak: number;
  peakStreak: number;
  cycleArmed: boolean;
  hasReachedPeakThisRep: boolean;
  consecutiveUnusableFrames: number;
};

export function createMovementRepConfirmationState(): Pick<
  MovementRepConfirmationState,
  "restStreak" | "peakStreak" | "cycleArmed"
> {
  return {
    restStreak: 0,
    peakStreak: 0,
    cycleArmed: false,
  };
}

export function resetMovementRepConfirmation(
  state: MovementRepConfirmationState,
): void {
  state.restStreak = 0;
  state.peakStreak = 0;
  state.cycleArmed = false;
  state.hasReachedPeakThisRep = false;
  state.consecutiveUnusableFrames = 0;
}

export function noteUnusableConfirmationFrame(
  state: MovementRepConfirmationState,
  poseLostUnknownMinTicks: number,
): boolean {
  state.restStreak = 0;
  state.peakStreak = 0;
  state.consecutiveUnusableFrames += 1;
  if (state.consecutiveUnusableFrames >= poseLostUnknownMinTicks) {
    state.cycleArmed = false;
    state.hasReachedPeakThisRep = false;
    return true;
  }
  return false;
}

export function noteUsableRestPeakFrame(
  state: MovementRepConfirmationState,
  input: { inRest: boolean; inPeak: boolean },
): { restConfirmed: boolean; peakConfirmed: boolean; shouldCountRep: boolean } {
  state.consecutiveUnusableFrames = 0;
  state.restStreak = input.inRest ? state.restStreak + 1 : 0;
  state.peakStreak = input.inPeak ? state.peakStreak + 1 : 0;

  const restConfirmed = state.restStreak >= MOVEMENT_REP_CONFIRM_MIN_TICKS;
  const peakConfirmed = state.peakStreak >= MOVEMENT_REP_CONFIRM_MIN_TICKS;
  let shouldCountRep = false;

  if (restConfirmed) {
    shouldCountRep = state.cycleArmed && state.hasReachedPeakThisRep;
    state.cycleArmed = true;
    state.hasReachedPeakThisRep = false;
  } else if (peakConfirmed && state.cycleArmed) {
    state.hasReachedPeakThisRep = true;
  }

  return { restConfirmed, peakConfirmed, shouldCountRep };
}
