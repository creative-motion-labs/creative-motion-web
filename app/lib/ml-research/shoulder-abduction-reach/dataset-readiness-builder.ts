/**
 * Shoulder Abduction Reach — dataset readiness builder (pure logic).
 * RASQ ML bridge, Slice 7 (2026-08-21).
 *
 * Builds inventory, label distribution, participant/rater coverage,
 * collection-gap analysis, labeling queue, and optional cross-artifact checks
 * from a Slice 4 manifest plus optional Slice 5 QC/training export.
 */

import type { ShoulderAbductionReachExclusionFlag } from "./label-schema";
import {
  SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS,
} from "./label-schema";
import { validateManifestLabelCompensationExclusionInvariant } from "./dataset-readiness-input-validation";
import { evaluateShoulderAbductionReachManifestIntegrity } from "./manifest-assembly";
import type {
  ShoulderAbductionReachManifestLabel,
  ShoulderAbductionReachManifestSample,
  ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";
import {
  TRAINING_EXPORT_SCHEMA_VERSION,
  type ShoulderAbductionTrainingExportQcReport,
  type ShoulderAbductionTrainingExportSample,
} from "./training-export-schema";
import { SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION_FOR_READINESS } from "./dataset-readiness-schema";
import {
  COLLECTION_GAP_CODES,
  DEFAULT_DATASET_READINESS_PLANNING_CONFIG,
  DATASET_READINESS_SCHEMA_VERSION,
  emptyCompensationClassCounts,
  emptyExclusionFlagCounts,
  emptySideCounts,
  type CollectionGap,
  type CompensationClassCounts,
  type CrossArtifactIntegrityResult,
  type DatasetCollectionStatus,
  type DatasetReadinessInventory,
  type DatasetReadinessLabelDistribution,
  type DatasetReadinessPlanningConfig,
  type LabelingQueueEntry,
  type LabelingQueueReport,
  type ManifestSampleLabelState,
  type ParticipantClassCoverageEntry,
  type ParticipantDistributionEntry,
  type RaterDistributionEntry,
  type ShoulderAbductionDatasetReadinessReport,
} from "./dataset-readiness-schema";

export type BuildDatasetReadinessInput = {
  manifest: ShoulderAbductionReachResearchManifest;
  sourceManifestSha256: string;
  qcReport?: ShoulderAbductionTrainingExportQcReport | null;
  sourceQcReportSha256?: string | null;
  trainingExportSamples?: readonly ShoulderAbductionTrainingExportSample[] | null;
  sourceTrainingExportSha256?: string | null;
  planningConfig?: DatasetReadinessPlanningConfig;
};

export function classifyManifestSampleLabelState(
  sample: ShoulderAbductionReachManifestSample,
): ManifestSampleLabelState {
  if (sample.labels.length === 0) {
    return "UNLABELED";
  }
  if (sample.labels.length > 1) {
    return "MULTI_RATER_UNRESOLVED";
  }
  const label = sample.labels[0];
  const invariantViolation = validateManifestLabelCompensationExclusionInvariant(
    label,
    `sample ${sample.sampleId}`,
  );
  if (invariantViolation !== null) {
    return "INVALID_LABEL";
  }
  if (label.exclusionFlag !== null) {
    return "THERAPIST_EXCLUDED";
  }
  if (label.compensationLabel !== null) {
    return "SUPERVISED_LABELED";
  }
  return "INVALID_LABEL";
}

export function collectManifestLabelInvariantViolations(
  manifest: ShoulderAbductionReachResearchManifest,
): string[] {
  const violations: string[] = [];

  for (const sample of manifest.samples) {
    for (let labelIndex = 0; labelIndex < sample.labels.length; labelIndex += 1) {
      const label = sample.labels[labelIndex];
      const violation = validateManifestLabelCompensationExclusionInvariant(
        label,
        `sample ${sample.sampleId} label[${labelIndex}]`,
      );
      if (violation !== null) {
        violations.push(violation);
      }
    }
  }

  return violations.sort((a, b) => a.localeCompare(b));
}

function isSupervisedEligibleSample(sample: ShoulderAbductionReachManifestSample): boolean {
  return classifyManifestSampleLabelState(sample) === "SUPERVISED_LABELED";
}

function incrementCompensationClass(
  counts: CompensationClassCounts,
  label: ShoulderAbductionReachManifestLabel["compensationLabel"],
): void {
  if (label === null) {
    return;
  }
  counts[label] += 1;
}

function incrementExclusionFlag(
  counts: ReturnType<typeof emptyExclusionFlagCounts>,
  flag: ShoulderAbductionReachExclusionFlag | null,
): void {
  if (flag === null) {
    return;
  }
  counts[flag] += 1;
}

function buildInventory(
  manifest: ShoulderAbductionReachResearchManifest,
  qcReport: ShoulderAbductionTrainingExportQcReport | null | undefined,
): DatasetReadinessInventory {
  const samples = manifest.samples;
  let therapistExcludedSamples = 0;
  let multiRaterSamples = 0;
  let supervisedLabeledSamples = 0;

  for (const sample of manifest.samples) {
    const state = classifyManifestSampleLabelState(sample);
    if (state === "THERAPIST_EXCLUDED") therapistExcludedSamples += 1;
    if (state === "MULTI_RATER_UNRESOLVED") multiRaterSamples += 1;
    if (state === "SUPERVISED_LABELED") supervisedLabeledSamples += 1;
  }

  const labeledSamples = samples.filter((sample) => sample.labels.length > 0).length;
  const unlabeledSamples = samples.length - labeledSamples;

  return {
    totalManifestSamples: samples.length,
    distinctParticipants: manifest.diagnostics.distinctParticipants,
    distinctSessions: manifest.diagnostics.distinctSessions,
    distinctRaters: manifest.diagnostics.distinctRaters,
    labeledSamples,
    unlabeledSamples,
    therapistExcludedSamples,
    multiRaterSamples,
    supervisedLabeledSamples,
    slice5TrainingCandidates:
      qcReport?.supervisedCandidatesExported ?? supervisedLabeledSamples,
    slice5RejectedSamples: qcReport
      ? qcReport.manifestSamplesReviewed - qcReport.supervisedCandidatesExported
      : null,
  };
}

function buildLabelDistribution(
  manifest: ShoulderAbductionReachResearchManifest,
): DatasetReadinessLabelDistribution {
  const compensationClasses = emptyCompensationClassCounts();
  const exclusionFlags = emptyExclusionFlagCounts();
  let unlabeled = 0;
  let multiRaterUnresolved = 0;

  for (const sample of manifest.samples) {
    const state = classifyManifestSampleLabelState(sample);
    if (state === "UNLABELED") {
      unlabeled += 1;
      continue;
    }
    if (state === "MULTI_RATER_UNRESOLVED") {
      multiRaterUnresolved += 1;
      for (const label of sample.labels) {
        incrementCompensationClass(compensationClasses, label.compensationLabel);
        incrementExclusionFlag(exclusionFlags, label.exclusionFlag);
      }
      continue;
    }
    if (state === "SUPERVISED_LABELED") {
      incrementCompensationClass(compensationClasses, sample.labels[0].compensationLabel);
      continue;
    }
    if (state === "THERAPIST_EXCLUDED") {
      incrementExclusionFlag(exclusionFlags, sample.labels[0].exclusionFlag);
    }
  }

  return {
    compensationClasses,
    exclusionFlags,
    unlabeled,
    multiRaterUnresolved,
  };
}

function buildParticipantDistribution(
  manifest: ShoulderAbductionReachResearchManifest,
): ParticipantDistributionEntry[] {
  const byParticipant = new Map<string, ParticipantDistributionEntry>();

  for (const sample of manifest.samples) {
    let entry = byParticipant.get(sample.participantId);
    if (!entry) {
      entry = {
        participantId: sample.participantId,
        sampleCount: 0,
        labeledCount: 0,
        unlabeledCount: 0,
        supervisedLabeledCount: 0,
        compensationClasses: emptyCompensationClassCounts(),
        sides: emptySideCounts(),
        sessionCount: 0,
        distinctParticipantsRepresented: 1,
      };
      byParticipant.set(sample.participantId, entry);
    }

    entry.sampleCount += 1;
    entry.sides[sample.side] += 1;

    const state = classifyManifestSampleLabelState(sample);
    if (state === "UNLABELED") {
      entry.unlabeledCount += 1;
    } else {
      entry.labeledCount += 1;
    }
    if (state === "SUPERVISED_LABELED") {
      entry.supervisedLabeledCount += 1;
      incrementCompensationClass(entry.compensationClasses, sample.labels[0].compensationLabel);
    }
  }

  const sessionSets = new Map<string, Set<string>>();
  for (const sample of manifest.samples) {
    let sessions = sessionSets.get(sample.participantId);
    if (!sessions) {
      sessions = new Set<string>();
      sessionSets.set(sample.participantId, sessions);
    }
    sessions.add(sample.devSessionId);
  }

  const entries = [...byParticipant.values()].sort((a, b) =>
    a.participantId.localeCompare(b.participantId),
  );

  for (const entry of entries) {
    entry.sessionCount = sessionSets.get(entry.participantId)?.size ?? 0;
  }

  return entries;
}

function buildRaterDistribution(
  manifest: ShoulderAbductionReachResearchManifest,
): RaterDistributionEntry[] {
  const byRater = new Map<string, RaterDistributionEntry>();

  for (const sample of manifest.samples) {
    for (const label of sample.labels) {
      let entry = byRater.get(label.raterId);
      if (!entry) {
        entry = {
          raterId: label.raterId,
          labelCount: 0,
          compensationClasses: emptyCompensationClassCounts(),
          exclusionCount: 0,
        };
        byRater.set(label.raterId, entry);
      }
      entry.labelCount += 1;
      if (label.exclusionFlag !== null) {
        entry.exclusionCount += 1;
      } else {
        incrementCompensationClass(entry.compensationClasses, label.compensationLabel);
      }
    }
  }

  return [...byRater.values()].sort((a, b) => a.raterId.localeCompare(b.raterId));
}

function buildParticipantClassCoverage(
  manifest: ShoulderAbductionReachResearchManifest,
): ParticipantClassCoverageEntry[] {
  const classParticipants = new Map<
    (typeof SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS)[number],
    { sampleCount: number; participantIds: Set<string> }
  >();

  for (const labelClass of SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS) {
    classParticipants.set(labelClass, { sampleCount: 0, participantIds: new Set() });
  }

  for (const sample of manifest.samples) {
    if (!isSupervisedEligibleSample(sample)) {
      continue;
    }
    const labelClass = sample.labels[0].compensationLabel;
    if (labelClass === null) {
      continue;
    }
    const bucket = classParticipants.get(labelClass);
    if (!bucket) {
      continue;
    }
    bucket.sampleCount += 1;
    bucket.participantIds.add(sample.participantId);
  }

  return SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS.map((compensationClass) => {
    const bucket = classParticipants.get(compensationClass)!;
    const participantIds = [...bucket.participantIds].sort((a, b) => a.localeCompare(b));
    return {
      compensationClass,
      observedSampleCount: bucket.sampleCount,
      distinctParticipants: participantIds.length,
      participantIds,
      singleParticipantOnly: participantIds.length === 1 && bucket.sampleCount > 0,
    };
  });
}

function buildLabelingQueueEntry(
  sample: ShoulderAbductionReachManifestSample,
  labelState: ManifestSampleLabelState,
  priorityRank: number,
): LabelingQueueEntry {
  return {
    sampleId: sample.sampleId,
    devSessionId: sample.devSessionId,
    repetitionId: sample.repetitionId,
    repetitionIndex: sample.repetitionIndex,
    side: sample.side,
    sourceLineReference: {
      relativeFilePath: sample.source.relativeFilePath,
      lineIndex: sample.source.lineIndex,
    },
    labelState,
    raterCount: sample.labels.length,
    priorityRank,
  };
}

export function buildLabelingQueue(
  manifest: ShoulderAbductionReachResearchManifest,
): LabelingQueueReport {
  const unlabeledSamples = manifest.samples
    .filter((sample) => classifyManifestSampleLabelState(sample) === "UNLABELED")
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  const multiRaterSamples = manifest.samples
    .filter((sample) => classifyManifestSampleLabelState(sample) === "MULTI_RATER_UNRESOLVED")
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  return {
    unlabeledQueue: unlabeledSamples.map((sample, index) =>
      buildLabelingQueueEntry(sample, "UNLABELED", index + 1),
    ),
    multiRaterQueue: multiRaterSamples.map((sample, index) =>
      buildLabelingQueueEntry(sample, "MULTI_RATER_UNRESOLVED", index + 1),
    ),
  };
}

export function verifyCrossArtifactIntegrity(input: {
  manifest: ShoulderAbductionReachResearchManifest;
  qcReport?: ShoulderAbductionTrainingExportQcReport | null;
  trainingExportSamples?: readonly ShoulderAbductionTrainingExportSample[] | null;
}): CrossArtifactIntegrityResult {
  const { manifest, qcReport, trainingExportSamples } = input;
  const checked = qcReport !== undefined || trainingExportSamples !== undefined;
  if (!checked) {
    return { checked: false, ok: true, failures: [] };
  }

  const failures: string[] = [];
  const manifestById = new Map(manifest.samples.map((sample) => [sample.sampleId, sample]));

  if (qcReport) {
    if (qcReport.manifestSchemaVersion !== manifest.manifestSchemaVersion) {
      failures.push(
        `manifest schema version mismatch: manifest=${manifest.manifestSchemaVersion}, qc=${qcReport.manifestSchemaVersion}`,
      );
    }
    if (qcReport.datasetVersion !== manifest.datasetVersion) {
      failures.push(
        `dataset version mismatch: manifest=${manifest.datasetVersion}, qc=${qcReport.datasetVersion}`,
      );
    }
    if (qcReport.manifestSamplesReviewed !== manifest.samples.length) {
      failures.push(
        `manifest sample count mismatch: manifest=${manifest.samples.length}, qc=${qcReport.manifestSamplesReviewed}`,
      );
    }
    if (
      trainingExportSamples &&
      qcReport.supervisedCandidatesExported !== trainingExportSamples.length
    ) {
      failures.push(
        `training candidate count mismatch: qc=${qcReport.supervisedCandidatesExported}, export=${trainingExportSamples.length}`,
      );
    }
  }

  if (trainingExportSamples) {
    const seenSampleIds = new Set<string>();

    for (const exportSample of trainingExportSamples) {
      if (exportSample.exportSchemaVersion !== TRAINING_EXPORT_SCHEMA_VERSION) {
        failures.push(
          `unsupported training export schema for ${exportSample.sampleId}: ${String(exportSample.exportSchemaVersion)}`,
        );
      }
      if (exportSample.exportSchemaVersion !== SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION_FOR_READINESS) {
        failures.push(
          `unsupported training export schema version for ${exportSample.sampleId}: ${String(exportSample.exportSchemaVersion)}`,
        );
      }

      if (seenSampleIds.has(exportSample.sampleId)) {
        failures.push(`duplicate training export sampleId: ${exportSample.sampleId}`);
      }
      seenSampleIds.add(exportSample.sampleId);

      const manifestSample = manifestById.get(exportSample.sampleId);
      if (!manifestSample) {
        failures.push(`training export sampleId absent from manifest: ${exportSample.sampleId}`);
        continue;
      }

      const state = classifyManifestSampleLabelState(manifestSample);
      if (state === "UNLABELED") {
        failures.push(`training export row for unlabeled manifest sample ${exportSample.sampleId}`);
      } else if (state === "THERAPIST_EXCLUDED") {
        failures.push(
          `training export row for therapist-excluded manifest sample ${exportSample.sampleId}`,
        );
      } else if (state === "MULTI_RATER_UNRESOLVED") {
        failures.push(
          `training export row for unresolved multi-rater manifest sample ${exportSample.sampleId}`,
        );
      } else if (state === "INVALID_LABEL") {
        failures.push(
          `training export row for invalid-label manifest sample ${exportSample.sampleId}`,
        );
      } else if (state !== "SUPERVISED_LABELED") {
        failures.push(
          `training export row for non-supervised manifest sample ${exportSample.sampleId} (state=${state})`,
        );
      }

      if (exportSample.provenance.participantId !== manifestSample.participantId) {
        failures.push(
          `participant mismatch for ${exportSample.sampleId}: manifest=${manifestSample.participantId}, export=${exportSample.provenance.participantId}`,
        );
      }

      if (exportSample.provenance.devSessionId !== manifestSample.devSessionId) {
        failures.push(
          `devSessionId mismatch for ${exportSample.sampleId}: manifest=${manifestSample.devSessionId}, export=${exportSample.provenance.devSessionId}`,
        );
      }

      if (exportSample.provenance.repetitionId !== manifestSample.repetitionId) {
        failures.push(
          `repetitionId mismatch for ${exportSample.sampleId}: manifest=${manifestSample.repetitionId}, export=${exportSample.provenance.repetitionId}`,
        );
      }

      if (exportSample.provenance.side !== manifestSample.side) {
        failures.push(
          `side mismatch for ${exportSample.sampleId}: manifest=${manifestSample.side}, export=${exportSample.provenance.side}`,
        );
      }

      if (exportSample.provenance.sourceLineIndex !== manifestSample.source.lineIndex) {
        failures.push(
          `sourceLineIndex mismatch for ${exportSample.sampleId}: manifest=${manifestSample.source.lineIndex}, export=${exportSample.provenance.sourceLineIndex}`,
        );
      }

      if (exportSample.provenance.datasetVersion !== manifest.datasetVersion) {
        failures.push(
          `dataset version mismatch for ${exportSample.sampleId}: manifest=${manifest.datasetVersion}, export=${exportSample.provenance.datasetVersion}`,
        );
      }

      if (state === "SUPERVISED_LABELED") {
        const manifestCompensationLabel = manifestSample.labels[0].compensationLabel;
        if (exportSample.target.compensationLabel !== manifestCompensationLabel) {
          failures.push(
            `compensationLabel mismatch for ${exportSample.sampleId}: manifest=${String(manifestCompensationLabel)}, export=${exportSample.target.compensationLabel}`,
          );
        }
      }
    }
  }

  return {
    checked: true,
    ok: failures.length === 0,
    failures: failures.sort((a, b) => a.localeCompare(b)),
  };
}

export function buildCollectionGaps(input: {
  manifest: ShoulderAbductionReachResearchManifest;
  inventory: DatasetReadinessInventory;
  labelDistribution: DatasetReadinessLabelDistribution;
  participantClassCoverage: ParticipantClassCoverageEntry[];
  crossArtifactIntegrity: CrossArtifactIntegrityResult;
  planningConfig: DatasetReadinessPlanningConfig;
}): CollectionGap[] {
  const {
    manifest,
    inventory,
    labelDistribution,
    participantClassCoverage,
    crossArtifactIntegrity,
    planningConfig,
  } = input;

  const gaps: CollectionGap[] = [];
  const integrity = evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics);
  const labelInvariantViolations = collectManifestLabelInvariantViolations(manifest);

  if (!integrity.ok) {
    gaps.push({
      code: "DATASET_INTEGRITY_BLOCKER",
      detail: integrity.blockingReasons.join("; "),
    });
  }

  if (labelInvariantViolations.length > 0) {
    gaps.push({
      code: "DATASET_INTEGRITY_BLOCKER",
      detail: labelInvariantViolations.join("; "),
    });
  }

  if (crossArtifactIntegrity.checked && !crossArtifactIntegrity.ok) {
    gaps.push({
      code: "CROSS_ARTIFACT_INTEGRITY_FAILURE",
      detail: crossArtifactIntegrity.failures.join("; "),
    });
  }

  if (inventory.distinctParticipants < planningConfig.minDistinctParticipants) {
    gaps.push({
      code: "NEED_MORE_DISTINCT_PARTICIPANTS",
      detail: `distinctParticipants=${inventory.distinctParticipants}, planningMinimum=${planningConfig.minDistinctParticipants}`,
    });
  }

  if (inventory.unlabeledSamples > 0) {
    gaps.push({
      code: "NEED_MORE_THERAPIST_LABELS",
      detail: `unlabeledSamples=${inventory.unlabeledSamples}`,
    });
  }

  for (const targetClass of planningConfig.targetCompensationClasses) {
    const coverage = participantClassCoverage.find(
      (entry) => entry.compensationClass === targetClass,
    );
    if (!coverage || coverage.observedSampleCount === 0) {
      gaps.push({
        code: "TARGET_CLASS_NOT_OBSERVED",
        detail: `targetClass=${targetClass}`,
      });
    }
  }

  for (const coverage of participantClassCoverage) {
    if (coverage.observedSampleCount === 0) {
      continue;
    }
    if (coverage.singleParticipantOnly) {
      gaps.push({
        code: "TARGET_CLASS_PARTICIPANT_COVERAGE_LOW",
        detail: `targetClass=${coverage.compensationClass}; distinctParticipants=1; participantId=${coverage.participantIds[0] ?? "unknown"}`,
      });
    } else if (
      coverage.distinctParticipants < planningConfig.minDistinctParticipantsPerTargetClass
    ) {
      gaps.push({
        code: "TARGET_CLASS_PARTICIPANT_COVERAGE_LOW",
        detail: `targetClass=${coverage.compensationClass}; distinctParticipants=${coverage.distinctParticipants}; planningMinimum=${planningConfig.minDistinctParticipantsPerTargetClass}`,
      });
    }
  }

  const supervisedCount = inventory.supervisedLabeledSamples;
  if (supervisedCount > 1) {
    const classCounts = labelDistribution.compensationClasses;
    const maxClassCount = Math.max(
      classCounts.NO_COMPENSATION,
      classCounts.MILD_COMPENSATION,
      classCounts.CLEAR_COMPENSATION,
    );
    const dominanceRatio = maxClassCount / supervisedCount;
    if (dominanceRatio >= planningConfig.classImbalanceDominanceThreshold) {
      gaps.push({
        code: "CLASS_DISTRIBUTION_IMBALANCED",
        detail: `dominantClassFraction=${dominanceRatio.toFixed(3)}; supervisedLabeledSamples=${supervisedCount}; planningThreshold=${planningConfig.classImbalanceDominanceThreshold}`,
      });
    }
  }

  if (inventory.multiRaterSamples > 0) {
    gaps.push({
      code: "MULTI_RATER_POLICY_REQUIRED",
      detail: `multiRaterSamples=${inventory.multiRaterSamples}`,
    });
  }

  if (inventory.distinctParticipants < 2) {
    gaps.push({
      code: "PARTICIPANT_SAFE_EVALUATION_NOT_POSSIBLE",
      detail: `distinctParticipants=${inventory.distinctParticipants}; participant-level train/test separation requires at least 2 participants`,
    });
  }

  const sorted = gaps.sort((a, b) => {
    const codeOrder =
      COLLECTION_GAP_CODES.indexOf(a.code) - COLLECTION_GAP_CODES.indexOf(b.code);
    if (codeOrder !== 0) {
      return codeOrder;
    }
    return a.detail.localeCompare(b.detail);
  });

  return sorted;
}

