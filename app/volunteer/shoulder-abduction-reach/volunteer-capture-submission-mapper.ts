/**
 * Maps an in-memory capture record to the browser-owned repetition submission contract.
 * Explicit allowlist — never spreads capture context into the request body.
 */

import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { ValidatedVolunteerRepetitionPayload } from "@/app/lib/research/volunteer-repetition-validation";

export function mapCaptureRecordToRepetitionSubmission(input: {
  record: ShoulderAbductionReachRepCaptureRecord;
  movementSessionId: string;
  clientSubmissionId: string;
}): ValidatedVolunteerRepetitionPayload {
  const { record, movementSessionId, clientSubmissionId } = input;
  const { context } = record;

  return {
    movementSessionId,
    clientSubmissionId,
    repetitionIndex: context.repetitionIndex,
    captureSchemaVersion: context.captureSchemaVersion,
    featureSchemaVersion: context.featureSchemaVersion,
    startedAtMs: context.startedAtMs,
    endedAtMs: context.endedAtMs,
    frames: record.frames,
    derivedFeatures: record.derivedFeatures,
  };
}

/** Keys that must never appear in a repetition submission body. */
export const FORBIDDEN_REPETITION_SUBMISSION_KEYS = [
  "participantId",
  "devSessionId",
  "repetitionId",
  "simulationCondition",
  "movementType",
  "side",
  "protocolCondition",
  "payloadHash",
  "collectionSessionId",
  "sessionToken",
  "context",
  "video",
  "image",
  "base64",
  "blob",
] as const;
