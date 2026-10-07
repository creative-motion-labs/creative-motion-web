/**
 * Shoulder Abduction Reach — transparent multinomial logistic regression baseline.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * CPU-only, dependency-free baseline classifier for research benchmarking.
 * NOT a clinically validated model.
 */

import {
  BASELINE_COMPENSATION_LABELS,
  BASELINE_MODEL_TYPE,
  type BaselineCompensationLabel,
} from "./baseline-experiment-schema";
import { createSeededRandom } from "./baseline-experiment-split";

export type MultinomialLogisticRegressionConfig = {
  maxIterations: number;
  learningRate: number;
  randomSeed: number;
};

export type TrainedMultinomialLogisticRegression = {
  modelType: typeof BASELINE_MODEL_TYPE;
  classLabels: BaselineCompensationLabel[];
  weights: number[][];
  bias: number[];
  featureCount: number;
  iterationsRun: number;
};

function softmax(logits: readonly number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - maxLogit));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / sum);
}

function oneHot(labelIndex: number, classCount: number): number[] {
  const vector = new Array<number>(classCount).fill(0);
  vector[labelIndex] = 1;
  return vector;
}

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Trains a simple multinomial logistic regression model with deterministic
 * weight initialization from `randomSeed`.
 */
export function trainMultinomialLogisticRegression(
  features: readonly number[][],
  labels: readonly BaselineCompensationLabel[],
  config: MultinomialLogisticRegressionConfig,
): TrainedMultinomialLogisticRegression {
  if (features.length === 0) {
    throw new Error("cannot train classifier on empty feature matrix");
  }
  if (features.length !== labels.length) {
    throw new Error("feature matrix and label vector length mismatch");
  }

  const featureCount = features[0].length;
  for (const row of features) {
    if (row.length !== featureCount) {
      throw new Error("inconsistent feature vector dimensions");
    }
  }

  const classLabels = [...BASELINE_COMPENSATION_LABELS];
  const classCount = classLabels.length;
  const labelToIndex = new Map(classLabels.map((label, index) => [label, index]));

  const random = createSeededRandom(config.randomSeed);
  const weights = Array.from({ length: classCount }, () =>
    Array.from({ length: featureCount }, () => (random() - 0.5) * 0.01),
  );
  const bias = Array.from({ length: classCount }, () => 0);

  let iterationsRun = 0;
  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    iterationsRun = iteration + 1;
    const gradW = weights.map((row) => row.map(() => 0));
    const gradB = bias.map(() => 0);

    for (let sampleIndex = 0; sampleIndex < features.length; sampleIndex += 1) {
      const x = features[sampleIndex];
      const logits = weights.map((row, classIndex) => dot(row, x) + bias[classIndex]);
      const probs = softmax(logits);
      const trueIndex = labelToIndex.get(labels[sampleIndex]);
      if (trueIndex === undefined) {
        throw new Error(`unsupported label during training: ${labels[sampleIndex]}`);
      }
      const target = oneHot(trueIndex, classCount);

      for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
        const error = probs[classIndex] - target[classIndex];
        gradB[classIndex] += error;
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
          gradW[classIndex][featureIndex] += error * x[featureIndex];
        }
      }
    }

    const scale = config.learningRate / features.length;
    for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
      bias[classIndex] -= scale * gradB[classIndex];
      for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
        weights[classIndex][featureIndex] -= scale * gradW[classIndex][featureIndex];
      }
    }
  }

  return {
    modelType: BASELINE_MODEL_TYPE,
    classLabels,
    weights,
    bias,
    featureCount,
    iterationsRun,
  };
}

export function predictMultinomialLogisticRegression(
  model: TrainedMultinomialLogisticRegression,
  features: readonly number[],
): BaselineCompensationLabel {
  const logits = model.weights.map((row, classIndex) =>
    dot(row, features) + model.bias[classIndex],
  );
  const probs = softmax(logits);
  let bestIndex = 0;
  for (let index = 1; index < probs.length; index += 1) {
    if (probs[index] > probs[bestIndex]) {
      bestIndex = index;
    }
  }
  return model.classLabels[bestIndex];
}

export function predictMultinomialLogisticRegressionBatch(
  model: TrainedMultinomialLogisticRegression,
  featureMatrix: readonly number[][],
): BaselineCompensationLabel[] {
  return featureMatrix.map((features) => predictMultinomialLogisticRegression(model, features));
}
