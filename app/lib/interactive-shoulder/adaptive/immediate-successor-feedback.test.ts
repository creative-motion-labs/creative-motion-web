/**
 * CHANGE-008 — immediate successor adaptive feedback.
 *
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/immediate-successor-feedback.test.ts
 *
 * THE INVARIANT UNDER TEST
 * ------------------------
 *   attempt N ends → N's adaptive outcome is applied → target N+1 is built
 *
 * and never the other order. Before CHANGE-008 a terminal tick built its own successor
 * inline, so N+1 was placed and timed from the state that attempt N had just invalidated;
 * the corrected values only reached N+2. That lag applied to timeouts and to the
 * reduced-motion hit path, which made an accessibility preference change the adaptive
 * timeline — the thing section 8 of the brief forbids.
 *
 * WHY THIS SUITE IS BEHAVIOURAL, NOT STRUCTURAL
 * ---------------------------------------------
 * The guarantee lives in the interaction between four independently-owned pieces: the
 * lifecycle's terminal transition, dispatch, the adaptive reducer, and the component's
 * per-frame ordering. Asserting any one of them in isolation — or asserting that a call
 * appears in the component source — would not prove the composition. So `runFrame` below
 * reproduces one `OrchestratorCvSessionCore` animation frame against a REAL
 * `SessionOrchestrator`, the REAL registered block runners, the REAL adaptive engine and
 * the REAL placement resolver, in the same order the component runs them. Every assertion
 * is then a statement about what a patient's session actually does.
 *
 * CLINICAL SAFETY: every degree, millisecond and coordinate here is a TEST FIXTURE. None
 * is a validated range-of-motion limit, a measured joint angle, or an approved reach
 * window. SYNTHETIC COORDINATES ONLY — no real-camera laterality is claimed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import type { SessionInputEvent } from "@/app/lib/session-orchestrator/types";
import { mapTargetHitToSessionInput } from "@/app/lib/session-orchestrator/adapters/shoulder-session-adapter";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import { registerAllBlockRunners } from "../block-engine/register-all-block-runners";
import type { ActiveBlockRunnerStates } from "../block-engine/tick-active-block-runner";
import {
  dispatchOrchestratorCvBlock,
  type OrchestratorCvBlockDispatchResult,
  type TargetAttemptTickConfig,
} from "../orchestrator-cv-block-dispatch";
import { createInitialInstructionalLifecycle } from "../instructional-lifecycle";
import { createInitialTargetLifecycle } from "../target-lifecycle";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "../target-generator";
import { DEFAULT_TARGET_HIT_CONFIG } from "../target-hit";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "../shoulder-abduction-reach-session-definition";
import type { NormalizedPoint, TherapeuticTarget } from "../types";
import { createAdaptiveDifficultyState } from "./adaptive-difficulty";
import type { AdaptiveDifficultyState } from "./adaptive-difficulty-types";
import {
  DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG,
  resolveDifficultyConfigForSessionFromEnv,
} from "./difficulty-config-registry";
import {
  applyDispatchOutcomesToAdaptiveState,
  resolveAttemptCompensationObservation,
} from "./adaptive-attempt-runtime";
import { resolveAdaptiveTargetPlacement } from "./adaptive-target-placement";

registerAllBlockRunners();

const T0 = 4_000_000;
const CONFIG = DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG;

/** Synthetic affected-side geometry, mirrored about x = 0.5. */
const RIGHT_SHOULDER: NormalizedPoint = { x: 0.55, y: 0.42 };
const LEFT_SHOULDER: NormalizedPoint = { x: 0.45, y: 0.42 };
const ARM_LENGTH = 0.25;

/** Outside `DEFAULT_SAFE_TARGET_BOUNDS`, so no target can ever be within reach of it. */
const RESTING_WRIST: NormalizedPoint = { x: 0.02, y: 0.97 };

/** The animated exit used in normal motion; reduced motion uses 0. */
const NORMAL_EXIT_MS = 480;

type Runtime = {
  orchestrator: SessionOrchestrator;
  states: ActiveBlockRunnerStates;
  /** null models a session with adaptive difficulty disabled. */
  adaptive: AdaptiveDifficultyState | null;
  /** Everything the component would have handed to `orchestrator.reportInputEvent`. */
  sessionInputs: SessionInputEvent[];
  side: ShoulderAbductionReachSide;
  shoulder: NormalizedPoint | null;
  armLength: number | null;
};

function createRuntime(overrides: Partial<Runtime> = {}): Runtime {
  const orchestrator = new SessionOrchestrator(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION);
  orchestrator.start(T0);
  orchestrator.beginCalibration(T0);
  orchestrator.completeCalibration(T0);
  orchestrator.tick(T0);
  return {
    orchestrator,
    states: {
      instructional: createInitialInstructionalLifecycle(),
      target: createInitialTargetLifecycle(),
      pattern: null,
    },
    adaptive: createAdaptiveDifficultyState(CONFIG),
    sessionInputs: [],
    side: "right",
    shoulder: RIGHT_SHOULDER,
    armLength: ARM_LENGTH,
    ...overrides,
  };
}

type FrameOptions = {
  nowMs: number;
  wrist: NormalizedPoint | null;
  hitExitTransitionMs?: number;
  compensationFlagged?: boolean;
  /**
   * Compensation observation supplied DIRECTLY through the `targetAttempt` seam,
   * bypassing `resolveAttemptCompensationObservation`.
   *
   * WHY THIS EXISTS (REVIEW FIX, BLOCKER 1)
   * ---------------------------------------
   * `resolveAttemptCompensationObservation` latches `true` and never asserts `false`,
   * because today's detector cannot tell "measured clear" from "never evaluated". So the
   * component currently reports every uncompensated attempt as UNKNOWN, and — correctly,
   * after this fix — UNKNOWN can no longer escalate under `excludedFromIncrease`.
   *
   * `compensationObservedDuringAttempt` is nonetheless a caller-owned `boolean` on the
   * seam, and a caller with a detector that CAN report measured-clear is entitled to send
   * `false`. This option models exactly that caller, so the observed-clean path stays
   * exercised end to end through the real dispatch runtime rather than only in the pure
   * engine. It is not a claim about what the current component emits.
   */
  compensationObserved?: boolean;
  /** Skips `orchestrator.tick`, mirroring a frame the component suppresses on a fault. */
  skipOrchestratorTick?: boolean;
};

type FrameResult = {
  dispatched: OrchestratorCvBlockDispatchResult;
  /** Adaptive level in force when this frame RESOLVED its placement (pre-outcome). */
  levelBefore: number | null;
  /** Adaptive level after this frame applied its outcome. */
  levelAfter: number | null;
  timeoutBefore: number | null;
  timeoutAfter: number | null;
  target: TherapeuticTarget | null;
};

/**
 * One `OrchestratorCvSessionCore` animation frame, in the component's exact order:
 *
 *   1. tick the orchestrator and read its snapshot
 *   2. resolve adaptive placement from the CURRENT adaptive state and this frame's geometry
 *   3. build the target-attempt seam (omitted entirely when adaptive is off)
 *   4. dispatch — the lifecycle may end an attempt, or build a successor, never both
 *   5. report a contact to the orchestrator as a session input (unchanged, additive-free)
 *   6. apply this frame's terminal outcomes to the adaptive state
 *
 * Step 6 after step 4 is what CHANGE-008 depends on, and step 2 reading the state that
 * step 6 last wrote is what makes the next frame's successor correct.
 */
function runFrame(rt: Runtime, opts: FrameOptions): FrameResult {
  if (opts.skipOrchestratorTick !== true) rt.orchestrator.tick(opts.nowMs);
  const snap = rt.orchestrator.getSnapshot(opts.nowMs);

  const adaptiveState = rt.adaptive;
  const levelBefore = adaptiveState?.currentLevel ?? null;
  const timeoutBefore = adaptiveState?.attemptTimeoutMs ?? null;

  const placement = resolveAdaptiveTargetPlacement({
    adaptiveState,
    affectedSide: rt.side,
    shoulderAnchorNormalized: rt.shoulder,
    reachRadiusNormalized: rt.armLength,
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
  });

  const targetAttempt: TargetAttemptTickConfig | undefined = adaptiveState
    ? {
        attemptTimeoutMs: adaptiveState.attemptTimeoutMs,
        compensationObservedDuringAttempt:
          "compensationObserved" in opts
            ? opts.compensationObserved
            : resolveAttemptCompensationObservation(opts.compensationFlagged),
        ...(placement.placed
          ? {
              preferredTargetPosition: placement.position,
              levelDegrees: placement.levelDegrees,
            }
          : {}),
      }
    : undefined;

  const dispatched = dispatchOrchestratorCvBlock({
    snap,
    nowMs: opts.nowMs,
    wrist: opts.wrist,
    side: rt.side,
    hitExitTransitionMs: opts.hitExitTransitionMs ?? 0,
    states: rt.states,
    activeMotionPattern: null,
    ...(targetAttempt ? { targetAttempt } : {}),
  });

  if (dispatched.status === "dispatched") {
    rt.states = dispatched.states;
    if (dispatched.targetContact) {
      const input = mapTargetHitToSessionInput(dispatched.targetContact);
      rt.orchestrator.reportInputEvent(input, opts.nowMs);
      rt.sessionInputs.push(input);
    }
    if (adaptiveState) {
      rt.adaptive = applyDispatchOutcomesToAdaptiveState(adaptiveState, {
        targetContact: dispatched.targetContact,
        targetAttemptTimeout: dispatched.targetAttemptTimeout,
      }).state;
    }
  }

  return {
    dispatched,
    levelBefore,
    levelAfter: rt.adaptive?.currentLevel ?? null,
    timeoutBefore,
    timeoutAfter: rt.adaptive?.attemptTimeoutMs ?? null,
    target: rt.states.target.currentTarget,
  };
}

