/**
 * Pure orchestrator CV block dispatch — no React state, no orchestrator
 * pause side effects. OrchestratorCvSessionCore owns fault reactions.
 */
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type {
  MovementBlock,
  SessionBlockType,
  SessionOrchestratorSnapshot,
} from "@/app/lib/session-orchestrator/types";
import { createInitialInstructionalLifecycle } from "./instructional-lifecycle";
import {
  resolveActiveMotionPattern,
  resolveFeedbackInteractionMode,
  type FeedbackInteractionMode,
} from "./motion-patterns/motion-pattern-registry";
import {
  type PatternCompletionEvent,
} from "./motion-patterns/pattern-lifecycle";
import { resetPatternLifecycleForBlock } from "./motion-patterns/pattern-lifecycle-gating";
import type { ResolvedMotionPattern } from "./motion-patterns/motion-pattern-types";
import {
  tickActiveBlockRunner,
  type ActiveBlockRunnerResolvers,
  type ActiveBlockRunnerStates,
  type ActiveBlockTickInput,
  type ActiveBlockTickResult,
  type PatternBlockRunnerStates,
  type TargetAttemptTickConfig,
} from "./block-engine/tick-active-block-runner";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "./target-generator";
import { createInitialTargetLifecycle } from "./target-lifecycle";
import type {
  NormalizedPoint,
  TargetAttemptStartEvent,
  TargetAttemptTimeoutEvent,
  TargetHitEvent,
} from "./types";

export type { TargetAttemptTickConfig } from "./block-engine/tick-active-block-runner";

export type OrchestratorCvRuntimeFault =
  | {
      kind: "runner_unavailable";
      blockType: SessionBlockType;
      reason: string;
    }
  | {
      kind: "pattern_unresolved";
      blockId: string;
      feedbackProfile?: string;
    };

export type OrchestratorCvBlockTransitionResult = {
  states: ActiveBlockRunnerStates;
  activeMotionPattern: ResolvedMotionPattern | null;
  presentationProgress: null;
  fault: OrchestratorCvRuntimeFault | null;
};

export type OrchestratorCvBlockDispatchInput = {
  snap: SessionOrchestratorSnapshot;
  nowMs: number;
  wrist: NormalizedPoint | null;
  side: ShoulderAbductionReachSide;
  hitExitTransitionMs: number;
  states: ActiveBlockRunnerStates;
  activeMotionPattern: ResolvedMotionPattern | null;
  /**
   * Target-attempt configuration seam. STRICTLY OPTIONAL and entirely caller-owned:
   * dispatch reads it, forwards it, and originates none of it. Omitting it — which every
   * production caller does today — leaves target dispatch behaving exactly as it did
   * before attempt plumbing existed, including the unconditional no-wrist skip below.
   *
   * There is no default here and there must never be one. A reach window, a placement
   * level and a compensation observation are all decisions this transport layer is not
   * entitled to make.
   */
  targetAttempt?: TargetAttemptTickConfig;
  /** Optional resolver overrides for deterministic tests — production callers omit. */
  resolvers?: ActiveBlockRunnerResolvers;
};

export type OrchestratorCvBlockDispatchResult =
  | { status: "not_active" }
  | { status: "skipped"; reason: "target_wrist_required" }
  | {
      status: "dispatched";
      states: ActiveBlockRunnerStates;
      targetContact: TargetHitEvent | null;
      /** Attempt starts from this tick, forwarded unchanged. `[]` for non-target blocks. */
      targetAttemptStarted: TargetAttemptStartEvent[];
      /** Attempt expiration from this tick, forwarded unchanged. `null` for non-target blocks. */
      targetAttemptTimeout: TargetAttemptTimeoutEvent | null;
      patternCompleted: PatternCompletionEvent | null;
      presentationProgress: number | null;
    }
  | { status: "fault"; fault: OrchestratorCvRuntimeFault };

