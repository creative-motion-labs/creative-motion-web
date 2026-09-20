/**
 * Run: npx tsx --test app/lib/session-orchestrator/session-orchestrator.test.ts
 *
 * Every scenario drives the Orchestrator with explicit `nowMs` values —
 * no real timers, no fake-timer libraries. State transitions are
 * deterministic by construction.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SessionOrchestrator } from "./session-orchestrator";
import { MOCK_NEURO_UPPER_LIMB_SESSION } from "./mock-neuro-upper-limb-session";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "@/app/lib/interactive-shoulder/shoulder-abduction-reach-session-definition";
import type { MovementBlock, SessionDefinition } from "./types";

const T0 = 1_000_000;

function minimalBlock(overrides: Partial<MovementBlock> = {}): MovementBlock {
  return {
    blockId: "b1",
    movementId: "mock-movement",
    movementVersion: "v0",
    title: "Block",
    instructions: "Do the movement.",
    completionMode: "duration",
    targetDurationSeconds: 10,
    supportedPositions: ["seated"],
    ...overrides,
  };
}

function twoBlockSession(overrides: Partial<SessionDefinition> = {}): SessionDefinition {
  return {
    sessionId: "test-session",
    title: "Test session",
    blocks: [
      minimalBlock({ blockId: "b1", completionMode: "duration", targetDurationSeconds: 10, restAfterSeconds: 5 }),
      minimalBlock({ blockId: "b2", completionMode: "validRepetitions", prescribedRepetitions: 3 }),
    ],
    ...overrides,
  };
}

/** Drives idle -> active on block 1 in one call, for tests that don't care about the ramp-up itself. */
function startedOrchestrator(definition: SessionDefinition, nowMs = T0): SessionOrchestrator {
  const o = new SessionOrchestrator(definition);
  o.start(nowMs);
  o.beginCalibration(nowMs);
  o.completeCalibration(nowMs);
  return o;
}

describe("SessionOrchestrator — lifecycle", () => {
  it("1. session starts from idle", () => {
    const o = new SessionOrchestrator(twoBlockSession());
    assert.equal(o.getSnapshot(T0).sessionState, "idle");
    o.start(T0);
    assert.equal(o.getSnapshot(T0).sessionState, "preparing");
  });

  it("2. preparation transitions to calibration", () => {
    const o = new SessionOrchestrator(twoBlockSession());
    o.start(T0);
    o.beginCalibration(T0 + 1_000);
    assert.equal(o.getSnapshot(T0 + 1_000).sessionState, "calibrating");
  });

  it("3. calibration completion starts the first movement block", () => {
    const o = new SessionOrchestrator(twoBlockSession());
    o.start(T0);
    o.beginCalibration(T0);
    o.completeCalibration(T0);
    const snap = o.getSnapshot(T0);
    assert.equal(snap.sessionState, "active");
    assert.equal(snap.currentBlockIndex, 0);
    assert.equal(snap.currentBlock?.blockId, "b1");
  });

  it("4. calibration cannot be skipped by a movement event", () => {
    const o = new SessionOrchestrator(twoBlockSession());
    o.start(T0);
    o.beginCalibration(T0);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 }, T0);
    const snap = o.getSnapshot(T0);
    assert.equal(snap.sessionState, "calibrating", "a movement event must not advance past calibration");
    assert.equal(snap.currentBlockIndex, null);
  });
});