function activeTarget(rt: Runtime): TherapeuticTarget {
  const target = rt.states.target.currentTarget;
  assert.ok(target, "expected an active target");
  return target;
}

/** A wrist sample sitting on the active target — "the patient has not moved". */
function onTargetOf(rt: Runtime): NormalizedPoint {
  const target = activeTarget(rt);
  return { x: target.x, y: target.y };
}

function contactOf(result: FrameResult) {
  assert.equal(result.dispatched.status, "dispatched");
  if (result.dispatched.status !== "dispatched") throw new Error("unreachable");
  return result.dispatched;
}

/**
 * Reaches the active target and returns the frame that registered the hit.
 *
 * Compensation is UNKNOWN unless the caller says otherwise — the production shape. A
 * reach whose point is that the streak advances must use `reachActiveTargetCleanly`.
 */
function reachActiveTarget(rt: Runtime, nowMs: number, hitExitTransitionMs = 0): FrameResult {
  const target = activeTarget(rt);
  const frame = runFrame(rt, { nowMs, wrist: { x: target.x, y: target.y }, hitExitTransitionMs });
  assert.ok(contactOf(frame).targetContact, `expected a hit at ${nowMs}`);
  return frame;
}

/** Reaches the active target with compensation OBSERVED and reported clean. */
function reachActiveTargetCleanly(
  rt: Runtime,
  nowMs: number,
  hitExitTransitionMs = 0,
): FrameResult {
  const target = activeTarget(rt);
  const frame = runFrame(rt, {
    nowMs,
    wrist: { x: target.x, y: target.y },
    hitExitTransitionMs,
    compensationObserved: false,
  });
  const contact = contactOf(frame).targetContact;
  assert.ok(contact, `expected a hit at ${nowMs}`);
  assert.equal(
    contact.compensatedDuringAttempt,
    false,
    "the clean observation must reach the terminal event, not be dropped",
  );
  return frame;
}

/** Lets the active attempt run out and returns the frame that expired it. */
function expireActiveAttempt(rt: Runtime, spawnedAtMs: number, hitExitTransitionMs = 0): FrameResult {
  const windowMs = rt.adaptive?.attemptTimeoutMs ?? CONFIG.normalAttemptTimeoutMs;
  const frame = runFrame(rt, {
    nowMs: spawnedAtMs + windowMs,
    wrist: RESTING_WRIST,
    hitExitTransitionMs,
  });
  assert.ok(contactOf(frame).targetAttemptTimeout, `expected an expiry at ${spawnedAtMs}`);
  return frame;
}

const distance = (a: NormalizedPoint, b: NormalizedPoint) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------
// 1. Exactly-once across the new terminal boundary
// ---------------------------------------------------------------------------

describe("CHANGE-008 exactly-once", () => {
  it("1. a timeout is emitted exactly once, however many frames follow", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const expiringId = activeTarget(rt).id;

    const expired = expireActiveAttempt(rt, T0);
    assert.equal(contactOf(expired).targetAttemptTimeout?.targetId, expiringId);

    const seen = new Set<string>([expiringId]);
    let frames = 0;
    for (let i = 1; i <= 20; i += 1) {
      const frame = runFrame(rt, {
        nowMs: T0 + CONFIG.normalAttemptTimeoutMs + i * 16,
        wrist: RESTING_WRIST,
      });
      const timeout = contactOf(frame).targetAttemptTimeout;
      if (timeout) {
        assert.equal(seen.has(timeout.targetId), false, "a target expired twice");
        seen.add(timeout.targetId);
      }
      frames += 1;
    }
    assert.equal(frames, 20);
    // The successor spawned on the frame after the expiry and has not run out yet, so the
    // only expiry in this window is the original one.
    assert.equal(seen.size, 1);
  });

  it("9. re-running the frame after a terminal event produces no duplicate outcome", () => {
    // The state after a terminal frame is the caller's; ticking it again — which a dropped
    // frame or a re-render would do — must not re-emit anything.
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const expired = expireActiveAttempt(rt, T0);
    assert.ok(contactOf(expired).targetAttemptTimeout);
    assert.equal(rt.states.target.currentTarget, null);

    const struggleAfterOne = rt.adaptive!.struggleStreak;
    const again = runFrame(rt, {
      nowMs: T0 + CONFIG.normalAttemptTimeoutMs + 1,
      wrist: RESTING_WRIST,
    });
    assert.equal(contactOf(again).targetAttemptTimeout, null);
    assert.equal(contactOf(again).targetContact, null);
    assert.equal(rt.adaptive!.struggleStreak, struggleAfterOne, "no second outcome was applied");
  });

  it("10/15. the successor spawns exactly once and starts exactly one attempt", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    expireActiveAttempt(rt, T0);

    const successorFrame = runFrame(rt, {
      nowMs: T0 + CONFIG.normalAttemptTimeoutMs + 16,
      wrist: RESTING_WRIST,
    });
    assert.equal(contactOf(successorFrame).targetAttemptStarted.length, 1);
    const successorId = activeTarget(rt).id;
    assert.equal(rt.states.target.sequence, 2);

    // Later frames neither respawn nor re-announce it.
    for (let i = 1; i <= 8; i += 1) {
      const frame = runFrame(rt, {
        nowMs: T0 + CONFIG.normalAttemptTimeoutMs + 16 + i * 16,
        wrist: RESTING_WRIST,
      });
      assert.equal(contactOf(frame).targetAttemptStarted.length, 0);
      assert.equal(activeTarget(rt).id, successorId);
      assert.equal(rt.states.target.sequence, 2);
    }
    assert.equal(rt.states.target.interaction.targetsShown, 2);
  });

  it("14. target identity and sequence stay aligned across a terminal boundary", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const first = activeTarget(rt);
    assert.equal(rt.states.target.sequence, 1);

    const expired = expireActiveAttempt(rt, T0);
    const timeout = contactOf(expired).targetAttemptTimeout;
    assert.equal(timeout?.targetId, first.id);
    assert.equal(timeout?.sequence, 1);

    const spawn = runFrame(rt, {
      nowMs: T0 + CONFIG.normalAttemptTimeoutMs + 16,
      wrist: RESTING_WRIST,
    });
    const started = contactOf(spawn).targetAttemptStarted[0];
    const second = activeTarget(rt);
    assert.notEqual(second.id, first.id);
    assert.equal(started.targetId, second.id);
    assert.equal(started.sequence, 2);
    assert.equal(rt.states.target.sequence, 2);
  });
});

// ---------------------------------------------------------------------------
// 2. Immediate successor — timeout path
// ---------------------------------------------------------------------------

describe("CHANGE-008 timeout path", () => {
  it("2/3. two timeouts lower the level, and the very next target uses the lowered one", () => {
    const rt = createRuntime();
    let nowMs = T0;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.equal(activeTarget(rt).levelDegrees, CONFIG.startLevel);

    // Attempt 1 expires: struggle streak 1, no level change yet.
    const first = expireActiveAttempt(rt, nowMs);
    assert.equal(first.levelAfter, CONFIG.startLevel);
    nowMs += CONFIG.normalAttemptTimeoutMs + 16;

    const secondTarget = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.equal(secondTarget.target?.levelDegrees, CONFIG.startLevel);
    const spawnedAt = nowMs;

    // Attempt 2 expires: the streak threshold is met and the level drops.
    const second = expireActiveAttempt(rt, spawnedAt);
    assert.equal(second.levelBefore, CONFIG.startLevel);
    assert.equal(
      second.levelAfter,
      CONFIG.startLevel - CONFIG.decreaseStep,
      "the second expiry lowered the placement level",
    );
    // THE INVARIANT: no successor was built by the frame that made that decision.
    assert.equal(rt.states.target.currentTarget, null);
    assert.equal(contactOf(second).targetAttemptStarted.length, 0);

    // The next frame builds it — at the LOWERED level, with no intervening stale target.
    nowMs = spawnedAt + CONFIG.normalAttemptTimeoutMs + 16;
    const successor = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.equal(
      successor.target?.levelDegrees,
      CONFIG.startLevel - CONFIG.decreaseStep,
      "the IMMEDIATE next target carries the new level — no one-target lag",
    );
    assert.equal(rt.states.target.sequence, 3, "it is target 3, not target 4");
  });

  it("4/21. at the floor the extended window is granted and governs the very next attempt", () => {
    const rt = createRuntime();
    let nowMs = T0;
    let spawnedAt = nowMs;

    // Drive expiries until the engine hits the floor and grants the extended window.
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const spawn = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
      if (!spawn.target) throw new Error("expected a target to spawn");
      spawnedAt = nowMs;
      const expired = expireActiveAttempt(rt, spawnedAt);
      nowMs = spawnedAt + (expired.timeoutBefore ?? CONFIG.normalAttemptTimeoutMs) + 16;
      if (rt.adaptive!.attemptTimeoutMs === CONFIG.extendedAttemptTimeoutMs) break;
    }
    assert.equal(rt.adaptive!.currentLevel, CONFIG.minLevel);
    assert.equal(rt.adaptive!.attemptTimeoutMs, CONFIG.extendedAttemptTimeoutMs);
    assert.equal(rt.states.target.currentTarget, null, "no successor outran the decision");

    // The next target is built under the extended window and must be measured by it.
    const spawn = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.ok(spawn.target);
    assert.equal(spawn.target.levelDegrees, CONFIG.minLevel);
    const baselineMs = nowMs;

    const atOldWindow = runFrame(rt, {
      nowMs: baselineMs + CONFIG.normalAttemptTimeoutMs,
      wrist: RESTING_WRIST,
    });
    assert.equal(
      contactOf(atOldWindow).targetAttemptTimeout,
      null,
      "the superseded window no longer ends the very next attempt",
    );

    const atNewWindow = runFrame(rt, {
      nowMs: baselineMs + CONFIG.extendedAttemptTimeoutMs,
      wrist: RESTING_WRIST,
    });
    const timeout = contactOf(atNewWindow).targetAttemptTimeout;
    assert.ok(timeout, "the extended window ended it");
    assert.equal(timeout.attemptTimeoutMs, CONFIG.extendedAttemptTimeoutMs);
  });
});

