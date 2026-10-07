/**
 * REVIEW-FIX-003 — a wrist measurement gap is not a measured exit.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/wrist-measurement-gap.test.ts
 *
 * THE INVARIANT UNDER TEST
 * ------------------------
 *     missing measurement != measured exit
 *
 * A hit is an ENTRY EDGE — `shouldRegisterTargetHit` fires on false → true. So anything
 * that writes `wristInside = false` without having measured the wrist is not merely
 * inaccurate bookkeeping: it manufactures the first half of an edge, and the next frame
 * that sees the wrist inside completes it. The reviewer's sequence
 *
 *     measured inside → wrist = null (no trackerLost) → measurement returns, same position
 *
 * therefore paid out a `TargetHitEvent` for a patient who never moved, and — through
 * `mapTargetHitToSessionInput` and `applyAttemptOutcome` — a `targetsReached`, an adaptive
 * success, a success streak and a possible level increase with it.
 *
 * These tests assert the two halves that make a fix a fix rather than a suppression:
 * a gap pays NOTHING, and a real reach across a gap still pays EXACTLY ONE hit. The
 * end-to-end adaptive consequence is proven against the real runtime in
 * `adaptive/immediate-successor-feedback.test.ts` ("REVIEW-FIX-003").
 *
 * CLINICAL SAFETY: every coordinate, millisecond and degree here is a TEST FIXTURE.
 * None is a validated reach window, a measured joint angle or an approved range-of-motion
 * limit. SYNTHETIC COORDINATES ONLY — no real-camera laterality is claimed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "./target-generator";
import { DEFAULT_TARGET_HIT_CONFIG } from "./target-hit";
import {
  createInitialTargetLifecycle,
  tickTargetLifecycle,
  type TargetLifecycleState,
  type TargetLifecycleTickInput,
} from "./target-lifecycle";
import type { NormalizedPoint } from "./types";

const T0 = 7_000_000;

/** Fixture only — carries no clinical validation. */
const TIMEOUT_MS = 4_000;

/**
 * Where every target in this file is placed, supplied through `preferredTargetPosition` so
 * the geometry is fixed and each attempt lands in the same spot — which is exactly what
 * deterministic adaptive placement does for two attempts at the same level, and the
 * precondition that makes this bug ordinary rather than rare.
 */
const TARGET_POSITION: NormalizedPoint = { x: 0.6, y: 0.4 };

/**
 * Inside the collision radius but NOT at the centre, so these tests exercise the real
 * radius predicate rather than coordinate identity.
 */
const INSIDE_WRIST: NormalizedPoint = { x: 0.63, y: 0.42 };

/**
 * A tracked wrist at rest, far outside `DEFAULT_SAFE_TARGET_BOUNDS`. This is what "the
 * patient is being measured and is not at the target" looks like — a MEASURED outside,
 * which is the thing a null wrist must never be confused with.
 */
const OUTSIDE_WRIST: NormalizedPoint = { x: 0.02, y: 0.97 };

/** The animated exit used in normal motion; reduced motion uses 0. */
const NORMAL_EXIT_MS = 480;

function lifecycleInput(
  overrides: Partial<TargetLifecycleTickInput> = {},
): TargetLifecycleTickInput {
  return {
    wrist: OUTSIDE_WRIST,
    nowMs: T0,
    side: "right",
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    hitConfig: DEFAULT_TARGET_HIT_CONFIG,
    preferredTargetPosition: TARGET_POSITION,
    ...overrides,
  };
}

/**
 * Spawns the first target with the wrist ALREADY inside it.
 *
 * This is the CHANGE-008 seeding path: the spawn reads the wrist's actual relationship to
 * the new target, so the attempt legitimately begins `wristInside = true` and owes no hit.
 * It is the only honest way to reach the reviewer's starting state — reaching in from
 * outside would terminate the attempt on entry.
 */
