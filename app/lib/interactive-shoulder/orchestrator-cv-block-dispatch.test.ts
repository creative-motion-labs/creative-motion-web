/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-block-dispatch.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerAllBlockRunners } from "./block-engine/register-all-block-runners";
import { INSTRUCTIONAL_BLOCK_RUNNER } from "./block-engine/instructional-block-runner";
import { D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./motion-patterns/d1-inspired-diagonal-reach-pattern";
import { resolveActiveMotionPattern } from "./motion-patterns/motion-pattern-registry";
import { createInitialInstructionalLifecycle } from "./instructional-lifecycle";
import { createInitialTargetLifecycle } from "./target-lifecycle";
import { samplePathAtProgress } from "./motion-patterns/bezier-path";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import type {
  SessionBlockType,
  SessionOrchestratorSnapshot,
  SessionState,
} from "@/app/lib/session-orchestrator/types";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "./shoulder-abduction-reach-session-definition";
import {
  dispatchOrchestratorCvBlock,
  resetRunnerStatesForBlockTransition,
  resolveOrchestratorBlockType,
  resolveOrchestratorHudFeedbackMode,
} from "./orchestrator-cv-block-dispatch";

const T0 = 8_000_000;

function emptyStates() {
  return {
    instructional: createInitialInstructionalLifecycle(),
    target: createInitialTargetLifecycle(),
    pattern: null,
  };
}

function activeSnap(block = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0]): SessionOrchestratorSnapshot {
  return {
    sessionState: "active",
    blockProgress: 0,
    blockElapsedSeconds: 0,
    safetyStatus: "normal",
    isPaused: false,
    patientFeedbackState: { message: null, encouragement: null },
    currentBlock: block,
    accumulatedBlockResults: [],
  } as SessionOrchestratorSnapshot;
}

