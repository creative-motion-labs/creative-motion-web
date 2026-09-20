/**
 * CHANGE-006 — adaptive attempt consumption and timeout feedback.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/adaptive-attempt-runtime.test.ts
 *
 * Two layers are exercised:
 *   1. the pure reducer, in isolation;
 *   2. a REAL runtime path — an actual SessionOrchestrator driving the real block-runner
 *      registry through dispatchOrchestratorCvBlock — proving that a changed
 *      attemptTimeoutMs is genuinely consumed by the NEXT attempt rather than merely
 *      stored in adaptive state.
 *
 * Every millisecond and degree below is a development/test fixture with no clinical
 * validation. A "success" is a registered target contact and an "incomplete" is an
 * expired attempt window; neither is a clinical outcome.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDispatchOutcomesToAdaptiveState,
  resolveAttemptCompensationObservation,
} from "./adaptive-attempt-runtime";
import {
  createAdaptiveDifficultyState,
  resolveAttemptCompensationState,
} from "./adaptive-difficulty";
import { mapTargetHitToAdaptiveOutcome } from "./target-attempt-outcome";
import { DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG } from "./difficulty-config-registry";
import type { AdaptiveDifficultyState } from "./adaptive-difficulty-types";
import type { TargetAttemptTimeoutEvent, TargetHitEvent } from "../types";
import { registerAllBlockRunners } from "../block-engine/register-all-block-runners";
import type { ActiveBlockRunnerStates } from "../block-engine/tick-active-block-runner";
import { createInitialInstructionalLifecycle } from "../instructional-lifecycle";
import { createInitialTargetLifecycle } from "../target-lifecycle";
import { dispatchOrchestratorCvBlock } from "../orchestrator-cv-block-dispatch";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "../shoulder-abduction-reach-session-definition";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";

const T0 = 8_000_000;
const CONFIG = DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG;

function freshState(): AdaptiveDifficultyState {
  return createAdaptiveDifficultyState(CONFIG);
}

/**
 * A hit carrying NO compensation observation — UNKNOWN.
 *
 * This is deliberately the default shape, because it is what the production runtime
 * actually emits today: `resolveAttemptCompensationObservation` latches `true` and never
 * asserts `false`, so every uncompensated attempt reaches the engine as UNKNOWN. Tests
 * that mean "an observed clean reach" must say so with `cleanHit()`.
 */
function hit(overrides: Partial<TargetHitEvent> = {}): TargetHitEvent {
  return {
    targetId: "target-1-8000000",
    capturedAtMs: T0 + 1_200,
    reactionTimeMs: 1_200,
    sequence: 1,
    ...overrides,
  };
}

/** A hit whose compensation WAS evaluated and reported clean. */
function cleanHit(overrides: Partial<TargetHitEvent> = {}): TargetHitEvent {
  return hit({ compensatedDuringAttempt: false, ...overrides });
}

function timeoutEvent(overrides: Partial<TargetAttemptTimeoutEvent> = {}): TargetAttemptTimeoutEvent {
  return {
    targetId: "target-1-8000000",
    sequence: 1,
    expiredAtMs: T0 + CONFIG.normalAttemptTimeoutMs,
    expiredAtBlockElapsedS: CONFIG.normalAttemptTimeoutMs / 1_000,
    activeElapsedMs: CONFIG.normalAttemptTimeoutMs,
    attemptTimeoutMs: CONFIG.normalAttemptTimeoutMs,
    ...overrides,
  };
}

const NO_OUTCOMES = { targetContact: null, targetAttemptTimeout: null };

