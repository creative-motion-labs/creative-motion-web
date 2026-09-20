/**
 * CHANGE-007 — adaptive target placement, end to end.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/adaptive-target-placement.test.ts
 *
 * The suite deliberately climbs the real stack rather than staying in pure-function land:
 * resolver → generator → lifecycle → registry-resolved block runner → dispatch. The
 * integration sections tick the SAME `dispatchOrchestratorCvBlock` and the SAME registered
 * `TARGET_BLOCK_RUNNER` the component uses, so a seam that fails to transport placement
 * cannot pass here by being individually correct.
 *
 * CLINICAL SAFETY: every degree, radius and coordinate below is a TEST FIXTURE for
 * target-placement geometry. None is a validated range-of-motion limit, a measured joint
 * angle, or a clinical reach allowance.
 *
 * SYNTHETIC COORDINATES ONLY: the anchors below follow the repository's documented
 * mirrored-preview convention (see `target-level-geometry.ts`). Passing left/right
 * assertions here proves the placement MATH is mirrored correctly. It proves nothing about
 * real-camera laterality, which remains unverified.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAdaptiveDifficultyState } from "./adaptive-difficulty";
import type { AdaptiveDifficultyState, DifficultyConfig } from "./adaptive-difficulty-types";
import { resolveAdaptiveTargetPlacement } from "./adaptive-target-placement";
import { projectTargetLevelPosition } from "./target-level-geometry";
import { registerAllBlockRunners } from "../block-engine/register-all-block-runners";
import { resolveTargetBlockRunner } from "../block-engine/target-block-runner";
import { dispatchOrchestratorCvBlock } from "../orchestrator-cv-block-dispatch";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "../shoulder-abduction-reach-session-definition";
import {
  DEFAULT_SAFE_TARGET_BOUNDS,
  generateTherapeuticTarget,
  isPointInsideSafeBounds,
} from "../target-generator";
import { DEFAULT_TARGET_HIT_CONFIG } from "../target-hit";
import {
  createInitialTargetLifecycle,
  tickTargetLifecycle,
  type TargetLifecycleState,
  type TargetLifecycleTickInput,
} from "../target-lifecycle";
import { createInitialInstructionalLifecycle } from "../instructional-lifecycle";
import type { SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";
import type { NormalizedPoint } from "../types";

const T0 = 9_000_000;

/** Mirror-image anchors about x = 0.5, matching the mirrored preview convention. */
const RIGHT_SHOULDER: NormalizedPoint = { x: 0.55, y: 0.42 };
const LEFT_SHOULDER: NormalizedPoint = { x: 0.45, y: 0.42 };
const ARM_LENGTH = 0.25;

/** TEST FIXTURE configuration — not clinically approved. */
function config(overrides: Partial<DifficultyConfig> = {}): DifficultyConfig {
  return {
    startLevel: 50,
    minLevel: 40,
    maxLevel: 70,
    increaseStep: 10,
    decreaseStep: 10,
    successStreakToIncrease: 2,
    struggleStreakToDecrease: 2,
    cooldownAttempts: 0,
    normalAttemptTimeoutMs: 6_000,
    extendedAttemptTimeoutMs: 9_000,
    compensatedSuccessPolicy: "excludedFromIncrease",
    ...overrides,
  };
}

function stateAtLevel(level: number): AdaptiveDifficultyState {
  return createAdaptiveDifficultyState(config({ startLevel: level }));
}

function placementAt(
  level: number,
  overrides: Partial<Parameters<typeof resolveAdaptiveTargetPlacement>[0]> = {},
) {
  return resolveAdaptiveTargetPlacement({
    adaptiveState: stateAtLevel(level),
    affectedSide: "right",
    shoulderAnchorNormalized: RIGHT_SHOULDER,
    reachRadiusNormalized: ARM_LENGTH,
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    ...overrides,
  });
}

function expectPlaced(result: ReturnType<typeof resolveAdaptiveTargetPlacement>) {
  assert.equal(result.placed, true);
  if (!result.placed) throw new Error("unreachable");
  return result;
}

const closeTo = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );

