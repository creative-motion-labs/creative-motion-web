/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/elbow-flexion-phase.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ELBOW_FLEXION_THRESHOLDS } from "./elbow-flexion-contract";
import {
  createElbowFlexionPhaseState,
  tickElbowFlexionPhase,
} from "./elbow-flexion-phase";

describe("elbow flexion phase FSM", () => {
  it("counts exactly three valid reps", () => {
    const state = createElbowFlexionPhaseState();
    const cycle = [150, 120, 80, 80, 120, 150];
    for (let rep = 0; rep < 3; rep += 1) {
      for (const angle of cycle) {
        tickElbowFlexionPhase(state, angle, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
      }
    }
    assert.equal(state.repCount, 3);
    assert.equal(state.completedPeaksDeg.length, 3);
  });

  it("does not count duplicate reps while holding peak flexion", () => {
    const state = createElbowFlexionPhaseState();
    const sequence = [150, 120, 70, 70, 70, 120, 150];
    for (const angle of sequence) {
      tickElbowFlexionPhase(state, angle, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    }
    assert.equal(state.repCount, 1);
  });

  it("requires extension return before another rep counts", () => {
    const state = createElbowFlexionPhaseState();
    const sequence = [150, 120, 70, 120, 100, 70, 120, 150];
    for (const angle of sequence) {
      tickElbowFlexionPhase(state, angle, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    }
    assert.equal(state.repCount, 1);
  });

  it("does not count a rep after tracking loss", () => {
    const state = createElbowFlexionPhaseState();
    tickElbowFlexionPhase(state, 150, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    tickElbowFlexionPhase(state, 120, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    tickElbowFlexionPhase(state, 70, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    for (let i = 0; i < DEFAULT_ELBOW_FLEXION_THRESHOLDS.poseLostUnknownMinTicks; i += 1) {
      tickElbowFlexionPhase(state, null, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    }
    tickElbowFlexionPhase(state, 150, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
    assert.equal(state.repCount, 0);
  });
});