// ---------------------------------------------------------------------------
// 3. Immediate successor — hit path and accessibility consistency
// ---------------------------------------------------------------------------

/**
 * Reaches two targets in a row so the success streak fires, and returns the level stamped
 * on the target built immediately after the increase, for a given exit transition.
 */
function levelOfTargetAfterIncrease(hitExitTransitionMs: number) {
  const rt = createRuntime();
  let nowMs = T0;
  runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });

  const levelsAtHit: number[] = [];
  for (let i = 0; i < CONFIG.successStreakToIncrease; i += 1) {
    nowMs += 200;
    // OBSERVED clean — the fixture policy is `excludedFromIncrease`, under which only an
    // observed-clean reach may build the increase streak. See `reachActiveTargetCleanly`.
    const hit = reachActiveTargetCleanly(rt, nowMs, hitExitTransitionMs);
    levelsAtHit.push(hit.levelBefore!);
    // No successor may exist on the frame that scored the hit, whatever the exit style.
    assert.equal(rt.states.target.currentTarget, null);
    // Move off the target and past any exit animation before the successor is built.
    nowMs += hitExitTransitionMs + 32;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
  }

  assert.deepEqual(levelsAtHit, [CONFIG.startLevel, CONFIG.startLevel]);
  return {
    rt,
    successorLevel: activeTarget(rt).levelDegrees,
    successorPosition: { x: activeTarget(rt).x, y: activeTarget(rt).y },
  };
}

describe("CHANGE-008 hit path and accessibility consistency", () => {
  it("5. a success streak raises the level and the immediate next target uses it", () => {
    const { rt, successorLevel } = levelOfTargetAfterIncrease(NORMAL_EXIT_MS);
    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel + CONFIG.increaseStep);
    assert.equal(
      successorLevel,
      CONFIG.startLevel + CONFIG.increaseStep,
      "the target built right after the increase already carries it",
    );
  });

  it("6/23. reduced motion produces the identical adaptive result and successor level", () => {
    const normal = levelOfTargetAfterIncrease(NORMAL_EXIT_MS);
    const reduced = levelOfTargetAfterIncrease(0);

    assert.equal(reduced.successorLevel, normal.successorLevel);
    assert.deepEqual(reduced.successorPosition, normal.successorPosition);
    assert.equal(reduced.rt.adaptive!.currentLevel, normal.rt.adaptive!.currentLevel);
    assert.equal(reduced.rt.adaptive!.attemptTimeoutMs, normal.rt.adaptive!.attemptTimeoutMs);
    assert.equal(reduced.rt.adaptive!.successStreak, normal.rt.adaptive!.successStreak);
    assert.deepEqual(
      reduced.rt.adaptive!.changes,
      normal.rt.adaptive!.changes,
      "an animation preference must not change a single adaptive decision",
    );
  });

  it("20. the existing session-input path for a hit is untouched", () => {
    for (const hitExitTransitionMs of [0, NORMAL_EXIT_MS]) {
      const rt = createRuntime();
      runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST, hitExitTransitionMs });
      const hit = reachActiveTarget(rt, T0 + 300, hitExitTransitionMs);
      const contact = contactOf(hit).targetContact;
      assert.ok(contact);
      assert.deepEqual(rt.sessionInputs, [
        { type: "targetContact", capturedAtMs: contact.capturedAtMs },
      ]);
      // And it reached the orchestrator's own accumulated interaction totals.
      const snap = rt.orchestrator.getSnapshot(T0 + 300);
      const contacted = snap.accumulatedBlockResults.reduce(
        (sum, result) => sum + result.interaction.targetsContacted,
        0,
      );
      assert.equal(contacted, 1);
    }
  });

  it("7. a compensated success applies the configured policy before the successor exists", () => {
    // Fixture policy is `excludedFromIncrease`: a compensated success must not advance the
    // streak, so the successor after two compensated hits stays at the starting level.
    assert.equal(CONFIG.compensatedSuccessPolicy, "excludedFromIncrease");
    const rt = createRuntime();
    let nowMs = T0;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST, compensationFlagged: true });

    for (let i = 0; i < CONFIG.successStreakToIncrease + 1; i += 1) {
      nowMs += 200;
      const target = activeTarget(rt);
      const hit = runFrame(rt, {
        nowMs,
        wrist: { x: target.x, y: target.y },
        compensationFlagged: true,
      });
      const contact = contactOf(hit).targetContact;
      assert.ok(contact);
      assert.equal(contact.compensatedDuringAttempt, true, "the observation reached the event");
      assert.equal(rt.adaptive!.successStreak, 0, "a compensated success never advanced it");
      assert.equal(rt.states.target.currentTarget, null);
      nowMs += 32;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST, compensationFlagged: true });
    }

    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel);
    assert.equal(activeTarget(rt).levelDegrees, CONFIG.startLevel);
  });

  it("an unknown compensation observation is never reported as clean", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST, compensationFlagged: false });
    const hit = reachActiveTarget(rt, T0 + 300);
    const contact = contactOf(hit).targetContact;
    assert.ok(contact);
    assert.equal(
      "compensatedDuringAttempt" in contact,
      false,
      "a bare false must stay unknown, never become an asserted clean movement",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Placement across the boundary
// ---------------------------------------------------------------------------

describe("CHANGE-008 placement across the boundary", () => {
  it("16. the successor's POSITION, not just its level, follows the post-outcome state", () => {
    const rt = createRuntime();
    let nowMs = T0;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    const firstPosition = { x: activeTarget(rt).x, y: activeTarget(rt).y };

    // Two expiries: the second lowers the level.
    expireActiveAttempt(rt, nowMs);
    nowMs += CONFIG.normalAttemptTimeoutMs + 16;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    const spawnedAt = nowMs;
    expireActiveAttempt(rt, spawnedAt);
    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel - CONFIG.decreaseStep);

    nowMs = spawnedAt + CONFIG.normalAttemptTimeoutMs + 16;
    const successor = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.ok(successor.target);

    const expected = resolveAdaptiveTargetPlacement({
      adaptiveState: rt.adaptive,
      affectedSide: "right",
      shoulderAnchorNormalized: RIGHT_SHOULDER,
      reachRadiusNormalized: ARM_LENGTH,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    });
    assert.equal(expected.placed, true);
    if (!expected.placed) return;
    assert.equal(successor.target.x, expected.position.x);
    assert.equal(successor.target.y, expected.position.y);

    // The target genuinely moved — and by a controlled amount. One fixture step of
    // 10 placement degrees shifts the target roughly half a collision radius: enough for
    // the patient to see and reach differently, small enough that adaptation reads as a
    // gradual easing rather than the target jumping across the screen.
    const moved = distance(successor.target, firstPosition);
    assert.ok(moved > 0.02, `a level change must move the target (moved ${moved})`);
    assert.ok(
      moved < DEFAULT_TARGET_HIT_CONFIG.collisionRadius,
      `one step must not fling the target (moved ${moved})`,
    );
  });

  it("17. synthetic left and right stay mirrored across the boundary", () => {
    const positions: Record<string, NormalizedPoint> = {};
    for (const side of ["right", "left"] as const) {
      const rt = createRuntime({
        side,
        shoulder: side === "right" ? RIGHT_SHOULDER : LEFT_SHOULDER,
      });
      let nowMs = T0;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST });
      expireActiveAttempt(rt, nowMs);
      nowMs += CONFIG.normalAttemptTimeoutMs + 16;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST });
      const spawnedAt = nowMs;
      expireActiveAttempt(rt, spawnedAt);
      nowMs = spawnedAt + CONFIG.normalAttemptTimeoutMs + 16;
      const successor = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
      assert.ok(successor.target);
      positions[side] = { x: successor.target.x, y: successor.target.y };
    }
    assert.ok(positions.right.x > RIGHT_SHOULDER.x, "right reaches toward higher x");
    assert.ok(positions.left.x < LEFT_SHOULDER.x, "left reaches toward lower x");
    assert.ok(Math.abs(positions.left.x - (1 - positions.right.x)) < 1e-9);
    assert.ok(Math.abs(positions.left.y - positions.right.y) < 1e-9);
  });

  it("16b. MIN_TARGET_SEPARATION governs the successor on every terminal path", () => {
    // Adaptive off, so placement is random and the sampler's separation guard is what
    // decides. It reads the RETIRED target's position — which, since CHANGE-008, is the
    // only record of where the last target was, because none is active at spawn time.
    // Both terminal paths and both motion preferences are exercised.
    //
    // DETERMINISM (review fix, PR #240). `runFrame` models the component, which supplies
    // no `random`, so the generator falls back to `Math.random`. `generateTherapeuticTarget`
    // is a rejection sampler with a BOUNDED retry budget: after 8 rejected candidates it
    // returns the last one rather than looping forever, which is correct for production
    // (a target must always be produced) but means the separation floor is best-effort,
    // not guaranteed. Against a live `Math.random` this test therefore failed roughly one
    // run in eight — a pre-existing flake, unrelated to the review-fix blockers.
    //
    // Seeding the generator makes the run reproducible without weakening the assertion or
    // touching production code. The property under test is unchanged: the successor's
    // separation is measured against the RETIRED target, on every terminal path.
    const realRandom = Math.random;
    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    try {
      for (const hitExitTransitionMs of [0, NORMAL_EXIT_MS]) {
        const rt = createRuntime({ adaptive: null });
        let nowMs = T0;
        runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });

        for (let i = 0; i < 12; i += 1) {
          const retired = activeTarget(rt);
          nowMs += 200;
          const hit = runFrame(rt, {
            nowMs,
            wrist: { x: retired.x, y: retired.y },
            hitExitTransitionMs,
          });
          assert.ok(contactOf(hit).targetContact);
          assert.deepEqual(rt.states.target.retiredTargetPosition, { x: retired.x, y: retired.y });

          nowMs += hitExitTransitionMs + 32;
          runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
          const successor = activeTarget(rt);
          assert.ok(
            distance(successor, retired) >= 0.12,
            `successor ${i} landed ${distance(successor, retired)} from its predecessor`,
          );
        }
      }
    } finally {
      Math.random = realRandom;
    }
  });

  it("22. adaptive disabled still produces targets, with no level and no adaptive state", () => {
    const rt = createRuntime({ adaptive: null });
    let nowMs = T0;
    for (let i = 0; i < 6; i += 1) {
      const frame = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
      assert.equal(frame.dispatched.status, "dispatched");
      nowMs += 1_000;
    }
    const target = activeTarget(rt);
    assert.equal(target.levelDegrees, undefined, "no level may be invented");
    assert.equal(rt.adaptive, null);
    // With no attempt seam there is no expiration at all, so the first target persists.
    assert.equal(rt.states.target.sequence, 1);

    // And it is still contactable, spawning its successor a frame later.
    const hit = reachActiveTarget(rt, nowMs);
    assert.ok(contactOf(hit).targetContact);
    assert.equal(rt.states.target.currentTarget, null);
    const successor = runFrame(rt, { nowMs: nowMs + 16, wrist: RESTING_WRIST });
    assert.ok(successor.target);
    assert.equal(successor.target.levelDegrees, undefined);
  });
});