const distance = (a: NormalizedPoint, b: NormalizedPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------
// 1. Resolver
// ---------------------------------------------------------------------------

describe("CHANGE-007 placement resolver", () => {
  it("1. adaptive disabled produces no placement at all", () => {
    const result = resolveAdaptiveTargetPlacement({
      adaptiveState: null,
      affectedSide: "right",
      shoulderAnchorNormalized: RIGHT_SHOULDER,
      reachRadiusNormalized: ARM_LENGTH,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    });
    assert.equal(result.placed, false);
    if (result.placed) throw new Error("unreachable");
    // Distinct from every geometry reason: the feature being off is the ordinary state.
    assert.equal(result.reason, "adaptiveDisabled");
  });

  it("2. a valid state and valid geometry follow the shoulder-anchored projection exactly", () => {
    const placed = expectPlaced(placementAt(50));
    const expected = projectTargetLevelPosition(RIGHT_SHOULDER, ARM_LENGTH, 50, "right");
    closeTo(placed.position.x, expected.x);
    closeTo(placed.position.y, expected.y);
    assert.equal(placed.levelDegrees, 50);
    assert.equal(placed.positionWasClampedToBounds, false);
  });

  it("3. the level comes from adaptiveState.currentLevel — different levels, different points", () => {
    const low = expectPlaced(placementAt(40));
    const mid = expectPlaced(placementAt(50));
    const high = expectPlaced(placementAt(70));

    assert.notDeepEqual(low.position, mid.position);
    assert.notDeepEqual(mid.position, high.position);
    // Not merely "different" — separated by more than the hit radius, so the difference is
    // a different reach for the patient rather than a sub-pixel wobble.
    assert.ok(
      distance(low.position, high.position) > DEFAULT_TARGET_HIT_CONFIG.collisionRadius,
      "a level change must move the target further than the collision radius",
    );
    // Higher level = more abduction = higher on screen (y grows downward).
    assert.ok(high.position.y < low.position.y);
  });

  it("4. side mirroring: synthetic left and right place laterally opposite", () => {
    const right = expectPlaced(placementAt(50));
    const left = expectPlaced(
      placementAt(50, { affectedSide: "left", shoulderAnchorNormalized: LEFT_SHOULDER }),
    );
    assert.ok(right.position.x > RIGHT_SHOULDER.x, "right places toward higher x");
    assert.ok(left.position.x < LEFT_SHOULDER.x, "left places toward lower x");
    // Mirror-symmetric anchors must yield mirror-symmetric targets about x = 0.5.
    closeTo(left.position.x, 1 - right.position.x, 1e-9);
    closeTo(left.position.y, right.position.y, 1e-9);
  });

  it("5. a missing shoulder anchor falls back rather than fabricating one", () => {
    for (const anchor of [null, undefined]) {
      const result = placementAt(50, { shoulderAnchorNormalized: anchor });
      assert.equal(result.placed, false);
      if (result.placed) throw new Error("unreachable");
      assert.equal(result.reason, "missingShoulderAnchor");
    }
  });

  it("6. a missing arm-length estimate falls back rather than inventing a radius", () => {
    for (const radius of [null, undefined]) {
      const result = placementAt(50, { reachRadiusNormalized: radius });
      assert.equal(result.placed, false);
      if (result.placed) throw new Error("unreachable");
      assert.equal(result.reason, "missingReachRadius");
    }
  });

  it("7. non-finite geometry never yields coordinates", () => {
    const cases: Array<[Parameters<typeof placementAt>[1], string]> = [
      [{ shoulderAnchorNormalized: { x: Number.NaN, y: 0.4 } }, "invalidShoulderAnchor"],
      [{ shoulderAnchorNormalized: { x: 0.5, y: Number.POSITIVE_INFINITY } }, "invalidShoulderAnchor"],
      [{ reachRadiusNormalized: Number.NaN }, "invalidReachRadius"],
      [{ reachRadiusNormalized: 0 }, "invalidReachRadius"],
      [{ reachRadiusNormalized: -0.2 }, "invalidReachRadius"],
    ];
    for (const [overrides, reason] of cases) {
      const result = placementAt(50, overrides);
      assert.equal(result.placed, false, `${reason} must not place`);
      if (result.placed) throw new Error("unreachable");
      assert.equal(result.reason, reason);
    }
  });

  it("8. a resolved position is always inside the supplied safe bounds", () => {
    // Anchored hard against the right edge so the raw projection would escape the bounds.
    const placed = expectPlaced(
      placementAt(70, { shoulderAnchorNormalized: { x: 0.79, y: 0.3 } }),
    );
    assert.ok(isPointInsideSafeBounds(placed.position, DEFAULT_SAFE_TARGET_BOUNDS));
    assert.equal(placed.positionWasClampedToBounds, true);
  });

  it("9. a target collapsing onto the shoulder anchor is refused, not emitted", () => {
    const result = placementAt(50, { reachRadiusNormalized: 0.001 });
    assert.equal(result.placed, false);
    if (result.placed) throw new Error("unreachable");
    assert.equal(result.reason, "targetCollapsedOntoAnchor");
  });

  it("10. deterministic — identical inputs always resolve to the identical point", () => {
    const first = expectPlaced(placementAt(50));
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(expectPlaced(placementAt(50)).position, first.position);
    }
  });

  it("11. it is pure — the adaptive state handed in is never mutated", () => {
    const state = stateAtLevel(50);
    const before = JSON.stringify(state);
    resolveAdaptiveTargetPlacement({
      adaptiveState: state,
      affectedSide: "right",
      shoulderAnchorNormalized: RIGHT_SHOULDER,
      reachRadiusNormalized: ARM_LENGTH,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    });
    assert.equal(JSON.stringify(state), before);
  });
});

