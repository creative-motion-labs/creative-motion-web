/**
 * CHANGE-006 — the runtime seam between one dispatch tick and the adaptive engine.
 *
 * Everything in this module is pure. It reads no clock, holds no state, and owns no
 * identity: the caller keeps the `AdaptiveDifficultyState` instance and hands it back on
 * the next tick, exactly as `OrchestratorCvSessionCore` already keeps
 * `TargetLifecycleState` in a ref and hands it to the dispatch layer.
 *
 * It exists so the component's animation frame contains a single call rather than the
 * mapping, ordering and null-handling rules inline — the same reason
 * `orchestrator-cv-runtime-fault.ts` holds the fault predicates the loop uses.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - It does not consume `targetAttemptStarted`. Attempt identity, attempt initialisation
 *   and attempt-local compensation reset are all owned by `target-lifecycle.ts`; reading
 *   the start event here would require a shadow "last sequence seen" and duplicate that
 *   ownership for no behavioural gain.
 * - It does not produce `trackingLost`. Tracking loss is already owned by the
 *   orchestrator's safety-hold path and the lifecycle gating; a tracking-loss outcome
 *   synthesised here would be a second, competing authority.
 * - It does not replace the existing session-input path. A hit still travels to
 *   `orchestrator.reportInputEvent` via `mapTargetHitToSessionInput`; this is additive.
 */
import { applyAttemptOutcome } from "./adaptive-difficulty";
import type { AdaptiveChange, AdaptiveDifficultyState } from "./adaptive-difficulty-types";
import {
  mapTargetAttemptTimeoutToAdaptiveOutcome,
  mapTargetHitToAdaptiveOutcome,
} from "./target-attempt-outcome";
import type { TargetAttemptTimeoutEvent, TargetHitEvent } from "../types";

/**
 * The two adaptive-relevant terminal facts a dispatch tick can carry, named exactly as
 * `OrchestratorCvBlockDispatchResult` exposes them so the call site is a direct handoff.
 */
export type AdaptiveAttemptRuntimeInput = {
  targetContact: TargetHitEvent | null;
  targetAttemptTimeout: TargetAttemptTimeoutEvent | null;
};

export type AdaptiveAttemptRuntimeResult = {
  state: AdaptiveDifficultyState;
  /** Decisions emitted by this tick, in the order they were applied. Usually empty. */
  changes: AdaptiveChange[];
  /** How many outcomes were applied — 0, 1, or (unreachable today) 2. See the ordering note. */
  appliedOutcomes: number;
};

/**
 * Applies one dispatch tick's terminal facts to the adaptive state.
 *
 * ORDERING: expiration is applied before contact.
 *
 * The lifecycle makes both-in-one-tick unreachable today — every terminal path in
 * `tickTargetLifecycle` returns immediately, so a tick yields a hit or an expiry, never
 * both. This function still handles both rather than assuming one, because assuming it
 * would encode a lifecycle internal that this layer does not own, and a silent
 * drop would be the failure mode if that internal ever changed.
 *
 * Expiration-first is the chronologically correct order for the case it covers: an
 * expired attempt terminates the EARLIER target, and its successor spawns in the same
 * tick, so any contact in that tick necessarily belongs to the later attempt. Applying
 * contact first would credit the successor's success before the predecessor's
 * incomplete, inverting two attempts' effect on the streaks.
 */
export function applyDispatchOutcomesToAdaptiveState(
  state: AdaptiveDifficultyState,
  input: AdaptiveAttemptRuntimeInput,
): AdaptiveAttemptRuntimeResult {
  let next = state;
  const changes: AdaptiveChange[] = [];
  let appliedOutcomes = 0;

  if (input.targetAttemptTimeout) {
    const applied = applyAttemptOutcome(
      next,
      mapTargetAttemptTimeoutToAdaptiveOutcome(input.targetAttemptTimeout),
    );
    next = applied.state;
    appliedOutcomes += 1;
    if (applied.change) changes.push(applied.change);
  }

  if (input.targetContact) {
    const applied = applyAttemptOutcome(
      next,
      mapTargetHitToAdaptiveOutcome(input.targetContact),
    );
    next = applied.state;
    appliedOutcomes += 1;
    if (applied.change) changes.push(applied.change);
  }

  return { state: next, changes, appliedOutcomes };
}

/**
 * The caller-owned compensation observation for the CURRENT attempt, derived from the
 * detector snapshot's latched compensation level.
 *
 * ONLY `true` IS TRUSTWORTHY, AND THAT IS NOT A SHORTCUT.
 * `ShoulderAbductionReachPoseDetectorSnapshot.compensationFlagged` is a bare boolean, but
 * the detector underneath it has three states: flagged, clear, and unavailable —
 * `updateShoulderAbductionReachCompensation` returns "unavailable" both when joint
 * visibility is too low AND before a resting-phase baseline has ever been captured. The
 * snapshot collapses "measured clear" and "never evaluated" into the same `false`.
 *
 * `target-lifecycle.ts` treats any non-undefined input as an observation, so forwarding a
 * raw `false` would move the attempt from "unknown" to an explicit "no compensation
 * observed" and stamp a manufactured clean-movement claim onto the terminal event. This
 * layer is not entitled to invent that. So: latch `true`, never assert `false`.
 *
 * The consequence is deliberate and should not be "fixed" by defaulting: until the
 * detector can distinguish measured-clear from not-evaluated, a clean attempt is reported
 * as UNKNOWN compensation, not as clean. Unknown is the honest answer.
 */
export function resolveAttemptCompensationObservation(
  compensationFlagged: boolean | undefined,
): true | undefined {
  return compensationFlagged === true ? true : undefined;
}
