/**
 * RASQ Interactive Shoulder — clinical movement-outcome request
 * validation (O1).
 *
 * Shape-only runtime validation for a future O2 API route's raw POST
 * body. Reuses isValidSessionState (the full SessionState union, not
 * just the outcome-eligible subset — a malformed sessionState and an
 * in-progress-but-well-formed one are distinguishable failure reasons)
 * so a caller gets a specific, honest rejection reason either way.
 *
 * Deliberately does NOT accept prescribedSide, providerId, patientId,
 * planId, or id from the request body — those are always
 * server-resolved from the plan_session row (prescribedSide) or the
 * authenticated session (ownership), never client input. This mirrors
 * the same allowlist discipline already established in
 * session-result-request-validation.ts.
 */
import { isValidSessionState } from "./movement-outcome-types";
import type { AssembleInteractiveShoulderMovementOutcomeInput } from "./movement-outcome-assembler";
import type {
  InteractionPerformance,
  InterpretedObservations,
  MeasuredMovementPerformance,
  MovementBlockResult,
  SessionBlockType,
} from "@/app/lib/session-orchestrator/types";

export type InteractiveShoulderMovementOutcomeRequestValidationFailure =
  | "invalid_request_body"
  | "invalid_plan_session_id"
  | "invalid_session_state"
  | "invalid_elapsed_seconds"
  | "invalid_block_counts"
  | "invalid_block_results";

export type InteractiveShoulderMovementOutcomeCreateRequest = Omit<
  AssembleInteractiveShoulderMovementOutcomeInput,
  "prescribedSide"
>;

export type InteractiveShoulderMovementOutcomeRequestValidationResult =
  | { ok: true; input: InteractiveShoulderMovementOutcomeCreateRequest }
  | { ok: false; reason: InteractiveShoulderMovementOutcomeRequestValidationFailure; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOVEMENT_BLOCK_COMPLETION_REASONS = [
  "duration",
  "validRepetitions",
  "holdDuration",
  "clinicianDefined",
  "manualCompletion",
  "blockTimeout",
  "movementInterrupted",
  "safetyStop",
] as const;

const FATIGUE_TRENDS = ["stable", "declining", "unknown"] as const;

const SESSION_BLOCK_TYPES = ["movement-target", "movement-pattern", "instructional"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => isFiniteNumber(item));
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; detail: string };

function validateInteractionPerformance(candidate: unknown, path: string): FieldResult<InteractionPerformance> {
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };
  if (!Number.isInteger(candidate.targetsContacted) || (candidate.targetsContacted as number) < 0) {
    return { ok: false, detail: `${path}.targetsContacted must be a non-negative integer` };
  }
  if (!Number.isInteger(candidate.patternsCompleted) || (candidate.patternsCompleted as number) < 0) {
    return { ok: false, detail: `${path}.patternsCompleted must be a non-negative integer` };
  }
  if (!isNumberArray(candidate.timingSamplesMs)) {
    return { ok: false, detail: `${path}.timingSamplesMs must be an array of numbers` };
  }
  if (
    candidate.responseConsistency !== null &&
    !(isFiniteNumber(candidate.responseConsistency) && candidate.responseConsistency >= 0 && candidate.responseConsistency <= 1)
  ) {
    return { ok: false, detail: `${path}.responseConsistency must be a number in [0,1] or null` };
  }
  if (!isFiniteNumber(candidate.participationDurationSeconds) || (candidate.participationDurationSeconds as number) < 0) {
    return { ok: false, detail: `${path}.participationDurationSeconds must be a non-negative number` };
  }
  return {
    ok: true,
    value: {
      targetsContacted: candidate.targetsContacted as number,
      patternsCompleted: candidate.patternsCompleted as number,
      timingSamplesMs: candidate.timingSamplesMs as number[],
      responseConsistency: candidate.responseConsistency as number | null,
      participationDurationSeconds: candidate.participationDurationSeconds as number,
    },
  };
}

