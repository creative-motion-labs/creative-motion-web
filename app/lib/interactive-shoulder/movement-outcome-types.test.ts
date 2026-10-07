/**
 * Run:
 *   npx tsx --test app/lib/interactive-shoulder/movement-outcome-types.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_SESSION_STATES,
  INTERACTIVE_SHOULDER_OUTCOME_ELIGIBLE_SESSION_STATES,
  isInteractiveShoulderOutcomeEligibleSessionState,
  isValidSessionState,
} from "./movement-outcome-types";

describe("isValidSessionState", () => {
  it("accepts every real SessionState value", () => {
    for (const state of ALL_SESSION_STATES) {
      assert.equal(isValidSessionState(state), true, state);
    }
  });

  it("rejects an unknown string", () => {
    assert.equal(isValidSessionState("finished"), false);
  });

  it("rejects non-string values", () => {
    assert.equal(isValidSessionState(null), false);
    assert.equal(isValidSessionState(undefined), false);
    assert.equal(isValidSessionState(42), false);
  });
});

describe("isInteractiveShoulderOutcomeEligibleSessionState", () => {
  it("accepts exactly completed — the MVP contract, nothing else", () => {
    assert.deepEqual([...INTERACTIVE_SHOULDER_OUTCOME_ELIGIBLE_SESSION_STATES], ["completed"]);
    assert.equal(isInteractiveShoulderOutcomeEligibleSessionState("completed"), true);
  });

  it("rejects every in-progress/mid-session state", () => {
    const midSession = [
      "idle",
      "preparing",
      "calibrating",
      "ready",
      "active",
      "resting",
      "transitioning",
      "paused",
      "safetyHold",
    ];
    for (const state of midSession) {
      assert.equal(
        isInteractiveShoulderOutcomeEligibleSessionState(state),
        false,
        `"${state}" must not be outcome-eligible`,
      );
    }
  });

  it("rejects stopped — a cancelled/manually/safety-stopped session is not a completed outcome (corrected per review)", () => {
    assert.equal(isInteractiveShoulderOutcomeEligibleSessionState("stopped"), false);
  });

  it("rejects the error state — a technical failure is not a movement outcome", () => {
    assert.equal(isInteractiveShoulderOutcomeEligibleSessionState("error"), false);
  });

  it("rejects unknown/malformed values", () => {
    assert.equal(isInteractiveShoulderOutcomeEligibleSessionState("done"), false);
    assert.equal(isInteractiveShoulderOutcomeEligibleSessionState(null), false);
  });
});