describe("orchestrator-cv-block-dispatch", () => {
  registerAllBlockRunners();

  it("target mode skips dispatch until wrist data exists", () => {
    const result = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(result.status, "skipped");
    if (result.status !== "skipped") return;
    assert.equal(result.reason, "target_wrist_required");
  });

  it("movement-pattern may tick with wrist null", () => {
    const pattern = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const patternBlock = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks[2];
    const transition = resetRunnerStatesForBlockTransition({
      block: patternBlock,
      side: "right",
    });
    assert.equal(transition.fault, null);
    assert.ok(transition.states.pattern);
    const result = dispatchOrchestratorCvBlock({
      snap: activeSnap(patternBlock),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: transition.states,
      activeMotionPattern: pattern,
    });
    assert.equal(result.status, "dispatched");
  });

  it("instructional dispatch requires no wrist and produces presentation progress only", () => {
    const warmUp = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks[0];
    const result = dispatchOrchestratorCvBlock({
      snap: activeSnap(warmUp),
      nowMs: T0,
      wrist: { x: 0.9, y: 0.9 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(result.status, "dispatched");
    if (result.status !== "dispatched") return;
    assert.equal(result.targetContact, null);
    assert.equal(result.patternCompleted, null);
    assert.ok(result.presentationProgress != null);
    assert.equal(result.states.instructional.completed, false);
    assert.equal(result.states.pattern, null);
  });

  it("paused session state does not dispatch runners", () => {
    const snap = { ...activeSnap(), sessionState: "paused" as const };
    const result = dispatchOrchestratorCvBlock({
      snap,
      nowMs: T0,
      wrist: { x: 0.5, y: 0.5 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(result.status, "not_active");
  });

  it("safetyHold session state does not dispatch runners", () => {
    const snap = { ...activeSnap(), sessionState: "safetyHold" as const };
    const result = dispatchOrchestratorCvBlock({
      snap,
      nowMs: T0,
      wrist: { x: 0.5, y: 0.5 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(result.status, "not_active");
  });

  it("targetContact and patternCompleted never cross-map", () => {
    let states = emptyStates();
    const spawned = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states,
      activeMotionPattern: null,
    });
    assert.equal(spawned.status, "skipped");

    const withSpawn = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: { x: 0.5, y: 0.35 },
      side: "right",
      hitExitTransitionMs: 0,
      states,
      activeMotionPattern: null,
    });
    assert.equal(withSpawn.status, "dispatched");
    if (withSpawn.status !== "dispatched") return;
    states = withSpawn.states;
    const target = states.target.currentTarget!;
    const hit = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0 + 500,
      wrist: { x: target.x, y: target.y },
      side: "right",
      hitExitTransitionMs: 0,
      states,
      activeMotionPattern: null,
    });
    assert.equal(hit.status, "dispatched");
    if (hit.status !== "dispatched") return;
    assert.ok(hit.targetContact);
    assert.equal(hit.patternCompleted, null);

    const pattern = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const patternBlock = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks[2];
    let patternStates = resetRunnerStatesForBlockTransition({
      block: patternBlock,
      side: "right",
    }).states;
    let completionCount = 0;
    for (let i = 0; i <= 24; i += 1) {
      const progress = 0.05 + (0.93 * i) / 24;
      const ticked = dispatchOrchestratorCvBlock({
        snap: activeSnap(patternBlock),
        nowMs: T0 + i * 50,
        wrist: samplePathAtProgress(pattern.sampledPath, progress),
        side: "right",
        hitExitTransitionMs: 0,
        states: patternStates,
        activeMotionPattern: pattern,
      });
      assert.equal(ticked.status, "dispatched");
      if (ticked.status !== "dispatched") return;
      patternStates = ticked.states;
      if (ticked.patternCompleted) completionCount += 1;
      assert.equal(ticked.targetContact, null);
    }
    assert.equal(completionCount, 1);
  });

  it("null target resolver produces runner_unavailable fault", () => {
    const result = dispatchOrchestratorCvBlock({
      snap: activeSnap(),
      nowMs: T0,
      wrist: { x: 0.5, y: 0.35 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      resolvers: { resolveTargetRunner: () => null },
    });
    assert.equal(result.status, "fault");
    if (result.status !== "fault") return;
    assert.equal(result.fault.kind, "runner_unavailable");
    assert.equal(result.fault.blockType, "movement-target");
  });

  it("unresolved motion pattern block produces pattern_unresolved fault on transition with null pattern state", () => {
    const transition = resetRunnerStatesForBlockTransition({
      block: {
        ...SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0],
        blockId: "broken-pattern-block",
        blockType: "movement-pattern",
        feedbackProfile: "unknown-pattern-profile",
      },
      side: "right",
    });
    assert.ok(transition.fault);
    assert.equal(transition.fault?.kind, "pattern_unresolved");
    assert.equal(transition.activeMotionPattern, null);
    assert.equal(transition.states.pattern, null);
  });

  it("dispatch returns pattern_unresolved when activeMotionPattern or pattern state is missing at runtime", () => {
    const patternBlock = {
      ...SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0],
      blockId: "runtime-pattern-block",
      blockType: "movement-pattern" as const,
      feedbackProfile: D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE,
    };
    const missingPattern = dispatchOrchestratorCvBlock({
      snap: activeSnap(patternBlock),
      nowMs: T0,
      wrist: { x: 0.5, y: 0.5 },
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(missingPattern.status, "fault");
    if (missingPattern.status !== "fault") return;
    assert.equal(missingPattern.fault.kind, "pattern_unresolved");

    const pattern = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const missingState = dispatchOrchestratorCvBlock({
      snap: activeSnap(patternBlock),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: pattern,
    });
    assert.equal(missingState.status, "fault");
  });

  it("block transition resets instructional, target, and pattern runner states without placeholder pattern IDs", () => {
    const warmUp = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks[0];
    const reach = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks[1];
    const warmTransition = resetRunnerStatesForBlockTransition({ block: warmUp, side: "right" });
    assert.equal(resolveOrchestratorBlockType(warmUp), "instructional");
    assert.equal(warmTransition.fault, null);
    assert.equal(warmTransition.states.pattern, null);

    const reachTransition = resetRunnerStatesForBlockTransition({ block: reach, side: "right" });
    assert.equal(resolveOrchestratorBlockType(reach), "movement-target");
    assert.equal(reachTransition.states.target.sequence, 0);
    assert.equal(reachTransition.states.instructional.completed, false);
    assert.equal(reachTransition.states.pattern, null);
  });

  it("explicit blockType wins over conflicting feedbackProfile for dispatch and HUD visual mode", () => {
    const conflictingBlock = {
      ...SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0],
      blockId: "conflicting-block",
      blockType: "movement-target" as const,
      feedbackProfile: D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE,
    };
    const blockType = resolveOrchestratorBlockType(conflictingBlock);
    assert.equal(blockType, "movement-target");
    assert.equal(resolveOrchestratorHudFeedbackMode(blockType), "reach-the-light-targets");

    const transition = resetRunnerStatesForBlockTransition({
      block: conflictingBlock,
      side: "right",
    });
    assert.equal(transition.activeMotionPattern, null);
    assert.equal(transition.states.pattern, null);

    const skipped = dispatchOrchestratorCvBlock({
      snap: activeSnap(conflictingBlock),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: transition.states,
      activeMotionPattern: null,
    });
    assert.equal(skipped.status, "skipped");
    if (skipped.status !== "skipped") return;
    assert.equal(skipped.reason, "target_wrist_required");
  });

  it("injected instructional runner tick() is executed by dispatch", () => {
    let tickCalls = 0;
    const warmUp = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1).blocks[0];
    const fakeRunner = {
      ...INSTRUCTIONAL_BLOCK_RUNNER,
      tick: () => {
        tickCalls += 1;
        return {
          state: { completed: false },
          ticked: true,
          completionEvent: null,
        };
      },
    };
    dispatchOrchestratorCvBlock({
      snap: activeSnap(warmUp),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      resolvers: { resolveInstructionalRunner: () => fakeRunner },
    });
    assert.equal(tickCalls, 1);
  });
});

describe("orchestrator cv session — stroke four-block real dispatch", () => {
  it("runs each Stroke ULRF block through orchestrator, transition reset, and real dispatch", () => {
    registerAllBlockRunners();
    const definition = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);
    const orchestrator = new SessionOrchestrator(definition);
    let nowMs = T0;
    orchestrator.start(nowMs);
    orchestrator.beginCalibration(nowMs);
    orchestrator.completeCalibration(nowMs);

    const visitedBlockIds: string[] = [];
    const dispatchCounts: Record<SessionBlockType, number> = {
      instructional: 0,
      "movement-target": 0,
      "movement-pattern": 0,
    };

    for (let index = 0; index < definition.blocks.length; index += 1) {
      const block = definition.blocks[index];
      orchestrator.tick(nowMs);
      const snap = orchestrator.getSnapshot(nowMs);
      assert.equal(snap.currentBlock?.blockId, block.blockId);
      visitedBlockIds.push(block.blockId);

      const blockType = resolveOrchestratorBlockType(block);
      assert.ok(blockType);

      const transition = resetRunnerStatesForBlockTransition({
        block,
        side: "right",
      });
      assert.equal(transition.fault, null, `block ${block.blockId} must not fault`);

      const wrist =
        blockType === "movement-target"
          ? ({ x: 0.5, y: 0.35 } as const)
          : null;

      const result = dispatchOrchestratorCvBlock({
        snap,
        nowMs,
        wrist,
        side: "right",
        hitExitTransitionMs: 0,
        states: transition.states,
        activeMotionPattern: transition.activeMotionPattern,
      });

      assert.equal(result.status, "dispatched", `block ${block.blockId} must dispatch`);
      dispatchCounts[blockType] += 1;

      nowMs += (block.targetDurationSeconds ?? 0) * 1_000;
    }

    orchestrator.tick(nowMs);
    const finalSnap = orchestrator.getSnapshot(nowMs);
    assert.equal(finalSnap.sessionState, "completed");
    assert.deepEqual(visitedBlockIds, definition.blocks.map((block) => block.blockId));
    assert.equal(dispatchCounts.instructional, 2);
    assert.equal(dispatchCounts["movement-target"], 1);
    assert.equal(dispatchCounts["movement-pattern"], 1);
    assert.equal(finalSnap.accumulatedBlockResults.length, 4);
    assert.equal(orchestrator.getSessionPerformanceSummary(nowMs).blocksCompleted, 4);
  });
});

/**
 * CHANGE-004 — target-attempt dispatch plumbing.
 *
 * FIXTURE VALUES ONLY. `FIXTURE_TIMEOUT_MS` is a test number with no clinical validation
 * whatsoever; production code supplies no timeout at all, and several tests below exist
 * specifically to prove that dispatch never invents one.
 */
const FIXTURE_TIMEOUT_MS = 4_000;
const FIXTURE_LEVEL_DEGREES = 45;
const TARGET_BLOCK = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0];

