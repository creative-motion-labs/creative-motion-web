/**
 * RASQ Upper-Limb Motor Screen — session-result creation request validation.
 *
 * Shape-only runtime validation of the raw POST body for
 * POST /api/upper-limb-motor-screen/session-results. Closed-enum and
 * type checks only, reusing every guard already defined in types.ts —
 * no new clinical judgment, no plausibility checks on any numeric
 * value, no aggregation or derivation, no non-empty-array requirement
 * (matching assembleUpperLimbMotorScreenSessionResult's own explicit
 * policy-neutral stance). id and status are never accepted here — the
 * route supplies both server-side.
 */

import {
  isRecord,
  isSafetyVocabularyFree,
  isValidClinicalStopReason,
  isValidClinicalStopReportedByRole,
  isValidProtectivePauseOutcome,
  isValidProtectivePauseReason,
  isValidProtectivePauseResumeActor,
  isValidUpperLimbAttemptCompletionState,
  isValidUpperLimbSide,
  isValidUpperLimbTaskId,
  type ClinicalStopEvent,
  type ProtectivePauseEvent,
  type UpperLimbMovementAttemptResult,
  type UpperLimbTaskCompletionSummary,
} from "./types";
import type { AssembleUpperLimbMotorScreenSessionResultInput } from "./session-result-assembler";

export type UpperLimbSessionResultRequestValidationFailure =
  | "invalid_request_body"
  | "invalid_assignment_id"
  | "invalid_task_completion"
  | "invalid_attempt"
  | "invalid_clinical_stop_event"
  | "invalid_overall_tracking_quality"
  | "invalid_longest_pause_gap_ms"
  | "invalid_trunk_compensation_observed"
  | "invalid_asymmetry_notes"
  | "forbidden_safety_vocabulary";

export type UpperLimbSessionResultCreateRequest = Omit<
  AssembleUpperLimbMotorScreenSessionResultInput,
  "id" | "status"
>;

export type UpperLimbSessionResultRequestValidationResult =
  | { ok: true; input: UpperLimbSessionResultCreateRequest }
  | { ok: false; reason: UpperLimbSessionResultRequestValidationFailure; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const TRACKING_QUALITY_VALUES = ["good", "fair", "poor", "unknown"] as const;
type TrackingQuality = (typeof TRACKING_QUALITY_VALUES)[number];
function isValidTrackingQuality(value: unknown): value is TrackingQuality {
  return typeof value === "string" && (TRACKING_QUALITY_VALUES as readonly string[]).includes(value);
}

type FieldResult<T> = { ok: true; value: T } | { ok: false; detail: string };

function validateTaskCompletionSummary(candidate: unknown, index: number): FieldResult<UpperLimbTaskCompletionSummary> {
  const path = `taskCompletion[${index}]`;
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };
  if (!isValidUpperLimbTaskId(candidate.taskId)) {
    return { ok: false, detail: `${path}.taskId is invalid` };
  }
  if (!isValidUpperLimbSide(candidate.testedSide)) {
    return { ok: false, detail: `${path}.testedSide is invalid` };
  }
  if (!isValidUpperLimbAttemptCompletionState(candidate.completionState)) {
    return { ok: false, detail: `${path}.completionState is invalid` };
  }
  return {
    ok: true,
    value: {
      taskId: candidate.taskId,
      testedSide: candidate.testedSide,
      completionState: candidate.completionState,
    },
  };
}

function validateProtectivePauseEvent(candidate: unknown, path: string): FieldResult<ProtectivePauseEvent> {
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };
  if (!isValidProtectivePauseReason(candidate.reason)) {
    return { ok: false, detail: `${path}.reason is invalid` };
  }
  if (typeof candidate.startedAtMs !== "number") {
    return { ok: false, detail: `${path}.startedAtMs is required` };
  }
  if (!isNumberOrNull(candidate.endedAtMs)) {
    return { ok: false, detail: `${path}.endedAtMs must be number or null` };
  }
  if (!isValidProtectivePauseOutcome(candidate.outcome)) {
    return { ok: false, detail: `${path}.outcome is invalid` };
  }
  if (!isStringOrNull(candidate.readinessConfirmedAt)) {
    return { ok: false, detail: `${path}.readinessConfirmedAt must be string or null` };
  }
  if (candidate.resumedBy !== null && !isValidProtectivePauseResumeActor(candidate.resumedBy)) {
    return { ok: false, detail: `${path}.resumedBy must be a valid actor or null` };
  }
  const resumedBy = candidate.resumedBy === null ? null : candidate.resumedBy;
  return {
    ok: true,
    value: {
      reason: candidate.reason,
      startedAtMs: candidate.startedAtMs,
      endedAtMs: candidate.endedAtMs,
      outcome: candidate.outcome,
      readinessConfirmedAt: candidate.readinessConfirmedAt,
      resumedBy,
    },
  };
}