// ---------------------------------------------------------------------------
// 5. Pause, safety hold, tracking loss
// ---------------------------------------------------------------------------

describe("CHANGE-008 pause, hold and tracking loss", () => {
  it("11. a pause taken right after a terminal event duplicates nothing", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const expired = expireActiveAttempt(rt, T0);
    assert.ok(contactOf(expired).targetAttemptTimeout);
    const struggle = rt.adaptive!.struggleStreak;
    const sequence = rt.states.target.sequence;

    let nowMs = T0 + CONFIG.normalAttemptTimeoutMs;
    rt.orchestrator.pause(nowMs);
    for (let i = 1; i <= 10; i += 1) {
      nowMs += 500;
      const frame = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
      assert.equal(frame.dispatched.status, "not_active");
    }
    assert.equal(rt.adaptive!.struggleStreak, struggle, "no outcome was re-applied");
    assert.equal(rt.states.target.sequence, sequence, "no successor was built while paused");
    assert.equal(rt.states.target.currentTarget, null);

    // Resuming builds it exactly once, at the post-outcome level.
    rt.orchestrator.resume(nowMs);
    const resumed = runFrame(rt, { nowMs: nowMs + 16, wrist: RESTING_WRIST });
    assert.equal(contactOf(resumed).targetAttemptStarted.length, 1);
    assert.equal(rt.states.target.sequence, sequence + 1);
    assert.equal(resumed.target?.levelDegrees, rt.adaptive!.currentLevel);
  });

  it("12. a safety hold taken right after a terminal event duplicates nothing", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const expired = expireActiveAttempt(rt, T0);
    assert.ok(contactOf(expired).targetAttemptTimeout);
    const struggle = rt.adaptive!.struggleStreak;
    const sequence = rt.states.target.sequence;

    // A real hold, entered through the orchestrator's own input vocabulary.
    let nowMs = T0 + CONFIG.normalAttemptTimeoutMs;
    rt.orchestrator.reportInputEvent({ type: "trackerLost", capturedAtMs: nowMs }, nowMs);
    rt.orchestrator.tick(nowMs);
    assert.equal(rt.orchestrator.getSnapshot(nowMs).safetyStatus, "hold");

    for (let i = 1; i <= 10; i += 1) {
      nowMs += 1_000;
      const frame = runFrame(rt, { nowMs, wrist: null });
      assert.equal(frame.dispatched.status, "not_active");
    }
    assert.equal(rt.adaptive!.struggleStreak, struggle);
    assert.equal(rt.states.target.sequence, sequence);
  });

  it("13. tracking loss never manufactures a timeout, and never chains attempts", () => {
    // TRACKING LOSS IS NOT PATIENT FAILURE. Two independent guards are exercised here:
    // the orchestrator freezes block-elapsed time on a hold so no attempt time accrues,
    // and — strengthened by CHANGE-008 — no successor is built while the wrist is absent,
    // so an untracked stretch cannot produce a run of "incomplete" attempts.
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const firstId = activeTarget(rt).id;

    let nowMs = T0;
    rt.orchestrator.reportInputEvent({ type: "trackerLost", capturedAtMs: nowMs }, nowMs);
    for (let i = 1; i <= 30; i += 1) {
      nowMs += 1_000;
      const frame = runFrame(rt, { nowMs, wrist: null });
      if (frame.dispatched.status === "dispatched") {
        assert.equal(frame.dispatched.targetAttemptTimeout, null, "tracking loss expired an attempt");
      }
    }
    assert.equal(rt.adaptive!.struggleStreak, 0, "no incomplete outcome was recorded");
    assert.equal(rt.states.target.sequence, 1);
    assert.equal(activeTarget(rt).id, firstId, "the same attempt is simply still waiting");

    // Recovery after a long loss is the orchestrator's own concern, not this slice's: past
    // `recalibrationGraceSeconds` it routes the session to recalibration rather than
    // straight back to active. Asserted so the boundary is explicit — nothing here tries to
    // resume a target block the orchestrator has not resumed.
    rt.orchestrator.reportInputEvent({ type: "trackerReady", capturedAtMs: nowMs }, nowMs);
    assert.equal(rt.orchestrator.getSnapshot(nowMs).sessionState, "calibrating");
  });

  it("13b. a brief tracking gap resumes the SAME attempt, with no outcome and no new target", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const firstId = activeTarget(rt).id;

    // Lost and recovered well inside the recalibration grace window.
    let nowMs = T0 + 500;
    rt.orchestrator.reportInputEvent({ type: "trackerLost", capturedAtMs: nowMs }, nowMs);
    for (let i = 1; i <= 3; i += 1) {
      nowMs += 500;
      assert.equal(runFrame(rt, { nowMs, wrist: null }).dispatched.status, "not_active");
    }
    rt.orchestrator.reportInputEvent({ type: "trackerReady", capturedAtMs: nowMs }, nowMs);
    assert.equal(rt.orchestrator.getSnapshot(nowMs).sessionState, "active");

    const resumed = runFrame(rt, { nowMs: nowMs + 16, wrist: RESTING_WRIST });
    assert.equal(resumed.dispatched.status, "dispatched");
    assert.equal(contactOf(resumed).targetAttemptTimeout, null);
    assert.equal(contactOf(resumed).targetAttemptStarted.length, 0, "no new attempt was started");
    assert.equal(activeTarget(rt).id, firstId, "the same attempt continues");
    assert.equal(rt.adaptive!.struggleStreak, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. False auto-hit protection (CHANGE-007) under the new ordering
// ---------------------------------------------------------------------------

describe("CHANGE-008 false auto-hit protection", () => {
  it("18/19. a successor under a stationary wrist pays nothing until a real exit and re-entry", () => {
    for (const hitExitTransitionMs of [0, NORMAL_EXIT_MS]) {
      const rt = createRuntime();
      let nowMs = T0;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
      const target = activeTarget(rt);
      const onTarget = { x: target.x, y: target.y };

      // Earn the first hit.
      nowMs += 200;
      const hit = runFrame(rt, { nowMs, wrist: onTarget, hitExitTransitionMs });
      assert.ok(contactOf(hit).targetContact);
      assert.equal(rt.states.target.interaction.targetsReached, 1);

      // The wrist never moves. The successor is placed at the same level, i.e. right where
      // the wrist already is, and must start INSIDE rather than pay out on arrival.
      nowMs += hitExitTransitionMs + 32;
      const successor = runFrame(rt, { nowMs, wrist: onTarget, hitExitTransitionMs });
      assert.ok(successor.target, `successor expected at transition ${hitExitTransitionMs}`);
      assert.equal(contactOf(successor).targetContact, null);
      assert.equal(rt.states.target.wristInside, true);

      for (let i = 1; i <= 10; i += 1) {
        nowMs += 16;
        const frame = runFrame(rt, { nowMs, wrist: onTarget, hitExitTransitionMs });
        assert.equal(contactOf(frame).targetContact, null, `free hit on frame ${i}`);
      }
      assert.equal(rt.states.target.interaction.targetsReached, 1);

      // Exit...
      nowMs += 16;
      const exited = runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
      assert.equal(contactOf(exited).targetContact, null);
      assert.equal(rt.states.target.wristInside, false);

      // ...and re-enter: exactly one new, legitimate hit.
      nowMs += 16;
      const reentered = runFrame(rt, {
        nowMs,
        wrist: { x: activeTarget(rt).x, y: activeTarget(rt).y },
        hitExitTransitionMs,
      });
      assert.ok(contactOf(reentered).targetContact, "a real reach must still count");
      assert.equal(rt.states.target.interaction.targetsReached, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Determinism and the full scripted flow
// ---------------------------------------------------------------------------

/**
 * A complete scripted session: struggle to the floor, then recover with a success streak.
 * Returns the level stamped on every target the patient was actually shown, in order.
 */
function runScriptedFlow(hitExitTransitionMs: number) {
  const rt = createRuntime();
  const shownLevels: number[] = [];
  const decisions: string[] = [];
  let nowMs = T0;

  const observeTarget = () => {
    const level = activeTarget(rt).levelDegrees;
    assert.ok(level !== undefined, "an adaptive session stamps every target with its level");
    shownLevels.push(level);
  };

  const recordDecisions = () => {
    const changes = rt.adaptive!.changes;
    while (decisions.length < changes.length) {
      decisions.push(changes[decisions.length].reason);
    }
  };

  runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
  observeTarget();

  // Phase 1 — four expiries: two lower the level to the floor, two more grant the
  // extended window instead of lowering past it.
  for (let i = 0; i < 4; i += 1) {
    const spawnedAt = nowMs;
    expireActiveAttempt(rt, spawnedAt, hitExitTransitionMs);
    recordDecisions();
    nowMs = spawnedAt + rt.adaptive!.attemptTimeoutMs + 16;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
    observeTarget();
    // Every target the patient sees must already reflect every decision made so far.
    assert.equal(shownLevels[shownLevels.length - 1], rt.adaptive!.currentLevel);
  }

  // Phase 2 — a success streak: two OBSERVED-CLEAN reaches raise the level again.
  for (let i = 0; i < CONFIG.successStreakToIncrease; i += 1) {
    nowMs += 200;
    reachActiveTargetCleanly(rt, nowMs, hitExitTransitionMs);
    recordDecisions();
    nowMs += hitExitTransitionMs + 32;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
    observeTarget();
    assert.equal(shownLevels[shownLevels.length - 1], rt.adaptive!.currentLevel);
  }

  return { rt, shownLevels, decisions };
}

describe("CHANGE-008 scripted multi-attempt flow", () => {
  it("25. struggle → decrease → extended window → success streak → increase, each visible immediately", () => {
    const { rt, shownLevels, decisions } = runScriptedFlow(NORMAL_EXIT_MS);

    assert.deepEqual(
      decisions,
      [
        "consecutiveStruggle",
        "minLevelExtendedTimeout",
        "consecutiveSuccess",
      ],
      "the fixture path: one decrease to the floor, one extension at it, one increase back",
    );
    assert.deepEqual(
      shownLevels,
      [50, 50, 40, 40, 40, 40, 50],
      "every level the patient was shown, in order — each change lands on the very next target",
    );
    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel);
    assert.equal(rt.states.target.interaction.targetsReached, 2);
  });

  it("23b. the scripted flow is identical under reduced motion", () => {
    const normal = runScriptedFlow(NORMAL_EXIT_MS);
    const reduced = runScriptedFlow(0);
    assert.deepEqual(reduced.shownLevels, normal.shownLevels);
    assert.deepEqual(reduced.decisions, normal.decisions);
    assert.equal(reduced.rt.adaptive!.currentLevel, normal.rt.adaptive!.currentLevel);
    assert.equal(reduced.rt.adaptive!.attemptTimeoutMs, normal.rt.adaptive!.attemptTimeoutMs);
  });

  it("26. VERIFY-005 full journey: one session through every runtime state, in sequence", () => {
    // THE RELEASE ARTIFACT. The other tests each isolate one property; this one proves the
    // properties compose, in one continuous session, in the order a patient would meet
    // them. Every stage asserts the invariant that matters at that stage, and every target
    // the patient is shown is recorded so the whole arc can be read at the end.
    const rt = createRuntime();
    const shown: Array<{ seq: number; level: number | undefined }> = [];
    const terminalIds: string[] = [];
    let nowMs = T0;

    const recordShownTarget = () => {
      const target = activeTarget(rt);
      shown.push({ seq: rt.states.target.sequence, level: target.levelDegrees });
    };
    const recordTerminal = (frame: FrameResult) => {
      const d = contactOf(frame);
      const id = d.targetContact?.targetId ?? d.targetAttemptTimeout?.targetId;
      assert.ok(id, "a terminal frame must identify its attempt");
      assert.equal(terminalIds.includes(id), false, `attempt ${id} ended twice`);
      terminalIds.push(id);
      // A terminal frame never builds its own successor — the whole point of CHANGE-008.
      assert.equal(rt.states.target.currentTarget, null);
      assert.equal(d.targetAttemptStarted.length, 0);
    };
    const buildSuccessor = () => {
      nowMs += 32;
      const frame = runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs: NORMAL_EXIT_MS });
      assert.equal(contactOf(frame).targetAttemptStarted.length, 1);
      recordShownTarget();
      // Whatever the engine last decided is already on the target the patient now sees.
      assert.equal(activeTarget(rt).levelDegrees, rt.adaptive!.currentLevel);
    };

    // ── 1. Session starts with its first target ────────────────────────────────
    runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs: NORMAL_EXIT_MS });
    recordShownTarget();
    assert.equal(rt.states.target.sequence, 1);
    assert.equal(activeTarget(rt).levelDegrees, CONFIG.startLevel);

    // ── 1b. An UNKNOWN-compensation success (review fix, blocker 1) ────────────
    // The production shape: the detector cannot report measured-clear, so the reach
    // arrives with no compensation observation at all. It is a real success — counted,
    // recorded, never a struggle — but it may not carry the patient toward a harder
    // target, because nobody established that the movement was clean.
    nowMs += 200;
    const unknownFrame = reachActiveTarget(rt, nowMs, NORMAL_EXIT_MS);
    const unknownContact = contactOf(unknownFrame).targetContact;
    assert.ok(unknownContact);
    assert.equal(
      "compensatedDuringAttempt" in unknownContact,
      false,
      "absence must survive the whole chain as absence, never as a clean observation",
    );
    recordTerminal(unknownFrame);
    assert.equal(rt.adaptive!.successStreak, 0, "UNKNOWN never advances the increase streak");
    assert.equal(rt.adaptive!.struggleStreak, 0, "and is never mistaken for a struggle");
    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel, "so the level cannot rise");
    assert.equal(rt.adaptive!.highestSuccessfulLevel, CONFIG.startLevel, "it IS still a success");
    nowMs += NORMAL_EXIT_MS;
    buildSuccessor();

    // ── 1c. Wrist-only measurement loss (review fix, blocker 2) ────────────────
    // The session stays ACTIVE, no tracker-loss event is reported, no safety hold is
    // entered, and block elapsed time keeps advancing — only the affected-side wrist is
    // missing. The attempt must be HELD, not failed.
    const heldAttemptId = activeTarget(rt).id;
    const beforeGap = { ...rt.adaptive! };
    for (let s = 0; s < 15; s += 1) {
      nowMs += 1_000;
      const frame = runFrame(rt, { nowMs, wrist: null, hitExitTransitionMs: NORMAL_EXIT_MS });
      assert.equal(frame.dispatched.status, "dispatched", "a healthy session keeps ticking");
      assert.equal(
        contactOf(frame).targetAttemptTimeout,
        null,
        "an unmeasurable interval must never expire an attempt",
      );
    }
    const gapSnap = rt.orchestrator.getSnapshot(nowMs);
    assert.equal(gapSnap.sessionState, "active", "this is a wrist-only gap, not a safety hold");
    assert.equal(gapSnap.safetyStatus, "normal");
    assert.ok(gapSnap.blockElapsedSeconds >= 15, "the block clock really did keep running");
    assert.equal(rt.adaptive!.struggleStreak, beforeGap.struggleStreak, "not patient struggle");
    assert.equal(rt.adaptive!.currentLevel, beforeGap.currentLevel, "the level did not drop");
    assert.deepEqual(rt.adaptive!.changes, beforeGap.changes, "no decision was emitted");
    assert.equal(activeTarget(rt).id, heldAttemptId, "the same attempt is still alive");
    assert.equal(rt.states.target.sequence, 2, "no successor was manufactured out of the gap");

    // Measurement returns: the attempt resumes rather than restarting or instantly ending.
    nowMs += 1_000;
    const recovered = runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs: NORMAL_EXIT_MS });
    assert.equal(
      contactOf(recovered).targetAttemptTimeout,
      null,
      "recovery must not cash in the elapsed gap as an instant expiry",
    );
    assert.equal(activeTarget(rt).id, heldAttemptId);

    // ── 2-3. The patient struggles: two MEASURED timeouts lower the level ──────
    // The first of these expires the very attempt that was just held — proving the window
    // resumed and that a genuine, observed non-reach still counts as incomplete.
    for (let i = 0; i < 2; i += 1) {
      const spawnedAt = nowMs;
      recordTerminal(expireActiveAttempt(rt, spawnedAt, NORMAL_EXIT_MS));
      nowMs = spawnedAt + rt.adaptive!.attemptTimeoutMs;
      buildSuccessor();
    }
    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel - CONFIG.decreaseStep);
    assert.equal(rt.adaptive!.currentLevel, CONFIG.minLevel, "the fixture floor");

    // ── 4. Still struggling at the floor: time is extended, never lowered ──────
    for (let i = 0; i < 2; i += 1) {
      const spawnedAt = nowMs;
      recordTerminal(expireActiveAttempt(rt, spawnedAt, NORMAL_EXIT_MS));
      nowMs = spawnedAt + rt.adaptive!.attemptTimeoutMs;
      buildSuccessor();
    }
    assert.equal(rt.adaptive!.currentLevel, CONFIG.minLevel, "never below the floor");
    assert.equal(rt.adaptive!.attemptTimeoutMs, CONFIG.extendedAttemptTimeoutMs);

    // ── 5. A compensated success: counted, but it must not advance progression ─
    nowMs += 200;
    const compensatedTarget = activeTarget(rt);
    const compensated = runFrame(rt, {
      nowMs,
      wrist: { x: compensatedTarget.x, y: compensatedTarget.y },
      hitExitTransitionMs: NORMAL_EXIT_MS,
      compensationFlagged: true,
    });
    assert.equal(contactOf(compensated).targetContact?.compensatedDuringAttempt, true);
    recordTerminal(compensated);
    assert.equal(rt.adaptive!.successStreak, 0, "a compensated success never advances the streak");
    nowMs += NORMAL_EXIT_MS;
    buildSuccessor();

    // ── 6. OBSERVED-clean successes: the streak fires and the level rises ──────
    const levelBeforeIncrease = rt.adaptive!.currentLevel;
    for (let i = 0; i < CONFIG.successStreakToIncrease; i += 1) {
      nowMs += 200;
      recordTerminal(reachActiveTargetCleanly(rt, nowMs, NORMAL_EXIT_MS));
      nowMs += NORMAL_EXIT_MS;
      buildSuccessor();
    }
    assert.equal(rt.adaptive!.currentLevel, levelBeforeIncrease + CONFIG.increaseStep);
    // Progressing away from the floor withdraws the extended accommodation.
    assert.equal(rt.adaptive!.attemptTimeoutMs, CONFIG.normalAttemptTimeoutMs);

    // ── 7. Pause and resume: no duplicate outcome, no duplicate target ─────────
    const beforePause = { ...rt.adaptive! };
    const sequenceBeforePause = rt.states.target.sequence;
    const targetIdBeforePause = activeTarget(rt).id;
    rt.orchestrator.pause(nowMs);
    for (let i = 0; i < 5; i += 1) {
      nowMs += 400;
      assert.equal(runFrame(rt, { nowMs, wrist: RESTING_WRIST }).dispatched.status, "not_active");
    }
    rt.orchestrator.resume(nowMs);
    nowMs += 32;
    const afterResume = runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs: NORMAL_EXIT_MS });
    assert.equal(afterResume.dispatched.status, "dispatched");
    assert.equal(rt.states.target.sequence, sequenceBeforePause, "the pause spawned nothing");
    assert.equal(activeTarget(rt).id, targetIdBeforePause, "the same attempt resumed");
    assert.equal(rt.adaptive!.currentLevel, beforePause.currentLevel);
    assert.equal(rt.adaptive!.successStreak, beforePause.successStreak);

    // ── 8. Tracking loss and recovery: no outcome, no new target ───────────────
    rt.orchestrator.reportInputEvent({ type: "trackerLost", capturedAtMs: nowMs }, nowMs);
    for (let i = 0; i < 3; i += 1) {
      nowMs += 500;
      const frame = runFrame(rt, { nowMs, wrist: null });
      assert.equal(frame.dispatched.status, "not_active", "a held session dispatches nothing");
    }
    rt.orchestrator.reportInputEvent({ type: "trackerReady", capturedAtMs: nowMs }, nowMs);
    assert.equal(rt.orchestrator.getSnapshot(nowMs).sessionState, "active");
    assert.equal(rt.adaptive!.struggleStreak, 0, "tracking loss is never patient failure");
    assert.equal(rt.states.target.sequence, sequenceBeforePause);
    assert.equal(activeTarget(rt).id, targetIdBeforePause);

    // ── 9. The session continues normally ─────────────────────────────────────
    nowMs += 200;
    recordTerminal(reachActiveTarget(rt, nowMs, NORMAL_EXIT_MS));
    nowMs += NORMAL_EXIT_MS;
    buildSuccessor();

    // ── Whole-journey invariants ──────────────────────────────────────────────
    // Every attempt ended exactly once (enforced per-terminal above) and every target the
    // patient saw was a distinct, monotonically numbered one.
    assert.deepEqual(
      shown.map((s) => s.seq),
      shown.map((_, i) => i + 1),
      "target sequence is strictly monotonic with no gaps and no repeats",
    );
    assert.equal(terminalIds.length, shown.length - 1, "every target but the live one ended");
    assert.equal(new Set(terminalIds).size, terminalIds.length, "no attempt ended twice");

    // The level arc the patient actually experienced: start, ease to the floor, hold at the
    // floor while time is extended, then climb back once reaches succeed. Every entry is
    // the level in force at the moment that target was built — never one target behind.
    assert.deepEqual(
      shown.map((s) => s.level),
      //  1   2   3   4   5   6   7   8   9  10   ← target sequence
      //  ↑ start
      //      ↑ UNKNOWN-compensation hit — counted, no progression (blocker 1)
      //      ↑ wrist-only measurement gap on this attempt — nothing at all (blocker 2)
      //          ─── measured struggling ───
      //              ↑ decrease
      //                  ↑ extended window (level held at the floor, never lowered)
      //                      ↑ compensated hit — counted, no progression
      //                          ↑   ↑ two OBSERVED-clean reaches → increase
      //                                  ↑ pause / tracking loss changed nothing
      [50, 50, 50, 40, 40, 40, 40, 40, 50, 50],
    );

    assert.deepEqual(
      rt.adaptive!.changes.map((c) => c.reason),
      ["consecutiveStruggle", "minLevelExtendedTimeout", "consecutiveSuccess"],
    );
    // Contacts reached the orchestrator through the untouched existing session path.
    assert.equal(rt.sessionInputs.length, rt.states.target.interaction.targetsReached);
    assert.ok(rt.sessionInputs.every((e) => e.type === "targetContact"));
  });

  it("24. the whole flow is deterministic when repeated", () => {
    const first = runScriptedFlow(NORMAL_EXIT_MS);
    for (let run = 0; run < 3; run += 1) {
      const repeat = runScriptedFlow(NORMAL_EXIT_MS);
      assert.deepEqual(repeat.shownLevels, first.shownLevels);
      assert.deepEqual(repeat.decisions, first.decisions);
      assert.deepEqual(repeat.rt.adaptive!.changes, first.rt.adaptive!.changes);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. REVIEW FIX (PR #240) — measurement loss is never patient performance
// ---------------------------------------------------------------------------

/**
 * These run the REAL path — a real `SessionOrchestrator`, the real block-runner registry,
 * the real dispatch/lifecycle/mapper/engine chain — because the blockers were both about
 * what the whole runtime concludes, not about what one function returns.
 *
 * Aisha's required scenario, exactly: an active attempt, `wrist = null`, NO `trackerLost`,
 * the session still active, and block elapsed time advancing past `attemptTimeoutMs`.
 */
describe("review fix — wrist measurement unavailability (blocker 2)", () => {
  /** Ticks with no wrist for `seconds` of live block time, returning every frame. */
  function unmeasuredInterval(rt: Runtime, fromMs: number, seconds: number) {
    const frames: FrameResult[] = [];
    for (let s = 1; s <= seconds; s += 1) {
      frames.push(runFrame(rt, { nowMs: fromMs + s * 1_000, wrist: null }));
    }
    return frames;
  }

  it("an active attempt + wrist=null + no trackerLost + elapsed > timeout ends nothing", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const attemptId = activeTarget(rt).id;
    const before = { ...rt.adaptive! };

    // Well past the window: 20s against a 6s fixture timeout.
    assert.ok(20_000 > CONFIG.normalAttemptTimeoutMs * 3);
    const frames = unmeasuredInterval(rt, T0, 20);

    // THE SESSION IS HEALTHY THROUGHOUT — this is not a paused or safety-held session,
    // and no tracker-loss event was ever reported. That is the whole point of the case.
    const snap = rt.orchestrator.getSnapshot(T0 + 20_000);
    assert.equal(snap.sessionState, "active");
    assert.equal(snap.safetyStatus, "normal");
    assert.ok(snap.blockElapsedSeconds >= 20, "block elapsed time really did advance");

    // 1 — no timeout event anywhere in the interval.
    for (const frame of frames) {
      assert.equal(contactOf(frame).targetAttemptTimeout, null);
      assert.equal(contactOf(frame).targetContact, null);
    }

    // 2 — and, the part Aisha asked to be proved beyond `timeoutEvent === undefined`:
    // the adaptive engine drew no conclusion about the patient at all.
    assert.equal(rt.adaptive!.struggleStreak, 0, "measurement loss is not struggle");
    assert.equal(rt.adaptive!.struggleStreak, before.struggleStreak);
    assert.equal(rt.adaptive!.currentLevel, before.currentLevel, "the level did not drop");
    assert.equal(rt.adaptive!.successStreak, before.successStreak);
    assert.equal(rt.adaptive!.attemptTimeoutMs, before.attemptTimeoutMs);
    assert.deepEqual(rt.adaptive!.changes, [], "no adaptive decision was emitted");
    assert.equal(rt.adaptive!.attemptsAtCurrentLevel, 0, "no attempt was counted");

    // 3 — the attempt is held, not voided: same target, no churn, no lost identity.
    assert.equal(activeTarget(rt).id, attemptId);
    assert.equal(rt.states.target.sequence, 1);
  });

  it("recovery: the held attempt resumes and can still be reached", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const attemptId = activeTarget(rt).id;
    unmeasuredInterval(rt, T0, 20);

    // The patient reaches the target on the frame measurement returns.
    const reached = reachActiveTargetCleanly(rt, T0 + 21_000);
    assert.equal(contactOf(reached).targetContact?.targetId, attemptId);
    assert.equal(rt.adaptive!.struggleStreak, 0);
    assert.equal(rt.adaptive!.successStreak, 1, "a real success after the gap still counts");
  });

  it("13. a LEGITIMATE timeout after the gap still becomes incomplete and struggle", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    unmeasuredInterval(rt, T0, 20);

    // Measurement returns and the patient, now visible, still does not reach the target.
    // The full window survived the gap, so it expires a full `normalAttemptTimeoutMs`
    // of MEASURED time later — and that is a real incomplete attempt.
    let timeout = null;
    for (let s = 21; s <= 21 + CONFIG.normalAttemptTimeoutMs / 1_000; s += 1) {
      const frame = runFrame(rt, { nowMs: T0 + s * 1_000, wrist: RESTING_WRIST });
      if (contactOf(frame).targetAttemptTimeout) {
        timeout = contactOf(frame).targetAttemptTimeout;
        break;
      }
    }
    assert.ok(timeout, "a measured non-reach must still expire");
    assert.equal(
      timeout.activeElapsedMs,
      CONFIG.normalAttemptTimeoutMs,
      "the reported duration excludes the 20s gap entirely",
    );
    assert.equal(rt.adaptive!.struggleStreak, 1, "a measured incomplete IS struggle");
  });

  it("a measured non-reach and an unmeasured interval of equal length differ completely", () => {
    const measured = createRuntime();
    runFrame(measured, { nowMs: T0, wrist: RESTING_WRIST });
    for (let s = 1; s <= 8; s += 1) {
      runFrame(measured, { nowMs: T0 + s * 1_000, wrist: RESTING_WRIST });
    }

    const unmeasured = createRuntime();
    runFrame(unmeasured, { nowMs: T0, wrist: RESTING_WRIST });
    for (let s = 1; s <= 8; s += 1) {
      runFrame(unmeasured, { nowMs: T0 + s * 1_000, wrist: null });
    }

    // Same session, same clock, same duration. The only difference is whether the runtime
    // could see the patient — and that difference must be total.
    assert.equal(measured.adaptive!.struggleStreak, 1);
    assert.equal(unmeasured.adaptive!.struggleStreak, 0);
  });

  it("8/9/10. pause, safety hold and global tracker loss are still handled upstream", () => {
    // The wrist-gap fix must not have disturbed the three unavailabilities that were
    // already correct — each still stops dispatch entirely rather than reaching the
    // lifecycle's accumulator.
    for (const scenario of ["pause", "safetyHold", "trackerLost"] as const) {
      const rt = createRuntime();
      runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
      const attemptId = activeTarget(rt).id;

      if (scenario === "pause") rt.orchestrator.pause(T0);
      else if (scenario === "trackerLost") {
        rt.orchestrator.reportInputEvent({ type: "trackerLost", capturedAtMs: T0 }, T0);
      } else {
        rt.orchestrator.reportInputEvent({ type: "trackerLost", capturedAtMs: T0 }, T0);
      }

      for (let s = 1; s <= 20; s += 1) {
        const frame = runFrame(rt, { nowMs: T0 + s * 1_000, wrist: null });
        assert.equal(frame.dispatched.status, "not_active", `${scenario} must not dispatch`);
      }
      assert.equal(rt.adaptive!.struggleStreak, 0, `${scenario} is never patient failure`);
      assert.deepEqual(rt.adaptive!.changes, []);
      assert.equal(rt.states.target.currentTarget?.id, attemptId);
    }
  });

  it("11. reduced motion behaves identically across a wrist gap", () => {
    const run = (hitExitTransitionMs: number) => {
      const rt = createRuntime();
      runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST, hitExitTransitionMs });
      for (let s = 1; s <= 20; s += 1) {
        runFrame(rt, { nowMs: T0 + s * 1_000, wrist: null, hitExitTransitionMs });
      }
      reachActiveTargetCleanly(rt, T0 + 21_000, hitExitTransitionMs);
      return rt;
    };
    const normal = run(NORMAL_EXIT_MS);
    const reduced = run(0);

    assert.equal(reduced.adaptive!.currentLevel, normal.adaptive!.currentLevel);
    assert.equal(reduced.adaptive!.successStreak, normal.adaptive!.successStreak);
    assert.equal(reduced.adaptive!.struggleStreak, normal.adaptive!.struggleStreak);
    assert.deepEqual(reduced.adaptive!.changes, normal.adaptive!.changes);
  });

  it("repeated gaps across a whole block never accumulate into a level decrease", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    let nowMs = T0;

    // Six separate gaps, each far longer than the attempt window, separated by single
    // measured frames. If any of them leaked even one incomplete outcome, the fixture's
    // struggle threshold of 2 would have fired a decrease.
    for (let gap = 0; gap < 6; gap += 1) {
      for (let s = 1; s <= 10; s += 1) {
        nowMs += 1_000;
        runFrame(rt, { nowMs, wrist: null });
      }
      nowMs += 1_000;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    }

    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel, "the level never dropped");
    assert.equal(rt.adaptive!.attemptTimeoutMs, CONFIG.normalAttemptTimeoutMs);
    assert.deepEqual(
      rt.adaptive!.changes.filter((c) => c.direction === "decrease"),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// 9. REVIEW FIX (PR #240) — the two blockers together
// ---------------------------------------------------------------------------

describe("review fix — UNKNOWN compensation and measurement loss combined", () => {
  it("an UNKNOWN-compensation attempt interrupted by a wrist gap moves nothing", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    const before = { ...rt.adaptive! };

    // A wrist gap opens mid-attempt and outlasts the window...
    for (let s = 1; s <= 15; s += 1) {
      runFrame(rt, { nowMs: T0 + s * 1_000, wrist: null });
    }
    // ...then the patient reaches the target, with compensation never observed.
    const reached = reachActiveTarget(rt, T0 + 16_000);
    const contact = contactOf(reached).targetContact;
    assert.ok(contact);
    assert.equal(
      "compensatedDuringAttempt" in contact,
      false,
      "no observation was supplied, so none is claimed",
    );

    // Neither blocker's failure mode occurs:
    assert.equal(rt.adaptive!.successStreak, 0, "UNKNOWN did not qualify as a clean success");
    assert.equal(rt.adaptive!.struggleStreak, 0, "the gap did not register as struggle");
    assert.equal(rt.adaptive!.currentLevel, before.currentLevel, "no increase, no decrease");
    assert.deepEqual(rt.adaptive!.changes, [], "no decision was emitted at all");
    // It is still a real, counted success — the engine simply drew no conclusion from it.
    assert.equal(rt.adaptive!.attemptsAtCurrentLevel, 1);
    assert.equal(rt.adaptive!.highestSuccessfulLevel, CONFIG.startLevel);
  });

  it("repeating that pattern can never escalate, however many times it happens", () => {
    const rt = createRuntime();
    runFrame(rt, { nowMs: T0, wrist: RESTING_WRIST });
    let nowMs = T0;

    // Eight unknown-compensation successes, each preceded by a measurement gap — four
    // times the fixture's increase threshold.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      for (let s = 1; s <= 8; s += 1) {
        nowMs += 1_000;
        runFrame(rt, { nowMs, wrist: null });
      }
      nowMs += 1_000;
      reachActiveTarget(rt, nowMs);
      nowMs += 32;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    }

    assert.equal(rt.adaptive!.currentLevel, CONFIG.startLevel, "the level never moved");
    assert.deepEqual(rt.adaptive!.changes, []);
    assert.equal(rt.states.target.interaction.targetsReached, 8, "all eight really happened");
    // The engine reacted to nothing, because nothing it could rely on was ever established.
    assert.equal(rt.adaptive!.successStreak, 0);
    assert.equal(rt.adaptive!.struggleStreak, 0);
  });
});

