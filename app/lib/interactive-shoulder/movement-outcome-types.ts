/**
 * RASQ Interactive Shoulder — clinical movement-outcome domain types (O1).
 *
 * Deliberately reuses, rather than duplicates, the existing
 * measured/interaction/interpreted separation already defined in
 * session-orchestrator/types.ts (MovementBlockResult and its three
 * sub-shapes) and the existing server-owned prescribed-side vocabulary
 * in clinical/clinical-prescribed-side.ts. Nothing here invents a new
 * clinical score, diagnostic field, or parallel laterality concept.
 *
 * No id field: identity is a persistence concern (the DB row's
 * primary key), not a business-content concern — see
 * movement-outcome-persistence.ts's toInteractiveShoulderMovementOutcomePublic.
 */
import type { ClinicalPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side";
import type { MovementBlockResult, SessionState } from "@/app/lib/session-orchestrator/types";

export const INTERACTIVE_SHOULDER_MOVEMENT_OUTCOME_SCHEMA_VERSION =
  "interactive-shoulder-movement-outcome/v1" as const;

/**
 * The only SessionState value a movement outcome may legitimately be
 * recorded under — a fully completed session. Per the approved MVP
 * clinical persistence contract, no other terminal or partial state is
 * eligible: "stopped" (manually/safety-stopped), "error" (a technical
 * failure, not a movement outcome), and every mid-session state (idle,
 * preparing, calibrating, ready, active, resting, transitioning,
 * paused, safetyHold) must never produce a row. A cancelled, stopped,
 * errored, safety-held, or otherwise partial session cannot be
 * persisted through this contract as a completed movement outcome —
 * there is no separate partial-session persistence path.
 *
 * Correction history: an earlier draft of this module additionally
 * allowed "stopped" (reasoning that a manually-stopped session still
 * produced real partial data worth recording). That was rejected in
 * review — the approved design requires runtime submission only after
 * full-session completion — and reduced to "completed" only.
 */
export const INTERACTIVE_SHOULDER_OUTCOME_ELIGIBLE_SESSION_STATES = ["completed"] as const;
export type InteractiveShoulderOutcomeEligibleSessionState =
  (typeof INTERACTIVE_SHOULDER_OUTCOME_ELIGIBLE_SESSION_STATES)[number];

export function isInteractiveShoulderOutcomeEligibleSessionState(
  value: unknown,
): value is InteractiveShoulderOutcomeEligibleSessionState {
  return (
    typeof value === "string" &&
    (INTERACTIVE_SHOULDER_OUTCOME_ELIGIBLE_SESSION_STATES as readonly string[]).includes(value)
  );
}

/**
 * The full set of SessionState values, for validating that an
 * out-of-range/malformed sessionState is rejected with a clear reason
 * rather than silently treated as "not eligible" the same way an
 * unrelated string would be. SessionState itself has no runtime
 * companion array in session-orchestrator/types.ts (it is a pure TS
 * union there); this mirrors it locally as a validation-boundary
 * concern rather than editing that shared file.
 */
export const ALL_SESSION_STATES = [
  "idle",
  "preparing",
  "calibrating",
  "ready",
  "active",
  "resting",
  "transitioning",
  "paused",
  "safetyHold",
  "completed",
  "stopped",
  "error",
] as const satisfies readonly SessionState[];

export function isValidSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && (ALL_SESSION_STATES as readonly string[]).includes(value);
}

/**
 * The persisted clinical movement-outcome snapshot for one plan
 * session. blockResults reuses MovementBlockResult verbatim — its own
 * interaction/measured/interpreted split is not re-derived or
 * re-labeled here.
 */
export type InteractiveShoulderMovementOutcomeSnapshot = {
  planSessionId: string;
  prescribedSide: ClinicalPrescribedSide | null;
  sessionState: InteractiveShoulderOutcomeEligibleSessionState;
  totalElapsedSeconds: number;
  blocksCompleted: number;
  blocksTotal: number;
  blockResults: MovementBlockResult[];
  schemaVersion: string;
};