describe("SessionOrchestrator — block completion modes", () => {
  it("5. duration-based block completes correctly", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 9_000);
    assert.equal(o.getSnapshot(T0 + 9_000).sessionState, "active", "not yet at target duration");
    o.tick(T0 + 10_000);
    assert.equal(o.getSnapshot(T0 + 10_000).sessionState, "resting");
  });

  it("6. repetition-based block completes correctly", () => {
    const def = twoBlockSession();
    const o = startedOrchestrator(def);
    o.tick(T0 + 10_000); // finish block 1 (duration)
    o.tick(T0 + 10_000); // resting -> transitioning
    o.tick(T0 + 15_000); // rest elapses (5s) -> transitioning -> block 2 active
    assert.equal(o.getSnapshot(T0 + 15_000).currentBlock?.blockId, "b2");

    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 16_000 }, T0 + 16_000);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 17_000 }, T0 + 17_000);
    assert.equal(o.getSnapshot(T0 + 17_000).sessionState, "active", "2 of 3 reps — not complete yet");
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 18_000 }, T0 + 18_000);
    assert.equal(o.getSnapshot(T0 + 18_000).sessionState, "completed", "block 2 has no restAfterSeconds and is the last block");
  });

  it("hold-duration block completes only once the reported hold meets the prescribed duration", () => {
    const def: SessionDefinition = {
      sessionId: "hold-session",
      title: "Hold session",
      blocks: [minimalBlock({ completionMode: "holdDuration", prescribedHoldSeconds: 3, restAfterSeconds: 0 })],
    };
    const o = startedOrchestrator(def);
    o.reportInputEvent({ type: "holdCompleted", capturedAtMs: T0 + 1_000, durationSeconds: 2 }, T0 + 1_000);
    assert.equal(o.getSnapshot(T0 + 1_000).sessionState, "active", "2s hold below the 3s prescription");
    o.reportInputEvent({ type: "holdCompleted", capturedAtMs: T0 + 2_000, durationSeconds: 3 }, T0 + 2_000);
    assert.equal(o.getSnapshot(T0 + 2_000).sessionState, "completed");
  });

  it("clinicianDefined/manualCompletion blocks only end via explicit completeBlockManually", () => {
    const def: SessionDefinition = {
      sessionId: "manual-session",
      title: "Manual session",
      blocks: [minimalBlock({ completionMode: "manualCompletion", targetDurationSeconds: undefined, restAfterSeconds: 0 })],
    };
    const o = startedOrchestrator(def);
    o.tick(T0 + 999_999);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    assert.equal(o.getSnapshot(T0 + 1_000).sessionState, "active", "nothing auto-completes a manual block");
    o.completeBlockManually(T0 + 2_000);
    assert.equal(o.getSnapshot(T0 + 2_000).sessionState, "completed");
    assert.equal(
      o.getSessionPerformanceSummary(T0 + 2_000).blockResults[0].completionReason,
      "manualCompletion",
    );
  });
});