// ---------------------------------------------------------------------------
// 10. REVIEW FIX (PR #240) — the feature flag stays off, and off means inert
// ---------------------------------------------------------------------------

describe("review fix — NEXT_PUBLIC_RASQ_ADAPTIVE_DIFFICULTY_V1 remains off by default", () => {
  it("an unset or disabled flag resolves no configuration, so no adaptive state exists", () => {
    // Re-asserted here, at the runtime edge, because both blocker fixes live on paths that
    // only run when a config was resolved. The production default must still be "off".
    for (const envValue of [undefined, "", "false", "TRUE", "1"]) {
      assert.equal(
        resolveDifficultyConfigForSessionFromEnv(
          SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION,
          envValue,
        ),
        null,
        `${String(envValue)} must not enable adaptive difficulty`,
      );
    }
  });

  it("with adaptive off, neither review-fix path can run at all", () => {
    // `adaptive: null` is exactly what the component holds when the flag is off: no
    // `targetAttempt` seam is built, so there is no attempt window, no expiration, no
    // compensation observation and no engine to move.
    const rt = createRuntime({ adaptive: null });
    let nowMs = T0;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    const targetId = activeTarget(rt).id;

    // A long wrist gap: dispatch falls back to the historical unconditional skip, because
    // the narrowed no-wrist path requires a `targetAttempt` that does not exist here.
    for (let s = 0; s < 20; s += 1) {
      nowMs += 1_000;
      const frame = runFrame(rt, { nowMs, wrist: null });
      assert.equal(frame.dispatched.status, "skipped", "legacy no-wrist behaviour is preserved");
    }

    // And a reach still works, with no adaptive consequence of any kind.
    nowMs += 1_000;
    const reached = reachActiveTarget(rt, nowMs);
    assert.equal(contactOf(reached).targetContact?.targetId, targetId);
    assert.equal(rt.adaptive, null, "no adaptive state was created");

    // CHANGE-008: the successor arrives on a later tick, not on the terminal one.
    nowMs += 32;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.equal(activeTarget(rt).levelDegrees, undefined, "and no level was invented");
  });
});

