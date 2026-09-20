/**
 * Run: npx tsx --test app/lib/interactive-shoulder/block-engine/target-block-runner.test.ts
 *
 * Re-runs the exact scenarios from target-lifecycle-gating.test.ts through
 * TARGET_BLOCK_RUNNER instead of calling tickTargetLifecycleIfActive
 * directly — proving the wrapper introduces zero behavior drift.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "../target-generator";
import { createInitialTargetLifecycle, type TargetLifecycleTickInput } from "../target-lifecycle";
import { tickTargetLifecycleIfActive } from "../target-lifecycle-gating";
import { getBlockRunnerForBlockType, registerBlockRunner } from "./block-runner-registry";
import {
  TARGET_BLOCK_RUNNER,
  registerTargetBlockRunner,
  resolveTargetBlockRunner,
} from "./target-block-runner";

const T0 = 3_000_000;
const WRIST_AT_TARGET = { x: 0.55, y: 0.35 };

/**
 * CHANGE-004 fixture. NOT a clinical value: no reach window has been validated for any
 * patient population in this repository, and nothing outside tests may supply one.
 */
const FIXTURE_TIMEOUT_MS = 4_000;
/** CHANGE-004 fixture — target-placement geometry only, never a measured joint angle. */
const FIXTURE_LEVEL_DEGREES = 45;

const deterministicRandom = () => 0.5;

/**
 * A tracked wrist at rest, outside `DEFAULT_SAFE_TARGET_BOUNDS` so it can never be inside
 * a target. "The patient is measured and is not reaching" — as distinct from `wrist: null`,
 * which since the blocker-2 review fix means only "no measurement this frame".
 */
const RESTING_WRIST = { x: 0.02, y: 0.97 };

function tickInput(
  overrides: Partial<TargetLifecycleTickInput> = {},
): TargetLifecycleTickInput {
  return {
    wrist: RESTING_WRIST,
    nowMs: T0,
    side: "right",
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    random: deterministicRandom,
    ...overrides,
  };
}