describe("SessionOrchestrator — rest and transitions", () => {
  it("7. rest period begins and ends correctly", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 10_000);
    assert.equal(o.getSnapshot(T0 + 10_000).sessionState, "resting");
    assert.equal(o.getSnapshot(T0 + 10_000).restRemainingSeconds, 5);
    o.tick(T0 + 12_000);
    assert.equal(o.getSnapshot(T0 + 12_000).restRemainingSeconds, 3);
    o.tick(T0 + 15_000);
    assert.equal(o.getSnapshot(T0 + 15_000).sessionState, "active", "rest elapsed, transitioning auto-advances on the same or next tick");
    assert.equal(o.getSnapshot(T0 + 15_000).currentBlock?.blockId, "b2");
  });

  it("rest periods do not accept movement completion events", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 10_000);
    assert.equal(o.getSnapshot(T0 + 10_000).sessionState, "resting");

    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 11_000 }, T0 + 11_000);
    o.reportInputEvent({ type: "holdCompleted", capturedAtMs: T0 + 11_000, durationSeconds: 99 }, T0 + 11_000);

    assert.equal(o.getSnapshot(T0 + 11_000).sessionState, "resting", "still resting — events during rest are ignored");
  });

  it("8. block transition preserves accumulated results", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 10_000); // block 1 completes
    o.tick(T0 + 15_000); // rest elapses, block 2 begins
    assert.equal(o.getSessionPerformanceSummary(T0 + 15_000).blockResults.length, 1);
    assert.equal(o.getSessionPerformanceSummary(T0 + 15_000).blockResults[0].blockId, "b1");

    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 16_000 }, T0 + 16_000);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 17_000 }, T0 + 17_000);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 18_000 }, T0 + 18_000);

    const summary = o.getSessionPerformanceSummary(T0 + 18_000);
    assert.equal(summary.blockResults.length, 2, "block 1's result is preserved, not overwritten by block 2");
    assert.equal(summary.blockResults[0].blockId, "b1");
    assert.equal(summary.blockResults[1].blockId, "b2");
  });

  it("events from a previous, already-completed movement block are ignored", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 10_000); // block 1 (duration) completes -> resting

    // Late-arriving events that would have belonged to block 1's active window.
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 10_500 }, T0 + 10_500);
    o.reportInputEvent({ type: "targetContact", capturedAtMs: T0 + 10_500 }, T0 + 10_500);

    const b1Result = o.getSessionPerformanceSummary(T0 + 10_500).blockResults[0];
    assert.equal(b1Result.measured.validRepetitions, 0, "already-pushed block 1 result must not mutate after completion");
    assert.equal(b1Result.interaction.targetsContacted, 0);
  });

  it("duplicate completion events cannot advance two blocks", () => {
    const def: SessionDefinition = {
      sessionId: "dup-session",
      title: "Duplicate events session",
      blocks: [
        minimalBlock({ blockId: "b1", completionMode: "validRepetitions", prescribedRepetitions: 1, restAfterSeconds: 0 }),
        minimalBlock({ blockId: "b2", completionMode: "validRepetitions", prescribedRepetitions: 2, restAfterSeconds: 0 }),
      ],
    };
    const o = startedOrchestrator(def);
    // Two reps delivered back-to-back at the same instant — the first completes block 1 (which has
    // no rest, so it cascades straight to block 2 becoming active); the second must land on block 2
    // as its own genuine rep, not be double-counted as if the same signal satisfied both blocks.
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 }, T0);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 }, T0);

    const snap = o.getSnapshot(T0);
    assert.equal(snap.currentBlock?.blockId, "b2", "second rep event applies to block 2, now active");
    const summary = o.getSessionPerformanceSummary(T0);
    assert.equal(summary.blocksCompleted, 1, "only block 1 is in the completed list; block 2 is still in progress");
    assert.equal(
      snap.accumulatedBlockResults.at(-1)?.measured.validRepetitions,
      1,
      "block 2 has exactly 1 rep credited, from the second event only — not 2",
    );
  });
});

describe("SessionOrchestrator — pause and resume", () => {
  it("9. pause freezes active timers — paused time is excluded from block and session elapsed", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 3_000);
    assert.equal(o.getSnapshot(T0 + 3_000).blockElapsedSeconds, 3);

    o.pause(T0 + 3_000);
    const duringPause = o.getSnapshot(T0 + 50_000);
    assert.equal(duringPause.blockElapsedSeconds, 3, "elapsed does not advance while paused");
    assert.equal(duringPause.sessionElapsedSeconds, 3);
    assert.equal(duringPause.isPaused, true);

    o.resume(T0 + 50_000);
    assert.equal(o.getSnapshot(T0 + 53_000).blockElapsedSeconds, 6, "resumes counting from where it left off");
  });

  it("10. resume continues from the correct state", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 10_000); // -> resting
    o.pause(T0 + 10_000);
    assert.equal(o.getSnapshot(T0 + 10_000).sessionState, "paused");
    o.resume(T0 + 20_000);
    assert.equal(o.getSnapshot(T0 + 20_000).sessionState, "resting", "returns to resting, not active");
  });
});