// ---------------------------------------------------------------------------
// REVIEW-FIX-003 — a wrist measurement gap must reach the adaptive engine as nothing
// ---------------------------------------------------------------------------

/**
 * The lifecycle-level proof lives in `../wrist-measurement-gap.test.ts`. This suite exists
 * because a fabricated hit does not stop at the lifecycle: it travels
 *
 *     TargetHitEvent → mapTargetHitToSessionInput → targetsReached
 *                    → AdaptiveAttemptOutcome(success) → applyAttemptOutcome()
 *                    → successStreak → level increase
 *
 * so the only assertion that fully retires the blocker is one taken against the real
 * runtime, downstream of every one of those seams.
 *
 * This is also the path where the bug was genuinely reachable in production: with adaptive
 * on and an attempt already in flight, `allowsNoWristTargetMaintenance` deliberately lets a
 * no-wrist frame through to the lifecycle (review fix, blocker 2). The frame that keeps the
 * attempt clock honest is exactly the frame that used to fabricate the exit.
 */
describe("REVIEW-FIX-003 wrist gap is not a measured exit", () => {
  it("a gap under a stationary wrist produces no hit and moves the adaptive engine not at all", () => {
    for (const hitExitTransitionMs of [0, NORMAL_EXIT_MS]) {
      const rt = createRuntime();
      let nowMs = T0;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST, hitExitTransitionMs });
      // Captured once: the wrist never moves for the rest of this case, and deterministic
      // placement puts the successor at the same level, i.e. right where it already is.
      const onTarget = onTargetOf(rt);

      // Earn one real hit, then let its successor land under the unmoved wrist — the
      // ordinary deterministic-placement situation, and the reviewer's starting state.
      nowMs += 200;
      reachActiveTarget(rt, nowMs, hitExitTransitionMs);
      nowMs += hitExitTransitionMs + 32;
      const successor = runFrame(rt, { nowMs, wrist: onTarget, hitExitTransitionMs });
      assert.ok(successor.target, `successor expected at transition ${hitExitTransitionMs}`);
      assert.equal(contactOf(successor).targetContact, null);
      assert.equal(rt.states.target.wristInside, true, "the attempt begins inside");

      const targetId = activeTarget(rt).id;
      const adaptiveBefore = structuredClone(rt.adaptive);
      const reachedBefore = rt.states.target.interaction.targetsReached;
      const inputsBefore = rt.sessionInputs.length;

      // THE GAP. No trackerLost, no pause, no safety hold — only this one measurement is
      // missing, and the frames still reach the lifecycle.
      for (let i = 0; i < 10; i += 1) {
        nowMs += 16;
        const frame = runFrame(rt, { nowMs, wrist: null, hitExitTransitionMs });
        assert.equal(frame.dispatched.status, "dispatched", "an in-flight attempt keeps ticking");
        assert.equal(contactOf(frame).targetContact, null, `gap frame ${i} paid a hit`);
        assert.equal(contactOf(frame).targetAttemptTimeout, null, `gap frame ${i} expired`);
      }
      assert.equal(
        rt.states.target.wristInside,
        true,
        "the last MEASURED contact state stands across the gap",
      );

      // Measurement returns at the position the wrist never left.
      nowMs += 16;
      const recovered = runFrame(rt, { nowMs, wrist: onTarget, hitExitTransitionMs });

      assert.equal(contactOf(recovered).targetContact, null, "no fake TargetHitEvent");
      assert.equal(
        rt.states.target.interaction.targetsReached,
        reachedBefore,
        "no fabricated targetsReached",
      );
      assert.equal(rt.sessionInputs.length, inputsBefore, "nothing was reported to the session");
      assert.equal(activeTarget(rt).id, targetId, "the same attempt, not a duplicate successor");

      // THE ADAPTIVE ASSERTION: no success, no streak increment, no level change, no
      // timeout change — the engine cannot have been touched at all.
      assert.deepEqual(
        rt.adaptive,
        adaptiveBefore,
        `the gap moved the adaptive engine at transition ${hitExitTransitionMs}`,
      );
    }
  });

  it("and a real exit and re-entry after the gap still earns exactly one adaptive success", () => {
    const rt = createRuntime();
    let nowMs = T0;
    runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    const onTarget = onTargetOf(rt);
    nowMs += 200;
    reachActiveTarget(rt, nowMs);
    nowMs += 32;
    runFrame(rt, { nowMs, wrist: onTarget });
    assert.equal(rt.states.target.wristInside, true);

    nowMs += 16;
    runFrame(rt, { nowMs, wrist: null });
    nowMs += 16;
    assert.equal(contactOf(runFrame(rt, { nowMs, wrist: onTarget })).targetContact, null);

    const reachedBefore = rt.states.target.interaction.targetsReached;
    const streakBefore = rt.adaptive!.successStreak;
    const targetId = activeTarget(rt).id;

    // A MEASURED exit — the thing the gap was not.
    nowMs += 16;
    const exited = runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    assert.equal(contactOf(exited).targetContact, null);
    assert.equal(rt.states.target.wristInside, false);
    assert.equal(activeTarget(rt).id, targetId, "still the same attempt");

    // ...and the re-entry the patient actually performed, observed clean so the success is
    // allowed to advance the streak under `excludedFromIncrease`.
    nowMs += 16;
    const reentered = runFrame(rt, {
      nowMs,
      wrist: onTarget,
      compensationObserved: false,
    });
    const contact = contactOf(reentered).targetContact;
    assert.ok(contact, "a real reach must still count — the fix suppresses nothing");
    assert.equal(contact.targetId, targetId);
    assert.equal(rt.states.target.interaction.targetsReached, reachedBefore + 1);
    assert.equal(
      rt.adaptive!.successStreak,
      streakBefore + 1,
      "the legitimate reach did reach the adaptive engine",
    );

    // Exactly one: later frames on the retired target pay nothing more.
    const afterReach = structuredClone(rt.adaptive);
    for (let i = 0; i < 3; i += 1) {
      nowMs += 16;
      runFrame(rt, { nowMs, wrist: RESTING_WRIST });
    }
    assert.equal(rt.states.target.interaction.targetsReached, reachedBefore + 1);
    assert.equal(rt.adaptive!.successStreak, afterReach!.successStreak);
  });
});