describe("target-block-runner", () => {
  it('registers under "movement-target" and resolves through the shared registry', () => {
    registerBlockRunner(TARGET_BLOCK_RUNNER);
    assert.equal(getBlockRunnerForBlockType("movement-target"), TARGET_BLOCK_RUNNER);
  });

  it("active → may tick, spawn targets, and register hits (replays target-lifecycle-gating.test.ts)", () => {
    let state = TARGET_BLOCK_RUNNER.createInitialState();
    state = TARGET_BLOCK_RUNNER.tick("active", state, {
      wrist: null,
      nowMs: T0,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => 0.5,
    }).state;
    assert.ok(state.currentTarget);
    assert.equal(state.interaction.targetsShown, 1);

    const hit = TARGET_BLOCK_RUNNER.tick("active", state, {
      wrist: { x: state.currentTarget!.x, y: state.currentTarget!.y },
      nowMs: T0 + 500,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => 0.5,
    });
    assert.equal(hit.ticked, true);
    assert.ok(hit.completionEvent);
    assert.equal(hit.state.interaction.targetsReached, 1);
  });

  for (const sessionState of ["paused", "safetyHold", "completed"] as const) {
    it(`${sessionState} → no target spawn, replacement, or hit registration (replays target-lifecycle-gating.test.ts)`, () => {
      let state = TARGET_BLOCK_RUNNER.createInitialState();
      const spawned = TARGET_BLOCK_RUNNER.tick(sessionState, state, {
        wrist: null,
        nowMs: T0,
        side: "right",
        bounds: DEFAULT_SAFE_TARGET_BOUNDS,
        random: () => 0.5,
      });
      assert.equal(spawned.ticked, false);
      assert.equal(spawned.state.currentTarget, null);
      assert.equal(spawned.state.interaction.targetsShown, 0);

      state = {
        ...TARGET_BLOCK_RUNNER.createInitialState(),
        currentTarget: {
          id: "seed-target",
          x: WRIST_AT_TARGET.x,
          y: WRIST_AT_TARGET.y,
          spawnedAtMs: T0,
        },
        interaction: {
          ...TARGET_BLOCK_RUNNER.createInitialState().interaction,
          targetsShown: 1,
        },
      };

      const hitAttempt = TARGET_BLOCK_RUNNER.tick(sessionState, state, {
        wrist: WRIST_AT_TARGET,
        nowMs: T0 + 500,
        side: "right",
        bounds: DEFAULT_SAFE_TARGET_BOUNDS,
        random: () => 0.5,
      });
      assert.equal(hitAttempt.ticked, false);
      assert.equal(hitAttempt.completionEvent, null);
      assert.equal(hitAttempt.state.currentTarget?.id, "seed-target");
      assert.equal(hitAttempt.state.interaction.targetsReached, 0);
    });
  }

  it("returns null for an unregistered blockType from within this isolated process", () => {
    assert.equal(getBlockRunnerForBlockType("movement-pattern"), null);
    assert.equal(getBlockRunnerForBlockType("instructional"), null);
  });

  it('resolveTargetBlockRunner resolves "movement-target" and fails safely for anything else', () => {
    registerTargetBlockRunner();
    assert.equal(resolveTargetBlockRunner("movement-target"), TARGET_BLOCK_RUNNER);

    // Never silently hands back the target runner for a block that isn't
    // declared movement-target — including undefined (no blockType set).
    assert.equal(resolveTargetBlockRunner(undefined), null);
    assert.equal(resolveTargetBlockRunner("movement-pattern"), null);
    assert.equal(resolveTargetBlockRunner("instructional"), null);
  });

  it("registerTargetBlockRunner is idempotent — a second call does not throw", () => {
    assert.doesNotThrow(() => registerTargetBlockRunner());
    assert.equal(resolveTargetBlockRunner("movement-target"), TARGET_BLOCK_RUNNER);
  });

  it("tracking loss (wrist: null) and recovery behave identically through the runner", () => {
    let state = TARGET_BLOCK_RUNNER.createInitialState();
    state = TARGET_BLOCK_RUNNER.tick("active", state, {
      wrist: null,
      nowMs: T0,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => 0.5,
    }).state;
    const spawnedTarget = state.currentTarget;
    assert.ok(spawnedTarget, "a target still spawns even while the wrist is unavailable");

    // Tracker lost mid-block: no wrist sample this tick.
    const lost = TARGET_BLOCK_RUNNER.tick("active", state, {
      wrist: null,
      nowMs: T0 + 100,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => 0.5,
    });
    assert.equal(lost.ticked, true);
    assert.equal(lost.completionEvent, null);
    assert.equal(lost.state.wristInside, false);
    assert.equal(lost.state.currentTarget?.id, spawnedTarget!.id, "target is preserved, not reset, during tracker loss");

    // Tracker recovers: wrist reappears at the same target and registers a hit normally.
    const recovered = TARGET_BLOCK_RUNNER.tick("active", lost.state, {
      wrist: { x: spawnedTarget!.x, y: spawnedTarget!.y },
      nowMs: T0 + 200,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => 0.5,
    });
    assert.ok(recovered.completionEvent, "recovery lets a hit register exactly as it would without the runner wrapper");
  });
});

/**
 * CHANGE-004 — attempt plumbing through the runner.
 *
 * These tests assert TRANSPORT, not clinical behaviour. The rules they exercise (when an
 * attempt starts, when it expires, that contact wins at the boundary) are owned and
 * already covered by target-attempt-lifecycle.test.ts; what is proven here is that the
 * runner neither loses nor alters any of it.
 */
