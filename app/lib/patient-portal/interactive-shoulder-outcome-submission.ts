/**
 * RASQ patient portal — Interactive Shoulder movement-outcome
 * submission client (O2).
 *
 * Mirrors submitPatientSessionComplete's exact fetch/error-mapping
 * shape (catalog-session-playback.ts) — same try/catch structure, same
 * "network failure before a response exists" handling — for the
 * completely separate /api/patient/interactive-shoulder-outcomes
 * endpoint. This call is independent of, and must never block or be
 * blocked by, the patient-reported session-complete submission.
 */
import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import {
  recordInteractiveShoulderOutcomeClientFailure,
  type InteractiveShoulderOutcomeClientFailureEvent,
} from "@/app/lib/interactive-shoulder/movement-outcome-telemetry";

export type InteractiveShoulderOutcomeSubmissionStatus = "idle" | "submitting" | "submitted";

/**
 * Pure decision extracted from CatalogPatientSessionPlayback's
 * movementOutcomeSubmissionRef guard so it is unit-testable without a
 * DOM/React renderer (none exists in this repo's test infra). Only
 * "idle" may start a submission attempt — a concurrent "submitting"
 * attempt is never duplicated, and a completed "submitted" attempt is
 * never resubmitted, however many times a caller (e.g. a repeated
 * onSessionComplete invocation, or a re-render) asks.
 */
export function shouldSubmitInteractiveShoulderOutcome(
  status: InteractiveShoulderOutcomeSubmissionStatus,
): boolean {
  return status === "idle";
}

export type SubmitInteractiveShoulderOutcomeInput = {
  token: string;
  planSessionId: string;
  snapshot: InteractiveShoulderSessionCompletionSnapshot;
};

export type SubmitInteractiveShoulderOutcomeResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string; status: number };

export const INTERACTIVE_SHOULDER_OUTCOME_NETWORK_ERROR =
  "Movement outcome could not be saved. It will not block your session.";

/**
 * Builds the exact request body the API expects — only the real
 * runtime facts (sessionState, elapsed time, block results) plus
 * planSessionId/token. Never includes providerId, patientId, planId,
 * or prescribedSide; those are always server-resolved.
 */
export function buildInteractiveShoulderOutcomeRequestBody(
  input: SubmitInteractiveShoulderOutcomeInput,
): Record<string, unknown> {
  return {
    token: input.token,
    planSessionId: input.planSessionId,
    sessionState: input.snapshot.sessionState,
    totalElapsedSeconds: input.snapshot.sessionElapsedSeconds,
    blocksCompleted: input.snapshot.accumulatedBlockResults.length,
    blocksTotal: input.snapshot.accumulatedBlockResults.length,
    blockResults: input.snapshot.accumulatedBlockResults,
  };
}

/**
 * Statuses the server returns for expected, routine outcomes of this
 * endpoint — not failures worth alerting on: 400 (invalid body/shape),
 * 404 (unknown token, ownership mismatch — never distinguished, by
 * design), 429 (rate limited), 503 (feature flag intentionally
 * disabled — the normal kill-switch state while
 * RASQ_INTERACTIVE_SHOULDER_OUTCOME_SUBMISSION_V1 is off). A completed
 * session while the flag is off is expected behavior, not an incident;
 * telemetry must not fire for it.
 */
const ROUTINE_CLIENT_RESPONSE_STATUSES = new Set([400, 404, 429, 503]);

/**
 * recordClientFailure is observability only (O5) — safe metadata (HTTP
 * status only, never the token/planSessionId/snapshot in `input`, never
 * the server's response body). Injectable for tests; defaults to the
 * real Sentry capture. Fires only for a network failure (status 0) or
 * a non-2xx response whose status is not in
 * ROUTINE_CLIENT_RESPONSE_STATUSES — i.e. a genuinely unexpected
 * failure, not an expected/routine response. Does not change the
 * return shape below or add any retry — the fire-and-forget behavior
 * this function's caller relies on is unchanged.
 */
export async function submitInteractiveShoulderOutcome(
  input: SubmitInteractiveShoulderOutcomeInput,
  fetchImpl: typeof fetch = fetch,
  recordClientFailure: (event: InteractiveShoulderOutcomeClientFailureEvent) => void = recordInteractiveShoulderOutcomeClientFailure,
): Promise<SubmitInteractiveShoulderOutcomeResult> {
  try {
    const res = await fetchImpl("/api/patient/interactive-shoulder-outcomes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInteractiveShoulderOutcomeRequestBody(input)),
    });

    const body = (await res.json().catch(() => ({}))) as { created?: boolean; error?: string };

    if (!res.ok) {
      if (!ROUTINE_CLIENT_RESPONSE_STATUSES.has(res.status)) {
        recordClientFailure({ status: res.status });
      }
      return {
        ok: false,
        error: body.error ?? INTERACTIVE_SHOULDER_OUTCOME_NETWORK_ERROR,
        status: res.status,
      };
    }

    return { ok: true, created: body.created ?? false };
  } catch {
    recordClientFailure({ status: 0 });
    return { ok: false, error: INTERACTIVE_SHOULDER_OUTCOME_NETWORK_ERROR, status: 0 };
  }
}
