/**
 * Centralized active-block dispatch by blockType. Callers tick exactly one
 * runner per frame based on the orchestrator's current block — this module
 * does not decide which block is active.
 *
 * Instructional blocks: presentation progress only. Duration-based block
 * completion remains SessionOrchestrator's responsibility — this dispatch
 * never passes targetDurationSeconds or acknowledgement into the
 * instructional lifecycle, so the runner cannot complete the block here.
 *
 * Unknown or unregistered runners return a structured runner_unavailable
 * result — never a silent successful no-op.
 */
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { SessionState } from "@/app/lib/session-orchestrator/types";
import type {
  PatternCompletionEvent,
  PatternLifecycleState,
} from "../motion-patterns/pattern-lifecycle";
import type { ResolvedMotionPattern } from "../motion-patterns/motion-pattern-types";
import type { InstructionalLifecycleState } from "../instructional-lifecycle";
import type {
  TargetLifecycleState,
  TargetLifecycleTickInput,
} from "../target-lifecycle";
import type {
  NormalizedPoint,
  SafeTargetBounds,
  TargetAttemptStartEvent,
  TargetAttemptTimeoutEvent,
  TargetHitEvent,
} from "../types";
import {
  resolveInstructionalBlockRunner,
} from "./instructional-block-runner";
import {
  resolvePatternBlockRunner,
} from "./pattern-block-runner";
import {
  resolveTargetBlockRunner,
} from "./target-block-runner";

export type InstructionalBlockRunner = NonNullable<
  ReturnType<typeof resolveInstructionalBlockRunner>
>;
export type TargetBlockRunner = NonNullable<ReturnType<typeof resolveTargetBlockRunner>>;
export type PatternBlockRunner = NonNullable<ReturnType<typeof resolvePatternBlockRunner>>;

export type ActiveBlockRunnerResolvers = {
  resolveInstructionalRunner?: () => InstructionalBlockRunner | null;
  resolveTargetRunner?: () => TargetBlockRunner | null;
  resolvePatternRunner?: () => PatternBlockRunner | null;
};

const defaultResolveInstructionalRunner = (): InstructionalBlockRunner | null =>
  resolveInstructionalBlockRunner("instructional");
const defaultResolveTargetRunner = (): TargetBlockRunner | null =>
  resolveTargetBlockRunner("movement-target");
const defaultResolvePatternRunner = (): PatternBlockRunner | null =>
  resolvePatternBlockRunner("movement-pattern");

export type ActiveBlockRunnerStates = {
  instructional: InstructionalLifecycleState;
  target: TargetLifecycleState;
  pattern: PatternLifecycleState | null;
};

export type PatternBlockRunnerStates = ActiveBlockRunnerStates & {
  pattern: PatternLifecycleState;
};

type ActiveBlockTickBase = {
  sessionState: SessionState;
  nowMs: number;
  blockElapsedSeconds: number;
  /** Optional typed resolver overrides — production callers omit this. */
  resolvers?: ActiveBlockRunnerResolvers;
};

export type InstructionalBlockTickInput = ActiveBlockTickBase & {
  blockType: "instructional";
  states: ActiveBlockRunnerStates;
  targetDurationSeconds?: number;
};

/**
 * The optional target-attempt inputs, taken verbatim from the approved lifecycle contract
 * with `Pick` rather than re-declared here. Restating them would let this transport layer
 * drift from `target-lifecycle.ts` — and would duplicate clinical documentation that has
 * exactly one home.
 *
 * Every field is optional and none is defaulted anywhere on this path. In particular an
 * omitted `attemptTimeoutMs` means "attempt expiration is off", never "use some standard
 * reach window": a reach window is a clinical parameter this layer may not invent.
 */
export type TargetAttemptTickConfig = Pick<
  TargetLifecycleTickInput,
  | "attemptTimeoutMs"
  | "levelDegrees"
  | "compensationObservedDuringAttempt"
  // CHANGE-007. Transport only: this layer resolves no geometry, knows nothing about
  // adaptive levels, and — exactly as with `attemptTimeoutMs` — an omitted value means
  // "the caller resolved no placement", never "use a default position".
  | "preferredTargetPosition"
>;

export type TargetBlockTickInput = ActiveBlockTickBase &
  TargetAttemptTickConfig & {
    blockType: "movement-target";
    states: ActiveBlockRunnerStates;
    wrist: NormalizedPoint | null;
    side: ShoulderAbductionReachSide;
    bounds: SafeTargetBounds;
    hitExitTransitionMs?: number;
    random?: () => number;
  };

export type PatternBlockTickInput = ActiveBlockTickBase & {
  blockType: "movement-pattern";
  states: PatternBlockRunnerStates;
  wrist: NormalizedPoint | null;
  pattern: ResolvedMotionPattern;
  completionExitTransitionMs?: number;
};

export type ActiveBlockTickInput =
  | InstructionalBlockTickInput
  | TargetBlockTickInput
  | PatternBlockTickInput;