describe("target-block-runner — CHANGE-004 attempt input forwarding", () => {
  it("1. forwards blockElapsedSeconds — the attempt baseline is stamped from it, and absent without it", () => {
    const withClock = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput({ blockElapsedSeconds: 12 }),
    );
    assert.equal(withClock.state.currentTarget?.spawnedAtBlockElapsedS, 12);
    assert.equal(withClock.attemptStartedEvents[0]?.startedAtBlockElapsedS, 12);

    // Legacy caller: no block clock reaches the lifecycle, so no attempt can ever expire.
    const withoutClock = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput(),
    );
    assert.equal(withoutClock.state.currentTarget?.spawnedAtBlockElapsedS, undefined);
    assert.equal(withoutClock.attemptStartedEvents[0]?.startedAtBlockElapsedS, null);
  });

  it("2. forwards optional attemptTimeoutMs — expiration happens only when it is supplied", () => {
    const spawned = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput({ blockElapsedSeconds: 0, attemptTimeoutMs: FIXTURE_TIMEOUT_MS }),
    );
    const atThreshold = tickInput({
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      blockElapsedSeconds: FIXTURE_TIMEOUT_MS / 1000,
    });

    const expired = TARGET_BLOCK_RUNNER.tick("active", spawned.state, {
      ...atThreshold,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
    });
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal(expired.attemptTimeoutEvent?.attemptTimeoutMs, FIXTURE_TIMEOUT_MS);

    // Same elapsed time, timeout omitted: the runner invents none, so nothing expires.
    const notConfigured = TARGET_BLOCK_RUNNER.tick("active", spawned.state, atThreshold);
    assert.equal(notConfigured.attemptTimeoutEvent, null);
    assert.equal(
      notConfigured.state.currentTarget?.id,
      spawned.state.currentTarget?.id,
      "the un-configured attempt keeps its target rather than being replaced",
    );
  });

  it("3. forwards optional levelDegrees onto the target and its attempt-start event", () => {
    const withLevel = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput({ levelDegrees: FIXTURE_LEVEL_DEGREES }),
    );
    assert.equal(withLevel.state.currentTarget?.levelDegrees, FIXTURE_LEVEL_DEGREES);
    assert.equal(withLevel.attemptStartedEvents[0]?.levelDegrees, FIXTURE_LEVEL_DEGREES);

    const withoutLevel = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput(),
    );
    assert.equal(withoutLevel.state.currentTarget?.levelDegrees, undefined);
    assert.equal(withoutLevel.attemptStartedEvents[0]?.levelDegrees, undefined);
  });

  it("forwards optional compensationObservedDuringAttempt to the terminal event", () => {
    const spawned = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput({ blockElapsedSeconds: 0, attemptTimeoutMs: FIXTURE_TIMEOUT_MS }),
    );
    const observed = TARGET_BLOCK_RUNNER.tick("active", spawned.state, tickInput({
      nowMs: T0 + 100,
      blockElapsedSeconds: 0.1,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
      compensationObservedDuringAttempt: true,
    }));
    const expired = TARGET_BLOCK_RUNNER.tick("active", observed.state, tickInput({
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      blockElapsedSeconds: FIXTURE_TIMEOUT_MS / 1000,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
    }));
    assert.equal(expired.attemptTimeoutEvent?.compensatedDuringAttempt, true);

    // Never supplied ⇒ absent, which means "unknown" and must not become "clean".
    const untouched = TARGET_BLOCK_RUNNER.tick("active", spawned.state, tickInput({
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      blockElapsedSeconds: FIXTURE_TIMEOUT_MS / 1000,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
    }));
    assert.equal(untouched.attemptTimeoutEvent?.compensatedDuringAttempt, undefined);
  });
});

