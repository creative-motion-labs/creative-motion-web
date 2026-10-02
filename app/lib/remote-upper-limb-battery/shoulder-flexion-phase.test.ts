/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/shoulder-flexion-phase.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOVEMENT_REP_CONFIRM_MIN_TICKS } from "@/app/lib/movement-rep-confirmation";
import { DEFAULT_SHOULDER_FLEXION_THRESHOLDS } from "./shoulder-flexion-contract";
import {
  createShoulderFlexionPhaseState,
  tickShoulderFlexionPhase,
} from "./shoulder-flexion-phase";

const N = MOVEMENT_REP_CONFIRM_MIN_TICKS;
const REST = 15;
const PEAK = 70;

function hold(value: number | null, ticks = N): Array<number | null> {
  return Array.from({ length: ticks }, () => value);
}

function runRepSequence(angles: Array<number | null>): ReturnType<typeof createShoulderFlexionPhaseState> {
  const state = createShoulderFlexionPhaseState();
  for (const angle of angles) {
    tickShoulderFlexionPhase(state, angle, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
  }
  return state;
}

function confirmedCycle(): number[] {
  return [...hold(REST), ...hold(PEAK), ...hold(REST)] as number[];
}

describe("shoulder flexion phase FSM", () => {
  it("counts exactly three valid sustained reps", () => {
    const state = createShoulderFlexionPhaseState();
    for (let rep = 0; rep < 3; rep += 1) {
      for (const angle of confirmedCycle()) {
        tickShoulderFlexionPhase(state, angle, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
      }
    }
    assert.equal(state.repCount, 3);
    assert.equal(state.completedPeaksDeg.length, 3);
  });

  it("counts a real sustained rest→peak→rest cycle exactly once", () => {
    const state = runRepSequence(confirmedCycle());
    assert.equal(state.repCount, 1);
    assert.equal(state.phase, "resting");
  });

  it("does not count a one-frame peak spike", () => {
    const state = runRepSequence([...hold(REST), PEAK, ...hold(REST)]);
    assert.equal(state.repCount, 0);
  });

  it("does not complete a rep on a one-frame rest spike", () => {
    const state = runRepSequence([...hold(REST), ...hold(PEAK), REST, ...hold(PEAK)]);
    assert.equal(state.repCount, 0);
  });

  it("does not count when starting already elevated then lowering to rest", () => {
    const state = runRepSequence([...hold(PEAK), ...hold(REST)]);
    assert.equal(state.repCount, 0);
    assert.equal(state.cycleArmed, true);
  });

  it("counts the next sustained cycle after an elevated start is disarmed at rest", () => {
    const state = runRepSequence([...hold(PEAK), ...hold(REST), ...hold(PEAK), ...hold(REST)]);
    assert.equal(state.repCount, 1);
  });

  it("does not double-count while holding still at rest or peak", () => {
    const restHold = runRepSequence(hold(REST, N * 4));
    assert.equal(restHold.repCount, 0);
    const peakHold = runRepSequence([...hold(REST), ...hold(PEAK, N * 4)]);
    assert.equal(peakHold.repCount, 0);
    const afterReturn = runRepSequence([...hold(REST), ...hold(PEAK, N * 4), ...hold(REST)]);
    assert.equal(afterReturn.repCount, 1);
  });

  it("does not count a rep when tracking is lost mid-movement", () => {
    const state = runRepSequence([
      ...hold(REST),
      ...hold(PEAK),
      ...hold(null, DEFAULT_SHOULDER_FLEXION_THRESHOLDS.poseLostUnknownMinTicks),
      ...hold(REST),
    ]);
    assert.equal(state.repCount, 0);
  });
});