/**
 * A wrist sample that satisfies the tracking requirement without ever landing inside a
 * generated target.
 *
 * `dispatchOrchestratorCvBlock` deliberately exposes no `random` seam, so a spawn tick
 * cannot be seeded here the way the lifecycle tests seed theirs. Right-side targets are
 * generated into x ∈ [0.47, 0.82], y ∈ [0.12, 0.72]; this point is far outside the 0.08
 * collision radius of all of it, so "spawn a target" never accidentally becomes "spawn and
 * immediately contact a target" and the attempt counts below stay deterministic.
 */
const WRIST_AWAY_FROM_TARGETS = { x: 0.2, y: 0.9 };

/** An active snapshot whose pause-aware block clock reads `blockElapsedSeconds`. */
function snapAt(
  blockElapsedSeconds: number,
  sessionState: SessionState = "active",
): SessionOrchestratorSnapshot {
  return { ...activeSnap(TARGET_BLOCK), blockElapsedSeconds, sessionState };
}

/** Spawns the first target with a wrist present, so later ticks have an ACTIVE attempt. */
function spawnedTargetStates(targetAttempt: { attemptTimeoutMs?: number; levelDegrees?: number } = {}) {
  const spawned = dispatchOrchestratorCvBlock({
    snap: snapAt(0),
    nowMs: T0,
    wrist: WRIST_AWAY_FROM_TARGETS,
    side: "right",
    hitExitTransitionMs: 0,
    states: emptyStates(),
    activeMotionPattern: null,
    targetAttempt,
  });
  assert.equal(spawned.status, "dispatched");
  if (spawned.status !== "dispatched") throw new Error("expected dispatch");
  assert.ok(spawned.states.target.currentTarget);
  return spawned;
}