function validateAttempt(candidate: unknown, index: number): FieldResult<UpperLimbMovementAttemptResult> {
  const path = `attempts[${index}]`;
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };

  if (typeof candidate.attemptIndex !== "number") {
    return { ok: false, detail: `${path}.attemptIndex is required` };
  }
  if (!isValidUpperLimbTaskId(candidate.taskId)) {
    return { ok: false, detail: `${path}.taskId is invalid` };
  }
  if (!isValidUpperLimbSide(candidate.testedSide)) {
    return { ok: false, detail: `${path}.testedSide is invalid` };
  }
  if (typeof candidate.startedAtMs !== "number") {
    return { ok: false, detail: `${path}.startedAtMs is required` };
  }
  if (!isNumberOrNull(candidate.completedAtMs)) {
    return { ok: false, detail: `${path}.completedAtMs must be number or null` };
  }
  if (!isValidUpperLimbAttemptCompletionState(candidate.completionState)) {
    return { ok: false, detail: `${path}.completionState is invalid` };
  }
  if (!isBooleanOrNull(candidate.targetReached)) {
    return { ok: false, detail: `${path}.targetReached must be boolean or null` };
  }
  if (!isBooleanOrNull(candidate.dwellConfirmed)) {
    return { ok: false, detail: `${path}.dwellConfirmed must be boolean or null` };
  }
  if (!isBooleanOrNull(candidate.returnToStartCompleted)) {
    return { ok: false, detail: `${path}.returnToStartCompleted must be boolean or null` };
  }
  if (!isNumberOrNull(candidate.reachTimeMs)) {
    return { ok: false, detail: `${path}.reachTimeMs must be number or null` };
  }
  if (!isNumberOrNull(candidate.returnTimeMs)) {
    return { ok: false, detail: `${path}.returnTimeMs must be number or null` };
  }
  if (!isNumberOrNull(candidate.totalMovementTimeMs)) {
    return { ok: false, detail: `${path}.totalMovementTimeMs must be number or null` };
  }
  if (!isNumberOrNull(candidate.normalizedPathLength)) {
    return { ok: false, detail: `${path}.normalizedPathLength must be number or null` };
  }
  if (!isNumberOrNull(candidate.pathEfficiency)) {
    return { ok: false, detail: `${path}.pathEfficiency must be number or null` };
  }
  if (!isNumberOrNull(candidate.peakShoulderAngleDeg)) {
    return { ok: false, detail: `${path}.peakShoulderAngleDeg must be number or null` };
  }
  if (!isNumberOrNull(candidate.peakElbowExtensionDeg)) {
    return { ok: false, detail: `${path}.peakElbowExtensionDeg must be number or null` };
  }
  if (!isBooleanOrNull(candidate.trunkDisplacementObserved)) {
    return { ok: false, detail: `${path}.trunkDisplacementObserved must be boolean or null` };
  }
  if (!isBooleanOrNull(candidate.withinConfiguredLimitThroughout)) {
    return { ok: false, detail: `${path}.withinConfiguredLimitThroughout must be boolean or null` };
  }
  if (!isValidTrackingQuality(candidate.trackingQualitySummary)) {
    return { ok: false, detail: `${path}.trackingQualitySummary is invalid` };
  }
  if (typeof candidate.protectivePauseCount !== "number") {
    return { ok: false, detail: `${path}.protectivePauseCount is required` };
  }
  if (typeof candidate.protectivePauseDurationMs !== "number") {
    return { ok: false, detail: `${path}.protectivePauseDurationMs is required` };
  }
  if (!Array.isArray(candidate.protectivePauseEvents)) {
    return { ok: false, detail: `${path}.protectivePauseEvents must be an array` };
  }
  const protectivePauseEvents: ProtectivePauseEvent[] = [];
  for (const [eventIndex, rawEvent] of candidate.protectivePauseEvents.entries()) {
    const eventResult = validateProtectivePauseEvent(rawEvent, `${path}.protectivePauseEvents[${eventIndex}]`);
    if (!eventResult.ok) return eventResult;
    protectivePauseEvents.push(eventResult.value);
  }
  if (!isStringArray(candidate.factualNotes)) {
    return { ok: false, detail: `${path}.factualNotes must be an array of strings` };
  }

  return {
    ok: true,
    value: {
      attemptIndex: candidate.attemptIndex,
      taskId: candidate.taskId,
      testedSide: candidate.testedSide,
      startedAtMs: candidate.startedAtMs,
      completedAtMs: candidate.completedAtMs,
      completionState: candidate.completionState,
      targetReached: candidate.targetReached,
      dwellConfirmed: candidate.dwellConfirmed,
      returnToStartCompleted: candidate.returnToStartCompleted,
      reachTimeMs: candidate.reachTimeMs,
      returnTimeMs: candidate.returnTimeMs,
      totalMovementTimeMs: candidate.totalMovementTimeMs,
      normalizedPathLength: candidate.normalizedPathLength,
      pathEfficiency: candidate.pathEfficiency,
      peakShoulderAngleDeg: candidate.peakShoulderAngleDeg,
      peakElbowExtensionDeg: candidate.peakElbowExtensionDeg,
      trunkDisplacementObserved: candidate.trunkDisplacementObserved,
      withinConfiguredLimitThroughout: candidate.withinConfiguredLimitThroughout,
      trackingQualitySummary: candidate.trackingQualitySummary,
      protectivePauseCount: candidate.protectivePauseCount,
      protectivePauseDurationMs: candidate.protectivePauseDurationMs,
      protectivePauseEvents,
      factualNotes: candidate.factualNotes,
    },
  };
}

