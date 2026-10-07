/**
 * Shoulder Abduction Reach — dev-only DATASET READINESS schema.
 * RASQ ML bridge, Slice 7 (2026-08-21).
 *
 * DEV/RESEARCH ONLY. A dataset-readiness report is a deterministic,
 * descriptive inventory of what research data currently exists, what remains
 * unlabeled or excluded, how participants/classes are distributed, and what
 * collection or labeling gaps remain before a real baseline experiment may be
 * attempted (Slice 6 remains the final gate).
 *
 * CRITICAL BOUNDARIES:
 *  - Slice 4 manifest is the primary descriptive source.
 *  - Slice 5 QC/training export are optional cross-check inputs only.
 *  - Unlabeled samples are NEVER treated as NO_COMPENSATION.
 *  - Therapist free-text notes are NEVER included in readiness outputs.
 *  - No compensation predictions or deterministic compensation features leak
 *    into the labeling queue.
 *  - Collection-gap codes are research-planning signals, NOT clinical or
 *    statistical validity claims.
 */

import { SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS } from "./label-schema";
import { ML_RESEARCH_MANIFEST_SCHEMA_VERSION } from "./manifest-schema";
import {
  TRAINING_EXPORT_QC_SCHEMA_VERSION,
  TRAINING_EXPORT_SCHEMA_VERSION,
} from "./training-export-schema";

/** Bumped whenever the canonical readiness report shape changes. */
export const DATASET_READINESS_SCHEMA_VERSION =
  "shoulder-abduction-dataset-readiness-v1" as const;

/**
 * Planning-configuration version — thresholds below are methodology planning
 * only, NOT claims of clinical or statistical sufficiency.
 */
export const DATASET_READINESS_PLANNING_CONFIG_VERSION =
  "shoulder-abduction-dataset-readiness-planning-v1" as const;

/**
 * Slice 7 collection-readiness status. Distinct from Slice 6 experiment
 * readiness — this only signals whether data collection/labeling appears
 * complete enough for Slice 6 to attempt its own independent validation.
 */
export type DatasetCollectionStatus =
  | "DATA_COLLECTION_INCOMPLETE"
  | "READY_FOR_BASELINE_READINESS_CHECK";

export const COLLECTION_GAP_CODES = [
  "NEED_MORE_DISTINCT_PARTICIPANTS",
  "NEED_MORE_THERAPIST_LABELS",
  "TARGET_CLASS_NOT_OBSERVED",
  "TARGET_CLASS_PARTICIPANT_COVERAGE_LOW",
  "CLASS_DISTRIBUTION_IMBALANCED",
  "MULTI_RATER_POLICY_REQUIRED",
  "PARTICIPANT_SAFE_EVALUATION_NOT_POSSIBLE",
  "DATASET_INTEGRITY_BLOCKER",
  "CROSS_ARTIFACT_INTEGRITY_FAILURE",
] as const;

export type CollectionGapCode = (typeof COLLECTION_GAP_CODES)[number];

export type CollectionGap = {
  code: CollectionGapCode;
  /** Descriptive detail — not a clinical sample-size claim. */
  detail: string;
};

/** Per-sample label state derived from manifest labels only. */
export type ManifestSampleLabelState =
  | "UNLABELED"
  | "SUPERVISED_LABELED"
  | "THERAPIST_EXCLUDED"
  | "MULTI_RATER_UNRESOLVED"
  | "INVALID_LABEL";

export type CompensationClassCounts = {
  NO_COMPENSATION: number;
  MILD_COMPENSATION: number;
  CLEAR_COMPENSATION: number;
};

export type ExclusionFlagCounts = {
  WRONG_MOVEMENT_PLANE: number;
  INCOMPLETE_REPETITION: number;
  NOT_REVIEWABLE: number;
};

export type SideCounts = {
  left: number;
  right: number;
};

export type DatasetReadinessInventory = {
  totalManifestSamples: number;
  distinctParticipants: number;
  distinctSessions: number;
  distinctRaters: number;
  /** Samples with at least one attached therapist label. */
  labeledSamples: number;
  /** Samples with zero therapist labels — never treated as NO_COMPENSATION. */
  unlabeledSamples: number;
  /** Samples with a single therapist exclusion label. */
  therapistExcludedSamples: number;
  /** Samples with more than one independent rater label. */
  multiRaterSamples: number;
  /** Samples with exactly one non-exclusion compensation label. */
  supervisedLabeledSamples: number;
  /** Slice 5 eligible training candidates when QC/export supplied; otherwise computed from manifest eligibility rules. */
  slice5TrainingCandidates: number;
  /** Rejected/non-candidate samples when QC information is available. */
  slice5RejectedSamples: number | null;
};

export type DatasetReadinessLabelDistribution = {
  compensationClasses: CompensationClassCounts;
  exclusionFlags: ExclusionFlagCounts;
  unlabeled: number;
  multiRaterUnresolved: number;
};

export type ParticipantDistributionEntry = {
  participantId: string;
  sampleCount: number;
  labeledCount: number;
  unlabeledCount: number;
  supervisedLabeledCount: number;
  compensationClasses: CompensationClassCounts;
  sides: SideCounts;
  sessionCount: number;
  /** True when every supervised label for this participant comes from the same participant (always true per entry; used for cross-participant coverage). */
  distinctParticipantsRepresented: 1;
};

