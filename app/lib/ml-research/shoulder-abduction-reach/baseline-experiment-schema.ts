/**
 * Shoulder Abduction Reach — dev-only BASELINE EXPERIMENT schema.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * DEV/RESEARCH ONLY. A baseline experiment consumes a Slice 5 canonical
 * training export, applies participant-level splitting, extracts auditable
 * baseline features from pose frames, runs a simple transparent classifier,
 * and reports technical research metrics — NOT clinical validation.
 *
 * CRITICAL BOUNDARIES:
 *  - Slice 5 training export is the ONLY accepted dataset input.
 *  - Raw capture files and therapist label files are never read here.
 *  - participantId is grouping/splitting metadata only — never a model feature.
 *  - When data are scientifically inadequate, the harness refuses to train.
 *  - Metrics are technical research outputs, not clinical performance claims.
 */

import type { ShoulderAbductionReachCompensationLabel } from "./label-schema";
import { TRAINING_EXPORT_SCHEMA_VERSION } from "./training-export-schema";

/** Bumped whenever the canonical experiment report shape changes. */
export const BASELINE_EXPERIMENT_SCHEMA_VERSION =
  "shoulder-abduction-baseline-experiment-v1" as const;

/** Baseline feature vector schema version — independent of experiment envelope. */
export const BASELINE_FEATURE_SCHEMA_VERSION =
  "shoulder-abduction-baseline-features-v1" as const;

/** Participant-level split policy identifier. */
export const BASELINE_SPLIT_POLICY_VERSION = "participant-holdout-v1" as const;

/** Readiness methodology configuration version — not a statistical validity claim. */
export const BASELINE_READINESS_POLICY_VERSION =
  "shoulder-abduction-baseline-readiness-v1" as const;

/** Transparent CPU-only baseline classifier identifier. */
export const BASELINE_MODEL_TYPE = "multinomial-logistic-regression-v1" as const;

/** Only this Slice 5 export schema version is accepted as experiment input. */
export const SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION = TRAINING_EXPORT_SCHEMA_VERSION;

export const BASELINE_COMPENSATION_LABELS = [
  "NO_COMPENSATION",
  "MILD_COMPENSATION",
  "CLEAR_COMPENSATION",
] as const satisfies readonly ShoulderAbductionReachCompensationLabel[];

export type BaselineCompensationLabel = (typeof BASELINE_COMPENSATION_LABELS)[number];

export type BaselineExperimentStatus =
  | "NOT_READY_FOR_BASELINE_EXPERIMENT"
  | "COMPLETED";

export type BaselineExperimentReadinessReason =
  | "insufficient_distinct_participants_for_participant_level_split"
  | "insufficient_eligible_supervised_samples"
  | "insufficient_target_class_support"
  | "insufficient_post_split_target_class_support"
  | "participant_split_not_feasible";

/**
 * Methodology/configuration thresholds — describe what this harness requires
 * to attempt a participant-level baseline experiment. These are NOT claims
 * that meeting them guarantees clinical or statistical validity.
 */
export type BaselineExperimentReadinessPolicy = {
  policyVersion: typeof BASELINE_READINESS_POLICY_VERSION;
  minDistinctParticipants: number;
  minSupervisedSamples: number;
  minDistinctTargetClasses: number;
  minSamplesPerTargetClass: number;
  minTrainParticipants: number;
  minTestParticipants: number;
  minTrainSamples: number;
  minTestSamples: number;
};

export const DEFAULT_BASELINE_READINESS_POLICY: BaselineExperimentReadinessPolicy = {
  policyVersion: BASELINE_READINESS_POLICY_VERSION,
  minDistinctParticipants: 2,
  minSupervisedSamples: 2,
  minDistinctTargetClasses: 2,
  minSamplesPerTargetClass: 1,
  minTrainParticipants: 1,
  minTestParticipants: 1,
  minTrainSamples: 1,
  minTestSamples: 1,
};

export type BaselineExperimentSplitSummary = {
  splitPolicyVersion: typeof BASELINE_SPLIT_POLICY_VERSION;
  randomSeed: number;
  trainParticipantIds: string[];
  testParticipantIds: string[];
  trainSampleIds: string[];
  testSampleIds: string[];
  leakageCheckPassed: boolean;
};

export type BaselineClassDistribution = Record<BaselineCompensationLabel, number>;

export type BaselineConfusionMatrix = {
  labels: BaselineCompensationLabel[];
  counts: number[][];
};

export type BaselinePerClassMetric = {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
};

export type BaselineEvaluationMetrics = {
  totalTrainSamples: number;
  totalTestSamples: number;
  distinctTrainParticipants: number;
  distinctTestParticipants: number;
  trainClassDistribution: BaselineClassDistribution;
  testClassDistribution: BaselineClassDistribution;
  confusionMatrix: BaselineConfusionMatrix;
  accuracy: number | null;
  perClass: Record<BaselineCompensationLabel, BaselinePerClassMetric>;
  macroF1: number | null;
  disclaimer: string;
};

export type BaselineExperimentConfiguration = {
  randomSeed: number;
  trainParticipantRatio: number;
  classifierMaxIterations: number;
  classifierLearningRate: number;
  readinessPolicy: BaselineExperimentReadinessPolicy;
};

export type BaselineExperimentProvenance = {
  sourceTrainingExportPath: string;
  sourceTrainingExportSha256: string | null;
  trainingExportSchemaVersion: string;
  datasetVersion: string | null;
  supervisedCandidateCount: number;
  distinctParticipantCount: number;
};

/**
 * Canonical, deterministic experiment report. No wall-clock timestamps —
 * run metadata goes to a separate sidecar file.
 */
export type BaselineExperimentReport = {
  experimentSchemaVersion: typeof BASELINE_EXPERIMENT_SCHEMA_VERSION;
  status: BaselineExperimentStatus;
  readinessReasons: BaselineExperimentReadinessReason[];
  featureSchemaVersion: typeof BASELINE_FEATURE_SCHEMA_VERSION;
  baselineModelType: typeof BASELINE_MODEL_TYPE;
  configuration: BaselineExperimentConfiguration;
  provenance: BaselineExperimentProvenance;
  split: BaselineExperimentSplitSummary | null;
  evaluation: BaselineEvaluationMetrics | null;
};

export function emptyClassDistribution(): BaselineClassDistribution {
  return {
    NO_COMPENSATION: 0,
    MILD_COMPENSATION: 0,
    CLEAR_COMPENSATION: 0,
  };
}

export function serializeBaselineExperimentReport(report: BaselineExperimentReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