function validateClinicalStopEvent(candidate: unknown, index: number): FieldResult<ClinicalStopEvent> {
  const path = `clinicalStopEvents[${index}]`;
  if (!isRecord(candidate)) return { ok: false, detail: `${path} must be an object` };
  if (!isValidClinicalStopReason(candidate.reason)) {
    return { ok: false, detail: `${path}.reason is invalid` };
  }
  if (typeof candidate.recordedAt !== "string" || !candidate.recordedAt.trim()) {
    return { ok: false, detail: `${path}.recordedAt is required` };
  }
  if (!isValidClinicalStopReportedByRole(candidate.recordedBy)) {
    return { ok: false, detail: `${path}.recordedBy is invalid` };
  }
  if (candidate.reviewRequired !== true) {
    return { ok: false, detail: `${path}.reviewRequired must be true` };
  }
  return {
    ok: true,
    value: {
      reason: candidate.reason,
      recordedAt: candidate.recordedAt,
      recordedBy: candidate.recordedBy,
      reviewRequired: true,
    },
  };
}

export function validateUpperLimbMotorScreenSessionResultRequest(
  candidate: unknown,
): UpperLimbSessionResultRequestValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_request_body", detail: "request body must be an object" };
  }

  if (!isSafetyVocabularyFree(candidate)) {
    return { ok: false, reason: "forbidden_safety_vocabulary" };
  }

  if (typeof candidate.assignmentId !== "string" || !UUID_RE.test(candidate.assignmentId)) {
    return { ok: false, reason: "invalid_assignment_id", detail: "assignmentId must be a valid UUID" };
  }

  if (!Array.isArray(candidate.taskCompletion)) {
    return { ok: false, reason: "invalid_task_completion", detail: "taskCompletion must be an array" };
  }
  const taskCompletion: UpperLimbTaskCompletionSummary[] = [];
  for (const [index, rawEntry] of candidate.taskCompletion.entries()) {
    const result = validateTaskCompletionSummary(rawEntry, index);
    if (!result.ok) return { ok: false, reason: "invalid_task_completion", detail: result.detail };
    taskCompletion.push(result.value);
  }

  if (!Array.isArray(candidate.attempts)) {
    return { ok: false, reason: "invalid_attempt", detail: "attempts must be an array" };
  }
  const attempts: UpperLimbMovementAttemptResult[] = [];
  for (const [index, rawAttempt] of candidate.attempts.entries()) {
    const result = validateAttempt(rawAttempt, index);
    if (!result.ok) return { ok: false, reason: "invalid_attempt", detail: result.detail };
    attempts.push(result.value);
  }

  if (!Array.isArray(candidate.clinicalStopEvents)) {
    return { ok: false, reason: "invalid_clinical_stop_event", detail: "clinicalStopEvents must be an array" };
  }
  const clinicalStopEvents: ClinicalStopEvent[] = [];
  for (const [index, rawEvent] of candidate.clinicalStopEvents.entries()) {
    const result = validateClinicalStopEvent(rawEvent, index);
    if (!result.ok) return { ok: false, reason: "invalid_clinical_stop_event", detail: result.detail };
    clinicalStopEvents.push(result.value);
  }

  if (!isValidTrackingQuality(candidate.overallTrackingQuality)) {
    return { ok: false, reason: "invalid_overall_tracking_quality" };
  }

  if (typeof candidate.longestPauseGapMs !== "number") {
    return { ok: false, reason: "invalid_longest_pause_gap_ms" };
  }

  if (!isBooleanOrNull(candidate.trunkCompensationObserved)) {
    return { ok: false, reason: "invalid_trunk_compensation_observed" };
  }

  if (!isStringArray(candidate.asymmetryNotes)) {
    return { ok: false, reason: "invalid_asymmetry_notes" };
  }

  return {
    ok: true,
    input: {
      assignmentId: candidate.assignmentId,
      taskCompletion,
      attempts,
      clinicalStopEvents,
      overallTrackingQuality: candidate.overallTrackingQuality,
      longestPauseGapMs: candidate.longestPauseGapMs,
      trunkCompensationObserved: candidate.trunkCompensationObserved,
      asymmetryNotes: candidate.asymmetryNotes,
    },
  };
}