// ---------------------------------------------------------------------------
// 2. Generator seam
// ---------------------------------------------------------------------------

describe("CHANGE-007 target generator seam", () => {
  const generatorBase = {
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    side: "right" as const,
    nowMs: T0,
    sequence: 1,
  };

  it("12. no preferred position means byte-identical legacy random behaviour", () => {
    const sequence = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2];
    const makeRandom = () => {
      let i = 0;
      return () => sequence[i++ % sequence.length];
    };
    const legacy = generateTherapeuticTarget({ ...generatorBase, random: makeRandom() });
    const withUndefined = generateTherapeuticTarget({
      ...generatorBase,
      random: makeRandom(),
      preferredPosition: undefined,
    });
    const withNull = generateTherapeuticTarget({
      ...generatorBase,
      random: makeRandom(),
      preferredPosition: null,
    });
    assert.deepEqual(withUndefined, legacy);
    assert.deepEqual(withNull, legacy);
  });

  it("13. a usable preferred position is the target's position", () => {
    const preferred = { x: 0.7, y: 0.55 };
    const target = generateTherapeuticTarget({ ...generatorBase, preferredPosition: preferred });
    assert.equal(target.x, preferred.x);
    assert.equal(target.y, preferred.y);
    // Identity is still the generator's own — the seam supplies coordinates, nothing else.
    assert.equal(target.id, `target-${generatorBase.sequence}-${T0}`);
    assert.equal(target.spawnedAtMs, T0);
  });

  it("14. an out-of-bounds preferred position is clamped, never emitted raw", () => {
    const target = generateTherapeuticTarget({
      ...generatorBase,
      preferredPosition: { x: 5, y: -5 },
    });
    assert.ok(isPointInsideSafeBounds(target, DEFAULT_SAFE_TARGET_BOUNDS));
    assert.equal(target.x, DEFAULT_SAFE_TARGET_BOUNDS.maxX);
    assert.equal(target.y, DEFAULT_SAFE_TARGET_BOUNDS.minY);
  });

  it("15. a non-finite preferred position falls back to the legacy random path", () => {
    const fixedRandom = () => 0.5;
    const legacy = generateTherapeuticTarget({ ...generatorBase, random: fixedRandom });
    for (const bad of [
      { x: Number.NaN, y: 0.5 },
      { x: 0.5, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0.5 },
    ]) {
      const target = generateTherapeuticTarget({
        ...generatorBase,
        random: fixedRandom,
        preferredPosition: bad,
      });
      assert.deepEqual({ x: target.x, y: target.y }, { x: legacy.x, y: legacy.y });
    }
  });

  it("16. MIN_TARGET_SEPARATION still governs the random path", () => {
    // The first roll lands exactly on the previous target; the sampler must reject it and
    // re-roll. Proven by the outcome being the SECOND roll's point, not the first's.
    const rolls = [0.5, 0.5, 0.2, 0.8];
    let i = 0;
    // Right-side biased bounds at rand() === 0.5 — the point the first roll produces.
    const firstRoll = { x: 0.644, y: 0.42 };
    const target = generateTherapeuticTarget({
      ...generatorBase,
      random: () => rolls[i++ % rolls.length],
      previousTarget: firstRoll,
    });
    assert.ok(
      distance(target, firstRoll) >= 0.12,
      "the separation guard must still reject a colliding random candidate",
    );
  });

  it("17. deliberate placement is NOT subject to the separation guard", () => {
    // Two consecutive attempts at the same level must land in the same place — that is what
    // "the same reach, twice" means. Perturbing it would break placement semantics; the
    // false-hit consequence is handled by wrist-entry seeding, asserted further below.
    const preferred = { x: 0.7, y: 0.55 };
    const target = generateTherapeuticTarget({
      ...generatorBase,
      preferredPosition: preferred,
      previousTarget: preferred,
    });
    assert.equal(target.x, preferred.x);
    assert.equal(target.y, preferred.y);
  });
});

