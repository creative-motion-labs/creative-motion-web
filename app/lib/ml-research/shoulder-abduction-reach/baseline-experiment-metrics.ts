/**
 * Shoulder Abduction Reach — baseline experiment evaluation metrics.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Deterministic technical research metrics. NOT clinical validation.
 */

import {
  BASELINE_COMPENSATION_LABELS,
  emptyClassDistribution,
  type BaselineClassDistribution,
  type BaselineCompensationLabel,
  type BaselineConfusionMatrix,
  type BaselineEvaluationMetrics,
  type BaselinePerClassMetric,
} from "./baseline-experiment-schema";

const METRICS_DISCLAIMER =
  "Technical research metrics from a dev-only baseline experiment harness. " +
  "Not clinical validation, not diagnostic performance, and not suitable for care decisions.";

function countDistribution(
  labels: readonly BaselineCompensationLabel[],
): BaselineClassDistribution {
  const distribution = emptyClassDistribution();
  for (const label of labels) {
    distribution[label] += 1;
  }
  return distribution;
}

function buildConfusionMatrix(
  trueLabels: readonly BaselineCompensationLabel[],
  predictedLabels: readonly BaselineCompensationLabel[],
): BaselineConfusionMatrix {
  const labels = [...BASELINE_COMPENSATION_LABELS];
  const indexByLabel = new Map(labels.map((label, index) => [label, index]));
  const counts = labels.map(() => labels.map(() => 0));

  for (let i = 0; i < trueLabels.length; i += 1) {
    const trueIndex = indexByLabel.get(trueLabels[i]);
    const predictedIndex = indexByLabel.get(predictedLabels[i]);
    if (trueIndex === undefined || predictedIndex === undefined) {
      throw new Error("confusion matrix received unsupported label");
    }
    counts[trueIndex][predictedIndex] += 1;
  }

  return { labels, counts };
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function computePerClassMetrics(
  confusion: BaselineConfusionMatrix,
): Record<BaselineCompensationLabel, BaselinePerClassMetric> {
  const result = {} as Record<BaselineCompensationLabel, BaselinePerClassMetric>;

  for (let classIndex = 0; classIndex < confusion.labels.length; classIndex += 1) {
    const label = confusion.labels[classIndex];
    const truePositive = confusion.counts[classIndex][classIndex];
    let falsePositive = 0;
    let falseNegative = 0;

    for (let row = 0; row < confusion.labels.length; row += 1) {
      if (row !== classIndex) {
        falsePositive += confusion.counts[row][classIndex];
        falseNegative += confusion.counts[classIndex][row];
      }
    }

    const precision = safeDivide(truePositive, truePositive + falsePositive);
    const recall = safeDivide(truePositive, truePositive + falseNegative);
    const f1 =
      precision === null || recall === null || precision + recall === 0
        ? null
        : (2 * precision * recall) / (precision + recall);

    const support = confusion.counts[classIndex].reduce((sum, value) => sum + value, 0);

    result[label] = { precision, recall, f1, support };
  }

  return result;
}

function computeMacroF1(
  perClass: Record<BaselineCompensationLabel, BaselinePerClassMetric>,
): number | null {
  const f1Values = BASELINE_COMPENSATION_LABELS.map((label) => perClass[label].f1).filter(
    (value): value is number => value !== null,
  );
  if (f1Values.length === 0) return null;
  return f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length;
}

export type ComputeEvaluationMetricsInput = {
  trainLabels: readonly BaselineCompensationLabel[];
  testLabels: readonly BaselineCompensationLabel[];
  predictedTestLabels: readonly BaselineCompensationLabel[];
  distinctTrainParticipants: number;
  distinctTestParticipants: number;
};

export function computeBaselineEvaluationMetrics(
  input: ComputeEvaluationMetricsInput,
): BaselineEvaluationMetrics {
  if (input.testLabels.length !== input.predictedTestLabels.length) {
    throw new Error("test label and prediction length mismatch");
  }

  const confusionMatrix = buildConfusionMatrix(input.testLabels, input.predictedTestLabels);
  const correct =
    input.testLabels.length === 0
      ? 0
      : input.testLabels.filter((label, index) => label === input.predictedTestLabels[index])
          .length;

  const perClass = computePerClassMetrics(confusionMatrix);

  return {
    totalTrainSamples: input.trainLabels.length,
    totalTestSamples: input.testLabels.length,
    distinctTrainParticipants: input.distinctTrainParticipants,
    distinctTestParticipants: input.distinctTestParticipants,
    trainClassDistribution: countDistribution(input.trainLabels),
    testClassDistribution: countDistribution(input.testLabels),
    confusionMatrix,
    accuracy: safeDivide(correct, input.testLabels.length),
    perClass,
    macroF1: computeMacroF1(perClass),
    disclaimer: METRICS_DISCLAIMER,
  };
}
