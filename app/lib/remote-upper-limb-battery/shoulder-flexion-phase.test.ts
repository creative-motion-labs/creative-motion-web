/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/shoulder-flexion-phase.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SHOULDER_FLEXION_THRESHOLDS } from "./shoulder-flexion-contract";
import {
  createShoulderFlexionPhaseState,
  tickShoulderFlexionPhase,
} from "./shoulder-flexion-phase";

function runRepSequence(angles: number[]): number {
  const state = createShoulderFlexionPhaseState();
  for (const angle of angles) {
    tickShoulderFlexionPhase(state, angle, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
  }
  return state.repCount;
}

describe("shoulder flexion phase FSM", () => {
  it("counts exactly three valid reps", () => {
    const state = createShoulderFlexionPhaseState();
    const cycle = [15, 40, 65, 65, 40, 15];
    for (let rep = 0; rep < 3; rep += 1) {
      for (const angle of cycle) {
        tickShoulderFlexionPhase(state, angle, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
      }
    }
    assert.equal(state.repCount, 3);
    assert.equal(state.completedPeaksDeg.length, 3);
  });

  it("does not count duplicate reps while holding at peak", () => {
    const reps = runRepSequence([15, 40, 70, 70, 70, 70, 40, 15]);
    assert.equal(reps, 1);
  });

  it("requires return to start before another rep can count", () => {
    const state = createShoulderFlexionPhaseState();
    const partial = [15, 40, 70, 40, 50, 70, 40, 15];
    for (const angle of partial) {
      tickShoulderFlexionPhase(state, angle, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
    }
    assert.equal(state.repCount, 1);
  });

  it("does not count a rep when tracking is lost mid-movement", () => {
    const state = createShoulderFlexionPhaseState();
    tickShoulderFlexionPhase(state, 15, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
    tickShoulderFlexionPhase(state, 40, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
    tickShoulderFlexionPhase(state, 70, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
    for (let i = 0; i < DEFAULT_SHOULDER_FLEXION_THRESHOLDS.poseLostUnknownMinTicks; i += 1) {
      tickShoulderFlexionPhase(state, null, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
    }
    tickShoulderFlexionPhase(state, 15, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
    assert.equal(state.repCount, 0);
  });
});