function resolveCollectionStatus(gaps: CollectionGap[]): DatasetCollectionStatus {
  const blockingCodes = new Set<CollectionGap["code"]>([
    "DATASET_INTEGRITY_BLOCKER",
    "CROSS_ARTIFACT_INTEGRITY_FAILURE",
    "NEED_MORE_DISTINCT_PARTICIPANTS",
    "NEED_MORE_THERAPIST_LABELS",
    "TARGET_CLASS_NOT_OBSERVED",
    "TARGET_CLASS_PARTICIPANT_COVERAGE_LOW",
    "MULTI_RATER_POLICY_REQUIRED",
    "PARTICIPANT_SAFE_EVALUATION_NOT_POSSIBLE",
  ]);

  const hasBlockingGap = gaps.some((gap) => blockingCodes.has(gap.code));
  return hasBlockingGap ? "DATA_COLLECTION_INCOMPLETE" : "READY_FOR_BASELINE_READINESS_CHECK";
}

export function buildShoulderAbductionDatasetReadinessReport(
  input: BuildDatasetReadinessInput,
): ShoulderAbductionDatasetReadinessReport {
  const planningConfig = input.planningConfig ?? DEFAULT_DATASET_READINESS_PLANNING_CONFIG;
  const inventory = buildInventory(input.manifest, input.qcReport);
  const labelDistribution = buildLabelDistribution(input.manifest);
  const participantDistribution = buildParticipantDistribution(input.manifest);
  const raterDistribution = buildRaterDistribution(input.manifest);
  const participantClassCoverage = buildParticipantClassCoverage(input.manifest);
  const crossArtifactIntegrity = verifyCrossArtifactIntegrity({
    manifest: input.manifest,
    qcReport: input.qcReport,
    trainingExportSamples: input.trainingExportSamples,
  });
  const collectionGaps = buildCollectionGaps({
    manifest: input.manifest,
    inventory,
    labelDistribution,
    participantClassCoverage,
    crossArtifactIntegrity,
    planningConfig,
  });
  const collectionStatus = resolveCollectionStatus(collectionGaps);

  return {
    readinessSchemaVersion: DATASET_READINESS_SCHEMA_VERSION,
    datasetVersion: input.manifest.datasetVersion,
    collectionStatus,
    inventory,
    labelDistribution,
    participantDistribution,
    raterDistribution,
    participantClassCoverage,
    collectionGaps,
    crossArtifactIntegrity,
    provenance: {
      readinessSchemaVersion: DATASET_READINESS_SCHEMA_VERSION,
      planningConfigVersion: planningConfig.configVersion,
      manifestSchemaVersion: input.manifest.manifestSchemaVersion,
      datasetVersion: input.manifest.datasetVersion,
      manifestSampleCount: input.manifest.samples.length,
      sourceManifestSha256: input.sourceManifestSha256,
      sourceQcReportSha256: input.sourceQcReportSha256 ?? null,
      sourceTrainingExportSha256: input.sourceTrainingExportSha256 ?? null,
      qcSchemaVersion: input.qcReport?.qcSchemaVersion ?? null,
      trainingExportSchemaVersion:
        input.trainingExportSamples?.[0]?.exportSchemaVersion ?? null,
    },
    planningConfig,
  };
}

export function buildDatasetReadinessCliSummaryLines(
  report: ShoulderAbductionDatasetReadinessReport,
): string[] {
  const lines = [
    `dataset status: ${report.collectionStatus}`,
    `manifest samples: ${report.inventory.totalManifestSamples}`,
    `participants: ${report.inventory.distinctParticipants}`,
    `labeled: ${report.inventory.labeledSamples}`,
    `unlabeled: ${report.inventory.unlabeledSamples}`,
    `supervised labeled: ${report.inventory.supervisedLabeledSamples}`,
    `training candidates: ${report.inventory.slice5TrainingCandidates}`,
  ];

  if (report.collectionGaps.length > 0) {
    lines.push("collection gaps:");
    for (const gap of report.collectionGaps) {
      lines.push(`  ${gap.code}: ${gap.detail}`);
    }
  }

  return lines;
}