describe("adaptive attempt runtime — outcome application", () => {
  it("1. a hit applies a success outcome", () => {
    const result = applyDispatchOutcomesToAdaptiveState(freshState(), {
      ...NO_OUTCOMES,
      targetContact: cleanHit(),
    });
    assert.equal(result.appliedOutcomes, 1);
    assert.equal(result.state.successStreak, 1);
    assert.equal(result.state.struggleStreak, 0);
    assert.equal(result.state.highestSuccessfulLevel, CONFIG.startLevel);
  });

  it("1b. a hit is applied as a success whatever its compensation state", () => {
    // All three states are successes: each is a counted attempt, each records the
    // highest successful level, and none is ever a struggle. Only the increase streak
    // distinguishes them — asserted per state in the blocker-1 suite below.
    for (const contact of [cleanHit(), hit(), hit({ compensatedDuringAttempt: true })]) {
      const result = applyDispatchOutcomesToAdaptiveState(freshState(), {
        ...NO_OUTCOMES,
        targetContact: contact,
      });
      assert.equal(result.appliedOutcomes, 1);
      assert.equal(result.state.attemptsAtCurrentLevel, 1);
      assert.equal(result.state.highestSuccessfulLevel, CONFIG.startLevel);
      assert.equal(result.state.struggleStreak, 0);
    }
  });

  it("2. a timeout applies an incomplete outcome", () => {
    const result = applyDispatchOutcomesToAdaptiveState(freshState(), {
      ...NO_OUTCOMES,
      targetAttemptTimeout: timeoutEvent(),
    });
    assert.equal(result.appliedOutcomes, 1);
    assert.equal(result.state.struggleStreak, 1);
    assert.equal(result.state.successStreak, 0);
  });

  it("3. a timeout can never be applied as a voided (trackingLost) attempt", () => {
    // trackingLost leaves adaptive state completely untouched. If a timeout were ever
    // mapped that way, the struggle streak below would stay at 0.
    const before = freshState();
    const after = applyDispatchOutcomesToAdaptiveState(before, {
      ...NO_OUTCOMES,
      targetAttemptTimeout: timeoutEvent(),
    });
    assert.notDeepEqual(after.state, before, "a timeout must move adaptive state");
    assert.equal(after.state.struggleStreak, 1);
    assert.equal(after.state.attemptsAtCurrentLevel, 1);
  });

  it("4. a tick with neither fact leaves the state untouched and identical", () => {
    const before = freshState();
    const after = applyDispatchOutcomesToAdaptiveState(before, NO_OUTCOMES);
    assert.equal(after.appliedOutcomes, 0);
    assert.equal(after.state, before, "the same object is returned — no needless copy");
    assert.deepEqual(after.changes, []);
  });

  it("5. a compensated hit carries the factual compensated flag into the engine", () => {
    // Under the fixture's excludedFromIncrease policy a compensated success preserves the
    // clean streak rather than advancing it — proof the flag actually reached the engine.
    let state = freshState();
    state = applyDispatchOutcomesToAdaptiveState(state, {
      ...NO_OUTCOMES,
      targetContact: cleanHit(),
    }).state;
    assert.equal(state.successStreak, 1);

    const afterCompensated = applyDispatchOutcomesToAdaptiveState(state, {
      ...NO_OUTCOMES,
      targetContact: hit({ compensatedDuringAttempt: true, sequence: 2 }),
    });
    assert.equal(afterCompensated.state.successStreak, 1, "preserved, not advanced");
    assert.equal(afterCompensated.state.attemptsAtCurrentLevel, 2, "still a counted attempt");
    assert.equal(afterCompensated.state.currentLevel, CONFIG.startLevel, "no increase");
  });

  // REVIEW FIX, BLOCKER 1 (PR #240) — requirement D, at the real mapper→engine boundary.
  //
  // This test previously asserted the OPPOSITE: that a hit with no compensation
  // observation "is treated as a clean success". That was the defect. Two such hits
  // reached the threshold and raised the level on movement quality nobody had evaluated.
  it("6. a hit with UNKNOWN compensation does not escalate through the mapper boundary", () => {
    assert.equal(CONFIG.compensatedSuccessPolicy, "excludedFromIncrease");

    let state = freshState();
    // Four hits — twice the fixture's threshold of 2 — none of them carrying an
    // observation. Routed through the real mapper, not a hand-built outcome.
    for (const sequence of [1, 2, 3, 4]) {
      state = applyDispatchOutcomesToAdaptiveState(state, {
        ...NO_OUTCOMES,
        targetContact: hit({ sequence }),
      }).state;
    }

    assert.equal(state.currentLevel, CONFIG.startLevel, "the level never moved");
    assert.equal(state.successStreak, 0, "no increase streak was built");
    assert.deepEqual(state.changes, [], "no decision was emitted");
    // Nor was the absence reinterpreted as struggle: these were successful reaches.
    assert.equal(state.struggleStreak, 0);
    assert.equal(state.attemptsAtCurrentLevel, 4);
  });

  it("6b. UNKNOWN survives the mapper as absent — it never becomes false", () => {
    // The mapper is where a tri-state fact would be flattened into a boolean, so the
    // distinction is asserted on the outcome it produces, not only on the engine's
    // reaction to it.
    assert.equal(
      "compensated" in mapTargetHitToAdaptiveOutcome(hit()),
      false,
      "an unobserved attempt carries no compensation key at all",
    );
    assert.equal(mapTargetHitToAdaptiveOutcome(cleanHit()).compensated, false);
    assert.equal(
      mapTargetHitToAdaptiveOutcome(hit({ compensatedDuringAttempt: true })).compensated,
      true,
    );

    // And the engine names those three payloads as three different states.
    assert.equal(
      resolveAttemptCompensationState(mapTargetHitToAdaptiveOutcome(hit()).compensated),
      "unknown",
    );
    assert.equal(
      resolveAttemptCompensationState(mapTargetHitToAdaptiveOutcome(cleanHit()).compensated),
      "clean",
    );
  });

  it("6c. an OBSERVED clean hit still escalates through the same boundary", () => {
    // The counterpart to 6: the fix restricts escalation to observed-clean reaches, it
    // does not disable escalation. Same path, same threshold, only the observation added.
    let state = freshState();
    for (const sequence of [1, 2]) {
      state = applyDispatchOutcomesToAdaptiveState(state, {
        ...NO_OUTCOMES,
        targetContact: cleanHit({ sequence }),
      }).state;
    }
    assert.equal(state.currentLevel, CONFIG.startLevel + CONFIG.increaseStep);
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0].direction, "increase");
  });

  it("7. ordering: an expiry in the same tick is applied before a contact", () => {
    // Unreachable through the lifecycle today (each terminal path returns immediately),
    // but defined rather than left to chance. Expiry belongs to the earlier attempt.
    const result = applyDispatchOutcomesToAdaptiveState(freshState(), {
      targetContact: cleanHit({ sequence: 2 }),
      targetAttemptTimeout: timeoutEvent({ sequence: 1 }),
    });
    assert.equal(result.appliedOutcomes, 2);
    // incomplete first zeroes the success streak, then the hit rebuilds it to exactly 1.
    assert.equal(result.state.successStreak, 1);
    assert.equal(result.state.struggleStreak, 0, "the later success cleared the struggle");
    assert.equal(result.state.attemptsAtCurrentLevel, 2, "both attempts were counted");
  });

  it("8. never mutates the state it is given, and is deterministic", () => {
    const before = freshState();
    const snapshot = structuredClone(before);
    const input = { ...NO_OUTCOMES, targetAttemptTimeout: timeoutEvent() };

    const first = applyDispatchOutcomesToAdaptiveState(before, input);
    const second = applyDispatchOutcomesToAdaptiveState(before, input);

    assert.deepEqual(before, snapshot, "the prior state was not mutated");
    assert.deepEqual(first.state, second.state, "repeated execution is deep-equal");
  });
});

