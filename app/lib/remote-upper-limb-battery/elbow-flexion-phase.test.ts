/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/elbow-flexion-phase.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOVEMENT_REP_CONFIRM_MIN_TICKS } from "@/app/lib/movement-rep-confirmation";
import { DEFAULT_ELBOW_FLEXION_THRESHOLDS } from "./elbow-flexion-contract";
import {
  createElbowFlexionPhaseState,
  tickElbowFlexionPhase,
} from "./elbow-flexion-phase";

const N = MOVEMENT_REP_CONFIRM_MIN_TICKS;
const REST = 150;
const PEAK = 70;

function hold(value: number | null, ticks = N): Array<number | null> {
  return Array.from({ length: ticks }, () => value);
}

function runSequence(angles: Array<number | null>) {
  const state = createElbowFlexionPhaseState();
  for (const angle of angles) {
    tickElbowFlexionPhase(state, angle, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
  }
  return state;
}

function confirmedCycle(): number[] {
  return [...hold(REST), ...hold(PEAK), ...hold(REST)] as number[];
}

describe("elbow flexion phase FSM", () => {
  it("counts exactly three valid sustained reps", () => {
    const state = createElbowFlexionPhaseState();
    for (let rep = 0; rep < 3; rep += 1) {
      for (const angle of confirmedCycle()) {
        tickElbowFlexionPhase(state, angle, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
      }
    }
    assert.equal(state.repCount, 3);
    assert.equal(state.completedPeaksDeg.length, 3);
  });

  it("counts a real sustained rest→peak→rest cycle exactly once", () => {
    assert.equal(runSequence(confirmedCycle()).repCount, 1);
  });

  it("does not count a one-frame peak spike", () => {
    assert.equal(runSequence([...hold(REST), PEAK, ...hold(REST)]).repCount, 0);
  });

  it("does not complete a rep on a one-frame rest spike", () => {
    assert.equal(runSequence([...hold(REST), ...hold(PEAK), REST, ...hold(PEAK)]).repCount, 0);
  });

  it("does not count when starting already flexed then extending to rest", () => {
    const state = runSequence([...hold(PEAK), ...hold(REST)]);
    assert.equal(state.repCount, 0);
    assert.equal(state.cycleArmed, true);
  });

  it("does not double-count while holding still", () => {
    assert.equal(runSequence(hold(REST, N * 4)).repCount, 0);
    assert.equal(runSequence([...hold(REST), ...hold(PEAK, N * 4)]).repCount, 0);
    assert.equal(runSequence([...hold(REST), ...hold(PEAK, N * 4), ...hold(REST)]).repCount, 1);
  });

  it("does not count a rep after tracking loss", () => {
    const state = runSequence([
      ...hold(REST),
      ...hold(PEAK),
      ...hold(null, DEFAULT_ELBOW_FLEXION_THRESHOLDS.poseLostUnknownMinTicks),
      ...hold(REST),
    ]);
    assert.equal(state.repCount, 0);
  });
});
