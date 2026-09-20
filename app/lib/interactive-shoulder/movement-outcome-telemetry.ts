/**
 * RASQ Interactive Shoulder — outcome submission telemetry (O5).
 *
 * Observability-only. No behavior change to the submission/persistence
 * contract this wraps — these functions are called alongside existing
 * failure branches, never in place of them, and never change what a
 * caller returns or how a caller retries (fire-and-forget submission
 * is unchanged; no retry/backoff is added here).
 *
 * Safe-metadata only, matching this codebase's existing Sentry
 * `beforeSend` privacy discipline (app/lib/sentry/before-send.ts):
 * never a token, never a patient/provider/plan/plan-session id, never
 * the request body, never the outcome payload (measured/interaction/
 * interpreted block data). Only a closed-enum failure reason and a
 * numeric HTTP status ever leave this module.
 */
import * as Sentry from "@sentry/nextjs";

const SERVER_FAILURE_MESSAGE = "interactive_shoulder_outcome.server_failure";
const CLIENT_FAILURE_MESSAGE = "interactive_shoulder_outcome.client_submission_failed";

/**
 * The two genuinely unexpected (5xx-class) server-side failure branches
 * in POST /api/patient/interactive-shoulder-outcomes — not the routine,
 * expected 400/404/429/503 responses (invalid body, unknown token,
 * ownership mismatch, rate limit, disabled flag), which are normal
 * request outcomes and already have their own client-facing responses.
 */
export type InteractiveShoulderOutcomeServerFailureReason =
  | "patient_access_resolution_failed"
  | "persistence_insert_failed";

export type InteractiveShoulderOutcomeServerFailureEvent = {
  reason: InteractiveShoulderOutcomeServerFailureReason;
  httpStatus: number;
};

/** Server-side capture — call alongside (never instead of) the existing console.error/response. */
export function recordInteractiveShoulderOutcomeServerFailure(
  event: InteractiveShoulderOutcomeServerFailureEvent,
): void {
  Sentry.captureMessage(SERVER_FAILURE_MESSAGE, {
    level: "error",
    tags: {
      feature: "interactive-shoulder-outcomes",
      reason: event.reason,
    },
    extra: {
      httpStatus: event.httpStatus,
    },
  });
}

export type InteractiveShoulderOutcomeClientFailureEvent = {
  /** 0 = network failure before any response existed; otherwise the real HTTP status. */
  status: number;
};

/** Client-side capture — call alongside (never instead of) the existing fire-and-forget failure handling. */
export function recordInteractiveShoulderOutcomeClientFailure(
  event: InteractiveShoulderOutcomeClientFailureEvent,
): void {
  Sentry.captureMessage(CLIENT_FAILURE_MESSAGE, {
    level: "error",
    tags: {
      feature: "interactive-shoulder-outcomes",
    },
    extra: {
      status: event.status,
    },
  });
}
