/**
 * Slice 5 training export — disk-level integration tests.
 *
 * Uses synthetic fixture sessions under dev-data/ and never depends on real
 * research data. Verifies source resolution, export boundaries, path safety,
 * determinism, and read-only behavior on capture/label/manifest sources.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/training-export-source-integrity.test.ts
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import {
  buildPersistedShoulderAbductionReachLabelRecord,
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
} from "./label-schema";
import {
  appendShoulderAbductionReachRepRecordLocally,
  ML_RESEARCH_DEV_DATA_DIR,
  resolveDevSessionJsonlPath,
} from "./local-jsonl-writer";
import {
  appendShoulderAbductionReachLabelLocally,
  resolveDevSessionLabelsJsonlPath,
} from "./local-label-writer";
import { buildShoulderAbductionTrainingExport } from "./training-export-builder";
import {
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  serializeShoulderAbductionReachManifest,
  type ShoulderAbductionReachManifestSample,
  type ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";
import {
  ML_RESEARCH_MANIFEST_DATA_DIR,
  resolveManifestJsonPath,
} from "./manifest-writer";
import { runShoulderAbductionTrainingExportCli } from "./training-export-cli";
import {
  assertTrainingExportOutputPathIsSafe,
  ML_RESEARCH_TRAINING_EXPORT_DATA_DIR,
  resolveTrainingExportJsonlPath,
  resolveTrainingExportQcReportPath,
  resolveTrainingExportRunSidecarPath,
  resolveTrainingExportCliExitCode,
  writeShoulderAbductionTrainingExport,
} from "./training-export-writer";
import { serializeTrainingExportQcReport } from "./training-export-schema";

const TEST_SESSION_ID = "test-fixture-training-export-do-not-use";
const MISSING_SESSION_ID = "test-fixture-training-export-missing-source";
const RATER_ID = "fixture-rater-a";

const CAPTURE_PATH = resolveDevSessionJsonlPath(TEST_SESSION_ID);
const LABELS_PATH = resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID);
const MANIFEST_PATH = resolveManifestJsonPath(`${TEST_SESSION_ID}-training-export`);
const EXPORT_NAME = `${TEST_SESSION_ID}-training-export`;
const EXPORT_JSONL_PATH = resolveTrainingExportJsonlPath(EXPORT_NAME);
const QC_REPORT_PATH = resolveTrainingExportQcReportPath(EXPORT_NAME);
const RUN_SIDECAR_PATH = resolveTrainingExportRunSidecarPath(EXPORT_JSONL_PATH);
const DIAGNOSTIC_MANIFEST_PATH = resolveManifestJsonPath(`${TEST_SESSION_ID}-training-export-bad`);

function captureRecord(
  overrides: Partial<ShoulderAbductionReachRepCaptureRecord["context"]> & { frameCount?: number } = {},
): ShoulderAbductionReachRepCaptureRecord {
  const frameCount = overrides.frameCount ?? 3;
  return {
    context: {
      captureSchemaVersion: overrides.captureSchemaVersion ?? ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: overrides.featureSchemaVersion ?? ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: overrides.participantId ?? "fixture-participant-1",
      devSessionId: overrides.devSessionId ?? TEST_SESSION_ID,
      repetitionIndex: overrides.repetitionIndex ?? 1,
      repetitionId: overrides.repetitionId ?? `${TEST_SESSION_ID}-rep-1`,
      side: overrides.side ?? "right",
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1000,
      endedAtMs: 2000,
    },
    frames: Array.from({ length: frameCount }, (_unused, frameIndex) => ({
      relativeTimestampMs: frameIndex * 100,
      frameIndex,
      joints: {},
    })),
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.21,
      peakShoulderAngleDegrees: 118,
      movementDurationMs: 1000,
      peakAngularVelocityDegPerSec: 240,
      trackingQuality: {
        framesTotal: frameCount,
        framesWithUsableAngle: frameCount,
        usableFrameRatio: 1,
        minCoreJointVisibility: 0.9,
      },
    },
  };
}

function manifestLabel(note = "sensitive therapist note must not leak") {
  return {
    labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    raterId: RATER_ID,
    compensationLabel: "MILD_COMPENSATION" as const,
    exclusionFlag: null,
    raterConfidence: "high" as const,
    note,
    labeledAtMs: 1_700_000_000_000,
  };
}

function manifestSample(
  overrides: Partial<ShoulderAbductionReachManifestSample> = {},
): ShoulderAbductionReachManifestSample {
  const sourceLineIndex = overrides.sourceLineIndex ?? 0;
  return {
    sampleId: overrides.sampleId ?? `${TEST_SESSION_ID}#${sourceLineIndex}`,
    devSessionId: overrides.devSessionId ?? TEST_SESSION_ID,
    sourceLineIndex,
    repetitionId: overrides.repetitionId ?? `${TEST_SESSION_ID}-rep-1`,
    repetitionIndex: overrides.repetitionIndex ?? 1,
    side: overrides.side ?? "right",
    participantId: overrides.participantId ?? "fixture-participant-1",
    movementType: overrides.movementType ?? "shoulder_abduction_reach",
    captureSchemaVersion: overrides.captureSchemaVersion ?? ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
    featureSchemaVersion: overrides.featureSchemaVersion ?? ML_RESEARCH_FEATURE_SCHEMA_VERSION,
    source: overrides.source ?? {
      kind: "capture_jsonl_line",
      relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${TEST_SESSION_ID}.jsonl`,
      lineIndex: sourceLineIndex,
      frameCount: 3,
    },
    labels: overrides.labels ?? [manifestLabel()],
  };
}

function cleanManifest(
  samples: ShoulderAbductionReachManifestSample[],
): ShoulderAbductionReachResearchManifest {
  return {
    manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    scope: { devSessionIds: [TEST_SESSION_ID] },
    samples,
    diagnostics: {
      captureRecordsRead: samples.length,
      labelRecordsRead: samples.length,
      manifestSamplesProduced: samples.length,
      labeledSamples: samples.filter((sample) => sample.labels.length > 0).length,
      unlabeledSamples: samples.filter((sample) => sample.labels.length === 0).length,
      totalAcceptedLabels: samples.reduce((sum, sample) => sum + sample.labels.length, 0),
      excludedLabels: 0,
      compensationLabels: samples.reduce(
        (sum, sample) =>
          sum + sample.labels.filter((label) => label.compensationLabel !== null).length,
        0,
      ),
      distinctParticipants: new Set(samples.map((sample) => sample.participantId)).size,
      distinctSessions: 1,
      distinctRaters: new Set(samples.flatMap((sample) => sample.labels.map((label) => label.raterId)))
        .size,
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

async function writeManifestFile(
  path: string,
  manifest: ShoulderAbductionReachResearchManifest,
): Promise<void> {
  await mkdir(ML_RESEARCH_MANIFEST_DATA_DIR, { recursive: true });
  await writeFile(path, serializeShoulderAbductionReachManifest(manifest), "utf8");
}

before(async () => {
  await mkdir(ML_RESEARCH_DEV_DATA_DIR, { recursive: true });
  await mkdir(ML_RESEARCH_MANIFEST_DATA_DIR, { recursive: true });
  await mkdir(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR, { recursive: true });

  for (const path of [
    CAPTURE_PATH,
    LABELS_PATH,
    MANIFEST_PATH,
    DIAGNOSTIC_MANIFEST_PATH,
    EXPORT_JSONL_PATH,
    QC_REPORT_PATH,
    RUN_SIDECAR_PATH,
    resolveTrainingExportQcReportPath(`${TEST_SESSION_ID}-training-export-bad`),
    resolveTrainingExportRunSidecarPath(
      resolveTrainingExportJsonlPath(`${TEST_SESSION_ID}-training-export-bad`),
    ),
  ]) {
    await unlink(path).catch(() => {});
  }

  await appendShoulderAbductionReachRepRecordLocally(captureRecord());
  await appendShoulderAbductionReachLabelLocally(
    buildPersistedShoulderAbductionReachLabelRecord(
      {
        devSessionId: TEST_SESSION_ID,
        repetitionId: `${TEST_SESSION_ID}-rep-1`,
        sourceLineIndex: 0,
        side: "right",
        participantId: "fixture-participant-1",
      },
      RATER_ID,
      {
        compensationLabel: "MILD_COMPENSATION",
        exclusionFlag: null,
        raterConfidence: "high",
        note: "sensitive therapist note must not leak",
      },
      1_700_000_000_000,
    ),
  );

  await writeManifestFile(MANIFEST_PATH, cleanManifest([manifestSample()]));
});

after(async () => {
  for (const path of [
    CAPTURE_PATH,
    LABELS_PATH,
    MANIFEST_PATH,
    DIAGNOSTIC_MANIFEST_PATH,
    EXPORT_JSONL_PATH,
    QC_REPORT_PATH,
    RUN_SIDECAR_PATH,
    resolveTrainingExportQcReportPath(`${TEST_SESSION_ID}-training-export-bad`),
    resolveTrainingExportRunSidecarPath(
      resolveTrainingExportJsonlPath(`${TEST_SESSION_ID}-training-export-bad`),
    ),
  ]) {
    await unlink(path).catch(() => {});
  }
});

describe("training export source resolution", () => {
  it("rejects SOURCE_NOT_FOUND when the capture session file is missing", async () => {
    const manifest = cleanManifest([
      manifestSample({
        devSessionId: MISSING_SESSION_ID,
        sampleId: `${MISSING_SESSION_ID}#0`,
        source: {
          kind: "capture_jsonl_line",
          relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${MISSING_SESSION_ID}.jsonl`,
          lineIndex: 0,
          frameCount: 3,
        },
      }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_NOT_FOUND, 1);
  });

  it("rejects SOURCE_LINE_MISSING when the referenced line does not exist", async () => {
    const manifest = cleanManifest([manifestSample({ sourceLineIndex: 9, sampleId: `${TEST_SESSION_ID}#9` })]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_LINE_MISSING, 1);
  });

  it("rejects MALFORMED_SOURCE_LINE when the referenced line is not valid JSON", async () => {
    const raw = await readFile(CAPTURE_PATH, "utf8");
    await writeFile(CAPTURE_PATH, `${raw}{"broken":true\n`, "utf8");

    const manifest = cleanManifest([
      manifestSample(),
      manifestSample({
        sourceLineIndex: 1,
        sampleId: `${TEST_SESSION_ID}#1`,
        repetitionIndex: 2,
        repetitionId: `${TEST_SESSION_ID}-rep-2`,
        source: {
          kind: "capture_jsonl_line",
          relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${TEST_SESSION_ID}.jsonl`,
          lineIndex: 1,
          frameCount: 3,
        },
      }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.MALFORMED_SOURCE_LINE, 1);
    assert.equal(qcReport.supervisedCandidatesExported, 1);

    await writeFile(CAPTURE_PATH, raw, "utf8");
  });

  it("rejects repetitionId mismatch against the source capture", async () => {
    const manifest = cleanManifest([
      manifestSample({ repetitionId: `${TEST_SESSION_ID}-rep-WRONG` }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_IDENTITY_MISMATCH, 1);
    assert.deepEqual(qcReport.rejectedSamples[0].mismatchedFields, ["repetitionId"]);
  });

  it("rejects side mismatch against the source capture", async () => {
    const manifest = cleanManifest([manifestSample({ side: "left" })]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_IDENTITY_MISMATCH, 1);
    assert.deepEqual(qcReport.rejectedSamples[0].mismatchedFields, ["side"]);
  });

  it("rejects participantId mismatch against the source capture", async () => {
    const manifest = cleanManifest([manifestSample({ participantId: "wrong-participant" })]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_IDENTITY_MISMATCH, 1);
    assert.deepEqual(qcReport.rejectedSamples[0].mismatchedFields, ["participantId"]);
  });

  it("rejects frameCount mismatch against the source capture", async () => {
    const manifest = cleanManifest([
      manifestSample({
        source: {
          kind: "capture_jsonl_line",
          relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${TEST_SESSION_ID}.jsonl`,
          lineIndex: 0,
          frameCount: 99,
        },
      }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_IDENTITY_MISMATCH, 1);
    assert.deepEqual(qcReport.rejectedSamples[0].mismatchedFields, ["frameCount"]);
  });

  it("rejects duplicate manifest sample identity on the second occurrence", async () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, sampleId: `${TEST_SESSION_ID}#0` }),
      manifestSample({ sourceLineIndex: 0, sampleId: `${TEST_SESSION_ID}#0` }),
    ]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.DUPLICATE_MANIFEST_SAMPLE_IDENTITY, 1);
    assert.equal(qcReport.supervisedCandidatesExported, 1);
  });

  it("rejects movementType mismatch against the source capture", async () => {
    const manifest = cleanManifest([manifestSample({ movementType: "wrong_movement_type" })]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_IDENTITY_MISMATCH, 1);
    assert.deepEqual(qcReport.rejectedSamples[0].mismatchedFields, ["movementType"]);
  });

  it("rejects repetitionIndex mismatch against the source capture", async () => {
    const manifest = cleanManifest([manifestSample({ repetitionIndex: 99 })]);

    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.SOURCE_IDENTITY_MISMATCH, 1);
    assert.deepEqual(qcReport.rejectedSamples[0].mismatchedFields, ["repetitionIndex"]);
  });
});

function malformedCaptureContext(
  overrides: Partial<ShoulderAbductionReachRepCaptureRecord["context"]> = {},
): ShoulderAbductionReachRepCaptureRecord["context"] {
  return {
    captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
    featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
    participantId: "fixture-participant-1",
    devSessionId: TEST_SESSION_ID,
    repetitionIndex: 2,
    repetitionId: `${TEST_SESSION_ID}-rep-2`,
    side: "right",
    movementType: "shoulder_abduction_reach",
    startedAtMs: 1000,
    endedAtMs: 2000,
    ...overrides,
  };
}

function malformedDerivedFeatures(
  overrides: Partial<ShoulderAbductionReachRepCaptureRecord["derivedFeatures"]> = {},
): ShoulderAbductionReachRepCaptureRecord["derivedFeatures"] {
  return {
    peakNormalizedTrunkDriftRatio: 0.21,
    peakShoulderAngleDegrees: 118,
    movementDurationMs: 1000,
    peakAngularVelocityDegPerSec: 240,
    trackingQuality: {
      framesTotal: 3,
      framesWithUsableAngle: 3,
      usableFrameRatio: 1,
    },
    ...overrides,
  };
}

describe("training export malformed source records", () => {
  let baselineCapture: string;

  beforeEach(async () => {
    baselineCapture = await readFile(CAPTURE_PATH, "utf8");
  });

  afterEach(async () => {
    await writeFile(CAPTURE_PATH, baselineCapture, "utf8");
  });

  async function exportSampleAtLine(sourceLineIndex: number, repetitionIndex: number) {
    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex,
        sampleId: `${TEST_SESSION_ID}#${sourceLineIndex}`,
        repetitionIndex,
        repetitionId: `${TEST_SESSION_ID}-rep-${repetitionIndex}`,
        source: {
          kind: "capture_jsonl_line",
          relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${TEST_SESSION_ID}.jsonl`,
          lineIndex: sourceLineIndex,
          frameCount: 3,
        },
      }),
    ]);
    return buildShoulderAbductionTrainingExport(manifest);
  }

  it("rejects JSON-valid capture missing frames without throwing", async () => {
    await writeFile(
      CAPTURE_PATH,
      `${baselineCapture}${JSON.stringify({
        context: malformedCaptureContext(),
        derivedFeatures: malformedDerivedFeatures(),
      })}\n`,
      "utf8",
    );

    const { qcReport } = await exportSampleAtLine(1, 2);
    assert.equal(qcReport.rejectionCounts.MALFORMED_SOURCE_RECORD, 1);
    assert.equal(qcReport.rejectedSamples[0].reason, "MALFORMED_SOURCE_RECORD");
  });

  it("rejects JSON-valid capture missing derivedFeatures without throwing", async () => {
    await writeFile(
      CAPTURE_PATH,
      `${baselineCapture}${JSON.stringify({
        context: malformedCaptureContext({ repetitionIndex: 3, repetitionId: `${TEST_SESSION_ID}-rep-3` }),
        frames: captureRecord({ repetitionIndex: 3, repetitionId: `${TEST_SESSION_ID}-rep-3` }).frames,
      })}\n`,
      "utf8",
    );

    const manifest = cleanManifest([
      manifestSample({
        sourceLineIndex: 1,
        sampleId: `${TEST_SESSION_ID}#1`,
        repetitionIndex: 3,
        repetitionId: `${TEST_SESSION_ID}-rep-3`,
        source: {
          kind: "capture_jsonl_line",
          relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${TEST_SESSION_ID}.jsonl`,
          lineIndex: 1,
          frameCount: 3,
        },
      }),
    ]);
    const { qcReport } = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(qcReport.rejectionCounts.MALFORMED_SOURCE_RECORD, 1);
  });

  it("rejects malformed trackingQuality shape without throwing", async () => {
    await writeFile(
      CAPTURE_PATH,
      `${baselineCapture}${JSON.stringify({
        context: malformedCaptureContext({ repetitionIndex: 4, repetitionId: `${TEST_SESSION_ID}-rep-4` }),
        frames: captureRecord({ repetitionIndex: 4, repetitionId: `${TEST_SESSION_ID}-rep-4` }).frames,
        derivedFeatures: malformedDerivedFeatures({
          trackingQuality: {
            framesTotal: 3,
            framesWithUsableAngle: 3,
            usableFrameRatio: "not-a-number",
          } as unknown as ShoulderAbductionReachRepCaptureRecord["derivedFeatures"]["trackingQuality"],
        }),
      })}\n`,
      "utf8",
    );

    const { qcReport } = await exportSampleAtLine(1, 4);
    assert.equal(qcReport.rejectionCounts.MALFORMED_SOURCE_RECORD, 1);
  });

  it("rejects wrong primitive type for repetitionIndex without throwing", async () => {
    await writeFile(
      CAPTURE_PATH,
      `${baselineCapture}${JSON.stringify({
        context: {
          ...malformedCaptureContext({ repetitionIndex: 5, repetitionId: `${TEST_SESSION_ID}-rep-5` }),
          repetitionIndex: "5",
        },
        frames: captureRecord({ repetitionIndex: 5, repetitionId: `${TEST_SESSION_ID}-rep-5` }).frames,
        derivedFeatures: malformedDerivedFeatures(),
      })}\n`,
      "utf8",
    );

    const { qcReport } = await exportSampleAtLine(1, 5);
    assert.equal(qcReport.rejectionCounts.MALFORMED_SOURCE_RECORD, 1);
  });
});

describe("training export content boundaries", () => {
  it("exports pose frames only and keeps provenance/QC separate from model input", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as ShoulderAbductionReachResearchManifest;
    const { samples } = await buildShoulderAbductionTrainingExport(manifest);

    assert.equal(samples.length, 1);
    const exported = samples[0];
    const serialized = JSON.stringify(exported).toLowerCase();

    assert.ok("participantId" in exported.provenance);
    assert.ok("raterId" in exported.provenance);
    assert.ok("devSessionId" in exported.provenance);
    assert.ok(!("participantId" in exported.input));
    assert.ok(!("raterId" in exported.input));
    assert.ok(!("devSessionId" in exported.input));
    assert.ok(!("derivedFeatures" in exported.input));
    assert.ok(!("note" in exported.qc));
    assert.ok(!serialized.includes("sensitive therapist note must not leak"));
    assert.ok(!serialized.includes('"consensus"'));
    assert.ok(!serialized.includes('"adjudication"'));
    assert.ok(!serialized.includes('"prediction"'));
    assert.ok(!serialized.includes('"split"'));
    assert.ok(!serialized.includes('"train"'));
    assert.ok(!serialized.includes('"validation"'));
    assert.ok(!serialized.includes('"test"'));
    assert.ok(Array.isArray(exported.input.frames));
  });
});

describe("training export never mutates research source data", () => {
  it("leaves capture, label, and manifest files byte-identical", async () => {
    const before = {
      capture: await readFile(CAPTURE_PATH, "utf8"),
      labels: await readFile(LABELS_PATH, "utf8"),
      manifest: await readFile(MANIFEST_PATH, "utf8"),
      captureStat: await stat(CAPTURE_PATH),
      labelsStat: await stat(LABELS_PATH),
      manifestStat: await stat(MANIFEST_PATH),
    };

    const manifest = JSON.parse(before.manifest) as ShoulderAbductionReachResearchManifest;
    const built = await buildShoulderAbductionTrainingExport(manifest);
    await writeShoulderAbductionTrainingExport(built.samples, built.qcReport, {
      outputName: EXPORT_NAME,
      manifestPath: MANIFEST_PATH,
      nowMs: 1_700_000_000_000,
    });

    assert.equal(await readFile(CAPTURE_PATH, "utf8"), before.capture);
    assert.equal(await readFile(LABELS_PATH, "utf8"), before.labels);
    assert.equal(await readFile(MANIFEST_PATH, "utf8"), before.manifest);
    assert.equal((await stat(CAPTURE_PATH)).mtimeMs, before.captureStat.mtimeMs);
    assert.equal((await stat(LABELS_PATH)).mtimeMs, before.labelsStat.mtimeMs);
    assert.equal((await stat(MANIFEST_PATH)).mtimeMs, before.manifestStat.mtimeMs);
  });
});

describe("training export determinism", () => {
  it("writes byte-identical canonical JSONL, QC report, and SHA-256 on repeat runs", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as ShoulderAbductionReachResearchManifest;

    const first = await buildShoulderAbductionTrainingExport(manifest);
    await writeShoulderAbductionTrainingExport(first.samples, first.qcReport, {
      outputName: EXPORT_NAME,
      manifestPath: MANIFEST_PATH,
      nowMs: 1_700_000_000_000,
    });
    const firstExport = await readFile(EXPORT_JSONL_PATH, "utf8");
    const firstQc = await readFile(QC_REPORT_PATH, "utf8");
    const firstHash = first.qcReport.exportContentSha256;

    const second = await buildShoulderAbductionTrainingExport(manifest);
    await writeShoulderAbductionTrainingExport(second.samples, second.qcReport, {
      outputName: EXPORT_NAME,
      manifestPath: MANIFEST_PATH,
      nowMs: 1_700_000_000_999,
    });
    const secondExport = await readFile(EXPORT_JSONL_PATH, "utf8");
    const secondQc = await readFile(QC_REPORT_PATH, "utf8");

    assert.equal(firstExport, secondExport);
    assert.equal(firstQc, secondQc);
    assert.equal(firstHash, second.qcReport.exportContentSha256);
    assert.equal(firstQc, serializeTrainingExportQcReport(first.qcReport));
  });
});

describe("training export output path allowlist", () => {
  it("rejects package.json, source tree, .git, capture, labels, manifest paths, and escapes", () => {
    assert.throws(() => assertTrainingExportOutputPathIsSafe("package.json"), /refusing to write training export/);
    assert.throws(
      () =>
        assertTrainingExportOutputPathIsSafe(
          "app/lib/cv/shoulder-abduction-reach-pose-detector.ts",
        ),
      /refusing to write training export/,
    );
    assert.throws(
      () =>
        assertTrainingExportOutputPathIsSafe(
          "app/lib/ml-research/shoulder-abduction-reach/manifest-assembly.ts",
        ),
      /refusing to write training export/,
    );
    assert.throws(() => assertTrainingExportOutputPathIsSafe(".git/config"), /refusing to write training export/);
    assert.throws(() => assertTrainingExportOutputPathIsSafe(CAPTURE_PATH), /refusing to write training export/);
    assert.throws(() => assertTrainingExportOutputPathIsSafe(LABELS_PATH), /refusing to write training export/);
    assert.throws(
      () => assertTrainingExportOutputPathIsSafe(resolveManifestJsonPath(TEST_SESSION_ID)),
      /refusing to write training export/,
    );
    assert.throws(
      () => assertTrainingExportOutputPathIsSafe("../../../package.json"),
      /refusing to write training export/,
    );
    assert.throws(
      () => assertTrainingExportOutputPathIsSafe(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR),
      /refusing to write training export directly to the export directory itself/,
    );
    assert.doesNotThrow(() => assertTrainingExportOutputPathIsSafe(EXPORT_JSONL_PATH));
    assert.doesNotThrow(() => assertTrainingExportOutputPathIsSafe(QC_REPORT_PATH));
  });

  it("writes exports to the dedicated dev-data export directory", () => {
    assert.match(EXPORT_JSONL_PATH, /[\\/]dev-data[\\/]rasq-ml[\\/]shoulder-abduction-training-exports[\\/]/);
    assert.notEqual(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR, ML_RESEARCH_DEV_DATA_DIR);
    assert.notEqual(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR, ML_RESEARCH_MANIFEST_DATA_DIR);
  });
});

describe("training export CLI fail-closed exit status", () => {
  it("returns exit code 1, writes QC report, and skips training JSONL when manifest integrity fails", async () => {
    const badManifest = cleanManifest([manifestSample()]);
    badManifest.diagnostics.malformedCaptureRecords = 1;
    badManifest.diagnostics.rejections = [
      {
        recordKind: "capture",
        reason: "unparsable_json",
        devSessionId: TEST_SESSION_ID,
        fileLineIndex: 2,
      },
    ];
    await writeManifestFile(DIAGNOSTIC_MANIFEST_PATH, badManifest);

    const badExportName = `${TEST_SESSION_ID}-training-export-bad`;
    const badQcPath = resolveTrainingExportQcReportPath(badExportName);
    const badJsonlPath = resolveTrainingExportJsonlPath(badExportName);
    const badRunPath = resolveTrainingExportRunSidecarPath(badJsonlPath);
    await unlink(badQcPath).catch(() => {});
    await unlink(badJsonlPath).catch(() => {});
    await unlink(badRunPath).catch(() => {});

    const result = await runShoulderAbductionTrainingExportCli({
      manifestPath: DIAGNOSTIC_MANIFEST_PATH,
      outName: badExportName,
      print: false,
      nowMs: 1_700_000_000_000,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.qcReport.datasetIntegrityOk, false);
    assert.equal(result.writeResult.exportFilePath, null);
    assert.equal(await readFile(badQcPath, "utf8"), serializeTrainingExportQcReport(result.qcReport));
    await assert.rejects(async () => readFile(badJsonlPath, "utf8"));
  });

  it("returns exit code 0 for a trustworthy manifest even when candidates are exported", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as ShoulderAbductionReachResearchManifest;
    const built = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(resolveTrainingExportCliExitCode(built.qcReport), 0);
  });
});
