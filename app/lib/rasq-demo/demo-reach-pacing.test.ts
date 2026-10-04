/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-reach-pacing.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_REACH_TARGET_ATTEMPT_TIMEOUT_MS,
  RASQ_DEMO_REACH_TARGET_DURATION_SECONDS,
  RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP,
  shouldCompleteDemoReachAfterExtraPresentation,
  shouldCompleteDemoReachAfterTargetHit,
  shouldPlayDemoReachMidInstruction,
} from "./demo-reach-pacing";

describe("demo reach pacing", () => {
  it("targets 8 presentations within ~90–105 seconds", () => {
    assert.ok(RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP >= 8 && RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP <= 10);
    assert.ok(
      RASQ_DEMO_REACH_TARGET_DURATION_SECONDS >= 90 && RASQ_DEMO_REACH_TARGET_DURATION_SECONDS <= 105,
    );
    const pacedWindowMs =
      RASQ_DEMO_REACH_TARGET_ATTEMPT_TIMEOUT_MS * RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP;
    assert.ok(pacedWindowMs >= 90_000 && pacedWindowMs <= 110_000);
  });

  it("ends the reach block after the cap target is hit", () => {
    assert.equal(shouldCompleteDemoReachAfterTargetHit(8), true);
    assert.equal(shouldCompleteDemoReachAfterTargetHit(7), false);
  });

  it("blocks extra target presentations beyond the cap", () => {
    assert.equal(shouldCompleteDemoReachAfterExtraPresentation(9), true);
    assert.equal(shouldCompleteDemoReachAfterExtraPresentation(8), false);
  });

  it("plays mid reach instruction once around halfway (sequence or time)", () => {
    assert.equal(
      shouldPlayDemoReachMidInstruction({
        targetSequence: 1,
        midInstructionAlreadyPlayed: false,
        reachBlockStartedAtMs: 1000,
        nowMs: 1500,
        reachBlockDurationSeconds: 100,
      }),
      false,
    );
    assert.equal(
      shouldPlayDemoReachMidInstruction({
        targetSequence: 4,
        midInstructionAlreadyPlayed: false,
        reachBlockStartedAtMs: 1000,
        nowMs: 2000,
        reachBlockDurationSeconds: 100,
      }),
      true,
    );
    assert.equal(
      shouldPlayDemoReachMidInstruction({
        targetSequence: 2,
        midInstructionAlreadyPlayed: false,
        reachBlockStartedAtMs: 0,
        nowMs: 51_000,
        reachBlockDurationSeconds: 100,
      }),
      true,
    );
    assert.equal(
      shouldPlayDemoReachMidInstruction({
        targetSequence: 4,
        midInstructionAlreadyPlayed: true,
        reachBlockStartedAtMs: 0,
        nowMs: 60_000,
        reachBlockDurationSeconds: 100,
      }),
      false,
    );
  });
});
