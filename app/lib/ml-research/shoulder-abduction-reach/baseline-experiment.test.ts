/**
 * Slice 6 baseline experiment — behavioral/unit tests.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/baseline-experiment.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  predictMultinomialLogisticRegressionBatch,
  trainMultinomialLogisticRegression,
} from "./baseline-classifier";
import { extractBaselineFeaturesFromPoseFrames } from "./baseline-feature-extraction";
import {
  FORBIDDEN_BASELINE_FEATURE_KEYS,
  BASELINE_FEATURE_NAMES,
} from "./baseline-feature-schema";
import { loadShoulderAbductionTrainingExportForBaselineExperiment } from "./baseline-experiment-reader";
import {
  assessBaselineExperimentReadiness,
  assessParticipantSplitFeasibility,
} from "./baseline-experiment-readiness";
import { validateBaselineExperimentJoint } from "./baseline-input-validation";
import { computeBaselineEvaluationMetrics } from "./baseline-experiment-metrics";
import {
  detectParticipantSplitLeakage,
  splitSamplesByParticipant,
} from "./baseline-experiment-split";
import { runShoulderAbductionBaselineExperiment } from "./baseline-experiment-runner";
import {
  BASELINE_COMPENSATION_LABELS,
  BASELINE_EXPERIMENT_SCHEMA_VERSION,
  serializeBaselineExperimentReport,
} from "./baseline-experiment-schema";
import { TRAINING_EXPORT_SCHEMA_VERSION } from "./training-export-schema";
import type { ShoulderAbductionTrainingExportSample } from "./training-export-schema";
import { ML_RESEARCH_DATASET_VERSION, ML_RESEARCH_LABEL_SCHEMA_VERSION } from "./label-schema";
import { ML_RESEARCH_CAPTURE_SCHEMA_VERSION, ML_RESEARCH_FEATURE_SCHEMA_VERSION } from "./capture-schema";
import { ML_RESEARCH_MANIFEST_SCHEMA_VERSION } from "./manifest-schema";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function joint(x: number, y: number) {
  return {
    landmark: { x, y },
    confidence: { visibility: 0.95, present: true },
  };
}

function makeFrames(wristYStart: number, wristYEnd: number, count = 5) {
  return Array.from({ length: count }, (_unused, frameIndex) => ({
    relativeTimestampMs: frameIndex * 100,
    frameIndex,
    joints: {
      left_hip: joint(0.4, 0.7),
      right_hip: joint(0.6, 0.7),
      left_shoulder: joint(0.4, 0.5),
      right_shoulder: joint(0.6, 0.5),
      left_elbow: joint(0.35, 0.55),
      right_elbow: joint(0.65, 0.55),
      left_wrist: joint(0.3, wristYStart + (wristYEnd - wristYStart) * (frameIndex / (count - 1))),
      right_wrist: joint(0.7, wristYStart + (wristYEnd - wristYStart) * (frameIndex / (count - 1))),
    },
  }));
}

function trainingExportSample(
  overrides: {
    sampleId?: string;
    participantId?: string;
    compensationLabel?: "NO_COMPENSATION" | "MILD_COMPENSATION" | "CLEAR_COMPENSATION";
    wristYStart?: number;
    wristYEnd?: number;
    side?: "left" | "right";
    frames?: ReturnType<typeof makeFrames>;
  } = {},
): ShoulderAbductionTrainingExportSample {
  const devSessionId = "fixture-session";
  const sourceLineIndex = overrides.sampleId
    ? Number(overrides.sampleId.split("#")[1] ?? 0)
    : 0;
  const sampleId = overrides.sampleId ?? `${devSessionId}#${sourceLineIndex}`;
  const side = overrides.side ?? "right";

  return {
    exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    sampleId,
    provenance: {
      participantId: overrides.participantId ?? "participant-a",
      devSessionId,
      sourceLineIndex,
      repetitionId: `${devSessionId}-rep-${sourceLineIndex + 1}`,
      repetitionIndex: sourceLineIndex + 1,
      side,
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
        frameCount: 5,
      },
    },
    input: {
      frames:
        overrides.frames ??
        makeFrames(overrides.wristYStart ?? 0.6, overrides.wristYEnd ?? 0.4),
    },
    target: {
      compensationLabel: overrides.compensationLabel ?? "NO_COMPENSATION",
    },
    qc: {
      raterConfidence: "medium",
      trackingQuality: {
        framesTotal: 5,
        framesWithUsableAngle: 5,
        usableFrameRatio: 1,
      },
      frameCount: 5,
      movementDurationMs: 400,
      reviewCaution: false,
    },
  };
}

async function writeTempExport(samples: ShoulderAbductionTrainingExportSample[]): Promise<string> {
  const dir = join(tmpdir(), `rasq-baseline-test-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "fixture.training-export.jsonl");
  const content = samples
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId))
    .map((sample) => `${JSON.stringify(sample)}\n`)
    .join("");
  await writeFile(path, content, "utf8");
  return path;
}

describe("baseline experiment — input safety", () => {
  it("rejects unsupported training export schema", async () => {
    const sample = trainingExportSample();
    (sample as { exportSchemaVersion: string }).exportSchemaVersion = "unsupported-v99";
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /unsupported training export schema/,
    );
  });

  it("rejects invalid compensation label", async () => {
    const sample = trainingExportSample();
    (sample.target as { compensationLabel: string }).compensationLabel = "SEVERE";
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /invalid compensation label/,
    );
  });

  it("rejects missing participant provenance", async () => {
    const sample = trainingExportSample();
    (sample.provenance as { participantId: string }).participantId = "";
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /missing participantId/,
    );
  });

  it("loads valid export without reading raw capture sources", async () => {
    const path = await writeTempExport([trainingExportSample()]);
    const loaded = await loadShoulderAbductionTrainingExportForBaselineExperiment(path);
    assert.equal(loaded.samples.length, 1);
    assert.equal(loaded.samples[0].participantId, "participant-a");
    assert.ok(loaded.sourceTrainingExportSha256.length > 0);
  });

  it("rejects empty pose-frame sequences", async () => {
    const sample = trainingExportSample({ frames: [] });
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /empty pose-frame sequence/,
    );
  });

  it("rejects present joint missing landmark structure", async () => {
    const sample = trainingExportSample({
      frames: [
        {
          relativeTimestampMs: 0,
          frameIndex: 0,
          joints: {
            right_shoulder: {
              confidence: { visibility: 0.9, present: true },
            },
          },
        },
      ],
    });
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /present joint missing landmark object/,
    );
  });

  it("rejects null landmark coordinates on present joints", async () => {
    const sample = trainingExportSample({
      frames: [
        {
          relativeTimestampMs: 0,
          frameIndex: 0,
          joints: {
            right_shoulder: {
              landmark: { x: null, y: 0.5 },
              confidence: { visibility: 0.9, present: true },
            },
          },
        },
      ],
    });
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /finite numeric landmark x and y/,
    );
  });

  it("rejects boolean landmark coordinates on present joints", async () => {
    const sample = trainingExportSample({
      frames: [
        {
          relativeTimestampMs: 0,
          frameIndex: 0,
          joints: {
            right_wrist: {
              landmark: { x: true, y: false },
              confidence: { visibility: 0.9, present: true },
            },
          },
        },
      ],
    });
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /finite numeric landmark x and y/,
    );
  });

  it("rejects non-finite landmark coordinates on present joints", async () => {
    const sample = trainingExportSample({
      frames: [
        {
          relativeTimestampMs: 0,
          frameIndex: 0,
          joints: {
            right_wrist: {
              landmark: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
              confidence: { visibility: 0.9, present: true },
            },
          },
        },
      ],
    });
    const path = await writeTempExport([sample]);
    await assert.rejects(
      () => loadShoulderAbductionTrainingExportForBaselineExperiment(path),
      /finite numeric landmark x and y/,
    );
  });
});

describe("baseline experiment — data sufficiency gate", () => {
  it("returns NOT_READY for current-like 1 sample / 1 participant", async () => {
    const path = await writeTempExport([
      trainingExportSample({ participantId: "only-participant", sampleId: "s#0" }),
    ]);
    const { report } = await runShoulderAbductionBaselineExperiment({
      trainingExportPath: path,
    });
    assert.equal(report.status, "NOT_READY_FOR_BASELINE_EXPERIMENT");
    assert.ok(
      report.readinessReasons.includes(
        "insufficient_distinct_participants_for_participant_level_split",
      ),
    );
    assert.equal(report.evaluation, null);
  });

  it("does not generate evaluation metrics when not ready", async () => {
    const readiness = assessBaselineExperimentReadiness([
      {
        sampleId: "s#0",
        participantId: "p1",
        side: "right",
        frames: makeFrames(0.6, 0.4),
        compensationLabel: "NO_COMPENSATION",
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
    ]);
    assert.equal(readiness.ready, false);
  });

  it("flags insufficient target-class support explicitly", () => {
    const readiness = assessBaselineExperimentReadiness([
      {
        sampleId: "s#0",
        participantId: "p1",
        side: "right",
        frames: makeFrames(0.6, 0.4),
        compensationLabel: "NO_COMPENSATION",
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#1",
        participantId: "p2",
        side: "right",
        frames: makeFrames(0.6, 0.4),
        compensationLabel: "NO_COMPENSATION",
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
    ]);
    assert.ok(readiness.reasons.includes("insufficient_target_class_support"));
  });
});

describe("baseline experiment — participant-level split / leakage", () => {
  const multiParticipantSamples = [
    {
      sampleId: "s#0",
      participantId: "p1",
      side: "right" as const,
      frames: makeFrames(0.6, 0.4),
      compensationLabel: "NO_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
    {
      sampleId: "s#1",
      participantId: "p1",
      side: "right" as const,
      frames: makeFrames(0.6, 0.35),
      compensationLabel: "MILD_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
    {
      sampleId: "s#2",
      participantId: "p2",
      side: "left" as const,
      frames: makeFrames(0.6, 0.3),
      compensationLabel: "CLEAR_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
    {
      sampleId: "s#3",
      participantId: "p3",
      side: "right" as const,
      frames: makeFrames(0.6, 0.45),
      compensationLabel: "NO_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
  ];

  it("keeps repeated reps from same participant together", () => {
    const split = splitSamplesByParticipant(multiParticipantSamples, { randomSeed: 42 });
    const p1Train = split.trainSamples.filter((s) => s.participantId === "p1").length;
    const p1Test = split.testSamples.filter((s) => s.participantId === "p1").length;
    assert.ok(p1Train === 2 || p1Test === 2);
    assert.notEqual(p1Train > 0 && p1Test > 0, true);
  });

  it("detects intentional bad split leakage", () => {
    assert.equal(
      detectParticipantSplitLeakage(["p1", "p2"], ["p2", "p3"]),
      true,
    );
    assert.equal(
      detectParticipantSplitLeakage(["p1"], ["p2"]),
      false,
    );
  });

  it("is deterministic with same seed and input", () => {
    const splitA = splitSamplesByParticipant(multiParticipantSamples, { randomSeed: 99 });
    const splitB = splitSamplesByParticipant(multiParticipantSamples, { randomSeed: 99 });
    assert.deepEqual(splitA.trainParticipantIds, splitB.trainParticipantIds);
    assert.deepEqual(splitA.testParticipantIds, splitB.testParticipantIds);
  });
});

describe("baseline experiment — feature boundaries", () => {
  it("does not include forbidden identity or label keys in feature vector", () => {
    const vector = extractBaselineFeaturesFromPoseFrames(makeFrames(0.6, 0.4), "right");
    const serialized = JSON.stringify({
      names: BASELINE_FEATURE_NAMES,
      values: vector.values,
    }).toLowerCase();

    for (const forbidden of FORBIDDEN_BASELINE_FEATURE_KEYS) {
      assert.ok(
        !serialized.includes(forbidden.toLowerCase()),
        `forbidden key leaked into features: ${forbidden}`,
      );
    }
    assert.equal(vector.values.length, BASELINE_FEATURE_NAMES.length);
  });

  it("feature extraction is deterministic", () => {
    const frames = makeFrames(0.62, 0.38, 6);
    const a = extractBaselineFeaturesFromPoseFrames(frames, "right");
    const b = extractBaselineFeaturesFromPoseFrames(frames, "right");
    assert.deepEqual(a.values, b.values);
  });

  it("does not silently coerce invalid present-joint coordinates", () => {
    const frames = [
      {
        relativeTimestampMs: 0,
        frameIndex: 0,
        joints: {
          right_wrist: {
            landmark: { x: null as unknown as number, y: "0.5" as unknown as number },
            confidence: { visibility: 0.9, present: true },
          },
        },
      },
    ];
    const vector = extractBaselineFeaturesFromPoseFrames(frames, "right");
    assert.equal(vector.values[2], 0);
    assert.equal(vector.values[3], 0);
  });
});

describe("baseline experiment — model and metrics", () => {
  it("computes confusion matrix and edge-case metrics deterministically", () => {
    const trueLabels = ["NO_COMPENSATION", "MILD_COMPENSATION", "CLEAR_COMPENSATION"] as const;
    const predictedLabels = ["NO_COMPENSATION", "CLEAR_COMPENSATION", "CLEAR_COMPENSATION"] as const;
    const metrics = computeBaselineEvaluationMetrics({
      trainLabels: [...trueLabels],
      testLabels: [...trueLabels],
      predictedTestLabels: [...predictedLabels],
      distinctTrainParticipants: 2,
      distinctTestParticipants: 1,
    });

    assert.equal(metrics.totalTestSamples, 3);
    assert.equal(metrics.confusionMatrix.counts[0][0], 1);
    assert.equal(metrics.confusionMatrix.counts[1][2], 1);
    assert.equal(metrics.perClass.MILD_COMPENSATION.precision, null);
    assert.equal(metrics.perClass.MILD_COMPENSATION.recall, 0);
    assert.equal(metrics.perClass.MILD_COMPENSATION.f1, null);
    assert.equal(metrics.perClass.CLEAR_COMPENSATION.recall, 1);
    assert.ok(metrics.disclaimer.includes("Not clinical validation"));
  });

  it("handles zero-denominator accuracy when test set is empty", () => {
    const metrics = computeBaselineEvaluationMetrics({
      trainLabels: ["NO_COMPENSATION"],
      testLabels: [],
      predictedTestLabels: [],
      distinctTrainParticipants: 1,
      distinctTestParticipants: 0,
    });
    assert.equal(metrics.accuracy, null);
    assert.equal(metrics.macroF1, null);
  });

  it("synthetic fixture can train and evaluate end-to-end", async () => {
    const path = await writeTempExport([
      trainingExportSample({
        sampleId: "fixture#0",
        participantId: "p1",
        compensationLabel: "NO_COMPENSATION",
        wristYStart: 0.65,
        wristYEnd: 0.45,
      }),
      trainingExportSample({
        sampleId: "fixture#1",
        participantId: "p1",
        compensationLabel: "MILD_COMPENSATION",
        wristYStart: 0.7,
        wristYEnd: 0.5,
      }),
      trainingExportSample({
        sampleId: "fixture#2",
        participantId: "p2",
        compensationLabel: "NO_COMPENSATION",
        wristYStart: 0.75,
        wristYEnd: 0.55,
      }),
      trainingExportSample({
        sampleId: "fixture#3",
        participantId: "p2",
        compensationLabel: "CLEAR_COMPENSATION",
        wristYStart: 0.72,
        wristYEnd: 0.52,
      }),
      trainingExportSample({
        sampleId: "fixture#4",
        participantId: "p3",
        compensationLabel: "MILD_COMPENSATION",
        wristYStart: 0.58,
        wristYEnd: 0.4,
      }),
      trainingExportSample({
        sampleId: "fixture#5",
        participantId: "p3",
        compensationLabel: "NO_COMPENSATION",
        wristYStart: 0.57,
        wristYEnd: 0.41,
      }),
      trainingExportSample({
        sampleId: "fixture#6",
        participantId: "p4",
        compensationLabel: "CLEAR_COMPENSATION",
        wristYStart: 0.6,
        wristYEnd: 0.42,
      }),
    ]);

    const loadedSamples = [
      {
        sampleId: "fixture#0",
        participantId: "p1",
        side: "right" as const,
        frames: makeFrames(0.65, 0.45),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "fixture#1",
        participantId: "p1",
        side: "right" as const,
        frames: makeFrames(0.7, 0.5),
        compensationLabel: "MILD_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "fixture#2",
        participantId: "p2",
        side: "right" as const,
        frames: makeFrames(0.75, 0.55),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "fixture#3",
        participantId: "p2",
        side: "right" as const,
        frames: makeFrames(0.72, 0.52),
        compensationLabel: "CLEAR_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "fixture#4",
        participantId: "p3",
        side: "right" as const,
        frames: makeFrames(0.58, 0.4),
        compensationLabel: "MILD_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "fixture#5",
        participantId: "p3",
        side: "right" as const,
        frames: makeFrames(0.57, 0.41),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "fixture#6",
        participantId: "p4",
        side: "right" as const,
        frames: makeFrames(0.6, 0.42),
        compensationLabel: "CLEAR_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
    ];

    let feasibleSeed: number | null = null;
    for (let seed = 0; seed < 200; seed += 1) {
      const split = splitSamplesByParticipant(loadedSamples, { randomSeed: seed });
      if (split.feasibility.feasible) {
        feasibleSeed = seed;
        break;
      }
    }
    assert.notEqual(feasibleSeed, null, "expected a feasible participant split seed");

    const runA = await runShoulderAbductionBaselineExperiment({
      trainingExportPath: path,
      randomSeed: feasibleSeed as number,
    });
    const runB = await runShoulderAbductionBaselineExperiment({
      trainingExportPath: path,
      randomSeed: feasibleSeed as number,
    });

    assert.equal(runA.report.status, "COMPLETED");
    assert.equal(runB.report.status, "COMPLETED");
    assert.deepEqual(
      JSON.parse(serializeBaselineExperimentReport(runA.report)),
      JSON.parse(serializeBaselineExperimentReport(runB.report)),
    );
    assert.equal(runA.report.experimentSchemaVersion, BASELINE_EXPERIMENT_SCHEMA_VERSION);
    assert.ok(runA.report.evaluation);
    assert.ok(runA.report.split?.leakageCheckPassed);
  });

  it("classifier trains on synthetic separable data", () => {
    const features = [
      [0, 0, 0.1],
      [0, 0, 0.2],
      [1, 1, 0.9],
      [1, 1, 0.8],
    ];
    const labels = [
      "NO_COMPENSATION",
      "NO_COMPENSATION",
      "CLEAR_COMPENSATION",
      "CLEAR_COMPENSATION",
    ] as const;
    const model = trainMultinomialLogisticRegression(features, labels, {
      maxIterations: 300,
      learningRate: 0.5,
      randomSeed: 1,
    });
    const preds = predictMultinomialLogisticRegressionBatch(model, features);
    assert.deepEqual(preds.slice(0, 2), ["NO_COMPENSATION", "NO_COMPENSATION"]);
    assert.deepEqual(preds.slice(2), ["CLEAR_COMPENSATION", "CLEAR_COMPENSATION"]);
  });
});

describe("baseline experiment — post-split class support", () => {
  const classSeparatedSamples = [
    {
      sampleId: "s#0",
      participantId: "p-no-1",
      side: "right" as const,
      frames: makeFrames(0.6, 0.4),
      compensationLabel: "NO_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
    {
      sampleId: "s#1",
      participantId: "p-no-2",
      side: "right" as const,
      frames: makeFrames(0.6, 0.42),
      compensationLabel: "NO_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
    {
      sampleId: "s#2",
      participantId: "p-mild-1",
      side: "right" as const,
      frames: makeFrames(0.6, 0.38),
      compensationLabel: "MILD_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
    {
      sampleId: "s#3",
      participantId: "p-mild-2",
      side: "right" as const,
      frames: makeFrames(0.6, 0.36),
      compensationLabel: "MILD_COMPENSATION" as const,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    },
  ];

  it("flags participant split that isolates target classes into train only", () => {
    const feasibility = assessParticipantSplitFeasibility(
      classSeparatedSamples,
      ["p-no-1", "p-no-2"],
      ["p-mild-1", "p-mild-2"],
    );
    assert.equal(feasibility.feasible, false);
    assert.equal(feasibility.reason, "insufficient_post_split_target_class_support");
  });

  it("flags participant split that isolates target classes into test only", () => {
    const trainHasAllClassesSamples = [
      {
        sampleId: "s#0",
        participantId: "p1",
        side: "right" as const,
        frames: makeFrames(0.6, 0.4),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#1",
        participantId: "p1",
        side: "right" as const,
        frames: makeFrames(0.6, 0.38),
        compensationLabel: "MILD_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#2",
        participantId: "p2",
        side: "right" as const,
        frames: makeFrames(0.6, 0.36),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#3",
        participantId: "p3",
        side: "right" as const,
        frames: makeFrames(0.6, 0.34),
        compensationLabel: "MILD_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
    ];

    const feasibility = assessParticipantSplitFeasibility(
      trainHasAllClassesSamples,
      ["p1", "p2"],
      ["p3"],
    );
    assert.equal(feasibility.feasible, false);
    assert.equal(feasibility.reason, "insufficient_post_split_target_class_support");
  });

  it("does not train or emit metrics when test split lacks a full-dataset class", async () => {
    const trainHasAllClassesSamples = [
      {
        sampleId: "s#0",
        participantId: "p1",
        side: "right" as const,
        frames: makeFrames(0.6, 0.4),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#1",
        participantId: "p1",
        side: "right" as const,
        frames: makeFrames(0.6, 0.38),
        compensationLabel: "MILD_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#2",
        participantId: "p2",
        side: "right" as const,
        frames: makeFrames(0.6, 0.36),
        compensationLabel: "NO_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
      {
        sampleId: "s#3",
        participantId: "p3",
        side: "right" as const,
        frames: makeFrames(0.6, 0.34),
        compensationLabel: "MILD_COMPENSATION" as const,
        datasetVersion: ML_RESEARCH_DATASET_VERSION,
        exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
      },
    ];

    const path = await writeTempExport([
      trainingExportSample({
        sampleId: "fixture#0",
        participantId: "p1",
        compensationLabel: "NO_COMPENSATION",
      }),
      trainingExportSample({
        sampleId: "fixture#1",
        participantId: "p1",
        compensationLabel: "MILD_COMPENSATION",
      }),
      trainingExportSample({
        sampleId: "fixture#2",
        participantId: "p2",
        compensationLabel: "NO_COMPENSATION",
      }),
      trainingExportSample({
        sampleId: "fixture#3",
        participantId: "p3",
        compensationLabel: "MILD_COMPENSATION",
      }),
    ]);

    let chosenSeed: number | null = null;
    for (let seed = 0; seed < 200; seed += 1) {
      const split = splitSamplesByParticipant(trainHasAllClassesSamples, {
        randomSeed: seed,
        trainParticipantRatio: 2 / 3,
      });
      const trainLabels = new Set(split.trainSamples.map((sample) => sample.compensationLabel));
      if (
        trainLabels.has("NO_COMPENSATION") &&
        trainLabels.has("MILD_COMPENSATION") &&
        split.feasibility.reason === "insufficient_post_split_target_class_support"
      ) {
        chosenSeed = seed;
        break;
      }
    }
    assert.notEqual(
      chosenSeed,
      null,
      "expected a seed where train has all classes but test lacks one",
    );

    const { report } = await runShoulderAbductionBaselineExperiment({
      trainingExportPath: path,
      randomSeed: chosenSeed as number,
      trainParticipantRatio: 2 / 3,
    });

    assert.equal(report.status, "NOT_READY_FOR_BASELINE_EXPERIMENT");
    assert.ok(
      report.readinessReasons.includes("insufficient_post_split_target_class_support"),
    );
    assert.equal(report.evaluation, null);
    assert.equal(report.split, null);
  });

  it("does not train or emit metrics when post-split class coverage is unusable", async () => {
    const path = await writeTempExport([
      trainingExportSample({
        sampleId: "fixture#0",
        participantId: "p-no-1",
        compensationLabel: "NO_COMPENSATION",
      }),
      trainingExportSample({
        sampleId: "fixture#1",
        participantId: "p-no-2",
        compensationLabel: "NO_COMPENSATION",
      }),
      trainingExportSample({
        sampleId: "fixture#2",
        participantId: "p-mild-1",
        compensationLabel: "MILD_COMPENSATION",
      }),
      trainingExportSample({
        sampleId: "fixture#3",
        participantId: "p-mild-2",
        compensationLabel: "MILD_COMPENSATION",
      }),
    ]);

    let chosenSeed: number | null = null;
    for (let seed = 0; seed < 200; seed += 1) {
      const split = splitSamplesByParticipant(classSeparatedSamples, { randomSeed: seed });
      if (
        split.feasibility.reason === "insufficient_post_split_target_class_support" &&
        split.trainSamples.length > 0 &&
        split.testSamples.length > 0
      ) {
        chosenSeed = seed;
        break;
      }
    }
    assert.notEqual(chosenSeed, null, "expected a seed that isolates classes by participant split");

    const { report } = await runShoulderAbductionBaselineExperiment({
      trainingExportPath: path,
      randomSeed: chosenSeed as number,
    });

    assert.equal(report.status, "NOT_READY_FOR_BASELINE_EXPERIMENT");
    assert.ok(
      report.readinessReasons.includes("insufficient_post_split_target_class_support"),
    );
    assert.equal(report.evaluation, null);
    assert.equal(report.split, null);
  });
});

describe("baseline experiment — input validation helpers", () => {
  it("validateBaselineExperimentJoint rejects malformed present joint structure", () => {
    assert.throws(
      () =>
        validateBaselineExperimentJoint(
          { confidence: { present: true } },
          "test joint",
        ),
      /present joint missing landmark object/,
    );
  });
});

describe("baseline experiment — canonical label policy", () => {
  it("supports all three canonical compensation labels", () => {
    assert.deepEqual(BASELINE_COMPENSATION_LABELS, [
      "NO_COMPENSATION",
      "MILD_COMPENSATION",
      "CLEAR_COMPENSATION",
    ]);
  });
});