function validateMeasuredMovementPerformance(candidate: unknown, path: string): FieldResult<MeasuredMovementPerformance> {
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };
  if (!Number.isInteger(candidate.validRepetitions) || (candidate.validRepetitions as number) < 0) {
    return { ok: false, detail: `${path}.validRepetitions must be a non-negative integer` };
  }
  if (!Number.isInteger(candidate.invalidRepetitions) || (candidate.invalidRepetitions as number) < 0) {
    return { ok: false, detail: `${path}.invalidRepetitions must be a non-negative integer` };
  }
  if (!isNumberArray(candidate.rangeValuesDegrees)) {
    return { ok: false, detail: `${path}.rangeValuesDegrees must be an array of numbers` };
  }
  if (!isFiniteNumberOrNull(candidate.holdDurationSeconds) || (typeof candidate.holdDurationSeconds === "number" && candidate.holdDurationSeconds < 0)) {
    return { ok: false, detail: `${path}.holdDurationSeconds must be a non-negative number or null` };
  }
  if (!isFiniteNumberOrNull(candidate.movementSpeed)) {
    return { ok: false, detail: `${path}.movementSpeed must be a number or null` };
  }
  if (!isFiniteNumberOrNull(candidate.returnControl)) {
    return { ok: false, detail: `${path}.returnControl must be a number or null` };
  }
  if (!isFiniteNumberOrNull(candidate.trackingConfidence)) {
    return { ok: false, detail: `${path}.trackingConfidence must be a number or null` };
  }
  return {
    ok: true,
    value: {
      validRepetitions: candidate.validRepetitions as number,
      invalidRepetitions: candidate.invalidRepetitions as number,
      rangeValuesDegrees: candidate.rangeValuesDegrees as number[],
      holdDurationSeconds: candidate.holdDurationSeconds as number | null,
      movementSpeed: candidate.movementSpeed as number | null,
      returnControl: candidate.returnControl as number | null,
      trackingConfidence: candidate.trackingConfidence as number | null,
    },
  };
}

function validateInterpretedObservations(candidate: unknown, path: string): FieldResult<InterpretedObservations> {
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };
  if (!Number.isInteger(candidate.compensationEvents) || (candidate.compensationEvents as number) < 0) {
    return { ok: false, detail: `${path}.compensationEvents must be a non-negative integer` };
  }
  if (!isStringArray(candidate.asymmetryObservations)) {
    return { ok: false, detail: `${path}.asymmetryObservations must be an array of strings` };
  }
  if (typeof candidate.fatigueTrend !== "string" || !(FATIGUE_TRENDS as readonly string[]).includes(candidate.fatigueTrend)) {
    return { ok: false, detail: `${path}.fatigueTrend is invalid` };
  }
  if (typeof candidate.reducedControl !== "boolean") {
    return { ok: false, detail: `${path}.reducedControl must be a boolean` };
  }
  if (!isStringArray(candidate.trackingLimitations)) {
    return { ok: false, detail: `${path}.trackingLimitations must be an array of strings` };
  }
  return {
    ok: true,
    value: {
      compensationEvents: candidate.compensationEvents as number,
      asymmetryObservations: candidate.asymmetryObservations as string[],
      fatigueTrend: candidate.fatigueTrend as InterpretedObservations["fatigueTrend"],
      reducedControl: candidate.reducedControl,
      trackingLimitations: candidate.trackingLimitations as string[],
    },
  };
}

/**
 * Exported (in addition to its use inside the top-level request
 * validator above) so the clinician read path (O3,
 * movement-outcome-report.ts) can defensively re-validate a persisted
 * block's shape without duplicating this same interaction/measured/
 * interpreted structural check. Read-only reuse — no change to what
 * this function accepts or rejects.
 */
