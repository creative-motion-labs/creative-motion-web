/**
 * CHANGE-003 — target attempt lifecycle.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/target-attempt-lifecycle.test.ts
 *
 * Scope of this suite: the interaction-domain attempt contract only — when an attempt
 * starts, how its pause-aware active time is measured, when it expires, and the
 * exactly-once guarantee on its terminal result. No clinical meaning is asserted here:
 * an expired attempt is not a diagnosis, and every timeout value below is a test fixture
 * with no clinical validation.
 *
 * The two clocks are exercised separately on purpose: `nowMs` (presentation/event) and
 * `blockElapsedSeconds` (pause-aware attempt time). Several tests advance one while
 * freezing the other, which is exactly what the orchestrator does during a pause.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "./target-generator";
import {
  createInitialTargetLifecycle,
  tickTargetLifecycle,
  type TargetLifecycleState,
  type TargetLifecycleTickInput,
} from "./target-lifecycle";
import type { NormalizedPoint } from "./types";

const T0 = 5_000_000;
const deterministicRandom = () => 0.42;

/** Fixture only — carries no clinical validation. */
const TIMEOUT_MS = 4_000;

/**
 * A tracked wrist at rest, far outside `DEFAULT_SAFE_TARGET_BOUNDS`, so no target can
 * ever be within its collision radius.
 *
 * This is what "the patient is being measured and is not at the target" looks like, and
 * it is the default for these tests (REVIEW FIX, BLOCKER 2). The default used to be
 * `wrist: null`, which conflated two different facts: a patient who is not reaching, and
 * a runtime that cannot see the patient's wrist. Every expiration test in this file was
 * written against the second while claiming to test the first. They now supply a real
 * measurement, and `wrist: null` means only what it says.
 */
const RESTING_WRIST: NormalizedPoint = { x: 0.02, y: 0.97 };