export type RaterDistributionEntry = {
  raterId: string;
  labelCount: number;
  compensationClasses: CompensationClassCounts;
  exclusionCount: number;
};

export type ParticipantClassCoverageEntry = {
  compensationClass: (typeof SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS)[number];
  observedSampleCount: number;
  distinctParticipants: number;
  participantIds: string[];
  /** True when all observed samples for this class come from one participant. */
  singleParticipantOnly: boolean;
};

export type CrossArtifactIntegrityResult = {
  checked: boolean;
  ok: boolean;
  failures: string[];
};

/**
 * Methodology planning thresholds only — NOT clinical/statistical proof.
 * Used to emit descriptive collection-gap codes.
 */
export type DatasetReadinessPlanningConfig = {
  configVersion: typeof DATASET_READINESS_PLANNING_CONFIG_VERSION;
  /** Minimum distinct participants before collection may appear ready for Slice 6 check. */
  minDistinctParticipants: number;
  /** Target compensation classes expected for baseline experiment planning. */
  targetCompensationClasses: readonly (typeof SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS)[number][];
  /** Minimum distinct participants that should contribute to each observed target class. */
  minDistinctParticipantsPerTargetClass: number;
  /**
   * When a single compensation class accounts for more than this fraction of
   * supervised labeled samples (and supervised count > 1), emit imbalance gap.
   */
  classImbalanceDominanceThreshold: number;
};

export const DEFAULT_DATASET_READINESS_PLANNING_CONFIG: DatasetReadinessPlanningConfig = {
  configVersion: DATASET_READINESS_PLANNING_CONFIG_VERSION,
  minDistinctParticipants: 2,
  targetCompensationClasses: SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS,
  minDistinctParticipantsPerTargetClass: 2,
  classImbalanceDominanceThreshold: 0.8,
};

export type DatasetReadinessProvenance = {
  readinessSchemaVersion: typeof DATASET_READINESS_SCHEMA_VERSION;
  planningConfigVersion: typeof DATASET_READINESS_PLANNING_CONFIG_VERSION;
  manifestSchemaVersion: string;
  datasetVersion: string;
  manifestSampleCount: number;
  sourceManifestSha256: string;
  sourceQcReportSha256: string | null;
  sourceTrainingExportSha256: string | null;
  qcSchemaVersion: string | null;
  trainingExportSchemaVersion: string | null;
};

export type LabelingQueueEntry = {
  sampleId: string;
  devSessionId: string;
  repetitionId: string;
  repetitionIndex: number;
  side: "left" | "right";
  sourceLineReference: {
    relativeFilePath: string;
    lineIndex: number;
  };
  labelState: ManifestSampleLabelState;
  raterCount: number;
  /** Deterministic queue priority rank (lower = higher priority). */
  priorityRank: number;
};

export type LabelingQueueReport = {
  /** Completely unlabeled samples — highest labeling priority. */
  unlabeledQueue: LabelingQueueEntry[];
  /** Multi-rater samples requiring explicit adjudication policy — separate queue. */
  multiRaterQueue: LabelingQueueEntry[];
};

export type ShoulderAbductionDatasetReadinessReport = {
  readinessSchemaVersion: typeof DATASET_READINESS_SCHEMA_VERSION;
  datasetVersion: string;
  collectionStatus: DatasetCollectionStatus;
  inventory: DatasetReadinessInventory;
  labelDistribution: DatasetReadinessLabelDistribution;
  participantDistribution: ParticipantDistributionEntry[];
  raterDistribution: RaterDistributionEntry[];
  participantClassCoverage: ParticipantClassCoverageEntry[];
  collectionGaps: CollectionGap[];
  crossArtifactIntegrity: CrossArtifactIntegrityResult;
  provenance: DatasetReadinessProvenance;
  planningConfig: DatasetReadinessPlanningConfig;
};

export function emptyCompensationClassCounts(): CompensationClassCounts {
  return {
    NO_COMPENSATION: 0,
    MILD_COMPENSATION: 0,
    CLEAR_COMPENSATION: 0,
  };
}

export function emptyExclusionFlagCounts(): ExclusionFlagCounts {
  return {
    WRONG_MOVEMENT_PLANE: 0,
    INCOMPLETE_REPETITION: 0,
    NOT_REVIEWABLE: 0,
  };
}

export function emptySideCounts(): SideCounts {
  return { left: 0, right: 0 };
}

/**
 * Canonical text form of the readiness report. Deterministic — no timestamps.
 */
export function serializeDatasetReadinessReport(
  report: ShoulderAbductionDatasetReadinessReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function serializeLabelingQueueReport(report: LabelingQueueReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export const SUPPORTED_MANIFEST_SCHEMA_VERSION = ML_RESEARCH_MANIFEST_SCHEMA_VERSION;
export const SUPPORTED_QC_SCHEMA_VERSION = TRAINING_EXPORT_QC_SCHEMA_VERSION;
export const SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION_FOR_READINESS =
  TRAINING_EXPORT_SCHEMA_VERSION;
