/**
 * Slice 6 baseline experiment — disk-level integration tests.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/baseline-experiment-source-integrity.test.ts
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { runShoulderAbductionBaselineExperimentCli } from "./baseline-experiment-cli";
import {
  assertBaselineExperimentOutputPathIsSafe,
  ML_RESEARCH_BASELINE_EXPERIMENT_DATA_DIR,
  resolveBaselineExperimentReportPath,
  resolveBaselineExperimentRunSidecarPath,
} from "./baseline-experiment-writer";
import {
  ML_RESEARCH_TRAINING_EXPORT_DATA_DIR,
  resolveTrainingExportJsonlPath,
} from "./training-export-writer";
import { TRAINING_EXPORT_SCHEMA_VERSION } from "./training-export-schema";
import type { ShoulderAbductionTrainingExportSample } from "./training-export-schema";
import { ML_RESEARCH_DATASET_VERSION, ML_RESEARCH_LABEL_SCHEMA_VERSION } from "./label-schema";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
} from "./capture-schema";
import { ML_RESEARCH_MANIFEST_SCHEMA_VERSION } from "./manifest-schema";

const TEST_EXPORT_NAME = "test-fixture-baseline-experiment-do-not-use";
const EXPORT_JSONL_PATH = resolveTrainingExportJsonlPath(TEST_EXPORT_NAME);
const REPORT_PATH = resolveBaselineExperimentReportPath(TEST_EXPORT_NAME);
const RUN_SIDECAR_PATH = resolveBaselineExperimentRunSidecarPath(REPORT_PATH);

function sampleLine(
  sampleId: string,
  participantId: string,
  label: "NO_COMPENSATION" | "MILD_COMPENSATION" | "CLEAR_COMPENSATION",
): ShoulderAbductionTrainingExportSample {
  const [devSessionId, linePart] = sampleId.split("#");
  const sourceLineIndex = Number(linePart);
  return {
    exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    sampleId,
    provenance: {
      participantId,
      devSessionId,
      sourceLineIndex,
      repetitionId: `${devSessionId}-rep-${sourceLineIndex + 1}`,
      repetitionIndex: sourceLineIndex + 1,
      side: "right",
      movementType: "shoulder_abduction_reach",
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
      manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      raterId: "fixture-rater",
      labeledAtMs: 1_700_000_000_000,
      manifestSourceReference: {
        kind: "capture_jsonl_line",
        relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${devSessionId}.jsonl`,
        lineIndex: sourceLineIndex,
        frameCount: 3,
      },
    },
    input: {
      frames: [
        {
          relativeTimestampMs: 0,
          frameIndex: 0,
          joints: {
            right_shoulder: { landmark: { x: 0.6, y: 0.5 }, confidence: { visibility: 0.9, present: true } },
            right_elbow: { landmark: { x: 0.65, y: 0.55 }, confidence: { visibility: 0.9, present: true } },
            right_wrist: { landmark: { x: 0.7, y: 0.6 }, confidence: { visibility: 0.9, present: true } },
            right_hip: { landmark: { x: 0.6, y: 0.7 }, confidence: { visibility: 0.9, present: true } },
            left_shoulder: { landmark: { x: 0.4, y: 0.5 }, confidence: { visibility: 0.9, present: true } },
          },
        },
        {
          relativeTimestampMs: 100,
          frameIndex: 1,
          joints: {
            right_shoulder: { landmark: { x: 0.6, y: 0.5 }, confidence: { visibility: 0.9, present: true } },
            right_elbow: { landmark: { x: 0.65, y: 0.5 }, confidence: { visibility: 0.9, present: true } },
            right_wrist: { landmark: { x: 0.7, y: 0.45 }, confidence: { visibility: 0.9, present: true } },
            right_hip: { landmark: { x: 0.6, y: 0.7 }, confidence: { visibility: 0.9, present: true } },
            left_shoulder: { landmark: { x: 0.4, y: 0.5 }, confidence: { visibility: 0.9, present: true } },
          },
        },
      ],
    },
    target: { compensationLabel: label },
    qc: {
      raterConfidence: "medium",
      trackingQuality: { framesTotal: 2, framesWithUsableAngle: 2, usableFrameRatio: 1 },
      frameCount: 2,
      movementDurationMs: 100,
      reviewCaution: false,
    },
  };
}

async function writeFixtureExport(
  samples: ShoulderAbductionTrainingExportSample[],
): Promise<void> {
  await mkdir(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR, { recursive: true });
  const content = samples
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId))
    .map((sample) => `${JSON.stringify(sample)}\n`)
    .join("");
  await writeFile(EXPORT_JSONL_PATH, content, "utf8");
}

async function cleanupOutputs(): Promise<void> {
  await unlink(EXPORT_JSONL_PATH).catch(() => {});
  await unlink(REPORT_PATH).catch(() => {});
  await unlink(RUN_SIDECAR_PATH).catch(() => {});
}

afterEach(async () => {
  await cleanupOutputs();
});

describe("baseline experiment — output safety", () => {
  it("rejects path traversal outside dedicated experiment directory", () => {
    assert.throws(
      () =>
        assertBaselineExperimentOutputPathIsSafe(
          join(process.cwd(), "dev-data", "rasq-ml", "shoulder-abduction", "escape.json"),
        ),
      /refusing to write baseline experiment output outside dedicated directory/,
    );
  });

  it("writes only under shoulder-abduction-baseline-experiments", async () => {
    await writeFixtureExport([
      sampleLine("fixture-session#0", "only-participant", "NO_COMPENSATION"),
    ]);

    const beforeHash = createHash("sha256")
      .update(await readFile(EXPORT_JSONL_PATH))
      .digest("hex");

    const result = await runShoulderAbductionBaselineExperimentCli({
      trainingExportPath: EXPORT_JSONL_PATH,
      experimentName: TEST_EXPORT_NAME,
      randomSeed: 42,
      print: false,
      nowMs: 1_700_000_100_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.report.status, "NOT_READY_FOR_BASELINE_EXPERIMENT");

    const afterHash = createHash("sha256")
      .update(await readFile(EXPORT_JSONL_PATH))
      .digest("hex");
    assert.equal(beforeHash, afterHash, "source training export must remain byte-identical");

    const reportStat = await stat(REPORT_PATH);
    assert.ok(reportStat.isFile());
    assert.ok(REPORT_PATH.includes("shoulder-abduction-baseline-experiments"));
    assert.ok(
      ML_RESEARCH_BASELINE_EXPERIMENT_DATA_DIR.endsWith("shoulder-abduction-baseline-experiments"),
    );
  });

  it("completes synthetic multi-participant fixture with metrics", async () => {
    await writeFixtureExport([
      sampleLine("fixture-session#0", "p1", "NO_COMPENSATION"),
      sampleLine("fixture-session#1", "p1", "MILD_COMPENSATION"),
      sampleLine("fixture-session#2", "p2", "NO_COMPENSATION"),
      sampleLine("fixture-session#3", "p2", "CLEAR_COMPENSATION"),
      sampleLine("fixture-session#4", "p3", "MILD_COMPENSATION"),
      sampleLine("fixture-session#5", "p3", "NO_COMPENSATION"),
      sampleLine("fixture-session#6", "p4", "CLEAR_COMPENSATION"),
    ]);

    let result: Awaited<ReturnType<typeof runShoulderAbductionBaselineExperimentCli>> | null =
      null;
    for (let seed = 0; seed < 200; seed += 1) {
      const attempt = await runShoulderAbductionBaselineExperimentCli({
        trainingExportPath: EXPORT_JSONL_PATH,
        experimentName: TEST_EXPORT_NAME,
        randomSeed: seed,
        print: false,
        nowMs: 1_700_000_200_000,
      });
      if (attempt.report.status === "COMPLETED") {
        result = attempt;
        break;
      }
    }

    assert.ok(result, "expected a feasible participant split seed for synthetic fixture");
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.status, "COMPLETED");
    assert.ok(result.report.evaluation);
    assert.equal(result.report.evaluation?.totalTestSamples > 0, true);

    const canonicalReport = await readFile(REPORT_PATH, "utf8");
    const parsed = JSON.parse(canonicalReport);
    assert.equal(parsed.status, "COMPLETED");
    assert.ok(parsed.evaluation.confusionMatrix);
  });
});

describe("baseline experiment — real-dataset-like refusal", () => {
  it("1 candidate / 1 participant exits 0 without training or metrics", async () => {
    await writeFixtureExport([
      sampleLine("real-like-session#0", "participant-single", "MILD_COMPENSATION"),
    ]);

    const result = await runShoulderAbductionBaselineExperimentCli({
      trainingExportPath: EXPORT_JSONL_PATH,
      experimentName: `${TEST_EXPORT_NAME}-real-like`,
      randomSeed: 42,
      print: false,
      nowMs: 1_700_000_300_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.report.provenance.supervisedCandidateCount, 1);
    assert.equal(result.report.provenance.distinctParticipantCount, 1);
    assert.equal(result.report.status, "NOT_READY_FOR_BASELINE_EXPERIMENT");
    assert.equal(result.report.evaluation, null);
    assert.ok(
      result.report.readinessReasons.includes(
        "insufficient_distinct_participants_for_participant_level_split",
      ),
    );
  });
});