export function resolveOrchestratorBlockType(
  block: MovementBlock | null | undefined,
): SessionBlockType | null {
  if (!block) return null;
  if (block.blockType) return block.blockType;
  const mode = resolveFeedbackInteractionMode(block.feedbackProfile);
  return mode === "motion-pattern" ? "movement-pattern" : "movement-target";
}

/** Authoritative HUD/visual feedback mode — derived from blockType, not feedbackProfile alone. */
export function resolveOrchestratorHudFeedbackMode(
  blockType: SessionBlockType | null,
): FeedbackInteractionMode {
  if (blockType === "movement-pattern") return "motion-pattern";
  return "reach-the-light-targets";
}

export function resetRunnerStatesForBlockTransition(input: {
  block: MovementBlock;
  side: ShoulderAbductionReachSide;
}): OrchestratorCvBlockTransitionResult {
  const blockType = resolveOrchestratorBlockType(input.block);
  const resolvedPattern = resolveActiveMotionPattern(input.block.feedbackProfile, input.side);

  const states: ActiveBlockRunnerStates = {
    instructional: createInitialInstructionalLifecycle(),
    target: createInitialTargetLifecycle(),
    pattern:
      blockType === "movement-pattern" && resolvedPattern
        ? resetPatternLifecycleForBlock(resolvedPattern.id)
        : null,
  };

  if (blockType === "movement-pattern" && !resolvedPattern) {
    return {
      states,
      activeMotionPattern: null,
      presentationProgress: null,
      fault: {
        kind: "pattern_unresolved",
        blockId: input.block.blockId,
        feedbackProfile: input.block.feedbackProfile,
      },
    };
  }

  return {
    states,
    activeMotionPattern: blockType === "movement-pattern" ? resolvedPattern : null,
    presentationProgress: null,
    fault: null,
  };
}

function mapTickResult(
  tickResult: ActiveBlockTickResult,
): OrchestratorCvBlockDispatchResult {
  if (tickResult.status === "not_active") {
    return { status: "not_active" };
  }
  if (tickResult.status === "runner_unavailable") {
    return {
      status: "fault",
      fault: {
        kind: "runner_unavailable",
        blockType: tickResult.blockType,
        reason: tickResult.reason,
      },
    };
  }
  return {
    status: "dispatched",
    states: tickResult.states,
    targetContact: tickResult.targetContact,
    targetAttemptStarted: tickResult.targetAttemptStarted,
    targetAttemptTimeout: tickResult.targetAttemptTimeout,
    patternCompleted: tickResult.patternCompleted,
    presentationProgress: tickResult.presentationProgress,
  };
}

/**
 * Whether a movement-target tick may proceed with no wrist sample.
 *
 * The historical rule was blunt: no wrist, no target dispatch at all. That rule is
 * deliberately kept for everything it used to cover, and narrowed in exactly one place —
 * an attempt that has ALREADY started must keep being ticked, so the lifecycle can OBSERVE
 * that the wrist is missing.
 *
 * That observation is the point (review fix, blocker 2). A no-wrist tick does not advance
 * the attempt's measurable window; it is precisely how the lifecycle learns to exclude the
 * interval from it. Skipping these ticks instead would leave the gap invisible, and the
 * attempt would then expire against block time that elapsed while nobody was watching.
 *
 * Both conditions are required:
 *
 * 1. `targetAttempt` supplied. Without it no attempt can expire, so a no-wrist tick would
 *    accomplish nothing and would only diverge from legacy behaviour. This is what makes
 *    "config omitted ⇒ legacy behaviour" a structural property rather than a promise.
 * 2. A target is currently active. This preserves target AVAILABILITY semantics exactly:
 *    with `currentTarget === null` the lifecycle's next tick would SPAWN, and presenting a
 *    patient with a fresh target while their arm is not being tracked is a behaviour this
 *    path has never had. Those ticks still skip.
 *
 * WHAT CHANGE-008 DID TO CONDITION 2 — a safety improvement, not a side effect.
 * `currentTarget === null` used to mean only "the first target of a block" or "a hit's
 * successor waiting out its exit transition", because every other terminal path replaced
 * its target inline. Since terminal events now retire their target and leave the successor
 * to a later tick, it also covers "a just-ended attempt's successor". So a tracking gap can
 * no longer manufacture a CHAIN of incomplete attempts: the attempt already in flight
 * expires exactly once, and nothing new is presented to — or scored against — a patient the
 * detector cannot see. The chain is asserted absent in `orchestrator-cv-block-dispatch.test`
 * (18/19) and end to end in `adaptive/immediate-successor-feedback.test` (13).
 *
 * Note what this is NOT: a missing wrist is never treated as failure and never produces a
 * timeout by itself — nor does it bring one closer. Expiration is caused by elapsed
 * MEASURABLE attempt time alone. Global tracker loss is handled upstream by the
 * orchestrator freezing block time; the wrist-only gap, which that path never sees, is
 * excluded per attempt by `target-lifecycle.ts`.
 */