function spawnWithWristInside(overrides: Partial<TargetLifecycleTickInput> = {}) {
  const result = tickTargetLifecycle(
    createInitialTargetLifecycle(),
    lifecycleInput({ wrist: INSIDE_WRIST, ...overrides }),
  );
  assert.ok(result.state.currentTarget, "expected a target");
  assert.equal(result.state.wristInside, true, "the attempt must begin inside");
  assert.equal(result.hitEvent, null, "a seeded spawn owes no hit");
  assert.equal(result.state.interaction.targetsReached, 0);
  return result.state;
}

/** Spawns the first target with the wrist measured OUTSIDE it. */
function spawnWithWristOutside(overrides: Partial<TargetLifecycleTickInput> = {}) {
  const result = tickTargetLifecycle(
    createInitialTargetLifecycle(),
    lifecycleInput({ wrist: OUTSIDE_WRIST, ...overrides }),
  );
  assert.ok(result.state.currentTarget, "expected a target");
  assert.equal(result.state.wristInside, false);
  return result.state;
}

/** Ticks `count` frames with no wrist sample, asserting nothing is paid out on any of them. */
function tickThroughGap(
  state: TargetLifecycleState,
  count: number,
  startMs: number,
  overrides: Partial<TargetLifecycleTickInput> = {},
): TargetLifecycleState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const result = tickTargetLifecycle(
      next,
      lifecycleInput({ wrist: null, nowMs: startMs + i * 16, ...overrides }),
    );
    assert.equal(result.hitEvent, null, `gap frame ${i} paid a hit`);
    assert.deepEqual(result.attemptStartedEvents, [], `gap frame ${i} spawned an attempt`);
    next = result.state;
  }
  return next;
}

// ---------------------------------------------------------------------------
// 1. The reviewer scenario, exactly as reported
// ---------------------------------------------------------------------------

describe("REVIEW-FIX-003 — the reviewer scenario", () => {
  it("inside → wrist = null → returns at the SAME inside position → no hit", () => {
    const spawned = spawnWithWristInside();
    const targetId = spawned.currentTarget?.id;

    // The gap. No `trackerLost`, no pause, no safety hold — the session is healthy and only
    // this one measurement is missing.
    const gapped = tickTargetLifecycle(
      spawned,
      lifecycleInput({ wrist: null, nowMs: T0 + 100 }),
    );
    assert.equal(gapped.hitEvent, null, "a gap frame must never pay a hit");

    // STATE CONTINUITY — the load-bearing assertion. Before the fix this read `false`,
    // which is the fabricated half of the entry edge.
    assert.equal(
      gapped.state.wristInside,
      true,
      "an unmeasured frame must leave the last MEASURED contact state standing",
    );
    assert.equal(
      gapped.state.currentTarget?.id,
      targetId,
      "the attempt is held across the gap, not restarted",
    );

    // Measurement returns at the same position the wrist never left.
    const recovered = tickTargetLifecycle(
      gapped.state,
      lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 200 }),
    );

    assert.equal(recovered.hitEvent, null, "no measured exit happened, so no entry can follow");
    assert.equal(recovered.state.interaction.targetsReached, 0, "no fabricated targetsReached");
    assert.deepEqual(recovered.state.interaction.reactionTimesMs, []);
    assert.deepEqual(recovered.state.interaction.targetHitTimestampsMs, []);
    assert.equal(recovered.state.wristInside, true);
    assert.equal(recovered.state.currentTarget?.id, targetId, "still the same attempt");
    assert.equal(recovered.state.interaction.targetsShown, 1, "no duplicate successor");
  });

  it("...and after recovery a real exit and re-entry still pays EXACTLY ONE hit", () => {
    let state = spawnWithWristInside();
    state = tickTargetLifecycle(state, lifecycleInput({ wrist: null, nowMs: T0 + 100 })).state;
    const recovered = tickTargetLifecycle(
      state,
      lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 200 }),
    );
    assert.equal(recovered.hitEvent, null);
    const targetId = recovered.state.currentTarget?.id;

    // A MEASURED exit — this is what the gap was not.
    const exited = tickTargetLifecycle(
      recovered.state,
      lifecycleInput({ wrist: OUTSIDE_WRIST, nowMs: T0 + 300 }),
    );
    assert.equal(exited.hitEvent, null);
    assert.equal(exited.state.wristInside, false, "a measured outside DOES clear the flag");
    assert.equal(exited.state.currentTarget?.id, targetId, "the same attempt is still running");

    // ...and the re-entry the patient actually performed.
    const reentered = tickTargetLifecycle(
      exited.state,
      lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 400 }),
    );
    assert.ok(reentered.hitEvent, "a real reach must still count — the fix suppresses nothing");
    assert.equal(reentered.hitEvent?.targetId, targetId);
    assert.equal(reentered.state.interaction.targetsReached, 1);

    // Exactly one: the terminal path retired the target, so no later frame can pay again.
    let after = reentered.state;
    for (let i = 0; i < 5; i += 1) {
      const frame = tickTargetLifecycle(
        after,
        lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 500 + i * 16 }),
      );
      after = frame.state;
    }
    assert.equal(after.interaction.targetsReached, 1, "exactly one hit for one real reach");
  });
});

