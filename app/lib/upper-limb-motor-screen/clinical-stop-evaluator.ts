/**
 * RASQ Upper-Limb Motor Screen — Phase 1 clinical-stop evaluator.
 *
 * Accepts only explicit human-reported or human-recorded input. There is no
 * parameter through which raw CV telemetry (tracking loss, occlusion, etc.)
 * can reach this evaluator — a clinical stop can only ever be produced from
 * a closed-enum reason plus a human recordedBy role. This module never
 * imports from protective-pause-evaluator.ts and never auto-clears an event.
 *
 * reason and recordedBy are typed unknown because this is the boundary where
 * external JSON (a therapist/patient/caregiver report submitted from a UI or
 * API) may reach the domain — they are validated internally via closed-enum
 * type guards, never cast or trusted.
 */

import {
  isValidClinicalStopReason,
  isValidClinicalStopReportedByRole,
  type ClinicalStopEvent,
} from "./types";

export type ClinicalStopReportInput = {
  reason: unknown;
  recordedBy: unknown;
  now?: () => string;
};

export type ClinicalStopEvaluationFailure = "invalid_reason" | "invalid_recorded_by";

export type ClinicalStopEvaluationResult =
  | { ok: true; event: ClinicalStopEvent }
  | { ok: false; reason: ClinicalStopEvaluationFailure };

/**
 * Produces a ClinicalStopEvent from an explicit human report. reviewRequired
 * is always true — this function has no "clear" or "resolve" counterpart;
 * clearing a clinical stop is not a capability this module provides.
 */
export function evaluateClinicalStop(input: ClinicalStopReportInput): ClinicalStopEvaluationResult {
  if (!isValidClinicalStopReason(input.reason)) {
    return { ok: false, reason: "invalid_reason" };
  }
  if (!isValidClinicalStopReportedByRole(input.recordedBy)) {
    return { ok: false, reason: "invalid_recorded_by" };
  }

  const now = input.now ?? (() => new Date().toISOString());

  const event: ClinicalStopEvent = {
    reason: input.reason,
    recordedAt: now(),
    recordedBy: input.recordedBy,
    reviewRequired: true,
  };

  return { ok: true, event };
}
