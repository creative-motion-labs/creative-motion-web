/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-capture-submission-mapper.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import {
  FORBIDDEN_REPETITION_SUBMISSION_KEYS,
  mapCaptureRecordToRepetitionSubmission,
} from "./volunteer-capture-submission-mapper";

function buildCaptureRecord(
  repetitionIndex: number,
): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: "local-participant",
      devSessionId: "local-session",
      repetitionIndex,
      repetitionId: `rep-${repetitionIndex}`,
      side: "right",
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1000 * repetitionIndex,
      endedAtMs: 2000 * repetitionIndex,
      simulationCondition: "NORMAL",
    },
    frames: [
      {
        relativeTimestampMs: 0,
        frameIndex: 0,
        joints: {
          right_shoulder: {
            landmark: { x: 0.5, y: 0.3 },
            confidence: { visibility: 0.9, present: true },
          },
        },
      },
    ],
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.1,
      peakShoulderAngleDegrees: 90,
      movementDurationMs: 1000,
      peakAngularVelocityDegPerSec: 45,
      trackingQuality: {
        framesTotal: 1,
        framesWithUsableAngle: 1,
        usableFrameRatio: 1,
        minCoreJointVisibility: 0.9,
      },
    },
  };
}

describe("volunteer-capture-submission-mapper", () => {
  it("maps only allowlisted repetition fields", () => {
    const movementSessionId = crypto.randomUUID();
    const clientSubmissionId = crypto.randomUUID();
    const record = buildCaptureRecord(1);

    const payload = mapCaptureRecordToRepetitionSubmission({
      record,
      movementSessionId,
      clientSubmissionId,
    });

    assert.deepEqual(Object.keys(payload).sort(), [
      "captureSchemaVersion",
      "clientSubmissionId",
      "derivedFeatures",
      "endedAtMs",
      "featureSchemaVersion",
      "frames",
      "movementSessionId",
      "repetitionIndex",
      "startedAtMs",
    ]);
    assert.equal(payload.movementSessionId, movementSessionId);
    assert.equal(payload.clientSubmissionId, clientSubmissionId);
    assert.equal(payload.repetitionIndex, 1);
    assert.equal(payload.frames.length, 1);
  });

  it("never includes forbidden identity or context fields", () => {
    const payload = mapCaptureRecordToRepetitionSubmission({
      record: buildCaptureRecord(2),
      movementSessionId: crypto.randomUUID(),
      clientSubmissionId: crypto.randomUUID(),
    });
    const serialized = JSON.stringify(payload);
    for (const key of FORBIDDEN_REPETITION_SUBMISSION_KEYS) {
      assert.doesNotMatch(serialized, new RegExp(`"${key}"`));
    }
  });
});
