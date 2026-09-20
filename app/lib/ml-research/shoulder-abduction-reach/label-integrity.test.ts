/**
 * Slice 2 label integrity — behavioral tests across capture resolution,
 * rater normalization, label persistence, and blindness boundaries.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/label-integrity.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { unlink } from "node:fs/promises";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import {
  resolveCaptureIdentityForLabel,
  readShoulderAbductionCaptureSessionForLabeling,
} from "./capture-reader";
import { readShoulderAbductionCaptureSessionLabelsForRater } from "./label-reader";
import {
  normalizeResearchRaterId,
  type ShoulderAbductionReachLabelRecord,
} from "./label-schema";
import {
  appendShoulderAbductionReachLabelLocally,
  resolveDevSessionLabelsJsonlPath,
} from "./local-label-writer";
import {
  appendShoulderAbductionReachRepRecordLocally,
  resolveDevSessionJsonlPath,
} from "./local-jsonl-writer";

const TEST_SESSION_ID = "test-fixture-label-integrity-do-not-use";

function captureRecord(side: "left" | "right", lineIndex: number): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: `participant-for-line-${lineIndex}`,
      devSessionId: TEST_SESSION_ID,
      repetitionIndex: 1,
      repetitionId: `${TEST_SESSION_ID}-shared-rep-id`,
      side,
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1000,
      endedAtMs: 2000,
    },
    frames: [{ relativeTimestampMs: 0, frameIndex: 0, joints: {} }],
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.5,
      peakShoulderAngleDegrees: 120,
      movementDurationMs: 1000,
      peakAngularVelocityDegPerSec: 500,
      trackingQuality: { framesTotal: 1, framesWithUsableAngle: 1, usableFrameRatio: 1 },
    },
  };
}

function labelRecord(
  sourceLineIndex: number,
  side: "left" | "right",
  raterId: string,
): ShoulderAbductionReachLabelRecord {
  return {
    labelSchemaVersion: "shoulder-abduction-label-schema-v1",
    datasetVersion: "shoulder-abduction-dataset-v1",
    devSessionId: TEST_SESSION_ID,
    sourceLineIndex,
    repetitionId: `${TEST_SESSION_ID}-shared-rep-id`,
    participantId: `participant-for-line-${sourceLineIndex}`,
    side,
    raterId,
    compensationLabel: "NO_COMPENSATION",
    exclusionFlag: null,
    raterConfidence: "high",
    note: "",
    labeledAtMs: Date.now(),
  };
}

after(async () => {
  await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
  await unlink(resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID)).catch(() => {});
});

describe("label integrity (integration)", () => {
  it("stamps participantId from server-side capture data only", async () => {
    await appendShoulderAbductionReachRepRecordLocally(captureRecord("right", 0));
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const resolved = await resolveCaptureIdentityForLabel({
      devSessionId: TEST_SESSION_ID,
      sourceLineIndex: reps[0].sourceLineIndex,
      repetitionId: reps[0].repetitionId,
      side: reps[0].side,
    });
    assert.equal(resolved?.participantId, "participant-for-line-0");
    assert.notEqual(resolved?.participantId, "forged-participant");
  });

  it("rater-facing payload remains blind to derived features and participantId", async () => {
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    const serialized = JSON.stringify(reps).toLowerCase();
    for (const forbidden of [
      "participantid",
      "participant-for-line",
      "derivedfeatures",
      "peakshoulderangledegrees",
      "peaknormalizedtrunkdriftratio",
      "simulationcondition",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden));
    }
  });

  it("matches labels for a rater using normalized raterId comparison", async () => {
    await appendShoulderAbductionReachLabelLocally(labelRecord(0, "right", " therapist-A "));
    const labels = await readShoulderAbductionCaptureSessionLabelsForRater(TEST_SESSION_ID, "therapist-A");
    assert.equal(labels.length, 1);
    assert.equal(labels[0].raterId, " therapist-A ");
  });

  it("does not merge distinct raters that differ only by case", async () => {
    await appendShoulderAbductionReachLabelLocally(labelRecord(0, "right", "Rater-A"));
    await appendShoulderAbductionReachLabelLocally(labelRecord(0, "right", "rater-a"));

    const upperLabels = await readShoulderAbductionCaptureSessionLabelsForRater(TEST_SESSION_ID, "Rater-A");
    const lowerLabels = await readShoulderAbductionCaptureSessionLabelsForRater(TEST_SESSION_ID, "rater-a");
    assert.equal(upperLabels.length, 1);
    assert.equal(lowerLabels.length, 1);
    assert.notEqual(upperLabels[0].raterId, lowerLabels[0].raterId);
  });

  it("disambiguates colliding repetitionIds across sides via sourceLineIndex", async () => {
    await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
    await appendShoulderAbductionReachRepRecordLocally(captureRecord("right", 0));
    await appendShoulderAbductionReachRepRecordLocally(captureRecord("left", 1));
    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    assert.equal(reps.length, 2);
    assert.equal(reps[0].repetitionId, reps[1].repetitionId);

    const rightResolved = await resolveCaptureIdentityForLabel({
      devSessionId: TEST_SESSION_ID,
      sourceLineIndex: reps[0].sourceLineIndex,
      repetitionId: reps[0].repetitionId,
      side: reps[0].side,
    });
    const leftResolved = await resolveCaptureIdentityForLabel({
      devSessionId: TEST_SESSION_ID,
      sourceLineIndex: reps[1].sourceLineIndex,
      repetitionId: reps[1].repetitionId,
      side: reps[1].side,
    });
    assert.ok(rightResolved && leftResolved);
    assert.equal(rightResolved.side, "right");
    assert.equal(leftResolved.side, "left");
    assert.notEqual(rightResolved.participantId, leftResolved.participantId);
  });
});

describe("normalizeResearchRaterId (pure)", () => {
  it("rejects malformed raterId values used by the POST route gate", () => {
    assert.equal(normalizeResearchRaterId(""), null);
    assert.equal(normalizeResearchRaterId("   "), null);
    assert.equal(normalizeResearchRaterId("bad\x01id"), null);
  });
});