describe("SessionOrchestrator — safety behavior", () => {
  it("11. tracker loss enters the configured safe state, driven by block safety configuration", () => {
    const zeroGrace = startedOrchestrator(twoBlockSession());
    zeroGrace.reportInputEvent({ type: "trackerLost", capturedAtMs: T0 }, T0);
    assert.equal(zeroGrace.getSnapshot(T0).sessionState, "safetyHold", "default grace is 0 — immediate hold");
    assert.equal(zeroGrace.getSnapshot(T0).safetyHoldReason, "trackerLost");

    const graceDef: SessionDefinition = {
      sessionId: "grace-session",
      title: "Grace session",
      blocks: [minimalBlock({ safetyRules: { trackerLossGraceSeconds: 4 } })],
    };
    const graced = startedOrchestrator(graceDef);
    graced.reportInputEvent({ type: "trackerLost", capturedAtMs: T0 }, T0);
    assert.equal(graced.getSnapshot(T0).sessionState, "active", "still within this block's configured grace period");
    graced.tick(T0 + 2_000);
    assert.equal(graced.getSnapshot(T0 + 2_000).sessionState, "active", "2s < 4s grace");
    graced.tick(T0 + 5_000);
    assert.equal(graced.getSnapshot(T0 + 5_000).sessionState, "safetyHold", "5s exceeds this block's 4s grace");
  });

  it("12. safety interruption prevents automatic progression / safety hold cannot accidentally advance the block", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.reportInputEvent({ type: "trackerLost", capturedAtMs: T0 }, T0);
    assert.equal(o.getSnapshot(T0).sessionState, "safetyHold");

    // A block worth of "time" passes while on hold — duration-based completion must not fire.
    o.tick(T0 + 999_000);
    assert.equal(o.getSnapshot(T0 + 999_000).sessionState, "safetyHold", "tick() must not silently complete the block while on hold");
    assert.equal(o.getSnapshot(T0 + 999_000).currentBlockIndex, 0, "still block 1 — no accidental advance");
  });

  it("compensation safety hold respects the block's configured threshold, and clears on compensationCleared", () => {
    const def: SessionDefinition = {
      sessionId: "comp-session",
      title: "Compensation session",
      blocks: [minimalBlock({ safetyRules: { maxCompensationEventsBeforePause: 2 } })],
    };
    const o = startedOrchestrator(def);
    o.reportInputEvent({ type: "compensationDetected", capturedAtMs: T0 }, T0);
    assert.equal(o.getSnapshot(T0).sessionState, "active", "1st event — under threshold");
    o.reportInputEvent({ type: "compensationDetected", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    assert.equal(o.getSnapshot(T0 + 1_000).sessionState, "safetyHold", "2nd event meets the configured threshold");

    o.reportInputEvent({ type: "compensationCleared", capturedAtMs: T0 + 2_000 }, T0 + 2_000);
    assert.equal(o.getSnapshot(T0 + 2_000).sessionState, "active");
  });

  it("pain report always enters safety hold regardless of any threshold, and requires an explicit resume", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.reportInputEvent({ type: "patientPainReported", capturedAtMs: T0, severity: 3 }, T0);
    assert.equal(o.getSnapshot(T0).sessionState, "safetyHold");
    assert.equal(o.getSnapshot(T0).safetyHoldReason, "painReported");

    // Nothing auto-clears a pain-reported hold — not time, not tracker/compensation events.
    o.tick(T0 + 60_000);
    o.reportInputEvent({ type: "compensationCleared", capturedAtMs: T0 + 60_000 }, T0 + 60_000);
    o.reportInputEvent({ type: "trackerReady", capturedAtMs: T0 + 60_000 }, T0 + 60_000);
    assert.equal(o.getSnapshot(T0 + 60_000).sessionState, "safetyHold", "only an explicit resume() clears a pain-reported hold");

    o.resume(T0 + 60_000);
    assert.equal(o.getSnapshot(T0 + 60_000).sessionState, "active");
  });

  it("13. manual stop ends the session and produces a distinct stopped result, not completed", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 3_000);
    o.requestSafetyStop(T0 + 3_000);
    const summary = o.getSessionPerformanceSummary(T0 + 3_000);
    assert.equal(summary.sessionState, "stopped");
    assert.notEqual(summary.sessionState, "completed");
    assert.equal(summary.blocksCompleted, 1, "the in-progress block is still recorded, marked as stopped");
    assert.equal(summary.blockResults[0].completionReason, "safetyStop");
  });
});