describe("orchestrator-cv-block-dispatch — CHANGE-004 clock and configuration seam", () => {
  registerAllBlockRunners();

  it("10. passes the SNAPSHOT blockElapsedSeconds into the target lifecycle as the attempt clock", () => {
    // nowMs and the block clock are deliberately unrelated numbers: if dispatch ever
    // derived attempt time from the wall clock, these assertions would not hold.
    const result = dispatchOrchestratorCvBlock({
      snap: snapAt(9),
      nowMs: T0,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS, levelDegrees: FIXTURE_LEVEL_DEGREES },
    });
    assert.equal(result.status, "dispatched");
    if (result.status !== "dispatched") return;

    assert.equal(result.states.target.currentTarget?.spawnedAtBlockElapsedS, 9);
    assert.equal(result.targetAttemptStarted.length, 1);
    assert.equal(result.targetAttemptStarted[0].startedAtBlockElapsedS, 9);
    assert.equal(result.targetAttemptStarted[0].startedAtMs, T0);
    assert.equal(result.targetAttemptStarted[0].levelDegrees, FIXTURE_LEVEL_DEGREES);
  });

  it("11. omitting targetAttempt preserves legacy behaviour end to end", () => {
    // Legacy no-wrist behaviour is unconditional again the moment the seam is unused.
    const skipped = dispatchOrchestratorCvBlock({
      snap: snapAt(0),
      nowMs: T0,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
    });
    assert.equal(skipped.status, "skipped");
    if (skipped.status !== "skipped") return;
    assert.equal(skipped.reason, "target_wrist_required");

    // And a legacy tick with a wrist behaves exactly as before: spawn, hit, no expiration.
    const spawned = spawnedTargetStates();
    const target = spawned.states.target.currentTarget!;
    const hit = dispatchOrchestratorCvBlock({
      snap: snapAt(600),
      nowMs: T0 + 500,
      wrist: { x: target.x, y: target.y },
      side: "right",
      hitExitTransitionMs: 0,
      states: spawned.states,
      activeMotionPattern: null,
    });
    assert.equal(hit.status, "dispatched");
    if (hit.status !== "dispatched") return;
    assert.ok(hit.targetContact);
    assert.equal(hit.targetAttemptTimeout, null);
    assert.equal(hit.patternCompleted, null);
    assert.equal(hit.presentationProgress, null);
  });

  it("12. never fabricates an attemptTimeoutMs — no elapsed time expires an unconfigured attempt", () => {
    // The seam is opted into, but carries no timeout. If any default (4000, 8000, 12000 …)
    // existed anywhere on this path, ten minutes of block time would trip it.
    let states = spawnedTargetStates({}).states;
    const originalTargetId = states.target.currentTarget?.id;

    for (const elapsedS of [4, 8, 12, 60, 600]) {
      const ticked = dispatchOrchestratorCvBlock({
        snap: snapAt(elapsedS),
        nowMs: T0 + elapsedS * 1000,
        wrist: null,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: {},
      });
      assert.equal(ticked.status, "dispatched");
      if (ticked.status !== "dispatched") return;
      assert.equal(ticked.targetAttemptTimeout, null, `no timeout may appear at ${elapsedS}s`);
      assert.deepEqual(ticked.targetAttemptStarted, [], "no attempt may restart either");
      states = ticked.states;
    }
    assert.equal(states.target.currentTarget?.id, originalTargetId);
  });

  it("13. never fabricates a levelDegrees — absent stays absent", () => {
    for (const targetAttempt of [undefined, {}]) {
      const result = dispatchOrchestratorCvBlock({
        snap: snapAt(0),
        nowMs: T0,
        wrist: WRIST_AWAY_FROM_TARGETS,
        side: "right",
        hitExitTransitionMs: 0,
        states: emptyStates(),
        activeMotionPattern: null,
        targetAttempt,
      });
      assert.equal(result.status, "dispatched");
      if (result.status !== "dispatched") return;
      assert.equal(result.states.target.currentTarget?.levelDegrees, undefined);
      assert.equal(result.targetAttemptStarted[0]?.levelDegrees, undefined);
    }
  });
});