function baseInput(
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

/** Spawns the first target with attempt timing configured. */
function spawnedWithTiming(blockElapsedSeconds = 0) {
  return tickTargetLifecycle(
    createInitialTargetLifecycle(),
    baseInput({ blockElapsedSeconds, attemptTimeoutMs: TIMEOUT_MS }),
  );
}

function wristAt(state: TargetLifecycleState) {
  const target = state.currentTarget;
  assert.ok(target, "expected an active target");
  return { x: target.x, y: target.y };
}

/**
 * CHANGE-008: a terminal tick retires its target and returns — the successor is built on a
 * LATER tick, which is the window in which the caller applies the attempt's adaptive
 * outcome. Tests that care about the successor therefore advance one tick rather than
 * reading it off the terminal result.
 */
function advanceToSuccessor(
  state: TargetLifecycleState,
  overrides: Partial<TargetLifecycleTickInput> = {},
) {
  assert.equal(state.currentTarget, null, "expected a retired target awaiting its successor");
  const result = tickTargetLifecycle(state, baseInput(overrides));
  assert.ok(result.state.currentTarget, "expected the successor to spawn on this tick");
  return result;
}

describe("target attempt lifecycle — attempt start", () => {
  it("1. spawning a target starts exactly one attempt", () => {
    const spawned = spawnedWithTiming(12);
    assert.equal(spawned.attemptStartedEvents.length, 1);
    assert.ok(spawned.state.currentTarget);

    // A tick that spawns nothing starts no attempt.
    const idle = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 100, blockElapsedSeconds: 12.1, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(idle.attemptStartedEvents.length, 0);
  });

  it("2. attempt identity is the target identity and sequence — no second counter", () => {
    const spawned = spawnedWithTiming(12);
    const attempt = spawned.attemptStartedEvents[0];
    assert.equal(attempt.targetId, spawned.state.currentTarget!.id);
    assert.equal(attempt.sequence, spawned.state.sequence);
    assert.equal(attempt.sequence, 1);
    assert.equal(attempt.startedAtMs, spawned.state.currentTarget!.spawnedAtMs);
    assert.equal(attempt.startedAtBlockElapsedS, 12);
    assert.equal(attempt.side, "right");

    const hit = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 500,
        blockElapsedSeconds: 12.5,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    // The terminal tick carries the outcome only — no successor, no second attempt start.
    assert.ok(hit.hitEvent);
    assert.equal(hit.attemptStartedEvents.length, 0);
    assert.equal(hit.state.currentTarget, null);

    // The successor attempt keeps identity aligned with the successor target.
    const successor = advanceToSuccessor(hit.state, {
      nowMs: T0 + 600,
      blockElapsedSeconds: 12.6,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    assert.equal(successor.attemptStartedEvents.length, 1);
    assert.equal(successor.attemptStartedEvents[0].sequence, 2);
    assert.equal(successor.attemptStartedEvents[0].targetId, successor.state.currentTarget!.id);
  });

  it("carries the reach side supplied to the tick, without claiming an affected side", () => {
    const left = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      baseInput({ side: "left", blockElapsedSeconds: 0, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(left.attemptStartedEvents[0].side, "left");
  });
});

describe("target attempt lifecycle — legacy compatibility", () => {
  it("3. an undefined timeout preserves legacy lifecycle behavior exactly", () => {
    // Legacy call shape: no blockElapsedSeconds, no attemptTimeoutMs.
    let state = tickTargetLifecycle(createInitialTargetLifecycle(), baseInput()).state;
    const firstId = state.currentTarget?.id;
    assert.ok(firstId);
    assert.equal(state.currentTarget!.spawnedAtBlockElapsedS, undefined);
    assert.equal(state.interaction.targetsShown, 1);

    // Wall-clock time far beyond any plausible timeout must change nothing.
    for (const nowMs of [T0 + 60_000, T0 + 600_000, T0 + 6_000_000]) {
      const idle = tickTargetLifecycle(state, baseInput({ nowMs }));
      assert.equal(idle.attemptTimeoutEvent, null);
      assert.equal(idle.hitEvent, null);
      assert.equal(idle.state.currentTarget!.id, firstId);
      state = idle.state;
    }

    const hit = tickTargetLifecycle(
      state,
      baseInput({ wrist: wristAt(state), nowMs: T0 + 6_001_000 }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.attemptTimeoutEvent, null);
    assert.equal(hit.state.interaction.targetsReached, 1);

    const successor = advanceToSuccessor(hit.state, { nowMs: T0 + 6_002_000 });
    assert.notEqual(successor.state.currentTarget!.id, firstId);
    assert.equal(successor.state.interaction.targetsShown, 2);
  });

  it("a configured timeout without block elapsed time cannot expire an attempt", () => {
    // No pause-aware clock is available, so there is no baseline to measure against and
    // the lifecycle must not fall back to wall-clock time.
    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      baseInput({ attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(spawned.state.currentTarget!.spawnedAtBlockElapsedS, undefined);
    assert.equal(spawned.attemptStartedEvents[0].startedAtBlockElapsedS, null);

    const later = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 10 * TIMEOUT_MS, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(later.attemptTimeoutEvent, null);
    assert.equal(later.state.currentTarget!.id, spawned.state.currentTarget!.id);
  });
});

describe("target attempt lifecycle — expiration", () => {
  it("4. an active target does not expire before the threshold", () => {
    const spawned = spawnedWithTiming(10);
    for (const blockElapsedSeconds of [10, 11, 13, 13.999]) {
      const tick = tickTargetLifecycle(
        spawned.state,
        baseInput({
          nowMs: T0 + 1_000,
          blockElapsedSeconds,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      assert.equal(tick.attemptTimeoutEvent, null, `unexpected expiry at ${blockElapsedSeconds}s`);
      assert.equal(tick.state.currentTarget!.id, spawned.state.currentTarget!.id);
    }
  });

  it("5. emits exactly one timeout event at the threshold, and reports active time", () => {
    const spawned = spawnedWithTiming(10);
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 4_200, blockElapsedSeconds: 14, attemptTimeoutMs: TIMEOUT_MS }),
    );
    const event = expired.attemptTimeoutEvent;
    assert.ok(event);
    assert.equal(event.targetId, spawned.state.currentTarget!.id);
    assert.equal(event.sequence, 1);
    assert.equal(event.activeElapsedMs, TIMEOUT_MS);
    assert.equal(event.attemptTimeoutMs, TIMEOUT_MS);
    assert.equal(event.expiredAtBlockElapsedS, 14);
    assert.equal(event.expiredAtMs, T0 + 4_200);
  });

  it("exact threshold equality expires the attempt (>=, not >)", () => {
    const spawned = spawnedWithTiming(10);
    const atThreshold = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 1, blockElapsedSeconds: 14, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(atThreshold.attemptTimeoutEvent);
    assert.equal(atThreshold.attemptTimeoutEvent.activeElapsedMs, TIMEOUT_MS);

    const justBelow = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 1, blockElapsedSeconds: 13.9999, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(justBelow.attemptTimeoutEvent, null);
  });

  it("6. an expired attempt emits no hit event", () => {
    const spawned = spawnedWithTiming(10);
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal(expired.hitEvent, null);
  });

  it("7. an expired attempt does not increment targetsReached", () => {
    const spawned = spawnedWithTiming(10);
    const before = spawned.state.interaction.targetsReached;
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal(expired.state.interaction.targetsReached, before);
    assert.equal(expired.state.interaction.targetsReached, 0);
    assert.deepEqual(expired.state.interaction.targetHitTimestampsMs, []);
  });

  it("8. an expired attempt appends no reaction time", () => {
    const spawned = spawnedWithTiming(10);
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.deepEqual(expired.state.interaction.reactionTimesMs, []);
  });

  it("9. the same target can never expire twice", () => {
    const spawned = spawnedWithTiming(10);
    const expiredId = spawned.state.currentTarget!.id;
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);

    let state = expired.state;
    const seenTimeoutIds = [expired.attemptTimeoutEvent.targetId];
    // Keep ticking well past the original threshold with no contact at all.
    for (let i = 1; i <= 12; i++) {
      const tick = tickTargetLifecycle(
        state,
        baseInput({
          nowMs: T0 + 5_000 + i * 500,
          blockElapsedSeconds: 15 + i * 0.5,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      if (tick.attemptTimeoutEvent) seenTimeoutIds.push(tick.attemptTimeoutEvent.targetId);
      state = tick.state;
    }
    assert.equal(seenTimeoutIds.filter((id) => id === expiredId).length, 1);
    assert.equal(new Set(seenTimeoutIds).size, seenTimeoutIds.length);
  });

  it("10. the lifecycle proceeds to a fresh target after an expiry", () => {
    const spawned = spawnedWithTiming(10);
    const expiredId = spawned.state.currentTarget!.id;
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    // CHANGE-008: the expiring tick retires the target and stops there, so the caller can
    // adapt before the patient is shown the next one. No successor yet, no attempt start.
    assert.equal(expired.state.currentTarget, null);
    assert.equal(expired.attemptStartedEvents.length, 0);
    // An expiry produces no hit presentation effects, so nothing withholds the successor.
    assert.equal(expired.state.exitingTarget, null);
    assert.equal(expired.state.spawnLockedUntilMs, null);

    const successor = advanceToSuccessor(expired.state, {
      nowMs: T0 + 5_100,
      blockElapsedSeconds: 15.1,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    assert.notEqual(successor.state.currentTarget!.id, expiredId);
    assert.equal(successor.state.sequence, 2);
    assert.equal(successor.state.interaction.targetsShown, 2);
    assert.equal(successor.state.targetHit, false);
    // The successor attempt is announced like any other.
    assert.equal(successor.attemptStartedEvents.length, 1);
    assert.equal(successor.attemptStartedEvents[0].targetId, successor.state.currentTarget!.id);

    // The successor is contactable normally.
    const hit = tickTargetLifecycle(
      successor.state,
      baseInput({
        wrist: wristAt(successor.state),
        nowMs: T0 + 5_500,
        blockElapsedSeconds: 15.5,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.state.interaction.targetsReached, 1);
  });

  it("13. a new target receives a fresh expiry baseline", () => {
    const spawned = spawnedWithTiming(10);
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);

    // The successor's baseline is taken when it actually spawns — the tick AFTER the one
    // that expired its predecessor, not the expiring tick itself.
    const successor = advanceToSuccessor(expired.state, {
      nowMs: T0 + 5_000,
      blockElapsedSeconds: 15,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    assert.equal(successor.state.currentTarget!.spawnedAtBlockElapsedS, 15);
    assert.equal(successor.attemptStartedEvents[0].startedAtBlockElapsedS, 15);

    // Just under a full fresh window measured from 15s — must not expire.
    const early = tickTargetLifecycle(
      successor.state,
      baseInput({ nowMs: T0 + 8_900, blockElapsedSeconds: 18.9, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(early.attemptTimeoutEvent, null);

    // A full fresh window later — expires on its own baseline, not the first target's.
    const second = tickTargetLifecycle(
      successor.state,
      baseInput({ nowMs: T0 + 9_000, blockElapsedSeconds: 19, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(second.attemptTimeoutEvent);
    assert.equal(second.attemptTimeoutEvent.activeElapsedMs, TIMEOUT_MS);
    assert.equal(second.attemptTimeoutEvent.sequence, 2);
  });

  it("14. frozen block elapsed time does not burn attempt time", () => {
    const spawned = spawnedWithTiming(10);
    let state = spawned.state;

    // Pause: wall clock races ahead by minutes while block elapsed time is frozen at 12s.
    for (let i = 1; i <= 10; i++) {
      const tick = tickTargetLifecycle(
        state,
        baseInput({
          nowMs: T0 + i * 30_000,
          blockElapsedSeconds: 12,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      assert.equal(tick.attemptTimeoutEvent, null, `wall clock leaked into attempt time at tick ${i}`);
      state = tick.state;
    }
    assert.equal(state.currentTarget!.id, spawned.state.currentTarget!.id);

    // Resume: attempt time continues from the same 2s of active time already spent.
    const stillActive = tickTargetLifecycle(
      state,
      baseInput({ nowMs: T0 + 400_000, blockElapsedSeconds: 13.9, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(stillActive.attemptTimeoutEvent, null);

    const expired = tickTargetLifecycle(
      state,
      baseInput({ nowMs: T0 + 400_100, blockElapsedSeconds: 14, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal(expired.attemptTimeoutEvent.activeElapsedMs, TIMEOUT_MS);
  });

  it("block elapsed time restarting backwards never expires an attempt", () => {
    const spawned = spawnedWithTiming(30);
    const rewound = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 1_000, blockElapsedSeconds: 0, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(rewound.attemptTimeoutEvent, null);
  });
});

describe("target attempt lifecycle — success and boundary precedence", () => {
  it("11. contact before the threshold prevents any expiry for that target", () => {
    const spawned = spawnedWithTiming(10);
    const contactedId = spawned.state.currentTarget!.id;
    const hit = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 2_000,
        blockElapsedSeconds: 12,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.hitEvent.targetId, contactedId);
    assert.equal(hit.attemptTimeoutEvent, null);

    // Push past the moment the contacted target would have expired: it is gone, and only
    // the successor's own baseline can ever expire.
    const later = tickTargetLifecycle(
      hit.state,
      baseInput({ nowMs: T0 + 4_100, blockElapsedSeconds: 14.1, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(later.attemptTimeoutEvent, null);
  });

  /**
   * BOUNDARY PRECEDENCE RULE: contact wins at the exact threshold. The wrist is inside the
   * target on this tick, so reporting an incomplete attempt would be a false negative.
   */
  it("contact wins at the exact expiry threshold — success only, never both", () => {
    const spawned = spawnedWithTiming(10);
    const boundary = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 4_000,
        blockElapsedSeconds: 14, // exactly TIMEOUT_MS of active attempt time
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(boundary.hitEvent);
    assert.equal(boundary.hitEvent.targetId, spawned.state.currentTarget!.id);
    assert.equal(boundary.attemptTimeoutEvent, null);
    assert.equal(boundary.state.interaction.targetsReached, 1);
  });

  it("no contact at the exact threshold expires the attempt", () => {
    const spawned = spawnedWithTiming(10);
    const away = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: { x: 0.02, y: 0.98 },
        nowMs: T0 + 4_000,
        blockElapsedSeconds: 14,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(away.attemptTimeoutEvent);
    assert.equal(away.hitEvent, null);
  });

  it("12. contact stays exactly-once per target while the wrist remains inside", () => {
    const spawned = spawnedWithTiming(10);
    const wrist = wristAt(spawned.state);
    const contactedId = spawned.state.currentTarget!.id;

    // The wrist is parked on the first target and never moves. Whatever the generator
    // does with successors, no single target may ever be contacted twice.
    let state = spawned.state;
    const contactedIds: string[] = [];
    for (let i = 0; i <= 6; i++) {
      const tick = tickTargetLifecycle(
        state,
        baseInput({
          wrist,
          nowMs: T0 + 1_000 + i * 100,
          blockElapsedSeconds: 11 + i * 0.1,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      if (tick.hitEvent) contactedIds.push(tick.hitEvent.targetId);
      state = tick.state;
    }
    assert.ok(contactedIds.includes(contactedId));
    assert.equal(contactedIds.filter((id) => id === contactedId).length, 1);
    assert.equal(new Set(contactedIds).size, contactedIds.length);
    assert.equal(state.interaction.targetsReached, contactedIds.length);
    assert.equal(state.interaction.reactionTimesMs.length, contactedIds.length);
  });

  it("a hit exit transition holds the attempt clock and expires nothing mid-transition", () => {
    const spawned = spawnedWithTiming(10);
    const hit = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 1_000,
        blockElapsedSeconds: 11,
        attemptTimeoutMs: TIMEOUT_MS,
        hitExitTransitionMs: 400,
      }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.state.currentTarget, null);
    assert.ok(hit.state.exitingTarget);
    assert.equal(hit.state.spawnLockedUntilMs, T0 + 1_400);
    // No successor attempt starts until the transition completes.
    assert.equal(hit.attemptStartedEvents.length, 0);

    // Mid-transition, with block time already far past the original threshold.
    const during = tickTargetLifecycle(
      hit.state,
      baseInput({
        nowMs: T0 + 1_200,
        blockElapsedSeconds: 30,
        attemptTimeoutMs: TIMEOUT_MS,
        hitExitTransitionMs: 400,
      }),
    );
    assert.equal(during.attemptTimeoutEvent, null);
    assert.equal(during.attemptStartedEvents.length, 0);

    // After the transition the successor spawns with a baseline taken at that moment.
    const after = tickTargetLifecycle(
      during.state,
      baseInput({
        nowMs: T0 + 1_500,
        blockElapsedSeconds: 31,
        attemptTimeoutMs: TIMEOUT_MS,
        hitExitTransitionMs: 400,
      }),
    );
    assert.equal(after.attemptTimeoutEvent, null);
    assert.equal(after.attemptStartedEvents.length, 1);
    assert.equal(after.state.currentTarget!.spawnedAtBlockElapsedS, 31);
  });
});

describe("target attempt lifecycle — tracking-loss safety", () => {
  /**
   * Tracking loss is NOT patient failure. An absent wrist is never itself a reason to end
   * an attempt; only elapsed MEASURABLE attempt time is.
   *
   * This suite covers the case where block time is frozen upstream — a safety hold from a
   * global tracker loss. That upstream freeze was once believed to cover every tracking
   * gap, which is exactly why the wrist-only gap went unnoticed: it happens with the
   * session active and the block clock running. See the blocker-2 suite below.
   */
  it("an absent wrist never expires an attempt on its own", () => {
    const spawned = spawnedWithTiming(10);
    let state = spawned.state;
    // Block time frozen (safety hold) while the wrist is unavailable for a long while.
    for (let i = 1; i <= 20; i++) {
      const tick = tickTargetLifecycle(
        state,
        baseInput({
          wrist: null,
          nowMs: T0 + i * 10_000,
          blockElapsedSeconds: 10,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      assert.equal(tick.attemptTimeoutEvent, null, `absent wrist ended the attempt at tick ${i}`);
      state = tick.state;
    }
    assert.equal(state.currentTarget!.id, spawned.state.currentTarget!.id);
    assert.equal(state.interaction.targetsShown, 1);
  });

  it("the timeout event carries no reason field that could absorb tracking loss", () => {
    const spawned = spawnedWithTiming(10);
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal("reason" in expired.attemptTimeoutEvent, false);
    assert.equal("trackingLost" in expired.attemptTimeoutEvent, false);
  });
});

// ── REVIEW FIX, BLOCKER 2 (PR #240) ─────────────────────────────────────────────
// A wrist-only measurement gap must not consume the attempt window.
//
// The scenario Aisha confirmed: session ACTIVE, no `trackerLost`, no safety hold, block
// elapsed time advancing normally — and `primaryWristNormalized === null`, because the
// affected-side wrist has its own per-joint presence rule in the detector. Before the fix
// that interval was charged against `attemptTimeoutMs`, so a long enough gap expired the
// attempt into `incomplete`, which the adaptive engine counts as patient struggle.
//
// The chosen semantic is FREEZE, not void: the attempt stays alive and keeps its
// identity, and only its measurable time stops advancing. The adaptive consequence — no
// struggleStreak increment — is proved end to end in
// `adaptive/immediate-successor-feedback.test`.

describe("target attempt lifecycle — wrist measurement availability (review fix, blocker 2)", () => {
  /** Ticks the lifecycle across a span of block seconds, one tick per second. */
  function tickAcross(
    state: TargetLifecycleState,
    fromS: number,
    toS: number,
    overrides: Partial<TargetLifecycleTickInput> = {},
  ) {
    let current = state;
    const timeouts = [];
    for (let s = fromS; s <= toS; s += 1) {
      const tick = tickTargetLifecycle(
        current,
        baseInput({
          nowMs: T0 + s * 1_000,
          blockElapsedSeconds: s,
          attemptTimeoutMs: TIMEOUT_MS,
          ...overrides,
        }),
      );
      if (tick.attemptTimeoutEvent) timeouts.push(tick.attemptTimeoutEvent);
      current = tick.state;
    }
    return { state: current, timeouts };
  }

  // 2, 4, 6, 7 — the headline scenario.
  it("2/4/6/7. an active attempt does not expire across a long wrist gap on a live clock", () => {
    const spawned = spawnedWithTiming(0);
    const attemptId = spawned.state.currentTarget!.id;

    // 40 block seconds — ten times the fixture window — of advancing, unfrozen block
    // time, with a healthy session and no wrist sample on any frame.
    const { state, timeouts } = tickAcross(spawned.state, 1, 40, { wrist: null });

    assert.deepEqual(timeouts, [], "an unmeasurable interval must expire nothing");
    // FROZEN, NOT VOIDED: same target, same attempt identity, no churn.
    assert.equal(state.currentTarget?.id, attemptId, "the attempt is still alive");
    assert.equal(state.sequence, 1, "no successor was manufactured");
    assert.equal(state.interaction.targetsShown, 1);
    // And the whole gap was accounted for as unmeasurable.
    assert.equal(state.attemptUnmeasuredElapsedS, 40);
  });

  // 3 — a gap that starts just short of the boundary must not push it over.
  it("3. a gap opening just before the boundary holds the attempt instead of expiring it", () => {
    const spawned = spawnedWithTiming(0);
    // 3.9s of measured time — just under the 4s window.
    const measured = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 3_900, blockElapsedSeconds: 3.9, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.equal(measured.attemptTimeoutEvent, null);

    // The wrist disappears exactly here. Block time keeps running well past the window.
    const { state, timeouts } = tickAcross(measured.state, 4, 30, { wrist: null });
    assert.deepEqual(timeouts, [], "the last 0.1s must not be paid out of unmeasured time");
    assert.equal(state.currentTarget?.id, spawned.state.currentTarget!.id);
  });

  // 5, 12 — recovery, and the window resuming rather than restarting or instantly firing.
  it("5/12. the window resumes on recovery — it neither restarts nor expires instantly", () => {
    const spawned = spawnedWithTiming(0);
    // 2 measured seconds of the 4s window are spent.
    const measured = tickAcross(spawned.state, 1, 2);
    assert.deepEqual(measured.timeouts, []);

    // 30 seconds of measurement gap.
    const gap = tickAcross(measured.state, 3, 32, { wrist: null });
    assert.deepEqual(gap.timeouts, [], "no expiry during the gap");
    assert.equal(gap.state.attemptUnmeasuredElapsedS, 30);

    // Measurement returns. 2 measured seconds remain, so second 33 is not yet enough...
    const resumedEarly = tickAcross(gap.state, 33, 33);
    assert.deepEqual(resumedEarly.timeouts, [], "no instant expiry against the gap");

    // ...and second 34 — the 4th measured second — reaches the threshold exactly.
    const expired = tickAcross(resumedEarly.state, 34, 34);
    assert.equal(expired.timeouts.length, 1, "measurable time still expires the attempt");
    assert.equal(expired.timeouts[0].targetId, spawned.state.currentTarget!.id);
    assert.equal(
      expired.timeouts[0].activeElapsedMs,
      TIMEOUT_MS,
      "the reported duration is measured time only — the 30s gap is excluded",
    );
  });

  // 1 — before any attempt exists there is nothing to protect, and nothing is charged.
  it("1. a wrist gap before the first target is not charged to the attempt that follows", () => {
    // The lifecycle is ticked with no wrist and no target for a long stretch. (In the real
    // runtime dispatch skips these ticks entirely; the lifecycle must be correct anyway.)
    const idle = tickAcross(createInitialTargetLifecycle(), 0, 0, { wrist: null });
    assert.ok(idle.state.currentTarget, "a tick with no target still spawns one");

    // The attempt that just spawned starts with a full, unspent window: it expires after
    // its own 4 measured seconds, not sooner and not later.
    const beforeThreshold = tickAcross(idle.state, 1, 3);
    assert.deepEqual(beforeThreshold.timeouts, []);
    const atThreshold = tickAcross(beforeThreshold.state, 4, 4);
    assert.equal(atThreshold.timeouts.length, 1);
    assert.equal(atThreshold.timeouts[0].activeElapsedMs, TIMEOUT_MS);
  });

  it("a gap in one attempt never shortens or lengthens the next", () => {
    const spawned = spawnedWithTiming(0);
    // Attempt 1: long gap, then measured time out to its expiry.
    const gap = tickAcross(spawned.state, 1, 20, { wrist: null });
    const expired = tickAcross(gap.state, 21, 24);
    assert.equal(expired.timeouts.length, 1, "attempt 1 expired on measured time");
    assert.equal(expired.state.currentTarget, null);
    assert.equal(expired.state.attemptUnmeasuredElapsedS, 0, "the accumulator was cleared");

    // Attempt 2 spawns and must get its own full, unspent window.
    const successor = tickAcross(expired.state, 25, 25);
    assert.ok(successor.state.currentTarget);
    assert.deepEqual(successor.timeouts, []);
    const stillRunning = tickAcross(successor.state, 26, 28);
    assert.deepEqual(stillRunning.timeouts, [], "attempt 2 did not inherit attempt 1's gap");
    const secondExpiry = tickAcross(stillRunning.state, 29, 29);
    assert.equal(secondExpiry.timeouts.length, 1);
    assert.equal(secondExpiry.timeouts[0].activeElapsedMs, TIMEOUT_MS);
  });

  // 14 — the exactly-once guarantee is untouched by the freeze.
  it("14. exactly-once survives a gap: an attempt held then expired ends only once", () => {
    const spawned = spawnedWithTiming(0);
    const attemptId = spawned.state.currentTarget!.id;
    const gap = tickAcross(spawned.state, 1, 15, { wrist: null });
    const after = tickAcross(gap.state, 16, 40);

    const forThisAttempt = after.timeouts.filter((t) => t.targetId === attemptId);
    assert.equal(forThisAttempt.length, 1, "the held attempt expired exactly once");
  });

  it("a hit during a wrist gap is impossible, but a hit right after recovery still counts", () => {
    const spawned = spawnedWithTiming(0);
    const gap = tickAcross(spawned.state, 1, 20, { wrist: null });
    assert.ok(gap.state.currentTarget, "the target is still there to be reached");

    // The patient's wrist reappears already on the target.
    const reached = tickTargetLifecycle(
      gap.state,
      baseInput({
        nowMs: T0 + 21_000,
        blockElapsedSeconds: 21,
        attemptTimeoutMs: TIMEOUT_MS,
        wrist: wristAt(gap.state),
      }),
    );
    assert.ok(reached.hitEvent, "the held attempt was still winnable");
    assert.equal(reached.attemptTimeoutEvent, null);
    assert.equal(reached.state.interaction.targetsReached, 1);
  });

  it("a wrist gap is not confused with a wrist that is simply away from the target", () => {
    const spawned = spawnedWithTiming(0);
    // Measured, and nowhere near the target: this IS the patient failing to reach.
    const measured = tickAcross(spawned.state, 1, 4);
    assert.equal(measured.timeouts.length, 1, "a measured non-reach expires normally");

    // The identical span with no measurement expires nothing.
    const unmeasured = tickAcross(spawnedWithTiming(0).state, 1, 4, { wrist: null });
    assert.deepEqual(unmeasured.timeouts, []);
  });
});

describe("target attempt lifecycle — timeout value boundaries", () => {
  it("a zero or negative timeout is treated as unconfigured, never as instant expiry", () => {
    for (const attemptTimeoutMs of [0, -1, -TIMEOUT_MS]) {
      const spawned = tickTargetLifecycle(
        createInitialTargetLifecycle(),
        baseInput({ blockElapsedSeconds: 10, attemptTimeoutMs }),
      );
      assert.equal(spawned.attemptTimeoutEvent, null, `spawn expired instantly at ${attemptTimeoutMs}`);
      assert.equal(spawned.state.interaction.targetsShown, 1);

      const later = tickTargetLifecycle(
        spawned.state,
        baseInput({ nowMs: T0 + 60_000, blockElapsedSeconds: 70, attemptTimeoutMs }),
      );
      assert.equal(later.attemptTimeoutEvent, null, `late expiry at ${attemptTimeoutMs}`);
      assert.equal(later.state.currentTarget!.id, spawned.state.currentTarget!.id);
    }
  });

  it("a non-finite timeout is treated as unconfigured", () => {
    for (const attemptTimeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const spawned = tickTargetLifecycle(
        createInitialTargetLifecycle(),
        baseInput({ blockElapsedSeconds: 10, attemptTimeoutMs }),
      );
      const later = tickTargetLifecycle(
        spawned.state,
        baseInput({ nowMs: T0 + 60_000, blockElapsedSeconds: 70, attemptTimeoutMs }),
      );
      assert.equal(later.attemptTimeoutEvent, null, `expired with timeout ${attemptTimeoutMs}`);
      assert.equal(later.state.currentTarget!.id, spawned.state.currentTarget!.id);
    }
  });

  it("a non-finite block elapsed value cannot expire an attempt", () => {
    const spawned = spawnedWithTiming(10);
    for (const blockElapsedSeconds of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const tick = tickTargetLifecycle(
        spawned.state,
        baseInput({ nowMs: T0 + 60_000, blockElapsedSeconds, attemptTimeoutMs: TIMEOUT_MS }),
      );
      assert.equal(tick.attemptTimeoutEvent, null, `expired with block elapsed ${blockElapsedSeconds}`);
    }
  });

  it("an absent current target produces no attempt result during a spawn lock", () => {
    const spawned = spawnedWithTiming(10);
    const hit = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 1_000,
        blockElapsedSeconds: 11,
        attemptTimeoutMs: TIMEOUT_MS,
        hitExitTransitionMs: 5_000,
      }),
    );
    assert.equal(hit.state.currentTarget, null);
    const locked = tickTargetLifecycle(
      hit.state,
      baseInput({
        nowMs: T0 + 2_000,
        blockElapsedSeconds: 100,
        attemptTimeoutMs: TIMEOUT_MS,
        hitExitTransitionMs: 5_000,
      }),
    );
    assert.equal(locked.attemptTimeoutEvent, null);
    assert.equal(locked.hitEvent, null);
    assert.equal(locked.attemptStartedEvents.length, 0);
  });
});

describe("target attempt lifecycle — optional metadata", () => {
  it("15. an optional placement level survives spawn → hit", () => {
    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      baseInput({ blockElapsedSeconds: 10, attemptTimeoutMs: TIMEOUT_MS, levelDegrees: 65 }),
    );
    assert.equal(spawned.state.currentTarget!.levelDegrees, 65);
    assert.equal(spawned.attemptStartedEvents[0].levelDegrees, 65);

    const hit = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 1_000,
        blockElapsedSeconds: 11,
        attemptTimeoutMs: TIMEOUT_MS,
        levelDegrees: 80, // the level for the NEXT target, not the one being contacted
      }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.hitEvent.levelDegrees, 65);

    // The next level reaches the successor on the tick that actually builds it — which,
    // since CHANGE-008, is the tick after the outcome rather than the same one.
    const successor = advanceToSuccessor(hit.state, {
      nowMs: T0 + 1_100,
      blockElapsedSeconds: 11.1,
      attemptTimeoutMs: TIMEOUT_MS,
      levelDegrees: 80,
    });
    assert.equal(successor.state.currentTarget!.levelDegrees, 80);
  });

  it("16. an optional placement level survives spawn → timeout", () => {
    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      baseInput({ blockElapsedSeconds: 10, attemptTimeoutMs: TIMEOUT_MS, levelDegrees: 65 }),
    );
    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({
        nowMs: T0 + 5_000,
        blockElapsedSeconds: 15,
        attemptTimeoutMs: TIMEOUT_MS,
        levelDegrees: 45,
      }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal(expired.attemptTimeoutEvent.levelDegrees, 65);

    const successor = advanceToSuccessor(expired.state, {
      nowMs: T0 + 5_100,
      blockElapsedSeconds: 15.1,
      attemptTimeoutMs: TIMEOUT_MS,
      levelDegrees: 45,
    });
    assert.equal(successor.state.currentTarget!.levelDegrees, 45);
  });

  it("17. no placement level is invented when the caller supplies none", () => {
    const spawned = spawnedWithTiming(10);
    assert.equal("levelDegrees" in spawned.state.currentTarget!, false);
    assert.equal("levelDegrees" in spawned.attemptStartedEvents[0], false);

    const expired = tickTargetLifecycle(
      spawned.state,
      baseInput({ nowMs: T0 + 5_000, blockElapsedSeconds: 15, attemptTimeoutMs: TIMEOUT_MS }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal("levelDegrees" in expired.attemptTimeoutEvent, false);

    const successor = advanceToSuccessor(expired.state, {
      nowMs: T0 + 5_100,
      blockElapsedSeconds: 15.1,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    assert.equal("levelDegrees" in successor.state.currentTarget!, false);

    const hit = tickTargetLifecycle(
      successor.state,
      baseInput({
        wrist: wristAt(successor.state),
        nowMs: T0 + 5_500,
        blockElapsedSeconds: 15.5,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(hit.hitEvent);
    assert.equal("levelDegrees" in hit.hitEvent, false);
  });

  it("a non-finite placement level is ignored rather than stamped on the target", () => {
    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      baseInput({ blockElapsedSeconds: 10, levelDegrees: Number.NaN }),
    );
    assert.equal("levelDegrees" in spawned.state.currentTarget!, false);
  });

  it("18. attempt-scoped compensation metadata accumulates and resets between targets", () => {
    // No compensation input at all → the field stays absent ("unknown", not "clean").
    const untouched = spawnedWithTiming(10);
    assert.equal(untouched.state.attemptCompensationObserved, null);
    const cleanHit = tickTargetLifecycle(
      untouched.state,
      baseInput({
        wrist: wristAt(untouched.state),
        nowMs: T0 + 500,
        blockElapsedSeconds: 10.5,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(cleanHit.hitEvent);
    assert.equal("compensatedDuringAttempt" in cleanHit.hitEvent, false);

    // Reported once mid-attempt → sticky for the rest of that attempt.
    const spawned = spawnedWithTiming(10);
    const reported = tickTargetLifecycle(
      spawned.state,
      baseInput({
        nowMs: T0 + 500,
        blockElapsedSeconds: 10.5,
        attemptTimeoutMs: TIMEOUT_MS,
        compensationObservedDuringAttempt: true,
      }),
    );
    assert.equal(reported.state.attemptCompensationObserved, true);
    const clearedLater = tickTargetLifecycle(
      reported.state,
      baseInput({
        nowMs: T0 + 700,
        blockElapsedSeconds: 10.7,
        attemptTimeoutMs: TIMEOUT_MS,
        compensationObservedDuringAttempt: false,
      }),
    );
    assert.equal(clearedLater.state.attemptCompensationObserved, true);

    const hit = tickTargetLifecycle(
      clearedLater.state,
      baseInput({
        wrist: wristAt(clearedLater.state),
        nowMs: T0 + 900,
        blockElapsedSeconds: 10.9,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.hitEvent.compensatedDuringAttempt, true);
    // Reset for the successor attempt — nothing leaks forward.
    assert.equal(hit.state.attemptCompensationObserved, null);

    // ...and it does not change difficulty or any interaction count.
    assert.equal(hit.state.interaction.targetsReached, 1);

    // Compensation also rides along an expired attempt, then resets.
    const successor = advanceToSuccessor(hit.state, {
      nowMs: T0 + 1_000,
      blockElapsedSeconds: 11,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    assert.equal(successor.state.attemptCompensationObserved, null);
    const compensatedExpiry = tickTargetLifecycle(
      successor.state,
      baseInput({
        nowMs: T0 + 5_000,
        blockElapsedSeconds: 15,
        attemptTimeoutMs: TIMEOUT_MS,
        compensationObservedDuringAttempt: true,
      }),
    );
    assert.ok(compensatedExpiry.attemptTimeoutEvent);
    assert.equal(compensatedExpiry.attemptTimeoutEvent.compensatedDuringAttempt, true);
    assert.equal(compensatedExpiry.state.attemptCompensationObserved, null);
  });
});

describe("target attempt lifecycle — purity", () => {
  it("19. never mutates the state or input objects it is given", () => {
    const spawned = spawnedWithTiming(10);
    const priorState = spawned.state;
    const snapshot = structuredClone(priorState);
    const input = baseInput({
      wrist: { x: 0.5, y: 0.5 },
      nowMs: T0 + 5_000,
      blockElapsedSeconds: 15,
      attemptTimeoutMs: TIMEOUT_MS,
      levelDegrees: 70,
      compensationObservedDuringAttempt: true,
    });
    const inputSnapshot = structuredClone({ ...input, random: undefined });

    const result = tickTargetLifecycle(priorState, input);
    assert.ok(result.attemptTimeoutEvent);

    assert.deepEqual(priorState, snapshot);
    assert.deepEqual({ ...input, random: undefined }, inputSnapshot);
    assert.notEqual(result.state, priorState);

    // A terminal tick changes no interaction counter, so it legitimately carries the same
    // (never mutated) interaction object forward. The tick that DOES change one must
    // replace it rather than write through the shared reference.
    const successor = advanceToSuccessor(result.state, {
      nowMs: T0 + 5_100,
      blockElapsedSeconds: 15.1,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    assert.notEqual(successor.state.interaction, priorState.interaction);
    assert.deepEqual(priorState, snapshot);
  });

  it("appends metrics by replacing arrays rather than mutating the prior ones", () => {
    const spawned = spawnedWithTiming(10);
    const priorReactionTimes = spawned.state.interaction.reactionTimesMs;
    const priorTimestamps = spawned.state.interaction.targetHitTimestampsMs;

    const hit = tickTargetLifecycle(
      spawned.state,
      baseInput({
        wrist: wristAt(spawned.state),
        nowMs: T0 + 1_000,
        blockElapsedSeconds: 11,
        attemptTimeoutMs: TIMEOUT_MS,
      }),
    );
    assert.ok(hit.hitEvent);
    assert.notEqual(hit.state.interaction.reactionTimesMs, priorReactionTimes);
    assert.notEqual(hit.state.interaction.targetHitTimestampsMs, priorTimestamps);
    assert.deepEqual(priorReactionTimes, []);
    assert.deepEqual(priorTimestamps, []);
  });

  it("re-ticking the same prior state is deterministic and repeatable", () => {
    const spawned = spawnedWithTiming(10);
    const input = baseInput({
      nowMs: T0 + 5_000,
      blockElapsedSeconds: 15,
      attemptTimeoutMs: TIMEOUT_MS,
    });
    const first = tickTargetLifecycle(spawned.state, input);
    const second = tickTargetLifecycle(spawned.state, input);
    assert.deepEqual(first.attemptTimeoutEvent, second.attemptTimeoutEvent);
    assert.deepEqual(first.state.interaction, second.state.interaction);
  });
});
