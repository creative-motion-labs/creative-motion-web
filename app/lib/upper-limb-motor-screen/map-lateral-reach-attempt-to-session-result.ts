/**
 * Maps a terminal Lateral Reach attempt into a session-results POST body.
 * Factual fields only — no new clinical scores or derived claims.
 */

import type { UpperLimbMovementAttemptResult } from "./types";
import type { UpperLimbSessionResultCreateRequest } from "./session-result-request-validation";
import { validateUpperLimbMotorScreenSessionResultRequest } from "./session-result-request-validation";

function longestProtectivePauseMs(attempt: UpperLimbMovementAttemptResult): number {
  let longest = 0;
  for (const event of attempt.protectivePauseEvents) {
    if (event.endedAtMs === null) continue;
    const duration = event.endedAtMs - event.startedAtMs;
    if (duration > longest) longest = duration;
  }
  return longest;
}

export function buildLateralReachSessionResultRequest(
  assignmentId: string,
  attempt: UpperLimbMovementAttemptResult,
): UpperLimbSessionResultCreateRequest {
  return {
    assignmentId,
    taskCompletion: [
      {
        taskId: attempt.taskId,
        testedSide: attempt.testedSide,
        completionState: attempt.completionState,
      },
    ],
    attempts: [attempt],
    clinicalStopEvents: [],
    overallTrackingQuality: attempt.trackingQualitySummary,
    longestPauseGapMs: longestProtectivePauseMs(attempt),
    trunkCompensationObserved: attempt.trunkDisplacementObserved,
    asymmetryNotes: [],
  };
}

export function assertLateralReachSessionResultRequestValid(
  assignmentId: string,
  attempt: UpperLimbMovementAttemptResult,
): boolean {
  const request = buildLateralReachSessionResultRequest(assignmentId, attempt);
  return validateUpperLimbMotorScreenSessionResultRequest(request).ok;
}
