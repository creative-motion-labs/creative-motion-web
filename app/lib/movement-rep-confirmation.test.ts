/**
 * Run: npx tsx --test app/lib/movement-rep-confirmation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOVEMENT_REP_CONFIRM_MIN_TICKS,
  createMovementRepConfirmationState,
  noteUnusableConfirmationFrame,
  noteUsableRestPeakFrame,
  type MovementRepConfirmationState,
} from "./movement-rep-confirmation";

const N = MOVEMENT_REP_CONFIRM_MIN_TICKS;
const POSE_LOST = 8;

function createState(): MovementRepConfirmationState {
  return {
    ...createMovementRepConfirmationState(),
    hasReachedPeakThisRep: false,
    consecutiveUnusableFrames: 0,
  };
}

function tick(
  state: MovementRepConfirmationState,
  input: { inRest: boolean; inPeak: boolean } | "unusable",
) {
  if (input === "unusable") {
    return { wentUnknown: noteUnusableConfirmationFrame(state, POSE_LOST) };
  }
  return noteUsableRestPeakFrame(state, input);
}

function hold(
  state: MovementRepConfirmationState,
  input: { inRest: boolean; inPeak: boolean },
  ticks = N,
) {
  let last = noteUsableRestPeakFrame(state, input);
  for (let i = 1; i < ticks; i += 1) {
    last = noteUsableRestPeakFrame(state, input);
  }
  return last;
}

describe("movement rep confirmation", () => {
  it("requires N consecutive valid rest frames before the cycle can arm", () => {
    const state = createState();
    for (let i = 0; i < N - 1; i += 1) {
      const result = tick(state, { inRest: true, inPeak: false });
      assert.equal("restConfirmed" in result && result.restConfirmed, false);
      assert.equal(state.cycleArmed, false);
    }
    const confirmed = tick(state, { inRest: true, inPeak: false });
    assert.equal("restConfirmed" in confirmed && confirmed.restConfirmed, true);
    assert.equal(state.cycleArmed, true);
  });

  it("does not count a one-frame peak spike", () => {
    const state = createState();
    hold(state, { inRest: true, inPeak: false });
    tick(state, { inRest: false, inPeak: true });
    const afterReturn = hold(state, { inRest: true, inPeak: false });
    assert.equal(afterReturn.shouldCountRep, false);
  });

  it("does not complete a rep on a one-frame rest spike", () => {
    const state = createState();
    hold(state, { inRest: true, inPeak: false });
    hold(state, { inRest: false, inPeak: true });
    const spike = tick(state, { inRest: true, inPeak: false });
    assert.equal(spike.shouldCountRep, false);
    hold(state, { inRest: false, inPeak: true });
    assert.equal(state.hasReachedPeakThisRep, true);
    assert.equal(state.cycleArmed, true);
  });

  it("does not count when starting already at peak then returning to rest", () => {
    const state = createState();
    hold(state, { inRest: false, inPeak: true });
    const afterLower = hold(state, { inRest: true, inPeak: false });
    assert.equal(afterLower.shouldCountRep, false);
    assert.equal(state.cycleArmed, true);
  });

  it("counts exactly once for a sustained rest→peak→rest cycle", () => {
    const state = createState();
    hold(state, { inRest: true, inPeak: false });
    hold(state, { inRest: false, inPeak: true });
    const counted = hold(state, { inRest: true, inPeak: false });
    assert.equal(counted.shouldCountRep, true);
    const stillResting = tick(state, { inRest: true, inPeak: false });
    assert.equal(stillResting.shouldCountRep, false);
  });

  it("does not double-count while holding still at rest or peak", () => {
    const state = createState();
    const restHold = hold(state, { inRest: true, inPeak: false }, N * 4);
    assert.equal(restHold.shouldCountRep, false);
    const peakHold = hold(state, { inRest: false, inPeak: true }, N * 4);
    assert.equal(peakHold.shouldCountRep, false);
    const returned = hold(state, { inRest: true, inPeak: false });
    assert.equal(returned.shouldCountRep, true);
    const extraRest = hold(state, { inRest: true, inPeak: false }, N * 2);
    assert.equal(extraRest.shouldCountRep, false);
  });

  it("does not let unusable frames contribute to confirmation streaks", () => {
    const state = createState();
    hold(state, { inRest: true, inPeak: false });
    hold(state, { inRest: false, inPeak: true }, N - 1);
    tick(state, "unusable");
    hold(state, { inRest: false, inPeak: true }, N - 1);
    const afterReturn = hold(state, { inRest: true, inPeak: false });
    assert.equal(afterReturn.shouldCountRep, false);
  });
});