export function validateMovementBlockResult(candidate: unknown, index: number): FieldResult<MovementBlockResult> {
  const path = `blockResults[${index}]`;
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };

  if (typeof candidate.blockId !== "string" || candidate.blockId.trim() === "") {
    return { ok: false, detail: `${path}.blockId is required` };
  }
  if (typeof candidate.movementId !== "string" || candidate.movementId.trim() === "") {
    return { ok: false, detail: `${path}.movementId is required` };
  }
  if (!isFiniteNumber(candidate.startedAtMs)) {
    return { ok: false, detail: `${path}.startedAtMs is required` };
  }
  if (!isFiniteNumberOrNull(candidate.completedAtMs)) {
    return { ok: false, detail: `${path}.completedAtMs must be a number or null` };
  }
  if (
    candidate.completionReason !== null &&
    !(MOVEMENT_BLOCK_COMPLETION_REASONS as readonly string[]).includes(candidate.completionReason as string)
  ) {
    return { ok: false, detail: `${path}.completionReason is invalid` };
  }

  // Both optional and purely descriptive — echoed straight from the
  // client's own MovementBlock definition, exactly like blockId/
  // movementId above. Never used for ownership or authority, so this
  // does not need the same server-resolution discipline as
  // prescribedSide/providerId/patientId.
  if (
    candidate.blockType !== undefined &&
    !(SESSION_BLOCK_TYPES as readonly string[]).includes(candidate.blockType as string)
  ) {
    return { ok: false, detail: `${path}.blockType is invalid` };
  }
  if (candidate.title !== undefined && typeof candidate.title !== "string") {
    return { ok: false, detail: `${path}.title must be a string` };
  }

  const interaction = validateInteractionPerformance(candidate.interaction, `${path}.interaction`);
  if (!interaction.ok) return interaction;
  const measured = validateMeasuredMovementPerformance(candidate.measured, `${path}.measured`);
  if (!measured.ok) return measured;
  const interpreted = validateInterpretedObservations(candidate.interpreted, `${path}.interpreted`);
  if (!interpreted.ok) return interpreted;

  return {
    ok: true,
    value: {
      blockId: candidate.blockId,
      movementId: candidate.movementId,
      startedAtMs: candidate.startedAtMs as number,
      completedAtMs: candidate.completedAtMs as number | null,
      completionReason: candidate.completionReason as MovementBlockResult["completionReason"],
      ...(candidate.blockType !== undefined
        ? { blockType: candidate.blockType as SessionBlockType }
        : {}),
      ...(candidate.title !== undefined ? { title: candidate.title as string } : {}),
      interaction: interaction.value,
      measured: measured.value,
      interpreted: interpreted.value,
    },
  };
}

const REQUEST_ALLOWED_KEYS = new Set([
  "planSessionId",
  "sessionState",
  "totalElapsedSeconds",
  "blocksCompleted",
  "blocksTotal",
  "blockResults",
]);

export function validateInteractiveShoulderMovementOutcomeRequest(
  candidate: unknown,
): InteractiveShoulderMovementOutcomeRequestValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_request_body", detail: "request body must be an object" };
  }

  for (const key of Object.keys(candidate)) {
    if (!REQUEST_ALLOWED_KEYS.has(key)) {
      return { ok: false, reason: "invalid_request_body", detail: `Unknown request field: ${key}.` };
    }
  }

  if (typeof candidate.planSessionId !== "string" || !UUID_RE.test(candidate.planSessionId)) {
    return { ok: false, reason: "invalid_plan_session_id", detail: "planSessionId must be a valid UUID" };
  }

  if (!isValidSessionState(candidate.sessionState)) {
    return { ok: false, reason: "invalid_session_state" };
  }

  if (!isFiniteNumber(candidate.totalElapsedSeconds) || candidate.totalElapsedSeconds < 0) {
    return { ok: false, reason: "invalid_elapsed_seconds" };
  }

  if (
    !Number.isInteger(candidate.blocksCompleted) ||
    !Number.isInteger(candidate.blocksTotal) ||
    (candidate.blocksCompleted as number) < 0 ||
    (candidate.blocksTotal as number) < 0 ||
    (candidate.blocksCompleted as number) > (candidate.blocksTotal as number)
  ) {
    return { ok: false, reason: "invalid_block_counts" };
  }

  if (!Array.isArray(candidate.blockResults)) {
    return { ok: false, reason: "invalid_block_results", detail: "blockResults must be an array" };
  }
  const blockResults: MovementBlockResult[] = [];
  for (const [index, rawBlock] of candidate.blockResults.entries()) {
    const result = validateMovementBlockResult(rawBlock, index);
    if (!result.ok) return { ok: false, reason: "invalid_block_results", detail: result.detail };
    blockResults.push(result.value);
  }

  return {
    ok: true,
    input: {
      planSessionId: candidate.planSessionId,
      sessionState: candidate.sessionState,
      totalElapsedSeconds: candidate.totalElapsedSeconds,
      blocksCompleted: candidate.blocksCompleted as number,
      blocksTotal: candidate.blocksTotal as number,
      blockResults,
    },
  };
}
