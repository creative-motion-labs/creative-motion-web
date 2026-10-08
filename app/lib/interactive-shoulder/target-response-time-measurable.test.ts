/**
 * Target response time is measured over MEASURABLE attempt time.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/target-response-time-measurable.test.ts
 *
 * Why this suite exists: the persisted per-target timing sample (`reactionTimeMs`, later
 * averaged into "Avg target response time") used to be plain wall-clock time from spawn to
 * contact. Attempt EXPIRY already ignored paused time and wrist-tracking gaps, but the
 * recorded response time did not, so a pause or a tracking gap between spawn and contact
 * silently inflated the clinician-facing average (a real production session recorded a
 * 9.5 s sample next to a 1.9 s mean).
 *
 * The two clocks are exercised separately on purpose, exactly as the orchestrator behaves:
 *   - `nowMs` keeps running through a pause;
 *   - `blockElapsedSeconds` is frozen during a pause or safety hold.
 *
 * Every number below is a deterministic test fixture. None is a real measurement.
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

const T0 = 9_000_000;
const deterministicRandom = () => 0.42;

/** Far outside the safe target bounds: tracked, but never touching a target. */
const RESTING_WRIST: NormalizedPoint = { x: 0.02, y: 0.97 };

function baseInput(overrides: Partial<TargetLifecycleTickInput> = {}): TargetLifecycleTickInput {
  return {
    wrist: RESTING_WRIST,
    nowMs: T0,
    side: "right",
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    random: deterministicRandom,
    ...overrides,
  };
}

function wristAt(state: TargetLifecycleState): NormalizedPoint {
  const target = state.currentTarget;
  assert.ok(target, "expected an active target");
  return { x: target.x, y: target.y };
}

/** Spawns the first target; `blockElapsedSeconds` undefined models a legacy caller. */
function spawn(blockElapsedSeconds: number | undefined) {
  const result = tickTargetLifecycle(
    createInitialTargetLifecycle(),
    baseInput(blockElapsedSeconds === undefined ? {} : { blockElapsedSeconds }),
  );
  assert.ok(result.state.currentTarget, "expected the first target to spawn");
  return result.state;
}

describe("target response time — measurable attempt time", () => {
  it("an uninterrupted attempt reports the real spawn-to-contact time", () => {
    const spawned = spawn(10);
    const hit = tickTargetLifecycle(
      spawned,
      baseInput({ wrist: wristAt(spawned), nowMs: T0 + 1_500, blockElapsedSeconds: 11.5 }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.hitEvent.reactionTimeMs, 1_500);
  });

  it("time frozen by a pause or safety hold is not counted as response time", () => {
    const spawned = spawn(10);
    // 20 s of wall clock pass, but the orchestrator froze block time: only 1.2 s of
    // block time elapsed between spawn and contact.
    const hit = tickTargetLifecycle(
      spawned,
      baseInput({ wrist: wristAt(spawned), nowMs: T0 + 20_000, blockElapsedSeconds: 11.2 }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(
      Math.round(hit.hitEvent.reactionTimeMs),
      1_200,
      "paused wall-clock time must not inflate the recorded response time",
    );
  });

  it("a wrist-tracking gap during the attempt is not counted as response time", () => {
    const spawned = spawn(10);

    // Three seconds of block time pass with no wrist sample at all: 1 s, then 2 s of it
    // is charged as unmeasured by the lifecycle's own accumulator.
    const gap1 = tickTargetLifecycle(
      spawned,
      baseInput({ wrist: null, nowMs: T0 + 1_000, blockElapsedSeconds: 11 }),
    );
    const gap2 = tickTargetLifecycle(
      gap1.state,
      baseInput({ wrist: null, nowMs: T0 + 3_000, blockElapsedSeconds: 13 }),
    );
    assert.equal(gap2.hitEvent, null);

    // Measurement returns and the patient is on the target 0.2 s later.
    const hit = tickTargetLifecycle(
      gap2.state,
      baseInput({ wrist: wristAt(gap2.state), nowMs: T0 + 3_200, blockElapsedSeconds: 13.2 }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(
      Math.round(hit.hitEvent.reactionTimeMs),
      200,
      "only the time the wrist was actually observed counts toward response time",
    );
  });

  it("a legacy caller without a block clock keeps the original wall-clock behavior", () => {
    const spawned = spawn(undefined);
    const hit = tickTargetLifecycle(
      spawned,
      baseInput({ wrist: wristAt(spawned), nowMs: T0 + 800 }),
    );
    assert.ok(hit.hitEvent);
    assert.equal(hit.hitEvent.reactionTimeMs, 800);
  });

  it("never reports a negative response time", () => {
    const spawned = spawn(10);
    // A block boundary can restart block elapsed time.
    const hit = tickTargetLifecycle(
      spawned,
      baseInput({ wrist: wristAt(spawned), nowMs: T0 + 300, blockElapsedSeconds: 2 }),
    );
    assert.ok(hit.hitEvent);
    assert.ok(hit.hitEvent.reactionTimeMs >= 0);
  });

  it("each target's response time is independent of the previous target's interruptions", () => {
    const first = spawn(10);
    const hit1 = tickTargetLifecycle(
      first,
      baseInput({ wrist: wristAt(first), nowMs: T0 + 30_000, blockElapsedSeconds: 10.9 }),
    );
    assert.ok(hit1.hitEvent);
    assert.equal(Math.round(hit1.hitEvent.reactionTimeMs), 900);

    // Successor spawns on a later tick; its own clock starts from its own spawn.
    const successor = tickTargetLifecycle(
      hit1.state,
      baseInput({ nowMs: T0 + 30_100, blockElapsedSeconds: 11 }),
    );
    assert.ok(successor.state.currentTarget);
    const hit2 = tickTargetLifecycle(
      successor.state,
      baseInput({
        wrist: wristAt(successor.state),
        nowMs: T0 + 30_900,
        blockElapsedSeconds: 11.8,
      }),
    );
    assert.ok(hit2.hitEvent);
    assert.equal(Math.round(hit2.hitEvent.reactionTimeMs), 800);
  });
});