// ---------------------------------------------------------------------------
// 3. Lifecycle seam
// ---------------------------------------------------------------------------

function lifecycleInput(
  overrides: Partial<TargetLifecycleTickInput> = {},
): TargetLifecycleTickInput {
  return {
    wrist: null,
    nowMs: T0,
    side: "right",
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    ...overrides,
  };
}

describe("CHANGE-007 lifecycle seam", () => {
  it("18. the preferred position reaches the actual lifecycle-generated target", () => {
    const placed = expectPlaced(placementAt(50));
    const result = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({
        preferredTargetPosition: placed.position,
        levelDegrees: placed.levelDegrees,
      }),
    );
    const target = result.state.currentTarget;
    assert.ok(target);
    assert.equal(target.x, placed.position.x);
    assert.equal(target.y, placed.position.y);
    assert.equal(target.levelDegrees, 50);
    // Exactly one attempt started — the seam adds no second spawn.
    assert.equal(result.attemptStartedEvents.length, 1);
    assert.equal(result.attemptStartedEvents[0].targetId, target.id);
  });

  it("19. omitting the preferred position leaves the legacy random spawn untouched", () => {
    const fixedRandom = () => 0.5;
    const legacy = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({ random: fixedRandom }),
    );
    const withNull = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({ random: fixedRandom, preferredTargetPosition: null }),
    );
    assert.deepEqual(withNull.state.currentTarget, legacy.state.currentTarget);
    assert.equal(legacy.state.currentTarget?.levelDegrees, undefined);
  });

  it("20. a level change between spawns moves the next real target", () => {
    const lowPlacement = expectPlaced(placementAt(40));
    const highPlacement = expectPlaced(placementAt(70));

    const first = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({
        preferredTargetPosition: lowPlacement.position,
        levelDegrees: lowPlacement.levelDegrees,
      }),
    );
    // Reach the first target, so its successor spawns on the same tick (exit transition 0).
    const hit = tickTargetLifecycle(
      first.state,
      lifecycleInput({
        nowMs: T0 + 500,
        wrist: { ...lowPlacement.position },
        preferredTargetPosition: highPlacement.position,
        levelDegrees: highPlacement.levelDegrees,
      }),
    );
    assert.ok(hit.hitEvent);
    // CHANGE-008: the successor is built on the following tick, from that tick's placement.
    assert.equal(hit.state.currentTarget, null);
    const spawned = tickTargetLifecycle(
      hit.state,
      lifecycleInput({
        nowMs: T0 + 516,
        preferredTargetPosition: highPlacement.position,
        levelDegrees: highPlacement.levelDegrees,
      }),
    );
    const successor = spawned.state.currentTarget;
    assert.ok(successor);
    assert.equal(successor.x, highPlacement.position.x);
    assert.equal(successor.y, highPlacement.position.y);
    assert.equal(successor.levelDegrees, 70);
    assert.ok(
      distance(successor, lowPlacement.position) > DEFAULT_TARGET_HIT_CONFIG.collisionRadius,
    );
  });

  it("21. the lifecycle never emits a target with non-finite coordinates", () => {
    const result = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({ preferredTargetPosition: { x: Number.NaN, y: Number.NaN } }),
    );
    const target = result.state.currentTarget;
    assert.ok(target);
    assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y));
    assert.ok(isPointInsideSafeBounds(target, DEFAULT_SAFE_TARGET_BOUNDS));
  });

  it("22. exactly one target is owned at a time across a placed spawn", () => {
    const placed = expectPlaced(placementAt(50));
    let state: TargetLifecycleState = createInitialTargetLifecycle();
    const ids = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      const result = tickTargetLifecycle(
        state,
        lifecycleInput({ nowMs: T0 + i * 16, preferredTargetPosition: placed.position }),
      );
      state = result.state;
      if (state.currentTarget) ids.add(state.currentTarget.id);
      assert.equal(state.exitingTarget, null);
    }
    // No contact was made, so the single first target must still be the only one spawned.
    assert.equal(ids.size, 1);
    assert.equal(state.sequence, 1);
    assert.equal(state.interaction.targetsShown, 1);
  });
});

