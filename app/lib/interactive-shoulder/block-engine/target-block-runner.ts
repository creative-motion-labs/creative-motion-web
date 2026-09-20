/**
 * Reach the Light, exposed as a Block Runner. This file contains no
 * target-lifecycle logic of its own — it is a mechanical field-rename
 * wrapper around the existing, unmodified `target-lifecycle.ts` /
 * `target-lifecycle-gating.ts` state machine. As of PR2,
 * `InteractiveShoulderSession.tsx` resolves and ticks Reach the Light
 * exclusively through `resolveTargetBlockRunner`/`registerTargetBlockRunner`
 * below — it no longer imports `tickTargetLifecycleIfActive` directly.
 *
 * The same rule governs the target-attempt values: this runner transports
 * them and interprets none of them. It invents no timeout, no level and no
 * clock; it does not decide whether an attempt started or expired, and it
 * does not deduplicate what the lifecycle already emits exactly once. Any
 * attempt-related rule appearing in this file would be a design defect.
 */
import type { SessionBlockType, SessionState } from "@/app/lib/session-orchestrator/types";
import {
  createInitialTargetLifecycle,
  type TargetLifecycleState,
  type TargetLifecycleTickInput,
} from "../target-lifecycle";
import { tickTargetLifecycleIfActive } from "../target-lifecycle-gating";
import type {
  TargetAttemptStartEvent,
  TargetAttemptTimeoutEvent,
  TargetHitEvent,
} from "../types";
import type { BlockRunner, BlockRunnerTickResult } from "./block-runner-types";
import {
  getBlockRunnerForBlockType,
  isBlockTypeRegistered,
  registerBlockRunner,
} from "./block-runner-registry";

/**
 * The shared runner result plus the two target-attempt outputs, forwarded verbatim from
 * `target-lifecycle`.
 *
 * They are additional fields rather than a reshaping of `completionEvent` because a hit,
 * an attempt start and an attempt timeout are different facts about different attempts.
 * Both are REQUIRED (not optional) so that a runner physically cannot return a result in
 * which an attempt event was quietly omitted; "no events this tick" must be spelled
 * `[]` / `null`.
 *
 * Since CHANGE-008 a terminal tick carries its outcome only — the successor, and therefore
 * the next attempt start, arrives on a later tick, after the caller has had the chance to
 * adapt. This wrapper neither knows nor enforces that; it is stated here because the field
 * shapes were originally justified by the old same-tick behaviour.
 *
 * Exactly-once ownership stays in `target-lifecycle`. This wrapper never filters,
 * deduplicates, buffers or re-emits these values — see the module doc above.
 */
export type TargetBlockRunnerTickResult = BlockRunnerTickResult<
  TargetLifecycleState,
  TargetHitEvent
> & {
  /** Attempt starts produced by this tick, in spawn order. Empty when nothing spawned. */
  attemptStartedEvents: TargetAttemptStartEvent[];
  /** At most one per target, and never together with a `completionEvent` for that target. */
  attemptTimeoutEvent: TargetAttemptTimeoutEvent | null;
};

/**
 * `BlockRunner` specialised for the target block: same contract, with a tick result
 * widened by the two attempt outputs above. Declared as an explicit named type (rather
 * than left to inference) so the widening is a reviewable part of the public surface and
 * so `resolveTargetBlockRunner` keeps handing callers a fully typed runner.
 */
export type TargetBlockRunnerContract = Omit<
  BlockRunner<TargetLifecycleState, TargetLifecycleTickInput, TargetHitEvent, void>,
  "tick"
> & {
  tick: (
    sessionState: SessionState,
    state: TargetLifecycleState,
    input: TargetLifecycleTickInput,
  ) => TargetBlockRunnerTickResult;
};

export const TARGET_BLOCK_RUNNER: TargetBlockRunnerContract = {
  blockType: "movement-target",
  createInitialState: () => createInitialTargetLifecycle(),
  tick: (sessionState, state, input) => {
    // `input` is passed through untouched: it already IS the lifecycle's own tick input,
    // so every attempt field on it (blockElapsedSeconds, attemptTimeoutMs, levelDegrees,
    // compensationObservedDuringAttempt) reaches the lifecycle exactly as the caller
    // supplied it, and an omitted field stays omitted rather than acquiring a default.
    const result = tickTargetLifecycleIfActive(sessionState, state, input);
    return {
      state: result.state,
      ticked: result.ticked,
      completionEvent: result.hitEvent,
      attemptStartedEvents: result.attemptStartedEvents,
      attemptTimeoutEvent: result.attemptTimeoutEvent,
    };
  },
};

/**
 * Registers TARGET_BLOCK_RUNNER under "movement-target". Idempotent — the
 * registry's own duplicate-registration guard would otherwise throw on a
 * second call (e.g. a test file re-importing this module in the same
 * process), so this checks membership first rather than relying on the
 * caller to register exactly once.
 */
export function registerTargetBlockRunner(): void {
  if (isBlockTypeRegistered("movement-target")) return;
  registerBlockRunner(TARGET_BLOCK_RUNNER);
}

/**
 * Resolves TARGET_BLOCK_RUNNER through the shared registry rather than
 * importing the constant directly, so the production call site proves
 * genuine blockType-driven resolution instead of a hardcoded reference.
 *
 * Returns null whenever `blockType` isn't exactly "movement-target" —
 * including undefined (no blockType set) and every other SessionBlockType
 * — so a caller can never be silently handed the wrong runner for the
 * block it asked about.
 *
 * The cast back to this module's concrete type is safe specifically
 * because: (1) `blockType` has just been narrowed to the literal
 * "movement-target" by the check above, and (2) this module is the only
 * place in the codebase that ever registers anything under that key —
 * `registerBlockRunner`'s duplicate-registration guard (block-runner-
 * registry.ts) makes that a structural guarantee, not an assumption a
 * future change could silently break without this file's own test
 * suite catching it.
 */
export function resolveTargetBlockRunner(
  blockType: SessionBlockType | undefined,
): typeof TARGET_BLOCK_RUNNER | null {
  if (blockType !== "movement-target") return null;
  const runner = getBlockRunnerForBlockType(blockType);
  if (!runner) return null;
  return runner as typeof TARGET_BLOCK_RUNNER;
}