describe("SessionOrchestrator — completion and progress", () => {
  it("14. final block produces completed state", () => {
    const def: SessionDefinition = {
      sessionId: "single-block",
      title: "Single block",
      blocks: [minimalBlock({ targetDurationSeconds: 2, restAfterSeconds: 0 })],
    };
    const o = startedOrchestrator(def);
    o.tick(T0 + 2_000);
    assert.equal(o.getSnapshot(T0 + 2_000).sessionState, "completed");
    assert.equal(o.getSessionPerformanceSummary(T0 + 2_000).blocksCompleted, 1);
    assert.equal(o.getSessionPerformanceSummary(T0 + 2_000).blocksTotal, 1);
  });

  it("15. session progress is monotonic, never decreases, and never exceeds 100%", () => {
    const o = startedOrchestrator(twoBlockSession());
    const samples: number[] = [];
    const times = [T0, T0 + 2_000, T0 + 5_000, T0 + 10_000, T0 + 12_000, T0 + 15_000, T0 + 16_000, T0 + 17_000, T0 + 18_000];

    for (const t of times) {
      o.tick(t);
      samples.push(o.getSnapshot(t).sessionProgress);
    }
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 16_000 }, T0 + 16_000);
    samples.push(o.getSnapshot(T0 + 16_000).sessionProgress);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 17_000 }, T0 + 17_000);
    samples.push(o.getSnapshot(T0 + 17_000).sessionProgress);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 18_000 }, T0 + 18_000);
    samples.push(o.getSnapshot(T0 + 18_000).sessionProgress);

    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] >= samples[i - 1], `progress decreased: ${samples[i - 1]} -> ${samples[i]} at index ${i}`);
    }
    for (const s of samples) {
      assert.ok(s >= 0 && s <= 1, `progress out of [0,1] bounds: ${s}`);
    }
    assert.equal(samples[samples.length - 1], 1);
  });

  it("progress does not decrease across a pause/safetyHold cycle", () => {
    const o = startedOrchestrator(twoBlockSession());
    o.tick(T0 + 5_000);
    const before = o.getSnapshot(T0 + 5_000).sessionProgress;
    o.reportInputEvent({ type: "trackerLost", capturedAtMs: T0 + 5_000 }, T0 + 5_000);
    const duringHold = o.getSnapshot(T0 + 100_000).sessionProgress;
    assert.ok(duringHold >= before, "safety hold must not regress progress");
    o.reportInputEvent({ type: "trackerReady", capturedAtMs: T0 + 100_000 }, T0 + 100_000);
    const afterResume = o.getSnapshot(T0 + 100_000).sessionProgress;
    assert.ok(afterResume >= duringHold);
  });
});