// ---------------------------------------------------------------------------
// 2. The focused cases around it
// ---------------------------------------------------------------------------

describe("REVIEW-FIX-003 — gap semantics in every starting state", () => {
  it("1. outside → null → returns OUTSIDE → no hit", () => {
    const spawned = spawnWithWristOutside();
    const gapped = tickThroughGap(spawned, 1, T0 + 100);
    assert.equal(gapped.wristInside, false, "a preserved false is still false");

    const recovered = tickTargetLifecycle(
      gapped,
      lifecycleInput({ wrist: OUTSIDE_WRIST, nowMs: T0 + 200 }),
    );
    assert.equal(recovered.hitEvent, null);
    assert.equal(recovered.state.interaction.targetsReached, 0);
  });

  it("2. outside → null → returns INSIDE → the first measured entry still counts", () => {
    // The current contract, unchanged by this fix: the wrist was last MEASURED outside, so
    // an inside measurement is a genuine entry edge. Preserving state cannot and must not
    // suppress it — that is what separates this fix from a blanket post-gap mute.
    const spawned = spawnWithWristOutside();
    const gapped = tickThroughGap(spawned, 1, T0 + 100);

    const recovered = tickTargetLifecycle(
      gapped,
      lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 200 }),
    );
    assert.ok(recovered.hitEvent, "a measured outside → measured inside edge is a real reach");
    assert.equal(recovered.state.interaction.targetsReached, 1);
  });

  it("3. inside → MANY null frames → returns inside → no hit", () => {
    const spawned = spawnWithWristInside();
    const gapped = tickThroughGap(spawned, 30, T0 + 100);
    assert.equal(gapped.wristInside, true, "state is held for the whole gap, not just one frame");

    const recovered = tickTargetLifecycle(
      gapped,
      lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 1_000 }),
    );
    assert.equal(recovered.hitEvent, null);
    assert.equal(recovered.state.interaction.targetsReached, 0);
    assert.equal(recovered.state.interaction.targetsShown, 1, "and no duplicate successor");
  });

  it("4. inside → null → returns OUTSIDE → the exit lands on the measurement, not the gap", () => {
    const spawned = spawnWithWristInside();
    const gapped = tickThroughGap(spawned, 1, T0 + 100);
    assert.equal(gapped.wristInside, true, "the gap itself is not the exit");

    const exited = tickTargetLifecycle(
      gapped,
      lifecycleInput({ wrist: OUTSIDE_WRIST, nowMs: T0 + 200 }),
    );
    assert.equal(exited.hitEvent, null);
    assert.equal(exited.state.wristInside, false, "the exit lands when it is MEASURED");

    // And the re-entry after that measured exit is a legitimate hit.
    const reentered = tickTargetLifecycle(
      exited.state,
      lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 300 }),
    );
    assert.ok(reentered.hitEvent);
    assert.equal(reentered.state.interaction.targetsReached, 1);
  });
});

