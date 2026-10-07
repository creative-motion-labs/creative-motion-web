/**
 * CHANGE-005 — target attempt facts → the adaptive engine's existing semantic outcome.
 *
 * This module is a pure translation boundary and nothing else. It follows the same
 * philosophy as `session-orchestrator/adapters/shoulder-session-adapter.ts`, which maps
 * runtime target events into the orchestrator's semantic input vocabulary:
 *
 *   event fact → pure mapper → existing semantic type
 *
 * `AdaptiveAttemptOutcome` (see `adaptive-difficulty-types.ts`) is ALREADY the canonical
 * semantic input for `applyAttemptOutcome`. No new attempt-result abstraction is
 * introduced here, and none should be: a second result vocabulary would immediately
 * compete with the one the engine already owns.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It holds no state, reads no clock, creates no identity, and calls no engine. It does
 * not decide WHETHER an attempt ended — `target-lifecycle.ts` owns that, including the
 * exactly-once guarantee on a terminal result. Callers hand it a fact that has already
 * happened; it returns the corresponding semantic outcome. Nothing here is wired into
 * the runtime by this stage.
 *
 * CLINICAL SAFETY BOUNDARY
 * ------------------------
 * `success` means only that the target interaction completed according to the software
 * contract. It is not a clinical outcome, not a movement-quality judgement, and not a
 * statement about range of motion, impairment or progress. `incomplete` means only that
 * the allotted pause-aware attempt time elapsed without contact. `compensated` is a
 * factual pass-through signal originating in the existing CV pipeline and is not
 * reinterpreted here.
 */
import type {
  AdaptiveAttemptOutcome,
} from "./adaptive-difficulty-types";
import type { TargetAttemptTimeoutEvent, TargetHitEvent } from "../types";

/**
 * The three outcome shapes, derived from the engine's own union with `Extract` rather
 * than restated. This mirrors how CHANGE-004 derived `TargetAttemptTickConfig` with
 * `Pick`: the narrower type stays structurally tied to its single source of truth and
 * cannot drift from it.
 *
 * Narrowing the return types is load bearing, not cosmetic. It makes "a timeout can
 * never become a tracking loss" a fact the compiler enforces at every call site, in
 * addition to the tests that assert it.
 */
type SuccessOutcome = Extract<AdaptiveAttemptOutcome, { kind: "success" }>;
type IncompleteOutcome = Extract<AdaptiveAttemptOutcome, { kind: "incomplete" }>;
type TrackingLostOutcome = Extract<AdaptiveAttemptOutcome, { kind: "trackingLost" }>;

/**
 * Maps a registered target contact to a successful attempt outcome.
 *
 * `reactionTimeMs` is carried across to `reachTimeMs` verbatim — the same factual number
 * the target lifecycle already measured, never recomputed and never sourced from a clock
 * read here. It is omitted rather than forwarded when it is not a finite number, which
 * is the same rule `target-lifecycle.ts` applies to every optional numeric it stamps:
 * declining to assert a value is honest, while forwarding NaN as "factual timing" is not.
 *
 * Compensation is a three-state fact and is preserved as one:
 *
 *   true      → the caller reported a compensatory pattern during this attempt
 *   false     → the caller supplied compensation input and reported none
 *   undefined → the caller supplied no compensation input at all — UNKNOWN
 *
 * The third case stays absent on the result. It must never be flattened into `false`:
 * `TargetHitEvent.compensatedDuringAttempt` documents absence as "unknown, not clean",
 * and this layer is not entitled to convert missing information into an observation of
 * clean movement. An explicit `false`, by contrast, IS an observation, so it is passed
 * through unchanged rather than discarded.
 */
export function mapTargetHitToAdaptiveOutcome(hit: TargetHitEvent): SuccessOutcome {
  return {
    kind: "success",
    ...(Number.isFinite(hit.reactionTimeMs) ? { reachTimeMs: hit.reactionTimeMs } : {}),
    ...(hit.compensatedDuringAttempt !== undefined
      ? { compensated: hit.compensatedDuringAttempt }
      : {}),
  };
}

/**
 * Maps an expired target attempt to an incomplete attempt outcome.
 *
 * `incomplete` is the ONLY outcome this function can produce, and the narrowed return
 * type makes that unrepresentable otherwise. Tracking loss is a different fact with a
 * different meaning — a voided attempt that says nothing about the patient — and it must
 * never be reachable from an expiration. `TargetAttemptTimeoutEvent` deliberately carries
 * no `reason` discriminant for exactly this purpose; nothing here may reintroduce one.
 *
 * The event is taken as a parameter even though no field of it is read. The signature is
 * the contract: producing `incomplete` requires possessing a real timeout event that the
 * lifecycle actually emitted, rather than a bare call anyone could make from anywhere.
 * `mapTargetHitToSessionInput` in the shoulder session adapter reads exactly one of its
 * event's fields for the same reason.
 */
export function mapTargetAttemptTimeoutToAdaptiveOutcome(
  timeout: TargetAttemptTimeoutEvent,
): IncompleteOutcome {
  void timeout;
  return { kind: "incomplete" };
}

/**
 * Maps an explicitly identified tracking loss to a voided attempt outcome.
 *
 * Deliberately takes NO input. There is no event, elapsed time, absent wrist sample or
 * missing hit from which this module is willing to infer tracking loss — every one of
 * those inferences has a plausible non-tracking explanation, and mislabelling a patient's
 * attempt as voided (or the reverse) is the specific failure this whole boundary exists
 * to prevent. The caller must already know, from the tracker itself, that the pose stream
 * was unusable for the attempt; this function only names that fact in the engine's
 * vocabulary.
 */
export function mapTrackingLossToAdaptiveOutcome(): TrackingLostOutcome {
  return { kind: "trackingLost" };
}