describe("SessionOrchestrator — result category separation", () => {
  it("16. / 10. interaction, measured, and interpreted results remain separated on the final summary", () => {
    const def: SessionDefinition = {
      sessionId: "separation-session",
      title: "Separation session",
      blocks: [minimalBlock({ completionMode: "manualCompletion", targetDurationSeconds: undefined, restAfterSeconds: 0 })],
    };
    const o = startedOrchestrator(def);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    o.reportInputEvent({ type: "targetContact", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    o.reportInputEvent({ type: "compensationDetected", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    o.completeBlockManually(T0 + 2_000);

    const result = o.getSessionPerformanceSummary(T0 + 2_000).blockResults[0];
    assert.deepEqual(Object.keys(result).sort(), [
      "blockId",
      "blockType",
      "completedAtMs",
      "completionReason",
      "interaction",
      "interpreted",
      "measured",
      "movementId",
      "startedAtMs",
      "title",
    ]);
    assert.equal(result.interaction.targetsContacted, 1);
    assert.equal(result.interaction.patternsCompleted, 0);
    assert.equal(result.measured.validRepetitions, 1);
    assert.equal(result.interpreted.compensationEvents, 1);
    // No cross-contamination: a field recorded in one category must not also appear in another.
    assert.equal("targetsContacted" in result.measured, false);
    assert.equal("patternsCompleted" in result.measured, false);
    assert.equal("validRepetitions" in result.interaction, false);
    assert.equal("compensationEvents" in result.measured, false);
    assert.deepEqual(result.interaction.timingSamplesMs, []);
    assert.deepEqual(result.measured.rangeValuesDegrees, []);
  });

  it("echoes the originating block's own blockType and title onto the result — not derived, not guessed", () => {
    const def: SessionDefinition = {
      sessionId: "block-type-session",
      title: "Block type session",
      blocks: [
        minimalBlock({
          blockId: "warm-up",
          blockType: "instructional",
          title: "Warm-up",
          completionMode: "duration",
          targetDurationSeconds: 5,
          restAfterSeconds: 0,
        }),
        minimalBlock({
          blockId: "reach",
          blockType: "movement-target",
          title: "Reach the Light",
          completionMode: "duration",
          targetDurationSeconds: 5,
          restAfterSeconds: 0,
        }),
      ],
    };
    const o = startedOrchestrator(def);
    o.tick(T0 + 5_000);
    o.tick(T0 + 10_000);

    const results = o.getSessionPerformanceSummary(T0 + 10_000).blockResults;
    assert.equal(results[0]?.blockType, "instructional");
    assert.equal(results[0]?.title, "Warm-up");
    assert.equal(results[1]?.blockType, "movement-target");
    assert.equal(results[1]?.title, "Reach the Light");
  });

  it("a block that declares no blockType leaves the result's blockType undefined — never a fabricated guess", () => {
    const def: SessionDefinition = {
      sessionId: "no-block-type-session",
      title: "No block type session",
      blocks: [minimalBlock({ blockType: undefined, completionMode: "manualCompletion", targetDurationSeconds: undefined })],
    };
    const o = startedOrchestrator(def);
    o.completeBlockManually(T0 + 1_000);
    const result = o.getSessionPerformanceSummary(T0 + 1_000).blockResults[0];
    assert.equal(result?.blockType, undefined);
  });

  it("records patternCompleted separately from targetsContacted and validRepetitions", () => {
    const o = new SessionOrchestrator(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION);
    o.start(T0);
    o.beginCalibration(T0);
    o.completeCalibration(T0);
    o.reportInputEvent(
      { type: "patternCompleted", patternId: "d1-inspired-diagonal-reach", capturedAtMs: T0 + 500 },
      T0 + 500,
    );
    o.reportInputEvent({ type: "targetContact", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 1_500 }, T0 + 1_500);
    const result = o.getSnapshot(T0 + 2_000).accumulatedBlockResults[0]!;
    assert.equal(result.interaction.patternsCompleted, 1);
    assert.equal(result.interaction.targetsContacted, 1);
    assert.equal(result.measured.validRepetitions, 1);
  });
});

describe("SessionOrchestrator — mock Neuro Upper-Limb session fixture", () => {
  it("runs the full 4-block mock session end to end and reaches completed with 4 results", () => {
    const o = new SessionOrchestrator(MOCK_NEURO_UPPER_LIMB_SESSION);
    o.start(T0);
    o.beginCalibration(T0);
    o.completeCalibration(T0); // -> warm-up (duration 30s, rest 10s)

    o.tick(T0 + 30_000); // warm-up completes -> resting
    assert.equal(o.getSnapshot(T0 + 30_000).sessionState, "resting");
    o.tick(T0 + 40_000); // rest elapses -> main-movement active
    assert.equal(o.getSnapshot(T0 + 40_000).currentBlock?.blockId, "main-movement");

    for (let i = 0; i < 10; i++) {
      o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 41_000 + i }, T0 + 41_000 + i);
    }
    // main-movement has restAfterSeconds: 15 -> resting, then functional-challenge after rest elapses.
    assert.equal(o.getSnapshot(T0 + 41_010).sessionState, "resting");
    o.tick(T0 + 56_010);
    assert.equal(o.getSnapshot(T0 + 56_010).currentBlock?.blockId, "functional-challenge");

    o.reportInputEvent({ type: "holdCompleted", capturedAtMs: T0 + 57_000, durationSeconds: 3 }, T0 + 57_000);
    // functional-challenge has restAfterSeconds: 0 -> cascades straight to cool-down.
    assert.equal(o.getSnapshot(T0 + 57_000).currentBlock?.blockId, "cool-down");

    o.tick(T0 + 77_000); // cool-down duration 20s elapses -> session completed (last block)
    const summary = o.getSessionPerformanceSummary(T0 + 77_000);
    assert.equal(summary.sessionState, "completed");
    assert.equal(summary.blocksCompleted, 4);
    assert.deepEqual(
      summary.blockResults.map((r) => r.blockId),
      ["warm-up", "main-movement", "functional-challenge", "cool-down"],
    );
  });
});

describe("SessionOrchestrator — measured sample persistence", () => {
  function manualCompletionSession(): SessionDefinition {
    return {
      sessionId: "sample-persistence",
      title: "Sample persistence",
      blocks: [
        minimalBlock({
          completionMode: "manualCompletion",
          targetDurationSeconds: undefined,
          restAfterSeconds: 0,
        }),
      ],
    };
  }

  it("appends reactionTimeMs samples for valid target contacts without changing target counts", () => {
    const o = startedOrchestrator(manualCompletionSession());
    o.reportInputEvent(
      { type: "targetContact", capturedAtMs: T0 + 1_000, reactionTimeMs: 420 },
      T0 + 1_000,
    );
    o.reportInputEvent(
      { type: "targetContact", capturedAtMs: T0 + 2_000, reactionTimeMs: 510 },
      T0 + 2_000,
    );
    o.completeBlockManually(T0 + 3_000);

    const result = o.getSessionPerformanceSummary(T0 + 3_000).blockResults[0];
    assert.equal(result.interaction.targetsContacted, 2);
    assert.deepEqual(result.interaction.timingSamplesMs, [420, 510]);
    assert.equal(result.measured.validRepetitions, 0);
  });

  it("does not fabricate timing samples when reactionTimeMs is missing or invalid", () => {
    const o = startedOrchestrator(manualCompletionSession());
    o.reportInputEvent({ type: "targetContact", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    o.reportInputEvent(
      { type: "targetContact", capturedAtMs: T0 + 2_000, reactionTimeMs: Number.NaN },
      T0 + 2_000,
    );
    o.completeBlockManually(T0 + 3_000);

    const result = o.getSessionPerformanceSummary(T0 + 3_000).blockResults[0];
    assert.equal(result.interaction.targetsContacted, 2);
    assert.deepEqual(result.interaction.timingSamplesMs, []);
  });

  it("appends peakAngleDegrees samples for valid repetitions without changing rep counts", () => {
    const o = startedOrchestrator(manualCompletionSession());
    o.reportInputEvent(
      { type: "validRepetition", capturedAtMs: T0 + 1_000, metrics: { peakAngleDegrees: 82 } },
      T0 + 1_000,
    );
    o.reportInputEvent(
      { type: "validRepetition", capturedAtMs: T0 + 2_000, metrics: { peakAngleDegrees: 95.5 } },
      T0 + 2_000,
    );
    o.completeBlockManually(T0 + 3_000);

    const result = o.getSessionPerformanceSummary(T0 + 3_000).blockResults[0];
    assert.equal(result.measured.validRepetitions, 2);
    assert.deepEqual(result.measured.rangeValuesDegrees, [82, 95.5]);
    assert.equal(result.interaction.targetsContacted, 0);
  });

  it("does not fabricate range samples when peakAngleDegrees is missing or invalid", () => {
    const o = startedOrchestrator(manualCompletionSession());
    o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 1_000 }, T0 + 1_000);
    o.reportInputEvent(
      { type: "validRepetition", capturedAtMs: T0 + 2_000, metrics: { peakAngleDegrees: Number.NaN } },
      T0 + 2_000,
    );
    o.completeBlockManually(T0 + 3_000);

    const result = o.getSessionPerformanceSummary(T0 + 3_000).blockResults[0];
    assert.equal(result.measured.validRepetitions, 2);
    assert.deepEqual(result.measured.rangeValuesDegrees, []);
  });

  it("records one timing sample and one range sample per distinct event — no cross-conversion", () => {
    const o = startedOrchestrator(manualCompletionSession());
    o.reportInputEvent(
      { type: "targetContact", capturedAtMs: T0 + 1_000, reactionTimeMs: 900 },
      T0 + 1_000,
    );
    o.reportInputEvent(
      { type: "validRepetition", capturedAtMs: T0 + 1_500, metrics: { peakAngleDegrees: 75 } },
      T0 + 1_500,
    );
    o.completeBlockManually(T0 + 2_000);

    const result = o.getSessionPerformanceSummary(T0 + 2_000).blockResults[0];
    assert.equal(result.interaction.targetsContacted, 1);
    assert.equal(result.measured.validRepetitions, 1);
    assert.deepEqual(result.interaction.timingSamplesMs, [900]);
    assert.deepEqual(result.measured.rangeValuesDegrees, [75]);
  });
});

describe("SessionOrchestrator — architectural boundaries", () => {
  it("17. / 15. a fully generic mock block runs to completion with no detector-specific fields required", () => {
    const genericBlock: MovementBlock = {
      blockId: "generic",
      movementId: "generic-movement",
      movementVersion: "v0",
      title: "Generic",
      instructions: "Generic instructions.",
      completionMode: "duration",
      targetDurationSeconds: 1,
      supportedPositions: ["configurable"],
    };
    const o = startedOrchestrator({ sessionId: "generic-session", title: "Generic", blocks: [genericBlock] });
    o.tick(T0 + 1_000);
    assert.equal(o.getSnapshot(T0 + 1_000).sessionState, "completed");
  });

  it("18. / 12. no persistence API is ever called during a full session run", () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("fetch must not be called by the Session Orchestrator");
    }) as typeof fetch;

    try {
      const o = startedOrchestrator(twoBlockSession());
      o.tick(T0 + 10_000);
      o.tick(T0 + 15_000);
      o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 16_000 }, T0 + 16_000);
      o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 17_000 }, T0 + 17_000);
      o.reportInputEvent({ type: "validRepetition", capturedAtMs: T0 + 18_000 }, T0 + 18_000);
      o.getSessionPerformanceSummary(T0 + 18_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalled, false);
  });

  it("no file in app/lib/session-orchestrator imports @supabase, calls fetch(, or imports the shoulder-rehabilitation module", () => {
    // Checks actual import/require statements only — doc comments are free
    // to explain the boundary in prose (e.g. "does not import the
    // shoulder-rehabilitation module"), which would otherwise false-positive
    // a naive whole-file substring check.
    const files = [
      "./types.ts",
      "./session-orchestrator.ts",
      "./mock-neuro-upper-limb-session.ts",
      "./index.ts",
    ];
    const importLinePattern = /^\s*import\b.*$/gm;
    for (const relative of files) {
      const path = new URL(relative, import.meta.url);
      const text = readFileSync(path, "utf8");
      const importLines = text.match(importLinePattern) ?? [];
      const importsText = importLines.join("\n");

      assert.doesNotMatch(importsText, /@supabase/i, `${relative} must not import Supabase`);
      assert.doesNotMatch(
        importsText,
        /shoulder/i,
        `${relative} must not import anything from the shoulder-rehabilitation module`,
      );
      assert.doesNotMatch(text, /[^.]\bfetch\(/, `${relative} must not call fetch()`);
    }
  });
});