// ---------------------------------------------------------------------------
// 4. False auto-hit
// ---------------------------------------------------------------------------

describe("CHANGE-007 false auto-hit prevention", () => {
  it("23. a successor spawning under a stationary wrist registers no immediate hit", () => {
    const placed = expectPlaced(placementAt(50));
    const wrist = { ...placed.position };
    const input = (nowMs: number): TargetLifecycleTickInput =>
      lifecycleInput({ nowMs, wrist, preferredTargetPosition: placed.position });

    // Tick 1 spawns the first target directly under the wrist. Seeded inside → no hit.
    const t1 = tickTargetLifecycle(createInitialTargetLifecycle(), input(T0));
    assert.equal(t1.hitEvent, null);
    assert.equal(t1.state.wristInside, true);

    // Holding still must never accumulate hits, however many frames pass.
    let state = t1.state;
    for (let i = 1; i <= 10; i += 1) {
      const result = tickTargetLifecycle(state, input(T0 + i * 16));
      assert.equal(result.hitEvent, null, `frame ${i} must not register a hit`);
      state = result.state;
    }
    assert.equal(state.interaction.targetsReached, 0);
  });

  it("24. exit then re-enter is a legitimate hit", () => {
    const placed = expectPlaced(placementAt(50));
    const outside = { x: placed.position.x, y: placed.position.y + 0.3 };

    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({
        nowMs: T0,
        wrist: { ...placed.position },
        preferredTargetPosition: placed.position,
      }),
    );
    assert.equal(spawned.hitEvent, null);

    const exited = tickTargetLifecycle(
      spawned.state,
      lifecycleInput({ nowMs: T0 + 100, wrist: outside, preferredTargetPosition: placed.position }),
    );
    assert.equal(exited.hitEvent, null);
    assert.equal(exited.state.wristInside, false);

    const reentered = tickTargetLifecycle(
      exited.state,
      lifecycleInput({
        nowMs: T0 + 200,
        wrist: { ...placed.position },
        preferredTargetPosition: placed.position,
      }),
    );
    assert.ok(reentered.hitEvent, "a real exit and re-entry must count");
    assert.equal(reentered.state.interaction.targetsReached, 1);
    assert.equal(reentered.hitEvent.sequence, 1);
  });

  it("25. the reduced-motion hit path (exit transition 0) does not chain free hits", () => {
    // With hitExitTransitionMs === 0 the successor spawns in the SAME tick as the hit, with
    // the wrist demonstrably inside it. This is the path where a flat wristInside = false
    // reset paid out an unearned second hit on the very next frame.
    const placed = expectPlaced(placementAt(50));
    const restingWrist = { x: 0.25, y: 0.25 };
    const input = (nowMs: number, wrist: NormalizedPoint): TargetLifecycleTickInput =>
      lifecycleInput({
        nowMs,
        wrist,
        hitExitTransitionMs: 0,
        preferredTargetPosition: placed.position,
      });

    // Spawn away from the wrist, so the first hit is genuinely earned.
    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      input(T0, restingWrist),
    );
    assert.equal(spawned.hitEvent, null);
    assert.equal(spawned.state.wristInside, false);

    // The patient reaches in. Real entry → real hit. Since CHANGE-008 the successor is
    // built on the NEXT tick, still at the same adaptive placement — i.e. directly under
    // the wrist that just arrived and has not moved.
    const earned = tickTargetLifecycle(spawned.state, input(T0 + 100, { ...placed.position }));
    assert.ok(earned.hitEvent, "reaching the first target is a real hit");
    assert.equal(earned.state.interaction.targetsReached, 1);
    assert.equal(earned.state.currentTarget, null);

    const successor = tickTargetLifecycle(earned.state, input(T0 + 116, { ...placed.position }));
    assert.equal(successor.hitEvent, null, "the successor must not pay out on arrival");
    assert.equal(successor.state.currentTarget?.x, placed.position.x);
    assert.equal(successor.state.wristInside, true, "the successor starts with the wrist inside");

    // Holding still must not chain a second, unearned hit on any later frame.
    let state = successor.state;
    for (let i = 1; i <= 10; i += 1) {
      const result = tickTargetLifecycle(state, input(T0 + 116 + i * 16, { ...placed.position }));
      assert.equal(result.hitEvent, null, `frame ${i} after the successor must not hit`);
      state = result.state;
    }
    assert.equal(state.interaction.targetsReached, 1);
  });

  it("26. an expired attempt's successor under the wrist also registers no free hit", () => {
    const placed = expectPlaced(placementAt(50));
    const away = { x: 0.3, y: 0.65 };
    const wrist = { ...placed.position };

    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({
        nowMs: T0,
        wrist,
        blockElapsedSeconds: 0,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: away,
      }),
    );
    assert.equal(spawned.hitEvent, null);

    // Attempt time runs out while the wrist sits where the SUCCESSOR will appear.
    const expired = tickTargetLifecycle(
      spawned.state,
      lifecycleInput({
        nowMs: T0 + 1_200,
        wrist,
        blockElapsedSeconds: 1.2,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: placed.position,
      }),
    );
    assert.ok(expired.attemptTimeoutEvent, "the first attempt must expire");
    assert.equal(expired.hitEvent, null);
    assert.equal(expired.state.currentTarget, null);

    // CHANGE-008: the successor is built on the following tick, landing under the wrist.
    const successorFrame = tickTargetLifecycle(
      expired.state,
      lifecycleInput({
        nowMs: T0 + 1_216,
        wrist,
        blockElapsedSeconds: 1.216,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: placed.position,
      }),
    );
    assert.equal(successorFrame.state.currentTarget?.x, placed.position.x);
    assert.equal(successorFrame.hitEvent, null, "the expired attempt's successor is not a free hit");

    const nextFrame = tickTargetLifecycle(
      successorFrame.state,
      lifecycleInput({
        nowMs: T0 + 1_232,
        wrist,
        blockElapsedSeconds: 1.232,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: placed.position,
      }),
    );
    assert.equal(nextFrame.hitEvent, null, "and not on the frame after it either");
    assert.equal(nextFrame.state.interaction.targetsReached, 0);
  });

  it("27. a wrist outside the new target still starts outside — seeding is not a blanket lock", () => {
    const placed = expectPlaced(placementAt(50));
    const result = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({
        wrist: { x: 0.25, y: 0.25 },
        preferredTargetPosition: placed.position,
      }),
    );
    assert.equal(result.state.wristInside, false);
    // And the first genuine entry still counts.
    const entered = tickTargetLifecycle(
      result.state,
      lifecycleInput({
        nowMs: T0 + 100,
        wrist: { ...placed.position },
        preferredTargetPosition: placed.position,
      }),
    );
    assert.ok(entered.hitEvent);
  });
});