describe("adaptive attempt runtime — compensation observation rule", () => {
  it("9. only a latched true becomes an observation; everything else stays unknown", () => {
    assert.equal(resolveAttemptCompensationObservation(true), true);
    assert.equal(
      resolveAttemptCompensationObservation(false),
      undefined,
      "a raw false is NOT an observation of clean movement — the detector cannot tell " +
        "'measured clear' from 'never evaluated'",
    );
    assert.equal(resolveAttemptCompensationObservation(undefined), undefined);
  });

  it("10. the rule can never manufacture an explicit false", () => {
    for (const value of [true, false, undefined] as const) {
      assert.notEqual(
        resolveAttemptCompensationObservation(value),
        false,
        "false must never be produced",
      );
    }
  });
});

/**
 * REAL RUNTIME PATH.
 *
 * These drive an actual SessionOrchestrator and the real block-runner registry, with no
 * injected resolvers and no hand-written snapshots, replicating exactly what
 * OrchestratorCvSessionCore does each animation frame:
 *
 *   orchestrator snapshot + adaptive attemptTimeoutMs
 *     → dispatchOrchestratorCvBlock → runner → gating → target-lifecycle
 *     → terminal event → CHANGE-005 mapper → applyAttemptOutcome
 *     → new adaptive attemptTimeoutMs → next dispatch
 */
