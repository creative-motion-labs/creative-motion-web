/**
 * Slice 5 training export — behavioral tests focusing on dataset-level
 * integrity, eligibility rules, and output structure without file I/O.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/training-export.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildShoulderAbductionTrainingExport } from "./training-export-builder";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
} from "./capture-schema";
import {
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
} from "./label-schema";
import {
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  type ShoulderAbductionReachResearchManifest,
  type ShoulderAbductionReachManifestSample,
  type ShoulderAbductionReachManifestLabel,
} from "./manifest-schema";
import { TRAINING_EXPORT_SCHEMA_VERSION } from "./training-export-schema";
import { buildTrainingExportCliRejectionBreakdownLines } from "./training-export-cli";
import {
  QC_REJECTION_REASONS,
  TRAINING_EXPORT_QC_SCHEMA_VERSION,
  type ShoulderAbductionTrainingExportQcReport,
} from "./training-export-schema";
import { resolveTrainingExportCliExitCode } from "./training-export-writer";

const SESSION_A = "fixture-export-session-a";
const PARTICIPANT_1 = "fixture-participant-1";
const RATER_A = "fixture-rater-a";
const RATER_B = "fixture-rater-b";

type ManifestSampleOverrides = Partial<ShoulderAbductionReachManifestSample> & {
  labels?: Array<Partial<ShoulderAbductionReachManifestLabel>>;
};

function manifestSample(overrides: ManifestSampleOverrides = {}): ShoulderAbductionReachManifestSample {
  const sourceLineIndex = overrides.sourceLineIndex ?? 0;
  const devSessionId = overrides.devSessionId ?? SESSION_A;
  const sampleId = overrides.sampleId ?? `${devSessionId}#${sourceLineIndex}`;

  const defaultLabels: ShoulderAbductionReachManifestLabel[] = overrides.labels
    ? overrides.labels.map((labelOverride) => ({
        labelSchemaVersion: labelOverride.labelSchemaVersion ?? ML_RESEARCH_LABEL_SCHEMA_VERSION,
        datasetVersion: labelOverride.datasetVersion ?? ML_RESEARCH_DATASET_VERSION,
        raterId: labelOverride.raterId ?? RATER_A,
        compensationLabel: labelOverride.compensationLabel !== undefined
          ? labelOverride.compensationLabel
          : "MILD_COMPENSATION",
        exclusionFlag: labelOverride.exclusionFlag ?? null,
        raterConfidence: labelOverride.raterConfidence ?? "medium",
        note: labelOverride.note ?? "",
        labeledAtMs: labelOverride.labeledAtMs ?? 1_700_000_000_000,
      }))
    : [
        {
          labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
          datasetVersion: ML_RESEARCH_DATASET_VERSION,
          raterId: RATER_A,
          compensationLabel: "MILD_COMPENSATION" as const,
          exclusionFlag: null,
          raterConfidence: "medium" as const,
          note: "",
          labeledAtMs: 1_700_000_000_000,
        },
      ];

  return {
    sampleId,
    devSessionId,
    sourceLineIndex,
    repetitionId: overrides.repetitionId ?? `${devSessionId}-rep-1`,
    repetitionIndex: overrides.repetitionIndex ?? 1,
    side: overrides.side ?? "right",
    participantId: overrides.participantId ?? PARTICIPANT_1,
    movementType: overrides.movementType ?? "shoulder_abduction_reach",
    captureSchemaVersion: overrides.captureSchemaVersion ?? ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
    featureSchemaVersion: overrides.featureSchemaVersion ?? ML_RESEARCH_FEATURE_SCHEMA_VERSION,
    source: overrides.source ?? {
      kind: "capture_jsonl_line" as const,
      relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${devSessionId}.jsonl`,
      lineIndex: sourceLineIndex,
      frameCount: 5,
    },
    labels: defaultLabels,
  };
}

function emptyManifest(samples: ShoulderAbductionReachManifestSample[] = []): ShoulderAbductionReachResearchManifest {
  return {
    manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    scope: { devSessionIds: [SESSION_A] },
    samples,
    diagnostics: {
      captureRecordsRead: samples.length,
      labelRecordsRead: 0,
      manifestSamplesProduced: samples.length,
      labeledSamples: samples.filter((s) => s.labels.length > 0).length,
      unlabeledSamples: samples.filter((s) => s.labels.length === 0).length,
      totalAcceptedLabels: samples.reduce((sum, s) => sum + s.labels.length, 0),
      excludedLabels: 0,
      compensationLabels: 0,
      distinctParticipants: new Set(samples.map((s) => s.participantId)).size,
      distinctSessions: 1,
      distinctRaters: new Set(
        samples.flatMap((s) => s.labels.map((l) => l.raterId)),
      ).size,
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

describe("training export — CRITICAL dataset-level integrity gate", () => {
  it("aborts export and writes 0 candidates when manifest has unresolved diagnostics", async () => {
    const manifest = emptyManifest([manifestSample()]);
    manifest.diagnostics.malformedCaptureRecords = 1;
    manifest.diagnostics.rejections = [
      {
        recordKind: "capture",
        reason: "unparsable_json",
        devSessionId: SESSION_A,
        fileLineIndex: 5,
      },
    ];

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(samples.length, 0, "NO samples exported when manifest has diagnostics");
    assert.equal(qcReport.datasetIntegrityOk, false);
    assert.equal(qcReport.supervisedCandidatesExported, 0);
    assert.ok(qcReport.datasetIntegrityBlockers.length > 0);
    assert.equal(qcReport.exportContentSha256, null);
    assert.ok(qcReport.datasetIntegrityBlockers.join(" ").includes("malformed"));
  });

  it("returns dataset-level failure even when samples look valid individually", async () => {
    const sample = manifestSample(); // appears valid
    const manifest = emptyManifest([sample]);
    manifest.diagnostics.orphanLabels = 5; // but manifest has diagnostics

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    // Must NOT export any samples when manifest integrity fails
    assert.equal(samples.length, 0);
    assert.equal(qcReport.datasetIntegrityOk, false);
  });
});

describe("training export — unlabeled samples", () => {
  it("rejects sample with UNLABELED when labels array is empty", async () => {
    const sample = manifestSample({ labels: [] });
    const manifest = emptyManifest([sample]);

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(samples.length, 0);
    assert.equal(qcReport.rejectionCounts.UNLABELED, 1);
    assert.equal(qcReport.rejectedSamples.length, 1);
    assert.equal(qcReport.rejectedSamples[0].reason, "UNLABELED");
  });

  it("does NOT treat unlabeled sample as NO_COMPENSATION", async () => {
    const sample = manifestSample({ labels: [] });
    const manifest = emptyManifest([sample]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(qcReport.exportedDistributions.compensationLabels.NO_COMPENSATION, 0);
  });
});

describe("training export — exclusion flags", () => {
  it("rejects sample with THERAPIST_EXCLUSION when exclusionFlag is set", async () => {
    const sample = manifestSample({
      labels: [
        {
          compensationLabel: null,
          exclusionFlag: "WRONG_MOVEMENT_PLANE",
        },
      ],
    });
    const manifest = emptyManifest([sample]);

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(samples.length, 0);
    assert.equal(qcReport.rejectionCounts.THERAPIST_EXCLUSION, 1);
    assert.equal(qcReport.exclusionFlagCounts.WRONG_MOVEMENT_PLANE, 1);
    assert.equal(qcReport.rejectedSamples[0].exclusionFlag, "WRONG_MOVEMENT_PLANE");
  });

  it("does NOT treat exclusion flags as compensation classes", async () => {
    const sample = manifestSample({
      labels: [
        {
          compensationLabel: null,
          exclusionFlag: "INCOMPLETE_REPETITION",
        },
      ],
    });
    const manifest = emptyManifest([sample]);

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(samples.length, 0);
    assert.equal(qcReport.exportedDistributions.compensationLabels.NO_COMPENSATION, 0);
    assert.equal(qcReport.exportedDistributions.compensationLabels.MILD_COMPENSATION, 0);
    assert.equal(qcReport.exportedDistributions.compensationLabels.CLEAR_COMPENSATION, 0);
  });

  it("counts all three exclusion flag types correctly", async () => {
    const samples = [
      manifestSample({
        sourceLineIndex: 0,
        labels: [{ compensationLabel: null, exclusionFlag: "WRONG_MOVEMENT_PLANE" }],
      }),
      manifestSample({
        sourceLineIndex: 1,
        labels: [{ compensationLabel: null, exclusionFlag: "INCOMPLETE_REPETITION" }],
      }),
      manifestSample({
        sourceLineIndex: 2,
        labels: [{ compensationLabel: null, exclusionFlag: "NOT_REVIEWABLE" }],
      }),
    ];
    const manifest = emptyManifest(samples);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(qcReport.rejectionCounts.THERAPIST_EXCLUSION, 3);
    assert.equal(qcReport.exclusionFlagCounts.WRONG_MOVEMENT_PLANE, 1);
    assert.equal(qcReport.exclusionFlagCounts.INCOMPLETE_REPETITION, 1);
    assert.equal(qcReport.exclusionFlagCounts.NOT_REVIEWABLE, 1);
  });
});

describe("training export — CRITICAL multi-rater handling", () => {
  it("rejects sample with MULTI_RATER_REQUIRES_POLICY when labels.length > 1", async () => {
    const sample = manifestSample({
      labels: [
        { raterId: RATER_A, compensationLabel: "NO_COMPENSATION", exclusionFlag: null },
        { raterId: RATER_B, compensationLabel: "MILD_COMPENSATION", exclusionFlag: null },
      ],
    });
    const manifest = emptyManifest([sample]);

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(samples.length, 0);
    assert.equal(qcReport.rejectionCounts.MULTI_RATER_REQUIRES_POLICY, 1);
  });

  it("does NOT invent consensus label even when raters agree", async () => {
    const sample = manifestSample({
      labels: [
        { raterId: RATER_A, compensationLabel: "MILD_COMPENSATION", exclusionFlag: null },
        { raterId: RATER_B, compensationLabel: "MILD_COMPENSATION", exclusionFlag: null },
      ],
    });
    const manifest = emptyManifest([sample]);

    const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    // Even though both raters agree, we don't automatically call it "adjudicated"
    assert.equal(samples.length, 0);
    assert.equal(qcReport.rejectionCounts.MULTI_RATER_REQUIRES_POLICY, 1);
    // No samples exported means no distribution
    assert.equal(qcReport.exportedDistributions.compensationLabels.MILD_COMPENSATION, 0);
  });
});

describe("training export — schema version gates", () => {
  it("rejects sample with unsupported capture schema", async () => {
    const sample = manifestSample({ captureSchemaVersion: "unsupported-capture-v99" });
    const manifest = emptyManifest([sample]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(qcReport.rejectionCounts.UNSUPPORTED_CAPTURE_SCHEMA, 1);
    assert.equal(qcReport.rejectedSamples[0].observedVersion, "unsupported-capture-v99");
  });

  it("rejects sample with unsupported feature schema", async () => {
    const sample = manifestSample({ featureSchemaVersion: "unsupported-features-v99" });
    const manifest = emptyManifest([sample]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(qcReport.rejectionCounts.UNSUPPORTED_FEATURE_SCHEMA, 1);
    assert.equal(qcReport.rejectedSamples[0].observedVersion, "unsupported-features-v99");
  });
});

describe("training export — participant-level split protection", () => {
  it("reports distinct participants for future leakage-safe splitting", async () => {
    const samples = [
      manifestSample({ participantId: "participant-1", sourceLineIndex: 0, labels: [] }),
      manifestSample({ participantId: "participant-2", sourceLineIndex: 1, labels: [] }),
      manifestSample({ participantId: "participant-1", sourceLineIndex: 2, labels: [] }),
    ];
    const manifest = emptyManifest(samples);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    // All rejected (unlabeled), but we still report participant grouping info
    assert.equal(qcReport.exportedDistributions.distinctParticipants, 0); // none exported
  });
});

describe("training export — deterministic ordering", () => {
  it("produces deterministic rejection ordering by sampleId", async () => {
    const samples = [
      manifestSample({ sampleId: "session-a#2", sourceLineIndex: 2, labels: [] }),
      manifestSample({ sampleId: "session-a#0", sourceLineIndex: 0, labels: [] }),
      manifestSample({ sampleId: "session-a#1", sourceLineIndex: 1, labels: [] }),
    ];
    const manifest = emptyManifest(samples);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(qcReport.rejectedSamples.length, 3);
    assert.equal(qcReport.rejectedSamples[0].sampleId, "session-a#0");
    assert.equal(qcReport.rejectedSamples[1].sampleId, "session-a#1");
    assert.equal(qcReport.rejectedSamples[2].sampleId, "session-a#2");
  });
});

describe("training export — QC report structure", () => {
  it("includes all required QC report fields", async () => {
    const manifest = emptyManifest([manifestSample({ labels: [] })]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.ok("qcSchemaVersion" in qcReport);
    assert.ok("datasetIntegrityOk" in qcReport);
    assert.ok("datasetIntegrityBlockers" in qcReport);
    assert.ok("manifestSchemaVersion" in qcReport);
    assert.ok("datasetVersion" in qcReport);
    assert.ok("manifestSamplesReviewed" in qcReport);
    assert.ok("supervisedCandidatesExported" in qcReport);
    assert.ok("rejectionCounts" in qcReport);
    assert.ok("exclusionFlagCounts" in qcReport);
    assert.ok("exportedDistributions" in qcReport);
    assert.ok("captureSchemaVersions" in qcReport);
    assert.ok("featureSchemaVersions" in qcReport);
    assert.ok("labelSchemaVersions" in qcReport);
    assert.ok("rejectedSamples" in qcReport);
    assert.ok("exportContentSha256" in qcReport);
  });

  it("reports observed schema versions from manifest", async () => {
    const manifest = emptyManifest([
      manifestSample({
        captureSchemaVersion: "v1",
        featureSchemaVersion: "features-v1",
        labels: [{ labelSchemaVersion: "label-v1" }],
      }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.ok(qcReport.captureSchemaVersions.includes("v1"));
    assert.ok(qcReport.featureSchemaVersions.includes("features-v1"));
    assert.ok(qcReport.labelSchemaVersions.includes("label-v1"));
  });
});

describe("training export — export schema", () => {
  it("uses correct export schema version constant", async () => {
    assert.equal(TRAINING_EXPORT_SCHEMA_VERSION, "shoulder-abduction-training-export-v1");
  });
});

describe("training export — CLI exit status policy", () => {
  it("returns exit code 1 when dataset integrity fails", () => {
    assert.equal(
      resolveTrainingExportCliExitCode({
        datasetIntegrityOk: false,
      } as Parameters<typeof resolveTrainingExportCliExitCode>[0]),
      1,
    );
  });

  it("returns exit code 0 when dataset integrity passes, even with zero exported candidates", () => {
    assert.equal(
      resolveTrainingExportCliExitCode({
        datasetIntegrityOk: true,
      } as Parameters<typeof resolveTrainingExportCliExitCode>[0]),
      0,
    );
  });
});

describe("training export — duplicate manifest sample identity", () => {
  it("rejects the second occurrence with DUPLICATE_MANIFEST_SAMPLE_IDENTITY", async () => {
    const manifest = emptyManifest([
      manifestSample({ sourceLineIndex: 0, sampleId: `${SESSION_A}#0`, labels: [] }),
      manifestSample({ sourceLineIndex: 0, sampleId: `${SESSION_A}#0`, labels: [] }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(qcReport.rejectionCounts.DUPLICATE_MANIFEST_SAMPLE_IDENTITY, 1);
    assert.equal(qcReport.rejectionCounts.UNLABELED, 1);
    assert.equal(
      qcReport.rejectedSamples.find((sample) => sample.reason === "DUPLICATE_MANIFEST_SAMPLE_IDENTITY")
        ?.sampleId,
      `${SESSION_A}#0`,
    );
  });
});

describe("training export — CLI rejection breakdown", () => {
  it("includes every non-zero canonical rejection reason", () => {
    const rejectionCounts = Object.fromEntries(
      QC_REJECTION_REASONS.map((reason) => [reason, 1]),
    ) as ShoulderAbductionTrainingExportQcReport["rejectionCounts"];

    const qcReport = {
      qcSchemaVersion: TRAINING_EXPORT_QC_SCHEMA_VERSION,
      datasetIntegrityOk: true,
      datasetIntegrityBlockers: [],
      manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      manifestSamplesReviewed: QC_REJECTION_REASONS.length,
      supervisedCandidatesExported: 0,
      rejectionCounts,
      exclusionFlagCounts: {
        WRONG_MOVEMENT_PLANE: 1,
        INCOMPLETE_REPETITION: 0,
        NOT_REVIEWABLE: 0,
      },
      exportedDistributions: {
        compensationLabels: { NO_COMPENSATION: 0, MILD_COMPENSATION: 0, CLEAR_COMPENSATION: 0 },
        raterConfidence: { low: 0, medium: 0, high: 0 },
        sides: { left: 0, right: 0 },
        distinctParticipants: 0,
        distinctSessions: 0,
        distinctRaters: 0,
        participantLevelSplitPossible: false,
      },
      captureSchemaVersions: [],
      featureSchemaVersions: [],
      labelSchemaVersions: [],
      rejectedSamples: [],
      exportContentSha256: null,
    } satisfies ShoulderAbductionTrainingExportQcReport;

    const lines = buildTrainingExportCliRejectionBreakdownLines(qcReport);
    for (const reason of QC_REJECTION_REASONS) {
      assert.ok(lines.some((line) => line.includes(reason)), `missing CLI line for ${reason}`);
    }
    assert.ok(lines.some((line) => line.includes("WRONG_MOVEMENT_PLANE")));
  });
});
