/**
 * RASQ Interactive Shoulder — clinical movement-outcome assembler (O1).
 *
 * Policy-neutral assembly only: copies the caller-supplied inputs into
 * the canonical InteractiveShoulderMovementOutcomeSnapshot shape. Makes
 * no clinical judgment, computes no derived score, and does not decide
 * whether prescribedSide is correct — the caller resolves that
 * server-side (see movement-outcome-persistence.ts) and passes the
 * already-resolved value in. This function's only gate is the
 * sessionState eligibility check below; everything else is a
 * deep, non-aliasing copy.
 */
import {
  isInteractiveShoulderOutcomeEligibleSessionState,
  INTERACTIVE_SHOULDER_MOVEMENT_OUTCOME_SCHEMA_VERSION,
  type InteractiveShoulderMovementOutcomeSnapshot,
  type InteractiveShoulderOutcomeEligibleSessionState,
} from "./movement-outcome-types";
import type { ClinicalPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side";
import type {
  InteractionPerformance,
  InterpretedObservations,
  MeasuredMovementPerformance,
  MovementBlockResult,
  SessionState,
} from "@/app/lib/session-orchestrator/types";

export type AssembleInteractiveShoulderMovementOutcomeInput = {
  planSessionId: string;
  /** Already server-resolved — never a raw client value. */
  prescribedSide: ClinicalPrescribedSide | null;
  sessionState: SessionState;
  totalElapsedSeconds: number;
  blocksCompleted: number;
  blocksTotal: number;
  blockResults: MovementBlockResult[];
};

export type AssembleInteractiveShoulderMovementOutcomeFailure =
  | "invalid_plan_session_id"
  | "session_not_eligible_for_outcome"
  | "invalid_elapsed_seconds"
  | "invalid_block_counts";

export type AssembleInteractiveShoulderMovementOutcomeResult =
  | { ok: true; snapshot: InteractiveShoulderMovementOutcomeSnapshot }
  | { ok: false; reason: AssembleInteractiveShoulderMovementOutcomeFailure; detail?: string };

function copyInteraction(source: InteractionPerformance): InteractionPerformance {
  return { ...source, timingSamplesMs: [...source.timingSamplesMs] };
}

function copyMeasured(source: MeasuredMovementPerformance): MeasuredMovementPerformance {
  return { ...source, rangeValuesDegrees: [...source.rangeValuesDegrees] };
}

function copyInterpreted(source: InterpretedObservations): InterpretedObservations {
  return {
    ...source,
    asymmetryObservations: [...source.asymmetryObservations],
    trackingLimitations: [...source.trackingLimitations],
  };
}

function copyBlockResult(source: MovementBlockResult): MovementBlockResult {
  return {
    ...source,
    interaction: copyInteraction(source.interaction),
    measured: copyMeasured(source.measured),
    interpreted: copyInterpreted(source.interpreted),
  };
}

/**
 * Assembles a clinical movement-outcome snapshot. Returns ok:false —
 * never throws, never silently substitutes a value — when the session
 * has not genuinely ended (see
 * INTERACTIVE_SHOULDER_OUTCOME_ELIGIBLE_SESSION_STATES) or when the
 * numeric session facts are internally inconsistent. This is the
 * single gate standing between "camera started" / "readiness reached"
 * / "cancelled mid-session" and a persisted clinical record — a
 * caller must never bypass it to force a snapshot for an ineligible
 * session.
 */
export function assembleInteractiveShoulderMovementOutcomeSnapshot(
  input: AssembleInteractiveShoulderMovementOutcomeInput,
): AssembleInteractiveShoulderMovementOutcomeResult {
  if (typeof input.planSessionId !== "string" || input.planSessionId.trim() === "") {
    return { ok: false, reason: "invalid_plan_session_id" };
  }

  if (!isInteractiveShoulderOutcomeEligibleSessionState(input.sessionState)) {
    return {
      ok: false,
      reason: "session_not_eligible_for_outcome",
      detail: `sessionState "${input.sessionState}" is not a terminal, outcome-eligible state`,
    };
  }
  const sessionState: InteractiveShoulderOutcomeEligibleSessionState = input.sessionState;

  if (!Number.isFinite(input.totalElapsedSeconds) || input.totalElapsedSeconds < 0) {
    return { ok: false, reason: "invalid_elapsed_seconds" };
  }

  if (
    !Number.isInteger(input.blocksCompleted) ||
    !Number.isInteger(input.blocksTotal) ||
    input.blocksCompleted < 0 ||
    input.blocksTotal < 0 ||
    input.blocksCompleted > input.blocksTotal
  ) {
    return { ok: false, reason: "invalid_block_counts" };
  }

  const snapshot: InteractiveShoulderMovementOutcomeSnapshot = {
    planSessionId: input.planSessionId,
    prescribedSide: input.prescribedSide,
    sessionState,
    totalElapsedSeconds: input.totalElapsedSeconds,
    blocksCompleted: input.blocksCompleted,
    blocksTotal: input.blocksTotal,
    blockResults: input.blockResults.map(copyBlockResult),
    schemaVersion: INTERACTIVE_SHOULDER_MOVEMENT_OUTCOME_SCHEMA_VERSION,
  };

  return { ok: true, snapshot };
}