// ---------------------------------------------------------------------------
// 5. Integration through the real registry and dispatch
// ---------------------------------------------------------------------------

const TARGET_BLOCK = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0];

function activeSnap(blockElapsedSeconds = 0): SessionOrchestratorSnapshot {
  return {
    sessionState: "active",
    blockProgress: 0,
    blockElapsedSeconds,
    safetyStatus: "normal",
    isPaused: false,
    patientFeedbackState: { message: null, encouragement: null },
    currentBlock: TARGET_BLOCK,
    accumulatedBlockResults: [],
  } as SessionOrchestratorSnapshot;
}

function emptyStates() {
  return {
    instructional: createInitialInstructionalLifecycle(),
    target: createInitialTargetLifecycle(),
    pattern: null,
  };
}

describe("CHANGE-007 dispatch integration", () => {
  registerAllBlockRunners();

  it("28. the registry-resolved target runner carries the placement seam", () => {
    // Resolved through the registry, exactly as production does — not the constant.
    const runner = resolveTargetBlockRunner("movement-target");
    assert.ok(runner);
    const placed = expectPlaced(placementAt(50));
    const result = runner.tick("active", createInitialTargetLifecycle(), {
      wrist: null,
      nowMs: T0,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      preferredTargetPosition: placed.position,
      levelDegrees: placed.levelDegrees,
    });
    assert.equal(result.ticked, true);
    assert.equal(result.state.currentTarget?.x, placed.position.x);
    assert.equal(result.state.currentTarget?.levelDegrees, 50);
  });

  it("29. dispatch places the real target from the adaptive seam", () => {
    const placed = expectPlaced(placementAt(50));
    const result = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: { x: 0.2, y: 0.2 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: {
        attemptTimeoutMs: 6_000,
        preferredTargetPosition: placed.position,
        levelDegrees: placed.levelDegrees,
      },
    });
    assert.equal(result.status, "dispatched");
    if (result.status !== "dispatched") return;
    const target = result.states.target.currentTarget;
    assert.ok(target);
    assert.equal(target.x, placed.position.x);
    assert.equal(target.y, placed.position.y);
    assert.equal(target.levelDegrees, 50);
    assert.equal(result.targetAttemptStarted.length, 1);
    assert.equal(result.targetAttemptStarted[0].levelDegrees, 50);
  });

  it("30. dispatch with no targetAttempt keeps the legacy random path", () => {
    // ADAPTIVE-DISABLED COMPATIBILITY, at the seam the component actually controls: with
    // adaptive off it passes no `targetAttempt` at all, so no placement key can exist.
    const legacy = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: { x: 0.2, y: 0.2 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(legacy.status, "dispatched");
    if (legacy.status !== "dispatched") return;
    const target = legacy.states.target.currentTarget;
    assert.ok(target);
    assert.equal(target.levelDegrees, undefined, "no level may be invented");
    assert.ok(isPointInsideSafeBounds(target, DEFAULT_SAFE_TARGET_BOUNDS));
    // The side bias the random path applies is still in force — placement did not silently
    // switch to the unbiased bounds for everyone.
    assert.ok(target.x >= 0.468, "right-side bias preserved on the legacy path");
  });

  it("31. an adaptive session with unavailable geometry still spawns, randomly placed", () => {
    // The realistic degraded frame: adaptive is ON, the timeout seam is supplied, but the
    // shoulder was not visible, so the component adds no placement key at all.
    const unavailable = placementAt(50, { shoulderAnchorNormalized: null });
    assert.equal(unavailable.placed, false);

    const result = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: { x: 0.2, y: 0.2 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: 6_000 },
    });
    assert.equal(result.status, "dispatched");
    if (result.status !== "dispatched") return;
    const target = result.states.target.currentTarget;
    assert.ok(target, "existing gating still spawns a target");
    assert.equal(target.levelDegrees, undefined, "no level without a real placement");
    assert.ok(isPointInsideSafeBounds(target, DEFAULT_SAFE_TARGET_BOUNDS));
  });

  it("32. tracking loss stays distinct from timeout across the placement seam", () => {
    const placed = expectPlaced(placementAt(50));
    const seeded = dispatchOrchestratorCvBlock({
      snap: activeSnap(0),
      nowMs: T0,
      wrist: { x: 0.2, y: 0.2 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: 6_000, preferredTargetPosition: placed.position },
    });
    assert.equal(seeded.status, "dispatched");
    if (seeded.status !== "dispatched") return;

    // Wrist gone, block time frozen by the orchestrator during a hold: no timeout appears,
    // and nothing anywhere turns the lost tracker into an attempt result.
    const lost = dispatchOrchestratorCvBlock({
      snap: activeSnap(0),
      nowMs: T0 + 10_000,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: seeded.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: 6_000, preferredTargetPosition: placed.position },
    });
    assert.equal(lost.status, "dispatched");
    if (lost.status !== "dispatched") return;
    assert.equal(lost.targetAttemptTimeout, null);
    assert.equal(lost.targetContact, null);
  });

  it("33. repeated identical dispatch ticks are deterministic", () => {
    const placed = expectPlaced(placementAt(50));
    const run = () =>
      dispatchOrchestratorCvBlock({
        snap: activeSnap(),
        nowMs: T0,
        wrist: { x: 0.2, y: 0.2 },
        side: "right",
        hitExitTransitionMs: 0,
        states: emptyStates(),
        activeMotionPattern: null,
        targetAttempt: { preferredTargetPosition: placed.position, levelDegrees: 50 },
      });
    const a = run();
    const b = run();
    assert.equal(a.status, "dispatched");
    assert.equal(b.status, "dispatched");
    if (a.status !== "dispatched" || b.status !== "dispatched") return;
    assert.deepEqual(a.states.target.currentTarget, b.states.target.currentTarget);
  });
});