describe("target-block-runner — CHANGE-004 attempt output forwarding", () => {
  it("4. returns attemptStartedEvents unchanged from the gated lifecycle", () => {
    const input = tickInput({
      blockElapsedSeconds: 3,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
      levelDegrees: FIXTURE_LEVEL_DEGREES,
    });
    const direct = tickTargetLifecycleIfActive("active", createInitialTargetLifecycle(), input);
    const viaRunner = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      input,
    );
    assert.equal(viaRunner.attemptStartedEvents.length, 1);
    assert.deepEqual(viaRunner.attemptStartedEvents, direct.attemptStartedEvents);
  });

  it("5. returns attemptTimeoutEvent unchanged from the gated lifecycle", () => {
    const spawnInput = tickInput({ blockElapsedSeconds: 0, attemptTimeoutMs: FIXTURE_TIMEOUT_MS });
    const expireInput = tickInput({
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      blockElapsedSeconds: FIXTURE_TIMEOUT_MS / 1000,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
    });

    const directSpawn = tickTargetLifecycleIfActive(
      "active",
      createInitialTargetLifecycle(),
      spawnInput,
    );
    const direct = tickTargetLifecycleIfActive("active", directSpawn.state, expireInput);

    const runnerSpawn = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      spawnInput,
    );
    const viaRunner = TARGET_BLOCK_RUNNER.tick("active", runnerSpawn.state, expireInput);

    assert.ok(viaRunner.attemptTimeoutEvent);
    assert.deepEqual(viaRunner.attemptTimeoutEvent, direct.attemptTimeoutEvent);
    assert.equal(viaRunner.completionEvent, null, "an expired attempt is never also a hit");
    assert.equal(
      viaRunner.attemptStartedEvents.length,
      0,
      "CHANGE-008: a terminal tick carries its outcome alone; the successor starts later",
    );

    // The successor — and its attempt start — arrive on the following tick, forwarded by
    // the runner just as unmodified as the terminal event was.
    const successorInput = tickInput({
      nowMs: T0 + FIXTURE_TIMEOUT_MS + 16,
      blockElapsedSeconds: FIXTURE_TIMEOUT_MS / 1000 + 0.016,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
    });
    const successor = TARGET_BLOCK_RUNNER.tick("active", viaRunner.state, successorInput);
    assert.equal(successor.attemptStartedEvents.length, 1);
    assert.equal(successor.attemptTimeoutEvent, null);
    assert.deepEqual(
      successor.attemptStartedEvents,
      tickTargetLifecycleIfActive("active", direct.state, successorInput).attemptStartedEvents,
    );
  });

  it("6. preserves hitEvent behaviour while carrying attempt outputs alongside it", () => {
    const spawned = TARGET_BLOCK_RUNNER.tick(
      "active",
      TARGET_BLOCK_RUNNER.createInitialState(),
      tickInput({ blockElapsedSeconds: 0, attemptTimeoutMs: FIXTURE_TIMEOUT_MS }),
    );
    const target = spawned.state.currentTarget;
    assert.ok(target);

    const hitInput = tickInput({
      wrist: { x: target.x, y: target.y },
      nowMs: T0 + 500,
      blockElapsedSeconds: 0.5,
      attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
    });
    const direct = tickTargetLifecycleIfActive("active", spawned.state, hitInput);
    const viaRunner = TARGET_BLOCK_RUNNER.tick("active", spawned.state, hitInput);

    assert.ok(viaRunner.completionEvent);
    assert.deepEqual(viaRunner.completionEvent, direct.hitEvent);
    assert.equal(viaRunner.attemptTimeoutEvent, null);
    assert.equal(
      viaRunner.attemptStartedEvents.length,
      0,
      "CHANGE-008: a contacted target's successor starts on a later tick, not this one",
    );

    const successor = TARGET_BLOCK_RUNNER.tick(
      "active",
      viaRunner.state,
      tickInput({ nowMs: T0 + 516, blockElapsedSeconds: 0.516, attemptTimeoutMs: FIXTURE_TIMEOUT_MS }),
    );
    assert.equal(successor.attemptStartedEvents.length, 1);
    assert.notEqual(successor.attemptStartedEvents[0]?.targetId, target.id);
  });

  for (const sessionState of ["paused", "safetyHold", "completed"] as const) {
    it(`${sessionState} → no attempt starts and no attempt expires, even with timing configured`, () => {
      const spawned = TARGET_BLOCK_RUNNER.tick(
        "active",
        TARGET_BLOCK_RUNNER.createInitialState(),
        tickInput({ blockElapsedSeconds: 0, attemptTimeoutMs: FIXTURE_TIMEOUT_MS }),
      );

      const gated = TARGET_BLOCK_RUNNER.tick(sessionState, spawned.state, tickInput({
        nowMs: T0 + FIXTURE_TIMEOUT_MS * 10,
        blockElapsedSeconds: (FIXTURE_TIMEOUT_MS * 10) / 1000,
        attemptTimeoutMs: FIXTURE_TIMEOUT_MS,
      }));
      assert.equal(gated.ticked, false);
      assert.deepEqual(gated.attemptStartedEvents, []);
      assert.equal(gated.attemptTimeoutEvent, null);
      assert.equal(gated.state, spawned.state, "gated ticks return the state untouched");
    });
  }
});