// ---------------------------------------------------------------------------
// 3. Motion preference and the attempt clock are untouched
// ---------------------------------------------------------------------------

describe("REVIEW-FIX-003 — unchanged neighbours", () => {
  it("5. reduced motion and normal motion share the same gap semantics", () => {
    for (const hitExitTransitionMs of [0, NORMAL_EXIT_MS]) {
      const spawned = spawnWithWristInside({ hitExitTransitionMs });
      const gapped = tickThroughGap(spawned, 3, T0 + 100, { hitExitTransitionMs });
      assert.equal(
        gapped.wristInside,
        true,
        `contact state must not depend on the animation preference (${hitExitTransitionMs})`,
      );

      const recovered = tickTargetLifecycle(
        gapped,
        lifecycleInput({ wrist: INSIDE_WRIST, nowMs: T0 + 200, hitExitTransitionMs }),
      );
      assert.equal(
        recovered.hitEvent,
        null,
        `a gap paid a hit at transition ${hitExitTransitionMs}`,
      );
      assert.equal(recovered.state.interaction.targetsReached, 0);
    }
  });

  it("6. the attempt lifecycle is unchanged — a gap neither expires nor extends an attempt", () => {
    const timed = { blockElapsedSeconds: 0, attemptTimeoutMs: TIMEOUT_MS };
    const spawned = spawnWithWristInside(timed);

    // A gap far longer than the reach window. It must not expire the attempt, because
    // unmeasurable time is excluded from the window (REVIEW FIX, BLOCKER 2) — and it must
    // not pay a hit either, which is this fix.
    let state = spawned;
    for (let i = 1; i <= 20; i += 1) {
      const frame = tickTargetLifecycle(
        state,
        lifecycleInput({
          wrist: null,
          nowMs: T0 + i * 500,
          blockElapsedSeconds: i * 0.5,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      assert.equal(frame.attemptTimeoutEvent, null, `gap frame ${i} expired the attempt`);
      assert.equal(frame.hitEvent, null, `gap frame ${i} paid a hit`);
      state = frame.state;
    }
    assert.equal(state.wristInside, true, "held inside for the whole gap");
    assert.equal(state.currentTarget?.id, spawned.currentTarget?.id);

    // Measurement returns, the wrist is measured OUTSIDE, and the attempt then expires on
    // measurable time exactly as it always did — a timeout is still reachable.
    let expired = null;
    let resumed = state;
    for (let i = 1; i <= 12 && expired === null; i += 1) {
      const frame = tickTargetLifecycle(
        resumed,
        lifecycleInput({
          wrist: OUTSIDE_WRIST,
          nowMs: T0 + 10_000 + i * 500,
          blockElapsedSeconds: 10 + i * 0.5,
          attemptTimeoutMs: TIMEOUT_MS,
        }),
      );
      resumed = frame.state;
      expired = frame.attemptTimeoutEvent;
    }
    assert.ok(expired, "measurable time still expires an attempt after a gap");
    assert.equal(resumed.interaction.targetsReached, 0, "and no hit was ever fabricated");
  });

  it("a gap mutates neither the state nor the input it is handed", () => {
    const spawned = spawnWithWristInside();
    const input = lifecycleInput({ wrist: null, nowMs: T0 + 100 });
    const snapshot = JSON.stringify(spawned);
    const inputSnapshot = JSON.stringify(input);

    tickTargetLifecycle(spawned, input);

    assert.equal(JSON.stringify(spawned), snapshot, "prior state was mutated");
    assert.equal(JSON.stringify(input), inputSnapshot, "input was mutated");
  });
});
