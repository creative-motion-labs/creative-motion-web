/**
 * Run: npx tsx --test app/lib/shoulder-rehabilitation/shoulder-abduction-reach-phase.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOVEMENT_REP_CONFIRM_MIN_TICKS } from "@/app/lib/movement-rep-confirmation";
import { DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS } from "./shoulder-abduction-reach-contract";
import {
  createShoulderAbductionReachPhaseState,
  resetShoulderAbductionReachPhaseState,
  tickShoulderAbductionReachPhase,
} from "./shoulder-abduction-reach-phase";

const THRESHOLDS = DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS;
const N = MOVEMENT_REP_CONFIRM_MIN_TICKS;
const REST = 10;
const PEAK = 80;

function hold(value: number | null, ticks = N): Array<number | null> {
  return Array.from({ length: ticks }, () => value);
}

function runSequence(angles: readonly (number | null)[]) {
  const state = createShoulderAbductionReachPhaseState();
  for (const angle of angles) {
    tickShoulderAbductionReachPhase(state, angle, THRESHOLDS);
  }
  return state;
}

function confirmedCycle(): number[] {
  return [...hold(REST), ...hold(PEAK), ...hold(REST)] as number[];
}

describe("tickShoulderAbductionReachPhase — full rep", () => {
  it("counts one rep for confirmed rest → confirmed peak → confirmed return", () => {
    const state = runSequence(confirmedCycle());
    assert.equal(state.phase, "resting");
    assert.equal(state.repCount, 1);
    assert.equal(state.peakAngleDegrees, PEAK);
  });

  it("starts fresh from the initial state", () => {
    const state = createShoulderAbductionReachPhaseState();
    assert.equal(state.phase, "resting");
    assert.equal(state.repCount, 0);
    assert.equal(state.peakAngleDegrees, null);
    assert.equal(state.cycleArmed, false);
  });
});

describe("tickShoulderAbductionReachPhase — false-rep guards", () => {
  it("does not count a one-frame peak spike", () => {
    assert.equal(runSequence([...hold(REST), PEAK, ...hold(REST)]).repCount, 0);
  });

  it("does not complete a rep on a one-frame rest spike", () => {
    assert.equal(runSequence([...hold(REST), ...hold(PEAK), REST, ...hold(PEAK)]).repCount, 0);
  });

  it("does not count when starting already elevated then lowering to rest", () => {
    const state = runSequence([...hold(PEAK), ...hold(REST)]);
    assert.equal(state.repCount, 0);
    assert.equal(state.cycleArmed, true);
  });

  it("does not double-count while holding still", () => {
    assert.equal(runSequence(hold(REST, N * 4)).repCount, 0);
    assert.equal(runSequence([...hold(REST), ...hold(PEAK, N * 4)]).repCount, 0);
    assert.equal(runSequence([...hold(REST), ...hold(PEAK, N * 4), ...hold(REST)]).repCount, 1);
  });

  it("does not count a partial attempt that never confirms peak", () => {
    const state = runSequence([...hold(REST), ...hold(40), ...hold(REST)]);
    assert.equal(state.repCount, 0);
  });
});

describe("tickShoulderAbductionReachPhase — consecutive reps", () => {
  it("counts two independent confirmed reps back to back", () => {
    const state = runSequence([...confirmedCycle(), ...hold(PEAK), ...hold(REST)]);
    assert.equal(state.repCount, 2);
  });
});

describe("tickShoulderAbductionReachPhase — unusable frames", () => {
  it("freezes the current phase for brief dropouts under the unknown threshold", () => {
    const state = runSequence([...hold(REST), ...hold(PEAK), null, null, null]);
    assert.equal(state.phase, "peak_abduction");
  });

  it("moves to unknown after poseLostUnknownMinTicks consecutive unusable frames", () => {
    const state = runSequence([
      ...hold(REST),
      ...hold(PEAK),
      ...hold(null, THRESHOLDS.poseLostUnknownMinTicks),
    ]);
    assert.equal(state.phase, "unknown");
  });

  it("resumes tracking from unknown once a usable angle returns", () => {
    const state = runSequence([
      REST,
      ...hold(null, THRESHOLDS.poseLostUnknownMinTicks),
      REST,
    ]);
    assert.equal(state.phase, "resting");
  });

  it("resets the unusable-frame counter as soon as a usable angle arrives", () => {
    const state = createShoulderAbductionReachPhaseState();
    for (let i = 0; i < THRESHOLDS.poseLostUnknownMinTicks - 1; i += 1) {
      tickShoulderAbductionReachPhase(state, null, THRESHOLDS);
    }
    assert.equal(state.phase, "resting");
    tickShoulderAbductionReachPhase(state, REST, THRESHOLDS);
    assert.equal(state.consecutiveUnusableFrames, 0);
  });

  it("does not let unusable frames contribute to rest or peak confirmation", () => {
    const mixedPeak = [
      ...hold(REST),
      ...hold(PEAK, N - 1),
      null,
      ...hold(PEAK, N - 1),
      ...hold(REST),
    ];
    assert.equal(runSequence(mixedPeak).repCount, 0);
  });
});

describe("resetShoulderAbductionReachPhaseState", () => {
  it("restores the initial state", () => {
    const state = runSequence(confirmedCycle());
    resetShoulderAbductionReachPhaseState(state);
    assert.equal(state.phase, "resting");
    assert.equal(state.repCount, 0);
    assert.equal(state.peakAngleDegrees, null);
    assert.equal(state.hasReachedPeakThisRep, false);
    assert.equal(state.cycleArmed, false);
    assert.equal(state.consecutiveUnusableFrames, 0);
  });
});