describe("adaptive attempt runtime — real orchestrator feedback edge", () => {
  registerAllBlockRunners();

  /** Far from any generated target, so the wrist never registers a contact. */
  const WRIST_AWAY = { x: 0.02, y: 0.97 };

  // Annotated rather than inferred: dispatch returns the wider ActiveBlockRunnerStates
  // (pattern: PatternLifecycleState | null), and an inferred `pattern: null` could not
  // accept it back on the next frame.
  function emptyStates(): ActiveBlockRunnerStates {
    return {
      instructional: createInitialInstructionalLifecycle(),
      target: createInitialTargetLifecycle(),
      pattern: null,
    };
  }

  function startedOrchestrator(startMs: number) {
    const orchestrator = new SessionOrchestrator(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION);
    orchestrator.start(startMs);
    orchestrator.beginCalibration(startMs);
    orchestrator.completeCalibration(startMs);
    orchestrator.tick(startMs);
    return orchestrator;
  }

  /**
   * One animation frame, wired exactly as the component wires it: the adaptive state's
   * CURRENT attemptTimeoutMs is what dispatch is given, and whatever comes back is fed
   * straight into the adaptive state.
   */
  function runFrame(
    orchestrator: SessionOrchestrator,
    states: ActiveBlockRunnerStates,
    adaptive: AdaptiveDifficultyState,
    nowMs: number,
  ) {
    orchestrator.tick(nowMs);
    const snap = orchestrator.getSnapshot(nowMs);
    const dispatched = dispatchOrchestratorCvBlock({
      snap,
      nowMs,
      wrist: WRIST_AWAY,
      side: "right",
      hitExitTransitionMs: 0,
      states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: adaptive.attemptTimeoutMs },
    });
    assert.equal(dispatched.status, "dispatched");
    if (dispatched.status !== "dispatched") throw new Error("unreachable");
    const applied = applyDispatchOutcomesToAdaptiveState(adaptive, {
      targetContact: dispatched.targetContact,
      targetAttemptTimeout: dispatched.targetAttemptTimeout,
    });
    return { dispatched, adaptive: applied.state, states: dispatched.states };
  }

  it("11. a real expired attempt reaches the adaptive engine as an incomplete outcome", () => {
    const orchestrator = startedOrchestrator(T0);
    let states = emptyStates();
    let adaptive = freshState();

    // Frame 1 spawns the first target and starts its attempt.
    let frame = runFrame(orchestrator, states, adaptive, T0);
    states = frame.states;
    adaptive = frame.adaptive;
    assert.equal(adaptive.struggleStreak, 0, "nothing has expired yet");

    // Frame 2, one full attempt window later, expires it.
    frame = runFrame(orchestrator, states, adaptive, T0 + CONFIG.normalAttemptTimeoutMs);
    assert.ok(frame.dispatched.status === "dispatched" && frame.dispatched.targetAttemptTimeout);
    assert.equal(frame.adaptive.struggleStreak, 1, "the real timeout moved adaptive state");
  });

  /**
   * One full attempt cycle at whatever window the engine currently grants: a frame that
   * spawns the target, then a frame exactly one window later that expires it.
   *
   * Those are two DISTINCT frames since CHANGE-008 — a terminal frame retires its target
   * and stops, and the successor is built by the following frame, after the caller has
   * applied the outcome. Returning the expiry frame's time lets the next cycle start
   * strictly after it.
   */
  function runExpiringAttempt(
    orchestrator: SessionOrchestrator,
    states: ActiveBlockRunnerStates,
    adaptive: AdaptiveDifficultyState,
    spawnAtMs: number,
  ) {
    const spawnFrame = runFrame(orchestrator, states, adaptive, spawnAtMs);
    assert.ok(spawnFrame.states.target.currentTarget, "a cycle must begin with a spawned target");
    const expireAtMs = spawnAtMs + spawnFrame.adaptive.attemptTimeoutMs;
    const expiryFrame = runFrame(
      orchestrator,
      spawnFrame.states,
      spawnFrame.adaptive,
      expireAtMs,
    );
    assert.ok(
      expiryFrame.dispatched.status === "dispatched" && expiryFrame.dispatched.targetAttemptTimeout,
      "a cycle must end with a real expiry",
    );
    return { ...expiryFrame, expiredAtMs: expireAtMs };
  }

  it("12. THE FEEDBACK EDGE: a changed attemptTimeoutMs is used by the next attempt", () => {
    const orchestrator = startedOrchestrator(T0);
    let states = emptyStates();
    let adaptive = freshState();
    let frameMs = T0;

    assert.equal(adaptive.attemptTimeoutMs, CONFIG.normalAttemptTimeoutMs);

    // Drive expiries until the engine reaches the floor and grants the extended window.
    // Fixture path: 2 expiries decrease 50 -> 40 (the floor), 2 more grant extended time.
    for (let i = 0; i < 6 && adaptive.attemptTimeoutMs === CONFIG.normalAttemptTimeoutMs; i += 1) {
      const cycle = runExpiringAttempt(orchestrator, states, adaptive, frameMs);
      states = cycle.states;
      adaptive = cycle.adaptive;
      frameMs = cycle.expiredAtMs + 16;
    }

    assert.equal(
      adaptive.currentLevel,
      CONFIG.minLevel,
      "repeated expiries walked the placement level down to the fixture floor",
    );
    assert.equal(
      adaptive.attemptTimeoutMs,
      CONFIG.extendedAttemptTimeoutMs,
      "at the floor the engine granted the extended attempt window",
    );
    assert.equal(
      states.target.currentTarget,
      null,
      "CHANGE-008: the expiring frame left no successor behind for the old window to own",
    );

    // The successor is built on the NEXT frame — the first frame that runs with the
    // extended window already in force.
    const spawnFrame = runFrame(orchestrator, states, adaptive, frameMs);
    states = spawnFrame.states;
    adaptive = spawnFrame.adaptive;
    assert.ok(states.target.currentTarget, "the successor spawns under the new window");
    const baselineMs = frameMs;

    // The proof: that attempt must actually be measured against the extended window.
    // At exactly the OLD (normal) window the attempt must NOT yet expire.
    const before = runFrame(
      orchestrator,
      states,
      adaptive,
      baselineMs + CONFIG.normalAttemptTimeoutMs,
    );
    assert.equal(
      before.dispatched.status === "dispatched" && before.dispatched.targetAttemptTimeout,
      null,
      "the old normal window no longer expires the attempt — the new value is in force",
    );

    // And at the extended window it does expire.
    const after = runFrame(
      orchestrator,
      before.states,
      before.adaptive,
      baselineMs + CONFIG.extendedAttemptTimeoutMs,
    );
    assert.ok(
      after.dispatched.status === "dispatched" && after.dispatched.targetAttemptTimeout,
      "the attempt expired at the extended window",
    );
    assert.equal(
      after.dispatched.status === "dispatched" &&
        after.dispatched.targetAttemptTimeout?.attemptTimeoutMs,
      CONFIG.extendedAttemptTimeoutMs,
      "the lifecycle reported the extended window as the one it enforced",
    );
  });

  it("13. ADAPTIVE DISABLED: no targetAttempt seam means no attempt ever expires", () => {
    // Exactly what production does today with the flag unset.
    const orchestrator = startedOrchestrator(T0);
    let states = emptyStates();

    for (const nowMs of [T0, T0 + 30_000, T0 + 60_000]) {
      orchestrator.tick(nowMs);
      const dispatched = dispatchOrchestratorCvBlock({
        snap: orchestrator.getSnapshot(nowMs),
        nowMs,
        wrist: WRIST_AWAY,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        // no targetAttempt — adaptive disabled
      });
      assert.equal(dispatched.status, "dispatched");
      if (dispatched.status !== "dispatched") return;
      assert.equal(
        dispatched.targetAttemptTimeout,
        null,
        "no attempt window exists, so a full minute of inactivity expires nothing",
      );
      states = dispatched.states;
    }
  });

  it("14. ADAPTIVE DISABLED: a null wrist still skips target dispatch, as before", () => {
    // The narrowed no-wrist rule from CHANGE-004 depends on the seam being supplied.
    // Without it the historical unconditional skip must still hold.
    const orchestrator = startedOrchestrator(T0);
    orchestrator.tick(T0);
    const dispatched = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(dispatched.status, "skipped");
    assert.equal(
      dispatched.status === "skipped" ? dispatched.reason : null,
      "target_wrist_required",
    );
  });

  it("15. a real pause freezes attempt time, so a paused session cannot expire an attempt", () => {
    // Guards the tracking-loss/safety boundary end to end: safety hold and pause both
    // freeze the orchestrator's block clock, and the gating layer stops ticking.
    const orchestrator = startedOrchestrator(T0);
    let states = emptyStates();
    const adaptive = freshState();

    const spawned = runFrame(orchestrator, states, adaptive, T0);
    states = spawned.states;

    orchestrator.pause(T0 + 1_000);
    orchestrator.tick(T0 + 1_000 + CONFIG.extendedAttemptTimeoutMs * 3);
    const whilePaused = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0 + 1_000 + CONFIG.extendedAttemptTimeoutMs * 3),
      nowMs: T0 + 1_000 + CONFIG.extendedAttemptTimeoutMs * 3,
      wrist: WRIST_AWAY,
      side: "right",
      hitExitTransitionMs: 0,
      states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: adaptive.attemptTimeoutMs },
    });
    assert.equal(
      whilePaused.status,
      "not_active",
      "a paused session dispatches nothing, so no attempt can expire against wall time",
    );
  });
});
