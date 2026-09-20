/**
 * RASQ ML bridge — per-repetition kinematic feature extraction boundaries.
 *
 * Guards that objective derived features stay in the capture record only,
 * never leak into the therapist labeling workflow, and never touch production
 * persistence or label taxonomy.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/feature-extraction-boundaries.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import { readShoulderAbductionCaptureSessionForLabeling } from "./capture-reader";
import { isValidShoulderAbductionReachLabelSubmission } from "./label-schema";
import { appendShoulderAbductionReachRepRecordLocally, resolveDevSessionJsonlPath } from "./local-jsonl-writer";
import { unlink } from "node:fs/promises";

const TEST_SESSION_ID = "test-fixture-feature-boundaries-do-not-use";

const LABELING_UI_FILES = [
  "app/clinician/shoulder-abduction-reach-ml-labeling-lab/page.tsx",
  "app/lib/ml-research/shoulder-abduction-reach/capture-reader.ts",
  "app/lib/ml-research/shoulder-abduction-reach/label-client.ts",
  "app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts",
];

function fixtureRecord(): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: "test-participant",
      devSessionId: TEST_SESSION_ID,
      repetitionIndex: 1,
      repetitionId: `${TEST_SESSION_ID}-right-rep-1`,
      side: "right",
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1_000,
      endedAtMs: 2_500,
    },
    frames: [
      { relativeTimestampMs: 0, frameIndex: 0, joints: {} },
      { relativeTimestampMs: 1_500, frameIndex: 1, joints: {} },
    ],
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.91,
      peakShoulderAngleDegrees: 172,
      movementDurationMs: 1_500,
      peakAngularVelocityDegPerSec: 999,
      trackingQuality: {
        framesTotal: 2,
        framesWithUsableAngle: 2,
        usableFrameRatio: 1,
        minCoreJointVisibility: 0.88,
      },
    },
  };
}

describe("labeling payload remains blind to kinematic derived features", () => {
  it("capture-reader redaction never exposes peak angle, trunk drift, or angular velocity", async () => {
    await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
    await appendShoulderAbductionReachRepRecordLocally(fixtureRecord());

    const reps = await readShoulderAbductionCaptureSessionForLabeling(TEST_SESSION_ID);
    assert.equal(reps.length, 1);
    const serialized = JSON.stringify(reps[0]).toLowerCase();
    for (const forbidden of [
      "peakshoulderangledegrees",
      "peaknormalizedtrunkdriftratio",
      "peakangularvelocitydegpersec",
      "derivedfeatures",
      "172",
      "0.91",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden));
    }

    await unlink(resolveDevSessionJsonlPath(TEST_SESSION_ID)).catch(() => {});
  });

  for (const relativePath of LABELING_UI_FILES) {
    it(`${relativePath} does not import derived-feature computation for display or label validation`, () => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      assert.doesNotMatch(source, /from ["'].*derived-features["']/);
      assert.doesNotMatch(source, /computeShoulderAbductionReachDerivedFeatures/);
    });
  }
});

describe("feature extraction does not affect therapist labels", () => {
  it("label validation accepts the same submission shape with no derived-feature fields", () => {
    assert.equal(
      isValidShoulderAbductionReachLabelSubmission({
        devSessionId: TEST_SESSION_ID,
        repetitionId: `${TEST_SESSION_ID}-right-rep-1`,
        sourceLineIndex: 0,
        side: "right",
        raterId: "rater-a",
        compensationLabel: "MILD_COMPENSATION",
        exclusionFlag: null,
        raterConfidence: "high",
        note: "",
      }),
      true,
    );
  });

  it("label validation logic does not read derived-feature fields from submissions", () => {
    const source = readFileSync(join(process.cwd(), "app/lib/ml-research/shoulder-abduction-reach/label-schema.ts"), "utf8");
    const validationBlock = source.slice(
      source.indexOf("function hasValidSubmissionFields"),
      source.indexOf("export function isValidShoulderAbductionReachLabelSubmission"),
    );
    for (const forbidden of [
      "peakShoulderAngleDegrees",
      "peakNormalizedTrunkDriftRatio",
      "peakAngularVelocityDegPerSec",
      "derivedFeatures",
      "computeShoulderAbductionReachDerivedFeatures",
    ]) {
      assert.doesNotMatch(validationBlock, new RegExp(forbidden));
    }
  });
});

describe("feature provenance on persisted capture records", () => {
  it("stamps capture and feature schema versions on every record", () => {
    const record = fixtureRecord();
    assert.equal(record.context.captureSchemaVersion, ML_RESEARCH_CAPTURE_SCHEMA_VERSION);
    assert.equal(record.context.featureSchemaVersion, ML_RESEARCH_FEATURE_SCHEMA_VERSION);
    assert.equal(ML_RESEARCH_FEATURE_SCHEMA_VERSION, "shoulder-abduction-reach-features-v2");
  });
});