export type ActiveBlockTickResult =
  | {
      status: "ticked";
      ticked: true;
      blockType: ActiveBlockTickInput["blockType"];
      states: ActiveBlockRunnerStates;
      targetContact: TargetHitEvent | null;
      /**
       * Attempt starts emitted by the target runner on this tick, forwarded unchanged.
       * Always `[]` for instructional and movement-pattern blocks — those modes have no
       * attempt concept and this stage does not give them one.
       */
      targetAttemptStarted: TargetAttemptStartEvent[];
      /**
       * Attempt expiration emitted by the target runner on this tick, forwarded
       * unchanged. Always `null` for non-target blocks. Never accompanies a
       * `targetContact` for the same target — the lifecycle guarantees that, and nothing
       * on this path may synthesise one.
       */
      targetAttemptTimeout: TargetAttemptTimeoutEvent | null;
      patternCompleted: PatternCompletionEvent | null;
      /** 0–1 presentation progress for instructional blocks; null otherwise. */
      presentationProgress: number | null;
    }
  | {
      status: "not_active";
      ticked: false;
      sessionState: SessionState;
    }
  | {
      status: "runner_unavailable";
      ticked: false;
      blockType: ActiveBlockTickInput["blockType"];
      reason: string;
    };

function computeInstructionalPresentationProgress(
  blockElapsedSeconds: number,
  targetDurationSeconds: number | undefined,
): number | null {
  if (
    targetDurationSeconds == null ||
    !Number.isFinite(targetDurationSeconds) ||
    targetDurationSeconds <= 0 ||
    !Number.isFinite(blockElapsedSeconds)
  ) {
    return null;
  }
  return Math.min(1, Math.max(0, blockElapsedSeconds / targetDurationSeconds));
}

function runnerUnavailable(
  blockType: ActiveBlockTickInput["blockType"],
): ActiveBlockTickResult {
  return {
    status: "runner_unavailable",
    ticked: false,
    blockType,
    reason: `No Block Runner registered for blockType "${blockType}".`,
  };
}

export function tickActiveBlockRunner(input: ActiveBlockTickInput): ActiveBlockTickResult {
  if (input.sessionState !== "active") {
    return { status: "not_active", ticked: false, sessionState: input.sessionState };
  }

  const nextStates = { ...input.states };
  const resolvers = input.resolvers;

  switch (input.blockType) {
    case "instructional": {
      const runner = (resolvers?.resolveInstructionalRunner ?? defaultResolveInstructionalRunner)();
      if (!runner) return runnerUnavailable("instructional");

      const ticked = runner.tick("active", nextStates.instructional, {
        nowMs: input.nowMs,
        blockElapsedSeconds: input.blockElapsedSeconds,
      });
      nextStates.instructional = ticked.state;
      return {
        status: "ticked",
        ticked: true,
        blockType: "instructional",
        states: nextStates,
        targetContact: null,
        targetAttemptStarted: [],
        targetAttemptTimeout: null,
        patternCompleted: null,
        presentationProgress: computeInstructionalPresentationProgress(
          input.blockElapsedSeconds,
          input.targetDurationSeconds,
        ),
      };
    }
    case "movement-target": {
      const runner = (resolvers?.resolveTargetRunner ?? defaultResolveTargetRunner)();
      if (!runner) return runnerUnavailable("movement-target");

      const ticked = runner.tick("active", nextStates.target, {
        wrist: input.wrist,
        nowMs: input.nowMs,
        side: input.side,
        bounds: input.bounds,
        hitExitTransitionMs: input.hitExitTransitionMs,
        random: input.random,
        // ATTEMPT CLOCK. The dispatch layer already carries the orchestrator's pause-aware
        // active block time for instructional progress; the same value — not a second,
        // wall-clock one — is what the lifecycle measures attempts against. Forwarded
        // unconditionally so an attempt's baseline is always honest; on its own it changes
        // nothing, because expiration additionally requires `attemptTimeoutMs`.
        blockElapsedSeconds: input.blockElapsedSeconds,
        attemptTimeoutMs: input.attemptTimeoutMs,
        levelDegrees: input.levelDegrees,
        compensationObservedDuringAttempt: input.compensationObservedDuringAttempt,
        preferredTargetPosition: input.preferredTargetPosition,
      });
      nextStates.target = ticked.state;
      return {
        status: "ticked",
        ticked: true,
        blockType: "movement-target",
        states: nextStates,
        targetContact: ticked.completionEvent,
        // Forwarded by reference, unfiltered. Re-checking "has this already been emitted?"
        // here would create a second attempt-event authority competing with the lifecycle.
        targetAttemptStarted: ticked.attemptStartedEvents,
        targetAttemptTimeout: ticked.attemptTimeoutEvent,
        patternCompleted: null,
        presentationProgress: null,
      };
    }
    case "movement-pattern": {
      const runner = (resolvers?.resolvePatternRunner ?? defaultResolvePatternRunner)();
      if (!runner) return runnerUnavailable("movement-pattern");

      const patternState = input.states.pattern;
      const ticked = runner.tick("active", patternState, {
        wrist: input.wrist,
        nowMs: input.nowMs,
        pattern: input.pattern,
        completionExitTransitionMs: input.completionExitTransitionMs,
      });
      return {
        status: "ticked",
        ticked: true,
        blockType: "movement-pattern",
        states: { ...input.states, pattern: ticked.state },
        targetContact: null,
        targetAttemptStarted: [],
        targetAttemptTimeout: null,
        patternCompleted: ticked.completionEvent,
        presentationProgress: null,
      };
    }
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}