// ---------------------------------------------------------------------------
// 6. Successor placement across the terminal boundary
// ---------------------------------------------------------------------------

describe("CHANGE-007 successor placement across a terminal event", () => {
  // These two tests replace CHANGE-007's characterisation of the one-target lag. That lag
  // was a consequence of the successor being built in the SAME tick as its predecessor's
  // outcome, before the caller could adapt. CHANGE-008 removed the same-tick spawn, so the
  // lag no longer exists on any path; what is asserted here is the placement half of that
  // guarantee — the successor is built from the placement supplied to the tick that builds
  // it, never from the one supplied to the tick that ended the previous attempt. The
  // adaptive half is proved end to end in `immediate-successor-feedback.test.ts`.
  const OLD = () => expectPlaced(placementAt(40));
  const NEW = () => expectPlaced(placementAt(70));

  it("34. after a timeout, the successor takes the placement of the tick that builds it", () => {
    const oldLevel = OLD();
    const newLevel = NEW();

    const spawned = tickTargetLifecycle(
      createInitialTargetLifecycle(),
      lifecycleInput({
        nowMs: T0,
        wrist: { x: 0.2, y: 0.2 },
        blockElapsedSeconds: 0,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: oldLevel.position,
        levelDegrees: oldLevel.levelDegrees,
      }),
    );
    assert.equal(spawned.state.currentTarget?.levelDegrees, 40);

    // The expiring tick still carries the OLD placement — and builds nothing with it.
    const expired = tickTargetLifecycle(
      spawned.state,
      lifecycleInput({
        nowMs: T0 + 1_200,
        wrist: { x: 0.2, y: 0.2 },
        blockElapsedSeconds: 1.2,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: oldLevel.position,
        levelDegrees: oldLevel.levelDegrees,
      }),
    );
    assert.ok(expired.attemptTimeoutEvent);
    assert.equal(expired.state.currentTarget, null);
    assert.equal(expired.attemptStartedEvents.length, 0);

    // The next tick carries the NEW placement, and that is what the successor gets.
    const successor = tickTargetLifecycle(
      expired.state,
      lifecycleInput({
        nowMs: T0 + 1_216,
        wrist: { x: 0.2, y: 0.2 },
        blockElapsedSeconds: 1.216,
        attemptTimeoutMs: 1_000,
        preferredTargetPosition: newLevel.position,
        levelDegrees: newLevel.levelDegrees,
      }),
    );
    assert.equal(successor.state.currentTarget?.levelDegrees, 70);
    assert.equal(successor.state.currentTarget?.x, newLevel.position.x);
    assert.equal(successor.state.currentTarget?.y, newLevel.position.y);
  });

  it("35. the same holds on the hit path, with and without an exit transition", () => {
    for (const hitExitTransitionMs of [0, 480]) {
      const oldLevel = OLD();
      const newLevel = NEW();

      const spawned = tickTargetLifecycle(
        createInitialTargetLifecycle(),
        lifecycleInput({
          nowMs: T0,
          wrist: { x: 0.2, y: 0.2 },
          hitExitTransitionMs,
          preferredTargetPosition: oldLevel.position,
          levelDegrees: oldLevel.levelDegrees,
        }),
      );
      const hit = tickTargetLifecycle(
        spawned.state,
        lifecycleInput({
          nowMs: T0 + 100,
          wrist: { ...oldLevel.position },
          hitExitTransitionMs,
          preferredTargetPosition: oldLevel.position,
          levelDegrees: oldLevel.levelDegrees,
        }),
      );
      assert.ok(hit.hitEvent, `hit expected at transition ${hitExitTransitionMs}`);
      assert.equal(hit.state.currentTarget, null);

      // Past any exit transition, the first tick that builds the successor decides its
      // placement — and it carries the new level in both motion modes.
      const successor = tickTargetLifecycle(
        hit.state,
        lifecycleInput({
          nowMs: T0 + 700,
          wrist: { x: 0.2, y: 0.2 },
          hitExitTransitionMs,
          preferredTargetPosition: newLevel.position,
          levelDegrees: newLevel.levelDegrees,
        }),
      );
      assert.equal(successor.state.currentTarget?.levelDegrees, 70);
      assert.equal(successor.state.currentTarget?.x, newLevel.position.x);
    }
  });
});