describe("orchestrator-cv-block-dispatch — CHANGE-004 null wrist behaviour", () => {
  registerAllBlockRunners();

  it("14. null wrist with NO active target keeps the target_wrist_required skip, configured or not", () => {
    for (const targetAttempt of [undefined, {}, { attemptTimeoutMs: FIXTURE_TIMEOUT_MS }]) {
      const result = dispatchOrchestratorCvBlock({
        snap: snapAt(0),
        nowMs: T0,
        wrist: null,
        side: "right",
        hitExitTransitionMs: 0,
        states: emptyStates(),
        activeMotionPattern: null,
        targetAttempt,
      });
      assert.equal(result.status, "skipped");
      if (result.status !== "skipped") return;
      assert.equal(result.reason, "target_wrist_required");
    }
  });

  it("14b. the first target is never spawned without tracking, however long the block runs", () => {
    // Deliberately never reassigned: every tick is fed the SAME untouched state, which is
    // what proves no spawn ever happened.
    const states = emptyStates();
    for (const elapsedS of [0, 5, 30, 120]) {
      const result = dispatchOrchestratorCvBlock({
        snap: snapAt(elapsedS),
        nowMs: T0 + elapsedS * 1000,
        wrist: null,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      assert.equal(result.status, "skipped");
      assert.equal(states.target.currentTarget, null);
      assert.equal(states.target.interaction.targetsShown, 0);
    }
  });

  it("15. null wrist WITH an active target performs lifecycle maintenance instead of skipping", () => {
    const spawned = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS });
    const targetId = spawned.states.target.currentTarget?.id;

    const maintained = dispatchOrchestratorCvBlock({
      snap: snapAt(1),
      nowMs: T0 + 1000,
      wrist: null,
      side: "right",
      hitExitTransitionMs: 0,
      states: spawned.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(maintained.status, "dispatched");
    if (maintained.status !== "dispatched") return;
    assert.equal(maintained.states.target.currentTarget?.id, targetId, "the attempt is preserved");
    assert.equal(maintained.targetContact, null);
    assert.equal(maintained.targetAttemptTimeout, null);
  });

  it("16. a missing wrist by itself never produces a timeout below the configured threshold", () => {
    let states = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS }).states;
    // Whole attempt spent with the tracker unavailable, but still short of the threshold.
    for (const elapsedS of [0.5, 1.5, 2.5, 3.5, 3.999]) {
      const ticked = dispatchOrchestratorCvBlock({
        snap: snapAt(elapsedS),
        nowMs: T0 + elapsedS * 1000,
        wrist: null,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      assert.equal(ticked.status, "dispatched");
      if (ticked.status !== "dispatched") return;
      assert.equal(
        ticked.targetAttemptTimeout,
        null,
        `absent tracking is not failure — nothing may expire at ${elapsedS}s`,
      );
      states = ticked.states;
    }
  });

  it("17. an active attempt expires once its active block time legitimately reaches the threshold", () => {
    const spawned = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS });
    const expiringTargetId = spawned.states.target.currentTarget?.id;

    const expired = dispatchOrchestratorCvBlock({
      snap: snapAt(FIXTURE_TIMEOUT_MS / 1000),
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: spawned.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(expired.status, "dispatched");
    if (expired.status !== "dispatched") return;
    assert.ok(expired.targetAttemptTimeout, "the timeout reached the dispatch caller");
    assert.equal(expired.targetAttemptTimeout?.targetId, expiringTargetId);
    assert.equal(expired.targetAttemptTimeout?.activeElapsedMs, FIXTURE_TIMEOUT_MS);
    assert.equal(expired.targetAttemptTimeout?.expiredAtBlockElapsedS, FIXTURE_TIMEOUT_MS / 1000);
  });

  it("18/19. the timeout crosses dispatch exactly once, and carries no contact", () => {
    let states = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS }).states;
    const firstTargetId = states.target.currentTarget?.id;
    const timeoutsPerTarget = new Map<string, number>();
    let contacts = 0;

    // Keep ticking well past the first expiration. The wrist is MEASURED throughout and
    // simply nowhere near a target, which is what makes these attempts legitimately
    // incomplete rather than merely unobserved (review fix, blocker 2). Every tick also
    // builds and then expires a successor, so exactly-once is exercised repeatedly.
    for (let elapsedS = 4; elapsedS <= 20; elapsedS += 1) {
      const ticked = dispatchOrchestratorCvBlock({
        snap: snapAt(elapsedS),
        nowMs: T0 + elapsedS * 1000,
        wrist: WRIST_AWAY_FROM_TARGETS,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      if (ticked.status === "skipped") continue;
      assert.equal(ticked.status, "dispatched");
      if (ticked.status !== "dispatched") return;
      if (ticked.targetContact) contacts += 1;
      if (ticked.targetAttemptTimeout) {
        const id = ticked.targetAttemptTimeout.targetId;
        timeoutsPerTarget.set(id, (timeoutsPerTarget.get(id) ?? 0) + 1);
        assert.equal(ticked.targetContact, null, "19. an expiring tick reports no hit");
      }
      states = ticked.states;
    }

    assert.equal(timeoutsPerTarget.get(firstTargetId!), 1, "18. reported exactly once");
    for (const [id, count] of timeoutsPerTarget) {
      assert.equal(count, 1, `target ${id} expired more than once`);
    }
    assert.equal(contacts, 0, "the wrist never entered a target");
  });

  // REVIEW FIX, BLOCKER 2 (PR #240) — the same loop, with the wrist UNAVAILABLE.
  //
  // This test previously ran the loop above with `wrist: null` and asserted that a
  // tracking gap produced exactly ONE timeout. That was the defect Aisha found: the
  // attempt was still being charged for time nobody could measure, so a long enough gap
  // reported the patient as incomplete. The correct count is ZERO — see the adaptive
  // consequence proved end to end in `adaptive/immediate-successor-feedback.test`.
  it("18b. a wrist-only measurement gap expires nothing, however long it lasts", () => {
    let states = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS }).states;
    const attemptTargetId = states.target.currentTarget?.id;
    let timeouts = 0;
    let contacts = 0;

    // Sixteen seconds of block time — four times the fixture window — with the session
    // fully active, no tracker loss, and no wrist sample.
    for (let elapsedS = 4; elapsedS <= 20; elapsedS += 1) {
      const ticked = dispatchOrchestratorCvBlock({
        snap: snapAt(elapsedS),
        nowMs: T0 + elapsedS * 1000,
        wrist: null,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      assert.equal(ticked.status, "dispatched", "the in-flight attempt keeps being ticked");
      if (ticked.status !== "dispatched") return;
      if (ticked.targetAttemptTimeout) timeouts += 1;
      if (ticked.targetContact) contacts += 1;
      states = ticked.states;
    }

    assert.equal(timeouts, 0, "measurement loss must never expire an attempt");
    assert.equal(contacts, 0);
    // The attempt is HELD, not voided: the same target is still live and still its own
    // attempt, so no target churn and no lost attempt identity.
    assert.equal(states.target.currentTarget?.id, attemptTargetId, "the same attempt is alive");
    assert.equal(states.target.sequence, 1, "no successor was manufactured");

    // Measurement returns. The window resumes from where it was held — it neither expires
    // instantly against the 16 seconds that passed, nor restarts from zero.
    const resumed = dispatchOrchestratorCvBlock({
      snap: snapAt(21),
      nowMs: T0 + 21_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(resumed.status, "dispatched");
    if (resumed.status !== "dispatched") return;
    assert.equal(resumed.targetAttemptTimeout, null, "no instant expiry on recovery");
    assert.equal(resumed.states.target.currentTarget?.id, attemptTargetId);

    // Every second of this attempt so far was unmeasured, so its FULL window survives:
    // the threshold is reached only after another `FIXTURE_TIMEOUT_MS` of measured time,
    // at block second 24 — not at 22, and certainly not instantly at 21.
    const stillRunning = dispatchOrchestratorCvBlock({
      snap: snapAt(23),
      nowMs: T0 + 23_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: resumed.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(stillRunning.status, "dispatched");
    if (stillRunning.status !== "dispatched") return;
    assert.equal(stillRunning.targetAttemptTimeout, null, "3s of measured time is not yet 4s");

    const expired = dispatchOrchestratorCvBlock({
      snap: snapAt(24),
      nowMs: T0 + 24_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: stillRunning.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(expired.status, "dispatched");
    if (expired.status !== "dispatched") return;
    assert.ok(expired.targetAttemptTimeout, "measurable time still expires the attempt");
    assert.equal(expired.targetAttemptTimeout?.targetId, attemptTargetId);
    // The reported duration counts ONLY measured time. The attempt spanned 24 block
    // seconds; 20 of them were unmeasured, and the event reports the other 4.
    assert.equal(
      expired.targetAttemptTimeout?.activeElapsedMs,
      FIXTURE_TIMEOUT_MS,
      "the 20s measurement gap was excluded from the reported attempt duration",
    );
  });
});

describe("orchestrator-cv-block-dispatch — CHANGE-004 gating and spawn-lock semantics", () => {
  registerAllBlockRunners();

  it("20. a paused or safety-held session cannot expire an attempt", () => {
    const spawned = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS });
    for (const sessionState of ["paused", "safetyHold"] as const) {
      const result = dispatchOrchestratorCvBlock({
        // Even if a caller handed in a block clock far past the threshold, a non-active
        // session may not produce a terminal attempt result.
        snap: snapAt(600, sessionState),
        nowMs: T0 + 600_000,
        wrist: null,
        side: "right",
        hitExitTransitionMs: 0,
        states: spawned.states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      assert.equal(result.status, "not_active");
      // The caller's state is left exactly as it was: same attempt, same sequence, and
      // no terminal result of any kind was produced for it.
      assert.equal(spawned.states.target.sequence, 1);
      assert.ok(spawned.states.target.currentTarget);
      assert.equal(spawned.states.target.targetHit, false);
    }
  });

  it("21. an inactive session cannot start a new attempt", () => {
    for (const sessionState of ["paused", "safetyHold", "completed", "calibrating"] as const) {
      const states = emptyStates();
      const result = dispatchOrchestratorCvBlock({
        snap: snapAt(0, sessionState),
        nowMs: T0,
        wrist: WRIST_AWAY_FROM_TARGETS,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      assert.equal(result.status, "not_active");
      assert.equal(states.target.currentTarget, null);
      assert.equal(states.target.sequence, 0);
    }
  });

  it("22. an exit transition with no wrist does not spawn the successor early", () => {
    const exitTransitionMs = 300;
    const spawned = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS });
    const target = spawned.states.target.currentTarget!;

    const hit = dispatchOrchestratorCvBlock({
      snap: snapAt(0.5),
      nowMs: T0 + 500,
      wrist: { x: target.x, y: target.y },
      side: "right",
      hitExitTransitionMs: exitTransitionMs,
      states: spawned.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(hit.status, "dispatched");
    if (hit.status !== "dispatched") return;
    assert.ok(hit.targetContact);
    // Post-hit exit transition: no active target, spawn locked, successor pending.
    assert.equal(hit.states.target.currentTarget, null);
    assert.ok(hit.states.target.spawnLockedUntilMs);
    const sequenceAfterHit = hit.states.target.sequence;

    // During the lock, with no wrist: skipped, exactly as before CHANGE-004.
    const duringLock = dispatchOrchestratorCvBlock({
      snap: snapAt(0.6),
      nowMs: T0 + 600,
      wrist: null,
      side: "right",
      hitExitTransitionMs: exitTransitionMs,
      states: hit.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(duringLock.status, "skipped");

    // Lock elapsed, wrist still unavailable: still skipped. A patient who is not being
    // tracked is not shown a fresh target — dispatch never restores target availability.
    const afterLock = dispatchOrchestratorCvBlock({
      snap: snapAt(5),
      nowMs: T0 + 5_000,
      wrist: null,
      side: "right",
      hitExitTransitionMs: exitTransitionMs,
      states: hit.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(afterLock.status, "skipped");
    assert.equal(hit.states.target.sequence, sequenceAfterHit, "no successor was created");
    assert.equal(hit.states.target.currentTarget, null);

    // Tracking returns: the successor spawns normally and starts exactly one attempt.
    const recovered = dispatchOrchestratorCvBlock({
      snap: snapAt(5),
      nowMs: T0 + 5_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: exitTransitionMs,
      states: hit.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(recovered.status, "dispatched");
    if (recovered.status !== "dispatched") return;
    assert.ok(recovered.states.target.currentTarget);
    assert.equal(recovered.targetAttemptStarted.length, 1);
    assert.equal(recovered.states.target.sequence, sequenceAfterHit + 1);
  });

  it("23. contact at the exact timeout threshold still wins after full dispatch plumbing", () => {
    const spawned = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS });
    const target = spawned.states.target.currentTarget!;

    const atThreshold = dispatchOrchestratorCvBlock({
      snap: snapAt(FIXTURE_TIMEOUT_MS / 1000),
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      wrist: { x: target.x, y: target.y },
      side: "right",
      hitExitTransitionMs: 0,
      states: spawned.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(atThreshold.status, "dispatched");
    if (atThreshold.status !== "dispatched") return;
    assert.ok(atThreshold.targetContact, "visible contact is never reported as an incomplete attempt");
    assert.equal(atThreshold.targetContact?.targetId, target.id);
    assert.equal(atThreshold.targetAttemptTimeout, null);
  });

  it("24. one target never produces both a success and a timeout", () => {
    let states = spawnedTargetStates({ attemptTimeoutMs: FIXTURE_TIMEOUT_MS }).states;
    const outcomes = new Map<string, string>();

    // The wrist is tracked on every frame — it simply rests outside the safe target bounds
    // except on contact frames, so it can never be inside a target by accident. Attempts
    // therefore end both ways: every tenth frame is reached, and the ones in between run
    // past the 4s fixture window and expire. Both terminal paths are exercised repeatedly
    // against the same state machine.
    //
    // Tracking is kept present deliberately: since CHANGE-008 a successor is built on a
    // later tick, and an untracked tick legitimately refuses to present a new target, so a
    // null-wrist loop would stall rather than exercise successive attempts. That refusal is
    // asserted directly in test 18/19.
    for (let step = 0; step < 40; step += 1) {
      const elapsedS = step * 0.75;
      const current = states.target.currentTarget;
      const wrist =
        step % 10 === 0 && current ? { x: current.x, y: current.y } : { x: 0.02, y: 0.98 };
      const ticked = dispatchOrchestratorCvBlock({
        snap: snapAt(elapsedS),
        nowMs: T0 + elapsedS * 1000,
        wrist,
        side: "right",
        hitExitTransitionMs: 0,
        states,
        activeMotionPattern: null,
        targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
      });
      if (ticked.status === "skipped") continue;
      assert.equal(ticked.status, "dispatched");
      if (ticked.status !== "dispatched") return;

      assert.ok(
        !(ticked.targetContact && ticked.targetAttemptTimeout),
        "a single tick may not report contact and expiration together",
      );
      for (const [id, kind] of [
        [ticked.targetContact?.targetId, "success"] as const,
        [ticked.targetAttemptTimeout?.targetId, "timeout"] as const,
      ]) {
        if (!id) continue;
        assert.equal(outcomes.has(id), false, `target ${id} produced a second terminal result`);
        outcomes.set(id, kind);
      }
      states = ticked.states;
    }

    assert.ok(outcomes.size > 1, "the loop must exercise several completed attempts");
    assert.ok([...outcomes.values()].includes("success"), "at least one success occurred");
    assert.ok([...outcomes.values()].includes("timeout"), "at least one timeout occurred");
  });

  it("25. all four Stroke ULRF blocks still dispatch, with attempt fields inert off the target path", () => {
    registerAllBlockRunners();
    const definition = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);
    const seen: Record<SessionBlockType, number> = {
      instructional: 0,
      "movement-target": 0,
      "movement-pattern": 0,
    };

    for (const block of definition.blocks) {
      const blockType = resolveOrchestratorBlockType(block)!;
      const transition = resetRunnerStatesForBlockTransition({ block, side: "right" });
      assert.equal(transition.fault, null);

      const result = dispatchOrchestratorCvBlock({
        snap: { ...activeSnap(block), blockElapsedSeconds: 2 },
        nowMs: T0,
        wrist: blockType === "movement-target" ? WRIST_AWAY_FROM_TARGETS : null,
        side: "right",
        hitExitTransitionMs: 0,
        states: transition.states,
        activeMotionPattern: transition.activeMotionPattern,
      });
      assert.equal(result.status, "dispatched", `block ${block.blockId} must still dispatch`);
      if (result.status !== "dispatched") return;
      seen[blockType] += 1;

      if (blockType === "movement-target") {
        assert.equal(result.targetAttemptStarted.length, 1);
      } else {
        assert.deepEqual(result.targetAttemptStarted, [], `${blockType} gains no attempts`);
      }
      assert.equal(result.targetAttemptTimeout, null);
    }

    assert.equal(seen.instructional, 2);
    assert.equal(seen["movement-target"], 1);
    assert.equal(seen["movement-pattern"], 1);
  });
});

/**
 * CHANGE-004 — full-path integration.
 *
 * These drive a REAL SessionOrchestrator and the REAL block-runner registry, with no
 * injected resolvers and no hand-written snapshots, so the values under test travel the
 * entire path:
 *
 *   orchestrator snapshot → dispatchOrchestratorCvBlock → tickActiveBlockRunner
 *   → TARGET_BLOCK_RUNNER → tickTargetLifecycleIfActive → tickTargetLifecycle
 *
 * and the resulting events travel all the way back to the dispatch caller.
 */
describe("orchestrator cv dispatch — CHANGE-004 real end-to-end attempt path", () => {
  registerAllBlockRunners();

  function startedOrchestrator(startMs: number) {
    const orchestrator = new SessionOrchestrator(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION);
    orchestrator.start(startMs);
    orchestrator.beginCalibration(startMs);
    orchestrator.completeCalibration(startMs);
    orchestrator.tick(startMs);
    return orchestrator;
  }

  it("a real attempt-start event reaches the dispatch caller with the orchestrator's own block clock", () => {
    const orchestrator = startedOrchestrator(T0);
    orchestrator.tick(T0 + 2_000);
    const snap = orchestrator.getSnapshot(T0 + 2_000);
    assert.equal(snap.sessionState, "active");
    assert.equal(snap.currentBlock?.blockId, "shoulder-abduction-reach-main");

    const dispatched = dispatchOrchestratorCvBlock({
      snap,
      nowMs: T0 + 2_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(dispatched.status, "dispatched");
    if (dispatched.status !== "dispatched") return;

    assert.equal(dispatched.targetAttemptStarted.length, 1);
    const started = dispatched.targetAttemptStarted[0];
    assert.equal(started.targetId, dispatched.states.target.currentTarget?.id);
    assert.equal(started.sequence, 1);
    assert.equal(
      started.startedAtBlockElapsedS,
      snap.blockElapsedSeconds,
      "the attempt baseline is the orchestrator's pause-aware block clock, nothing else",
    );
  });

  it("a real timeout event travels the whole path back to the dispatch caller", () => {
    const orchestrator = startedOrchestrator(T0);
    const spawned = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0),
      nowMs: T0,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(spawned.status, "dispatched");
    if (spawned.status !== "dispatched") return;
    const expiringTargetId = spawned.states.target.currentTarget?.id;

    orchestrator.tick(T0 + FIXTURE_TIMEOUT_MS);
    const expired = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0 + FIXTURE_TIMEOUT_MS),
      nowMs: T0 + FIXTURE_TIMEOUT_MS,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: spawned.states,
      activeMotionPattern: null,
      targetAttempt: { attemptTimeoutMs: FIXTURE_TIMEOUT_MS },
    });
    assert.equal(expired.status, "dispatched");
    if (expired.status !== "dispatched") return;

    assert.ok(expired.targetAttemptTimeout, "the timeout survived every layer");
    assert.equal(expired.targetAttemptTimeout?.targetId, expiringTargetId);
    assert.equal(expired.targetAttemptTimeout?.activeElapsedMs, FIXTURE_TIMEOUT_MS);
    assert.equal(expired.targetAttemptTimeout?.attemptTimeoutMs, FIXTURE_TIMEOUT_MS);
    assert.equal(expired.targetContact, null);
  });

  it("a real orchestrator pause freezes attempt time — wall-clock seconds cannot expire an attempt", () => {
    const orchestrator = startedOrchestrator(T0);
    const config = { attemptTimeoutMs: FIXTURE_TIMEOUT_MS };
    const spawned = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0),
      nowMs: T0,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: emptyStates(),
      activeMotionPattern: null,
      targetAttempt: config,
    });
    assert.equal(spawned.status, "dispatched");
    if (spawned.status !== "dispatched") return;
    const attemptTargetId = spawned.states.target.currentTarget?.id;

    // 3 seconds of genuine active time — short of the fixture window.
    orchestrator.tick(T0 + 3_000);
    const beforePause = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0 + 3_000),
      nowMs: T0 + 3_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: spawned.states,
      activeMotionPattern: null,
      targetAttempt: config,
    });
    assert.equal(beforePause.status, "dispatched");
    if (beforePause.status !== "dispatched") return;
    assert.equal(beforePause.targetAttemptTimeout, null);

    // A full minute of wall-clock time passes while paused.
    orchestrator.pause(T0 + 3_000);
    orchestrator.tick(T0 + 63_000);
    const pausedSnap = orchestrator.getSnapshot(T0 + 63_000);
    assert.equal(pausedSnap.sessionState, "paused");
    assert.equal(pausedSnap.blockElapsedSeconds, 3, "the orchestrator froze the attempt clock");
    const whilePaused = dispatchOrchestratorCvBlock({
      snap: pausedSnap,
      nowMs: T0 + 63_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: beforePause.states,
      activeMotionPattern: null,
      targetAttempt: config,
    });
    assert.equal(whilePaused.status, "not_active");

    // Resumed: the attempt continues from where it stopped, not from wall-clock time.
    orchestrator.resume(T0 + 63_000);
    orchestrator.tick(T0 + 63_500);
    const afterResume = orchestrator.getSnapshot(T0 + 63_500);
    assert.ok(afterResume.blockElapsedSeconds < FIXTURE_TIMEOUT_MS / 1000);
    const stillRunning = dispatchOrchestratorCvBlock({
      snap: afterResume,
      nowMs: T0 + 63_500,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: beforePause.states,
      activeMotionPattern: null,
      targetAttempt: config,
    });
    assert.equal(stillRunning.status, "dispatched");
    if (stillRunning.status !== "dispatched") return;
    assert.equal(
      stillRunning.targetAttemptTimeout,
      null,
      "60 paused seconds must not consume any of the patient's attempt time",
    );
    assert.equal(stillRunning.states.target.currentTarget?.id, attemptTargetId);

    // One more second of genuine active time finally reaches the threshold.
    orchestrator.tick(T0 + 64_000);
    const finallyExpired = dispatchOrchestratorCvBlock({
      snap: orchestrator.getSnapshot(T0 + 64_000),
      nowMs: T0 + 64_000,
      wrist: WRIST_AWAY_FROM_TARGETS,
      side: "right",
      hitExitTransitionMs: 0,
      states: stillRunning.states,
      activeMotionPattern: null,
      targetAttempt: config,
    });
    assert.equal(finallyExpired.status, "dispatched");
    if (finallyExpired.status !== "dispatched") return;
    assert.ok(finallyExpired.targetAttemptTimeout);
    assert.equal(finallyExpired.targetAttemptTimeout?.targetId, attemptTargetId);
    assert.equal(finallyExpired.targetAttemptTimeout?.activeElapsedMs, FIXTURE_TIMEOUT_MS);
  });
});