function allowsNoWristTargetMaintenance(input: OrchestratorCvBlockDispatchInput): boolean {
  if (input.targetAttempt === undefined) return false;
  return input.states.target.currentTarget !== null;
}

export function dispatchOrchestratorCvBlock(
  input: OrchestratorCvBlockDispatchInput,
): OrchestratorCvBlockDispatchResult {
  const { snap } = input;
  if (snap.sessionState !== "active") {
    return { status: "not_active" };
  }

  const currentBlock = snap.currentBlock;
  const blockType = resolveOrchestratorBlockType(currentBlock);
  if (!currentBlock || !blockType) {
    return { status: "not_active" };
  }

  if (blockType === "movement-target" && !input.wrist && !allowsNoWristTargetMaintenance(input)) {
    return { status: "skipped", reason: "target_wrist_required" };
  }

  const base = {
    sessionState: snap.sessionState,
    nowMs: input.nowMs,
    blockElapsedSeconds: snap.blockElapsedSeconds,
    states: input.states,
  };

  let tickInput: ActiveBlockTickInput;
  switch (blockType) {
    case "instructional":
      tickInput = {
        ...base,
        blockType: "instructional",
        targetDurationSeconds: currentBlock.targetDurationSeconds,
      };
      break;
    case "movement-target":
      tickInput = {
        ...base,
        blockType: "movement-target",
        wrist: input.wrist,
        side: input.side,
        bounds: DEFAULT_SAFE_TARGET_BOUNDS,
        hitExitTransitionMs: input.hitExitTransitionMs,
        // `base` already carries snap.blockElapsedSeconds — the orchestrator's pause-aware
        // active block time, and the only clock the attempt path is allowed to read. The
        // caller's optional attempt fields are spread on top; when none were supplied,
        // nothing is added and no key is invented.
        ...(input.targetAttempt ?? {}),
      };
      break;
    case "movement-pattern": {
      const activeMotionPattern = input.activeMotionPattern;
      const patternState = input.states.pattern;
      if (!activeMotionPattern || !patternState) {
        return {
          status: "fault",
          fault: {
            kind: "pattern_unresolved",
            blockId: currentBlock.blockId,
            feedbackProfile: currentBlock.feedbackProfile,
          },
        };
      }
      const patternStates: PatternBlockRunnerStates = {
        ...input.states,
        pattern: patternState,
      };
      tickInput = {
        sessionState: snap.sessionState,
        nowMs: input.nowMs,
        blockElapsedSeconds: snap.blockElapsedSeconds,
        states: patternStates,
        blockType: "movement-pattern",
        wrist: input.wrist,
        pattern: activeMotionPattern,
        completionExitTransitionMs: input.hitExitTransitionMs,
      };
      break;
    }
    default: {
      const _exhaustive: never = blockType;
      return _exhaustive;
    }
  }

  return mapTickResult(tickActiveBlockRunner({ ...tickInput, resolvers: input.resolvers }));
}
