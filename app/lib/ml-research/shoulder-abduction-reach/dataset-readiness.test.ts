/**
 * Slice 7 dataset readiness — behavioral tests over synthetic in-memory fixtures.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/dataset-readiness.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
} from "./capture-schema";
import { ML_RESEARCH_DATASET_VERSION, ML_RESEARCH_LABEL_SCHEMA_VERSION } from "./label-schema";
import {
  buildLabelingQueue,
  buildShoulderAbductionDatasetReadinessReport,
  classifyManifestSampleLabelState,
  collectManifestLabelInvariantViolations,
  verifyCrossArtifactIntegrity,
} from "./dataset-readiness-builder";
import { validateShoulderAbductionReachManifestForDatasetReadiness } from "./dataset-readiness-input-validation";
import {
  DATASET_READINESS_SCHEMA_VERSION,
  serializeDatasetReadinessReport,
  type ShoulderAbductionDatasetReadinessReport,
} from "./dataset-readiness-schema";
import {
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  type ShoulderAbductionReachManifestSample,
  type ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";
import {
  TRAINING_EXPORT_QC_SCHEMA_VERSION,
  TRAINING_EXPORT_SCHEMA_VERSION,
  type ShoulderAbductionTrainingExportQcReport,
  type ShoulderAbductionTrainingExportSample,
} from "./training-export-schema";

const SESSION = "fixture-session-readiness";
const PARTICIPANT_A = "fixture-participant-a";
const PARTICIPANT_B = "fixture-participant-b";
const RATER_A = "fixture-rater-a";
const RATER_B = "fixture-rater-b";

function manifestLabel(
  overrides: {
    raterId?: string;
    compensationLabel?: "NO_COMPENSATION" | "MILD_COMPENSATION" | "CLEAR_COMPENSATION" | null;
    exclusionFlag?: "WRONG_MOVEMENT_PLANE" | "INCOMPLETE_REPETITION" | "NOT_REVIEWABLE" | null;
    note?: string;
  } = {},
) {
  const hasExclusion = overrides.exclusionFlag !== undefined && overrides.exclusionFlag !== null;
  return {
    labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    raterId: overrides.raterId ?? RATER_A,
    compensationLabel: hasExclusion
      ? null
      : (overrides.compensationLabel ?? "MILD_COMPENSATION"),
    exclusionFlag: hasExclusion ? overrides.exclusionFlag! : null,
    raterConfidence: "high" as const,
    note: overrides.note ?? "sensitive therapist note must not appear in readiness output",
    labeledAtMs: 1_700_000_000_000,
  };
}

function manifestSample(
  overrides: Partial<ShoulderAbductionReachManifestSample> = {},
): ShoulderAbductionReachManifestSample {
  const sourceLineIndex = overrides.sourceLineIndex ?? 0;
  return {
    sampleId: overrides.sampleId ?? `${SESSION}#${sourceLineIndex}`,
    devSessionId: overrides.devSessionId ?? SESSION,
    sourceLineIndex,
    repetitionId: overrides.repetitionId ?? `${SESSION}-rep-${sourceLineIndex}`,
    repetitionIndex: overrides.repetitionIndex ?? sourceLineIndex + 1,
    side: overrides.side ?? "right",
    participantId: overrides.participantId ?? PARTICIPANT_A,
    movementType: "shoulder_abduction_reach",
    captureSchemaVersion: overrides.captureSchemaVersion ?? ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
    featureSchemaVersion: overrides.featureSchemaVersion ?? ML_RESEARCH_FEATURE_SCHEMA_VERSION,
    source: overrides.source ?? {
      kind: "capture_jsonl_line",
      relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${SESSION}.jsonl`,
      lineIndex: sourceLineIndex,
      frameCount: 3,
    },
    labels: overrides.labels ?? [],
  };
}

function cleanManifest(
  samples: ShoulderAbductionReachManifestSample[],
): ShoulderAbductionReachResearchManifest {
  const distinctParticipants = new Set(samples.map((sample) => sample.participantId)).size;
  const distinctSessions = new Set(samples.map((sample) => sample.devSessionId)).size;
  const raters = new Set<string>();
  let labeledSamples = 0;
  let excludedLabels = 0;
  let compensationLabels = 0;

  for (const sample of samples) {
    if (sample.labels.length > 0) labeledSamples += 1;
    for (const label of sample.labels) {
      raters.add(label.raterId);
      if (label.exclusionFlag !== null) excludedLabels += 1;
      if (label.compensationLabel !== null) compensationLabels += 1;
    }
  }

  return {
    manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    scope: { devSessionIds: [SESSION] },
    samples,
    diagnostics: {
      captureRecordsRead: samples.length,
      labelRecordsRead: samples.reduce((sum, sample) => sum + sample.labels.length, 0),
      manifestSamplesProduced: samples.length,
      labeledSamples,
      unlabeledSamples: samples.length - labeledSamples,
      totalAcceptedLabels: samples.reduce((sum, sample) => sum + sample.labels.length, 0),
      excludedLabels,
      compensationLabels,
      distinctParticipants,
      distinctSessions,
      distinctRaters: raters.size,
      malformedCaptureRecords: 0,
      malformedLabelRecords: 0,
      orphanLabels: 0,
      labelIdentityMismatches: 0,
      incompatibleVersionRecords: 0,
      supersededLabelRevisions: 0,
      missingCaptureSessions: [],
      rejections: [],
    },
  };
}

function buildReport(
  manifest: ShoulderAbductionReachResearchManifest,
  extras: {
    qcReport?: ShoulderAbductionTrainingExportQcReport;
    trainingExportSamples?: ShoulderAbductionTrainingExportSample[];
  } = {},
): ShoulderAbductionDatasetReadinessReport {
  return buildShoulderAbductionDatasetReadinessReport({
    manifest,
    sourceManifestSha256: "fixture-manifest-sha256",
    qcReport: extras.qcReport,
    sourceQcReportSha256: extras.qcReport ? "fixture-qc-sha256" : null,
    trainingExportSamples: extras.trainingExportSamples,
    sourceTrainingExportSha256: extras.trainingExportSamples ? "fixture-export-sha256" : null,
  });
}

function qcReportFromManifest(
  manifest: ShoulderAbductionReachResearchManifest,
  supervisedCandidatesExported: number,
): ShoulderAbductionTrainingExportQcReport {
  return {
    qcSchemaVersion: TRAINING_EXPORT_QC_SCHEMA_VERSION,
    datasetIntegrityOk: true,
    datasetIntegrityBlockers: [],
    manifestSchemaVersion: manifest.manifestSchemaVersion,
    datasetVersion: manifest.datasetVersion,
    manifestSamplesReviewed: manifest.samples.length,
    supervisedCandidatesExported,
    rejectionCounts: {
      UNLABELED: manifest.samples.length - supervisedCandidatesExported,
      THERAPIST_EXCLUSION: 0,
      MULTI_RATER_REQUIRES_POLICY: 0,
      SOURCE_NOT_FOUND: 0,
      SOURCE_LINE_MISSING: 0,
      SOURCE_IDENTITY_MISMATCH: 0,
      UNSUPPORTED_CAPTURE_SCHEMA: 0,
      UNSUPPORTED_FEATURE_SCHEMA: 0,
      MALFORMED_SOURCE_LINE: 0,
      MALFORMED_SOURCE_RECORD: 0,
      DUPLICATE_MANIFEST_SAMPLE_IDENTITY: 0,
    },
    exclusionFlagCounts: {
      WRONG_MOVEMENT_PLANE: 0,
      INCOMPLETE_REPETITION: 0,
      NOT_REVIEWABLE: 0,
    },
    exportedDistributions: {
      compensationLabels: {
        NO_COMPENSATION: 0,
        MILD_COMPENSATION: supervisedCandidatesExported,
        CLEAR_COMPENSATION: 0,
      },
      raterConfidence: { low: 0, medium: 0, high: supervisedCandidatesExported },
      sides: { left: 0, right: supervisedCandidatesExported },
      distinctParticipants: 1,
      distinctSessions: 1,
      distinctRaters: 1,
      participantLevelSplitPossible: false,
    },
    captureSchemaVersions: [ML_RESEARCH_CAPTURE_SCHEMA_VERSION],
    featureSchemaVersions: [ML_RESEARCH_FEATURE_SCHEMA_VERSION],
    labelSchemaVersions: [ML_RESEARCH_LABEL_SCHEMA_VERSION],
    rejectedSamples: [],
    exportContentSha256: null,
  };
}

function exportSampleFromManifestSample(
  sample: ShoulderAbductionReachManifestSample,
): ShoulderAbductionTrainingExportSample {
  const label = sample.labels[0];
  return {
    exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    sampleId: sample.sampleId,
    provenance: {
      participantId: sample.participantId,
      devSessionId: sample.devSessionId,
      sourceLineIndex: sample.sourceLineIndex,
      repetitionId: sample.repetitionId,
      repetitionIndex: sample.repetitionIndex,
      side: sample.side,
      movementType: sample.movementType,
      captureSchemaVersion: sample.captureSchemaVersion,
      featureSchemaVersion: sample.featureSchemaVersion,
      labelSchemaVersion: label.labelSchemaVersion,
      manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      raterId: label.raterId,
      labeledAtMs: label.labeledAtMs,
      manifestSourceReference: sample.source,
    },
    input: { frames: [] },
    target: { compensationLabel: label.compensationLabel! },
    qc: {
      raterConfidence: label.raterConfidence,
      trackingQuality: {
        framesTotal: 3,
        framesWithUsableAngle: 3,
        usableFrameRatio: 1,
      },
      frameCount: 3,
      movementDurationMs: 1000,
      reviewCaution: false,
    },
  };
}

describe("dataset readiness inventory", () => {
  it("counts total, labeled, unlabeled, exclusions, and compensation classes correctly", () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, labels: [] }),
      manifestSample({
        sourceLineIndex: 1,
        labels: [manifestLabel({ compensationLabel: "NO_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 2,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 3,
        labels: [manifestLabel({ exclusionFlag: "NOT_REVIEWABLE" })],
      }),
      manifestSample({
        sourceLineIndex: 4,
        labels: [
          manifestLabel({ raterId: RATER_A, compensationLabel: "CLEAR_COMPENSATION" }),
          manifestLabel({ raterId: RATER_B, compensationLabel: "MILD_COMPENSATION" }),
        ],
      }),
    ]);

    const report = buildReport(manifest);

    assert.equal(report.inventory.totalManifestSamples, 5);
    assert.equal(report.inventory.unlabeledSamples, 1);
    assert.equal(report.inventory.labeledSamples, 4);
    assert.equal(report.inventory.therapistExcludedSamples, 1);
    assert.equal(report.inventory.multiRaterSamples, 1);
    assert.equal(report.inventory.supervisedLabeledSamples, 2);
    assert.equal(report.labelDistribution.compensationClasses.NO_COMPENSATION, 1);
    assert.equal(report.labelDistribution.compensationClasses.MILD_COMPENSATION, 2);
    assert.equal(report.labelDistribution.compensationClasses.CLEAR_COMPENSATION, 1);
    assert.equal(report.labelDistribution.exclusionFlags.NOT_REVIEWABLE, 1);
    assert.equal(report.labelDistribution.unlabeled, 1);
    assert.equal(report.labelDistribution.multiRaterUnresolved, 1);
  });

  it("does not convert multi-rater samples into consensus labels", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [
          manifestLabel({ raterId: RATER_A, compensationLabel: "NO_COMPENSATION" }),
          manifestLabel({ raterId: RATER_B, compensationLabel: "CLEAR_COMPENSATION" }),
        ],
      }),
    ]);

    const report = buildReport(manifest);
    assert.equal(classifyManifestSampleLabelState(manifest.samples[0]), "MULTI_RATER_UNRESOLVED");
    assert.equal(report.inventory.supervisedLabeledSamples, 0);
    assert.equal(report.inventory.multiRaterSamples, 1);
  });
});

describe("participant coverage", () => {
  it("counts repeated reps from the same participant as one participant", () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, participantId: PARTICIPANT_A, labels: [] }),
      manifestSample({ sourceLineIndex: 1, participantId: PARTICIPANT_A, labels: [] }),
      manifestSample({ sourceLineIndex: 2, participantId: PARTICIPANT_A, labels: [] }),
    ]);

    const report = buildReport(manifest);
    assert.equal(report.inventory.distinctParticipants, 1);
    assert.equal(report.participantDistribution.length, 1);
    assert.equal(report.participantDistribution[0].sampleCount, 3);
  });

  it("reports participant distribution and class-by-participant coverage", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        participantId: PARTICIPANT_A,
        labels: [manifestLabel({ compensationLabel: "NO_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 1,
        participantId: PARTICIPANT_B,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
      manifestSample({ sourceLineIndex: 2, participantId: PARTICIPANT_B, labels: [] }),
    ]);

    const report = buildReport(manifest);
    assert.equal(report.participantDistribution.length, 2);
    const participantB = report.participantDistribution.find(
      (entry) => entry.participantId === PARTICIPANT_B,
    );
    assert.ok(participantB);
    assert.equal(participantB.unlabeledCount, 1);
    assert.equal(participantB.supervisedLabeledCount, 1);
    assert.equal(participantB.compensationClasses.MILD_COMPENSATION, 1);
  });

  it("does not treat one participant as dataset diverse", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [manifestLabel({ compensationLabel: "NO_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 1,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 2,
        labels: [manifestLabel({ compensationLabel: "CLEAR_COMPENSATION" })],
      }),
    ]);

    const report = buildReport(manifest);
    assert.equal(report.collectionStatus, "DATA_COLLECTION_INCOMPLETE");
    assert.ok(
      report.collectionGaps.some((gap) => gap.code === "NEED_MORE_DISTINCT_PARTICIPANTS"),
    );
    assert.ok(
      report.collectionGaps.some((gap) => gap.code === "PARTICIPANT_SAFE_EVALUATION_NOT_POSSIBLE"),
    );
  });

  it("flags classes represented by only one participant", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        participantId: PARTICIPANT_A,
        labels: [manifestLabel({ compensationLabel: "NO_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 1,
        participantId: PARTICIPANT_B,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
    ]);

    const report = buildReport(manifest);
    const noCompCoverage = report.participantClassCoverage.find(
      (entry) => entry.compensationClass === "NO_COMPENSATION",
    );
    assert.ok(noCompCoverage);
    assert.equal(noCompCoverage.singleParticipantOnly, true);
    assert.ok(
      report.collectionGaps.some(
        (gap) =>
          gap.code === "TARGET_CLASS_PARTICIPANT_COVERAGE_LOW" &&
          gap.detail.includes("NO_COMPENSATION"),
      ),
    );
  });
});

describe("labeling queue", () => {
  it("includes unlabeled samples with deterministic ordering and excludes labeled samples", () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 2, labels: [] }),
      manifestSample({ sourceLineIndex: 0, labels: [] }),
      manifestSample({
        sourceLineIndex: 1,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 3,
        labels: [manifestLabel({ exclusionFlag: "NOT_REVIEWABLE" })],
      }),
    ]);

    const queue = buildLabelingQueue(manifest);
    assert.equal(queue.unlabeledQueue.length, 2);
    assert.deepEqual(
      queue.unlabeledQueue.map((entry) => entry.sampleId),
      [`${SESSION}#0`, `${SESSION}#2`],
    );
    assert.equal(queue.multiRaterQueue.length, 0);
  });

  it("handles exclusions separately and keeps multi-rater samples in a separate queue", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [
          manifestLabel({ raterId: RATER_A, compensationLabel: "NO_COMPENSATION" }),
          manifestLabel({ raterId: RATER_B, compensationLabel: "CLEAR_COMPENSATION" }),
        ],
      }),
    ]);

    const queue = buildLabelingQueue(manifest);
    assert.equal(queue.unlabeledQueue.length, 0);
    assert.equal(queue.multiRaterQueue.length, 1);
    assert.equal(queue.multiRaterQueue[0].labelState, "MULTI_RATER_UNRESOLVED");
  });

  it("does not leak predicted class, compensation features, or therapist notes", () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, labels: [] }),
    ]);
    const queue = buildLabelingQueue(manifest);
    const serialized = JSON.stringify(queue);
    assert.doesNotMatch(serialized, /compensationLabel/);
    assert.doesNotMatch(serialized, /peakNormalizedTrunkDriftRatio/);
    assert.doesNotMatch(serialized, /sensitive therapist note/);
    assert.doesNotMatch(serialized, /note/);
  });

  it("does not expose participantId or other hidden identity fields in queue entries", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        participantId: PARTICIPANT_A,
        labels: [],
      }),
      manifestSample({
        sourceLineIndex: 1,
        participantId: PARTICIPANT_B,
        labels: [
          manifestLabel({ raterId: RATER_A, compensationLabel: "NO_COMPENSATION" }),
          manifestLabel({ raterId: RATER_B, compensationLabel: "CLEAR_COMPENSATION" }),
        ],
      }),
      manifestSample({
        sourceLineIndex: 2,
        participantId: PARTICIPANT_B,
        labels: [],
      }),
    ]);

    const queue = buildLabelingQueue(manifest);
    const allEntries = [...queue.unlabeledQueue, ...queue.multiRaterQueue];
    assert.equal(queue.unlabeledQueue.length, 2);
    assert.deepEqual(
      queue.unlabeledQueue.map((entry) => entry.sampleId),
      [`${SESSION}#0`, `${SESSION}#2`],
    );
    assert.equal(queue.multiRaterQueue.length, 1);
    assert.equal(queue.multiRaterQueue[0]!.sampleId, `${SESSION}#1`);

    for (const entry of allEntries) {
      assert.equal("participantId" in entry, false);
      assert.equal("raterId" in entry, false);
      assert.equal("compensationLabel" in entry, false);
      assert.equal("exclusionFlag" in entry, false);
      assert.equal("note" in entry, false);
    }

    const serialized = JSON.stringify(queue);
    assert.doesNotMatch(serialized, /fixture-participant-a/i);
    assert.doesNotMatch(serialized, /fixture-participant-b/i);
    assert.doesNotMatch(serialized, /"participantId"/);
    assert.doesNotMatch(serialized, /"raterId"/);
  });
});

describe("collection gap analysis", () => {
  it("emits expected gap codes for a single-participant mostly-unlabeled dataset", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
      ...Array.from({ length: 3 }, (_unused, index) =>
        manifestSample({ sourceLineIndex: index + 1, labels: [] }),
      ),
    ]);

    const report = buildReport(manifest);
    assert.equal(report.collectionStatus, "DATA_COLLECTION_INCOMPLETE");
    assert.ok(
      report.collectionGaps.some((gap) => gap.code === "NEED_MORE_DISTINCT_PARTICIPANTS"),
    );
    assert.ok(report.collectionGaps.some((gap) => gap.code === "NEED_MORE_THERAPIST_LABELS"));
    assert.ok(report.collectionGaps.some((gap) => gap.code === "TARGET_CLASS_NOT_OBSERVED"));
    assert.doesNotMatch(
      JSON.stringify(report.collectionGaps),
      /clinically sufficient|statistically sufficient|ground truth/i,
    );
  });

  it("does not emit arbitrary clinical sample-size claims", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        participantId: PARTICIPANT_A,
        labels: [manifestLabel({ compensationLabel: "NO_COMPENSATION" })],
      }),
      manifestSample({
        sourceLineIndex: 1,
        participantId: PARTICIPANT_B,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
    ]);

    const report = buildReport(manifest);
    for (const gap of report.collectionGaps) {
      assert.doesNotMatch(gap.detail, /clinically|statistically|sufficient sample size/i);
    }
  });
});

describe("cross-artifact integrity", () => {
  it("passes for a valid manifest/QC/export combination", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised, manifestSample({ sourceLineIndex: 1, labels: [] })]);
    const exportSample = exportSampleFromManifestSample(supervised);
    const qcReport = qcReportFromManifest(manifest, 1);

    const result = verifyCrossArtifactIntegrity({
      manifest,
      qcReport,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
  });

  it("fails when export sample is absent from manifest", () => {
    const manifest = cleanManifest([manifestSample({ sourceLineIndex: 0, labels: [] })]);
    const exportSample = exportSampleFromManifestSample(
      manifestSample({
        sourceLineIndex: 99,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
    );

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("absent from manifest")));
  });

  it("fails on participant mismatch and dataset-version mismatch", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised]);
    const exportSample = exportSampleFromManifestSample(supervised);
    exportSample.provenance.participantId = "wrong-participant";
    exportSample.provenance.datasetVersion = "wrong-dataset-version";

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("participant mismatch")));
    assert.ok(result.failures.some((failure) => failure.includes("dataset version mismatch")));
  });

  it("fails when training export includes an unlabeled manifest sample", () => {
    const unlabeled = manifestSample({ sourceLineIndex: 0, labels: [] });
    const manifest = cleanManifest([unlabeled]);
    const exportSample = exportSampleFromManifestSample(
      manifestSample({
        sourceLineIndex: 0,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
    );

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("unlabeled manifest sample")));
  });

  it("fails on dataset-version mismatch between manifest and QC report", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
    ]);
    const qcReport = qcReportFromManifest(manifest, 1);
    qcReport.datasetVersion = "wrong-dataset-version";

    const result = verifyCrossArtifactIntegrity({ manifest, qcReport });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("dataset version mismatch")));
  });

  it("fails on wrong repetitionId with correct sampleId and participantId", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised]);
    const exportSample = exportSampleFromManifestSample(supervised);
    exportSample.provenance.repetitionId = "wrong-repetition-id";

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("repetitionId mismatch")));
  });

  it("fails on wrong side", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      side: "right",
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised]);
    const exportSample = exportSampleFromManifestSample(supervised);
    exportSample.provenance.side = "left";

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("side mismatch")));
  });

  it("fails on wrong devSessionId", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised]);
    const exportSample = exportSampleFromManifestSample(supervised);
    exportSample.provenance.devSessionId = "wrong-session";

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("devSessionId mismatch")));
  });

  it("fails on wrong sourceLineIndex", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised]);
    const exportSample = exportSampleFromManifestSample(supervised);
    exportSample.provenance.sourceLineIndex = 99;

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("sourceLineIndex mismatch")));
  });

  it("fails on wrong target.compensationLabel", () => {
    const supervised = manifestSample({
      sourceLineIndex: 0,
      labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
    });
    const manifest = cleanManifest([supervised]);
    const exportSample = exportSampleFromManifestSample(supervised);
    exportSample.target.compensationLabel = "CLEAR_COMPENSATION";

    const result = verifyCrossArtifactIntegrity({
      manifest,
      trainingExportSamples: [exportSample],
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes("compensationLabel mismatch")));
  });
});

describe("determinism", () => {
  it("produces byte-identical serialized readiness reports for identical inputs", () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, labels: [] }),
      manifestSample({
        sourceLineIndex: 1,
        labels: [manifestLabel({ compensationLabel: "MILD_COMPENSATION" })],
      }),
    ]);

    const first = serializeDatasetReadinessReport(buildReport(manifest));
    const second = serializeDatasetReadinessReport(buildReport(manifest));
    assert.equal(first, second);
    assert.match(first, new RegExp(DATASET_READINESS_SCHEMA_VERSION));
  });
});

describe("planning configuration boundary", () => {
  it("uses explicit planning configuration only for gap thresholds", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        participantId: PARTICIPANT_A,
        labels: [manifestLabel({ compensationLabel: "NO_COMPENSATION" })],
      }),
      manifestSample({ sourceLineIndex: 1, participantId: PARTICIPANT_A, labels: [] }),
    ]);

    const report = buildReport(manifest);
    assert.ok(
      report.collectionGaps.some(
        (gap) =>
          gap.code === "NEED_MORE_DISTINCT_PARTICIPANTS" &&
          gap.detail.includes("planningMinimum"),
      ),
    );
    assert.ok(report.planningConfig.configVersion.length > 0);
  });
});

describe("manifest trust boundary", () => {
  it("rejects missing samples with a controlled validation error", () => {
    const manifest = cleanManifest([manifestSample()]);
    const parsed = { ...manifest, samples: undefined };

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(parsed),
      /manifest\.samples must be an array/,
    );
  });

  it("rejects samples with wrong primitive type", () => {
    const manifest = cleanManifest([manifestSample()]);
    const parsed = { ...manifest, samples: "not-an-array" };

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(parsed),
      /manifest\.samples must be an array/,
    );
  });

  it("rejects missing diagnostics", () => {
    const manifest = cleanManifest([manifestSample()]);
    const parsed = { ...manifest, diagnostics: undefined };

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(parsed),
      /manifest\.diagnostics must be an object/,
    );
  });

  it("rejects diagnostics with wrong shape", () => {
    const manifest = cleanManifest([manifestSample()]);
    const parsed = {
      ...manifest,
      diagnostics: { ...manifest.diagnostics, distinctParticipants: "one" },
    };

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(parsed),
      /manifest\.diagnostics\.distinctParticipants must be a finite number/,
    );
  });

  it("rejects unsupported manifestSchemaVersion", () => {
    const manifest = cleanManifest([manifestSample()]);
    const parsed = { ...manifest, manifestSchemaVersion: "unsupported-manifest-v99" };

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(parsed),
      /unsupported manifest schema version/,
    );
  });

  it("rejects malformed nested sample", () => {
    const manifest = cleanManifest([manifestSample()]);
    const parsed = {
      ...manifest,
      samples: [{ ...manifest.samples[0], participantId: 123 }],
    };

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(parsed),
      /missing participantId/,
    );
  });

  it("rejects malformed nested label", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [{ ...manifestLabel(), raterId: "" }],
      }),
    ]);

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(manifest),
      /missing raterId/,
    );
  });
});

describe("label invariant", () => {
  it("treats compensationLabel null + exclusionFlag null as integrity failure", () => {
    const invalidSample = manifestSample({
      sourceLineIndex: 0,
      labels: [
        {
          ...manifestLabel(),
          compensationLabel: null,
          exclusionFlag: null,
        },
      ],
    });
    const manifest = cleanManifest([invalidSample]);

    assert.equal(classifyManifestSampleLabelState(invalidSample), "INVALID_LABEL");
    assert.ok(collectManifestLabelInvariantViolations(manifest).length > 0);

    const report = buildReport(manifest);
    assert.ok(
      report.collectionGaps.some((gap) => gap.code === "DATASET_INTEGRITY_BLOCKER"),
    );
    assert.equal(report.collectionStatus, "DATA_COLLECTION_INCOMPLETE");
  });

  it("treats compensationLabel non-null + exclusionFlag non-null as integrity failure", () => {
    const invalidSample = manifestSample({
      sourceLineIndex: 0,
      labels: [
        {
          ...manifestLabel(),
          compensationLabel: "MILD_COMPENSATION",
          exclusionFlag: "NOT_REVIEWABLE",
        },
      ],
    });
    const manifest = cleanManifest([invalidSample]);

    assert.equal(classifyManifestSampleLabelState(invalidSample), "INVALID_LABEL");
    assert.ok(collectManifestLabelInvariantViolations(manifest).length > 0);
  });

  it("does not increment therapistExcludedSamples for invalid null/null label", () => {
    const invalidSample = manifestSample({
      sourceLineIndex: 0,
      labels: [
        {
          ...manifestLabel(),
          compensationLabel: null,
          exclusionFlag: null,
        },
      ],
    });
    const manifest = cleanManifest([invalidSample]);
    const report = buildReport(manifest);

    assert.equal(report.inventory.therapistExcludedSamples, 0);
    assert.equal(classifyManifestSampleLabelState(invalidSample), "INVALID_LABEL");
  });

  it("rejects null/null label at manifest trust boundary", () => {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 0,
        labels: [
          {
            ...manifestLabel(),
            compensationLabel: null,
            exclusionFlag: null,
          },
        ],
      }),
    ]);

    assert.throws(
      () => validateShoulderAbductionReachManifestForDatasetReadiness(manifest),
      /label invariant violated/,
    );
  });
});
