/**
 * Shoulder Abduction Reach — baseline experiment orchestration.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * End-to-end deterministic experiment runner consuming Slice 5 exports only.
 */

import {
  predictMultinomialLogisticRegressionBatch,
  trainMultinomialLogisticRegression,
} from "./baseline-classifier";
import { extractBaselineFeaturesFromPoseFrames } from "./baseline-feature-extraction";
import { loadShoulderAbductionTrainingExportForBaselineExperiment } from "./baseline-experiment-reader";
import { assessBaselineExperimentReadiness } from "./baseline-experiment-readiness";
import {
  BASELINE_EXPERIMENT_SCHEMA_VERSION,
  BASELINE_FEATURE_SCHEMA_VERSION,
  BASELINE_MODEL_TYPE,
  type BaselineExperimentConfiguration,
  type BaselineExperimentReport,
  DEFAULT_BASELINE_READINESS_POLICY,
} from "./baseline-experiment-schema";
import { computeBaselineEvaluationMetrics } from "./baseline-experiment-metrics";
import { splitSamplesByParticipant } from "./baseline-experiment-split";

export type RunBaselineExperimentOptions = {
  trainingExportPath: string;
  randomSeed?: number;
  trainParticipantRatio?: number;
  classifierMaxIterations?: number;
  classifierLearningRate?: number;
};

export type RunBaselineExperimentResult = {
  report: BaselineExperimentReport;
};

function buildDefaultConfiguration(
  options: RunBaselineExperimentOptions,
): BaselineExperimentConfiguration {
  return {
    randomSeed: options.randomSeed ?? 42,
    trainParticipantRatio: options.trainParticipantRatio ?? 0.5,
    classifierMaxIterations: options.classifierMaxIterations ?? 200,
    classifierLearningRate: options.classifierLearningRate ?? 0.1,
    readinessPolicy: DEFAULT_BASELINE_READINESS_POLICY,
  };
}

/**
 * Runs the baseline experiment harness. Returns NOT_READY without training
 * when data are scientifically inadequate.
 */
export async function runShoulderAbductionBaselineExperiment(
  options: RunBaselineExperimentOptions,
): Promise<RunBaselineExperimentResult> {
  const configuration = buildDefaultConfiguration(options);
  const loaded = await loadShoulderAbductionTrainingExportForBaselineExperiment(
    options.trainingExportPath,
  );

  const readiness = assessBaselineExperimentReadiness(
    loaded.samples,
    configuration.readinessPolicy,
  );

  const baseReport: BaselineExperimentReport = {
    experimentSchemaVersion: BASELINE_EXPERIMENT_SCHEMA_VERSION,
    status: "NOT_READY_FOR_BASELINE_EXPERIMENT",
    readinessReasons: [...readiness.reasons],
    featureSchemaVersion: BASELINE_FEATURE_SCHEMA_VERSION,
    baselineModelType: BASELINE_MODEL_TYPE,
    configuration,
    provenance: {
      sourceTrainingExportPath: options.trainingExportPath,
      sourceTrainingExportSha256: loaded.sourceTrainingExportSha256,
      trainingExportSchemaVersion: loaded.trainingExportSchemaVersion,
      datasetVersion: loaded.datasetVersion,
      supervisedCandidateCount: loaded.samples.length,
      distinctParticipantCount: readiness.distinctParticipants,
    },
    split: null,
    evaluation: null,
  };

  if (!readiness.ready) {
    return { report: baseReport };
  }

  const split = splitSamplesByParticipant(loaded.samples, {
    randomSeed: configuration.randomSeed,
    trainParticipantRatio: configuration.trainParticipantRatio,
    readinessPolicy: configuration.readinessPolicy,
  });

  if (!split.leakageCheckPassed) {
    return {
      report: {
        ...baseReport,
        readinessReasons: [
          ...readiness.reasons,
          "participant_split_not_feasible",
        ],
      },
    };
  }

  if (!split.feasibility.feasible) {
    return {
      report: {
        ...baseReport,
        readinessReasons: [
          ...readiness.reasons,
          split.feasibility.reason ?? "participant_split_not_feasible",
        ],
      },
    };
  }

  const trainFeatures = split.trainSamples.map((sample) =>
    extractBaselineFeaturesFromPoseFrames(sample.frames, sample.side).values,
  );
  const testFeatures = split.testSamples.map((sample) =>
    extractBaselineFeaturesFromPoseFrames(sample.frames, sample.side).values,
  );

  const trainLabels = split.trainSamples.map((sample) => sample.compensationLabel);
  const testLabels = split.testSamples.map((sample) => sample.compensationLabel);

  const model = trainMultinomialLogisticRegression(trainFeatures, trainLabels, {
    maxIterations: configuration.classifierMaxIterations,
    learningRate: configuration.classifierLearningRate,
    randomSeed: configuration.randomSeed,
  });

  const predictedTestLabels = predictMultinomialLogisticRegressionBatch(model, testFeatures);

  const evaluation = computeBaselineEvaluationMetrics({
    trainLabels,
    testLabels,
    predictedTestLabels,
    distinctTrainParticipants: split.trainParticipantIds.length,
    distinctTestParticipants: split.testParticipantIds.length,
  });

  return {
    report: {
      ...baseReport,
      status: "COMPLETED",
      readinessReasons: [],
      split: {
        splitPolicyVersion: split.splitPolicyVersion,
        randomSeed: split.randomSeed,
        trainParticipantIds: split.trainParticipantIds,
        testParticipantIds: split.testParticipantIds,
        trainSampleIds: split.trainSamples.map((sample) => sample.sampleId),
        testSampleIds: split.testSamples.map((sample) => sample.sampleId),
        leakageCheckPassed: split.leakageCheckPassed,
      },
      evaluation,
    },
  };
}
