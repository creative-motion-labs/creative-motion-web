/**
 * RASQ Upper-Limb Motor Screen — Phase 1 protective-pause evaluator.
 *
 * Covers two categories under one non-clinical, non-technical-failure-labeled
 * vocabulary: tracking_or_environment and configured_limit. Neither this
 * module nor any value it produces labels configured_limit_exceeded as a
 * technical failure, a clinical safety event, a diagnosis, or an automatic
 * clinical stop — escalation only ever produces an outcome value on this
 * evaluator's own event; creating the resulting ClinicalStopEvent is a
 * separate, explicit call to clinical-stop-evaluator.ts made by a human-
 * triggered flow outside this module. This module never imports from
 * clinical-stop-evaluator.ts.
 *
 * Resume requires both an explicit readiness confirmation and a human
 * resumedBy actor — "system"/"auto" is not a valid actor and there is no
 * code path here that resumes without both.
 *
 * reason, outcome, and resumedBy are typed unknown because this is the
 * boundary where external JSON (a live capture loop or a persisted/
 * transmitted pause record) may reach the domain — they are validated
 * internally via closed-enum type guards, never cast or trusted.
 */

import {
  isValidProtectivePauseOutcome,
  isValidProtectivePauseReason,
  isValidProtectivePauseResumeActor,
  type ProtectivePauseEvent,
  type ProtectivePauseResumeActor,
} from "./types";

export type ProtectivePauseEvaluationInput = {
  reason: unknown;
  startedAtMs: number;
  endedAtMs: number;
  outcome: unknown;
  readinessConfirmedAt: string | null;
  resumedBy: unknown;
};

export type ProtectivePauseEvaluationFailure =
  | "invalid_reason"
  | "invalid_outcome"
  | "readiness_confirmation_required_for_resume"
  | "resumed_by_required_for_resume"
  | "invalid_resumed_by";

export type ProtectivePauseEvaluationResult =
  | { ok: true; event: ProtectivePauseEvent }
  | { ok: false; reason: ProtectivePauseEvaluationFailure };

export function evaluateProtectivePause(
  input: ProtectivePauseEvaluationInput,
): ProtectivePauseEvaluationResult {
  if (!isValidProtectivePauseReason(input.reason)) {
    return { ok: false, reason: "invalid_reason" };
  }
  if (!isValidProtectivePauseOutcome(input.outcome)) {
    return { ok: false, reason: "invalid_outcome" };
  }

  let resumedBy: ProtectivePauseResumeActor | null = null;

  if (input.outcome === "resumed") {
    if (!input.readinessConfirmedAt) {
      return { ok: false, reason: "readiness_confirmation_required_for_resume" };
    }
    if (!input.resumedBy) {
      return { ok: false, reason: "resumed_by_required_for_resume" };
    }
    if (!isValidProtectivePauseResumeActor(input.resumedBy)) {
      return { ok: false, reason: "invalid_resumed_by" };
    }
    resumedBy = input.resumedBy;
  }

  const event: ProtectivePauseEvent = {
    reason: input.reason,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    outcome: input.outcome,
    readinessConfirmedAt: input.readinessConfirmedAt,
    resumedBy,
  };

  return { ok: true, event };
}

export function isConfiguredLimitProtectivePause(event: ProtectivePauseEvent): boolean {
  return event.reason.category === "configured_limit";
}

export function isTrackingOrEnvironmentProtectivePause(event: ProtectivePauseEvent): boolean {
  return event.reason.category === "tracking_or_environment";
}
