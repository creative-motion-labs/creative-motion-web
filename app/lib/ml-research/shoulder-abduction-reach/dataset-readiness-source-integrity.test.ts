/**
 * Slice 7 dataset readiness — disk-level integration tests.
 *
 * Uses synthetic fixture sessions under dev-data/ and never depends on real
 * research data. Verifies path safety, determinism, and read-only behavior on
 * source manifest/QC/export files.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/dataset-readiness-source-integrity.test.ts
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import {
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
} from "./label-schema";
import {
  appendShoulderAbductionReachRepRecordLocally,
  ML_RESEARCH_DEV_DATA_DIR,
  resolveDevSessionJsonlPath,
} from "./local-jsonl-writer";
import { resolveDevSessionLabelsJsonlPath } from "./local-label-writer";
import { runShoulderAbductionDatasetReadinessCli } from "./dataset-readiness-cli";
import {
  ML_RESEARCH_MANIFEST_DATA_DIR,
  resolveManifestJsonPath,
} from "./manifest-writer";
import {
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  serializeShoulderAbductionReachManifest,
  type ShoulderAbductionReachManifestSample,
  type ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";
import { buildShoulderAbductionTrainingExport } from "./training-export-builder";
import {
  assertDatasetReadinessOutputPathIsSafe,
  ML_RESEARCH_DATASET_READINESS_DATA_DIR,
  resolveDatasetReadinessReportPath,
  resolveLabelingQueueReportPath,
  resolveDatasetReadinessRunSidecarPath,
} from "./dataset-readiness-writer";
import { serializeTrainingExportQcReport } from "./training-export-schema";
import {
  ML_RESEARCH_TRAINING_EXPORT_DATA_DIR,
  resolveTrainingExportJsonlPath,
  resolveTrainingExportQcReportPath,
  writeShoulderAbductionTrainingExport,
} from "./training-export-writer";

const TEST_SESSION_ID = "test-fixture-dataset-readiness-do-not-use";
const RATER_ID = "fixture-rater-a";

const CAPTURE_PATH = resolveDevSessionJsonlPath(TEST_SESSION_ID);
const LABELS_PATH = resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID);
const MANIFEST_PATH = resolveManifestJsonPath(`${TEST_SESSION_ID}-readiness`);
const EXPORT_NAME = `${TEST_SESSION_ID}-readiness`;
const EXPORT_JSONL_PATH = resolveTrainingExportJsonlPath(EXPORT_NAME);
const QC_REPORT_PATH = resolveTrainingExportQcReportPath(EXPORT_NAME);
const READINESS_NAME = `${TEST_SESSION_ID}-readiness`;
const READINESS_REPORT_PATH = resolveDatasetReadinessReportPath(READINESS_NAME);
const LABELING_QUEUE_PATH = resolveLabelingQueueReportPath(READINESS_NAME);
const READINESS_RUN_PATH = resolveDatasetReadinessRunSidecarPath(READINESS_REPORT_PATH);

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
    repetitionId: overrides.repetitionId ?? `${TEST_SESSION_ID}-rep-${sourceLineIndex + 1}`,
    repetitionIndex: overrides.repetitionIndex ?? sourceLineIndex + 1,
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
    labels: overrides.labels ?? (sourceLineIndex === 0 ? [manifestLabel()] : []),
  };
}

function cleanManifest(
  samples: ShoulderAbductionReachManifestSample[],
): ShoulderAbductionReachResearchManifest {
  const distinctParticipants = new Set(samples.map((sample) => sample.participantId)).size;
  const labeledSamples = samples.filter((sample) => sample.labels.length > 0).length;

  return {
    manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    scope: { devSessionIds: [TEST_SESSION_ID] },
    samples,
    diagnostics: {
      captureRecordsRead: samples.length,
      labelRecordsRead: samples.reduce((sum, sample) => sum + sample.labels.length, 0),
      manifestSamplesProduced: samples.length,
      labeledSamples,
      unlabeledSamples: samples.length - labeledSamples,
      totalAcceptedLabels: samples.reduce((sum, sample) => sum + sample.labels.length, 0),
      excludedLabels: 0,
      compensationLabels: labeledSamples,
      distinctParticipants,
      distinctSessions: 1,
      distinctRaters: labeledSamples > 0 ? 1 : 0,
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

async function sha256File(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

describe("dataset readiness source integrity", () => {
  before(async () => {
    await mkdir(ML_RESEARCH_DEV_DATA_DIR, { recursive: true });
    await mkdir(ML_RESEARCH_MANIFEST_DATA_DIR, { recursive: true });
    await mkdir(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR, { recursive: true });
    await mkdir(ML_RESEARCH_DATASET_READINESS_DATA_DIR, { recursive: true });
  });

  beforeEach(async () => {
    await removeIfExists(CAPTURE_PATH);
    await removeIfExists(LABELS_PATH);
    await removeIfExists(MANIFEST_PATH);
    await removeIfExists(EXPORT_JSONL_PATH);
    await removeIfExists(QC_REPORT_PATH);
    await removeIfExists(READINESS_REPORT_PATH);
    await removeIfExists(LABELING_QUEUE_PATH);
    await removeIfExists(READINESS_RUN_PATH);
  });

  afterEach(async () => {
    await removeIfExists(CAPTURE_PATH);
    await removeIfExists(LABELS_PATH);
    await removeIfExists(MANIFEST_PATH);
    await removeIfExists(EXPORT_JSONL_PATH);
    await removeIfExists(QC_REPORT_PATH);
    await removeIfExists(READINESS_REPORT_PATH);
    await removeIfExists(LABELING_QUEUE_PATH);
    await removeIfExists(READINESS_RUN_PATH);
  });

  after(async () => {
    await removeIfExists(CAPTURE_PATH);
    await removeIfExists(LABELS_PATH);
    await removeIfExists(MANIFEST_PATH);
    await removeIfExists(EXPORT_JSONL_PATH);
    await removeIfExists(QC_REPORT_PATH);
    await removeIfExists(READINESS_REPORT_PATH);
    await removeIfExists(LABELING_QUEUE_PATH);
    await removeIfExists(READINESS_RUN_PATH);
  });

  it("rejects path traversal and unsafe sibling output paths", () => {
    assert.throws(
      () => assertDatasetReadinessOutputPathIsSafe("package.json"),
      /refusing to write dataset readiness output/,
    );
    assert.throws(
      () => assertDatasetReadinessOutputPathIsSafe(MANIFEST_PATH),
      /refusing to write dataset readiness output/,
    );
    assert.throws(
      () => assertDatasetReadinessOutputPathIsSafe("../../../package.json"),
      /refusing to write dataset readiness output/,
    );
    assert.throws(
      () => assertDatasetReadinessOutputPathIsSafe(ML_RESEARCH_DATASET_READINESS_DATA_DIR),
      /refusing to write dataset readiness output directly to directory itself/,
    );
    assert.doesNotThrow(() => assertDatasetReadinessOutputPathIsSafe(READINESS_REPORT_PATH));
  });

  it("leaves source manifest/QC/export bytes unchanged after a readiness run", async () => {
    await appendShoulderAbductionReachRepRecordLocally(captureRecord());
    await appendShoulderAbductionReachRepRecordLocally(
      captureRecord({
        repetitionIndex: 2,
        repetitionId: `${TEST_SESSION_ID}-rep-2`,
      }),
    );

    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, labels: [manifestLabel()] }),
      manifestSample({ sourceLineIndex: 1, labels: [] }),
    ]);
    await writeFile(MANIFEST_PATH, serializeShoulderAbductionReachManifest(manifest), "utf8");

    const exportResult = await buildShoulderAbductionTrainingExport(manifest);
    assert.equal(exportResult.qcReport.supervisedCandidatesExported, 1);
    await writeShoulderAbductionTrainingExport(exportResult.samples, exportResult.qcReport, {
      outputName: EXPORT_NAME,
      manifestPath: MANIFEST_PATH,
      nowMs: 1_700_000_000_000,
    });

    const manifestHashBefore = await sha256File(MANIFEST_PATH);
    const qcHashBefore = await sha256File(QC_REPORT_PATH);
    const exportHashBefore = await sha256File(EXPORT_JSONL_PATH);

    const result = await runShoulderAbductionDatasetReadinessCli({
      manifestPath: MANIFEST_PATH,
      qcReportPath: QC_REPORT_PATH,
      trainingExportPath: EXPORT_JSONL_PATH,
      outputName: READINESS_NAME,
      print: false,
      nowMs: 1_700_000_000_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.readinessReport.collectionStatus, "DATA_COLLECTION_INCOMPLETE");
    assert.equal(result.readinessReport.inventory.totalManifestSamples, 2);
    assert.equal(result.readinessReport.inventory.unlabeledSamples, 1);
    assert.equal(result.readinessReport.inventory.slice5TrainingCandidates, 1);

    assert.equal(await sha256File(MANIFEST_PATH), manifestHashBefore);
    assert.equal(await sha256File(QC_REPORT_PATH), qcHashBefore);
    assert.equal(await sha256File(EXPORT_JSONL_PATH), exportHashBefore);

    const readinessRaw = await readFile(READINESS_REPORT_PATH, "utf8");
    assert.doesNotMatch(readinessRaw, /sensitive therapist note must not leak/);
    assert.doesNotMatch(readinessRaw, /peakNormalizedTrunkDriftRatio/);

    const queueRaw = await readFile(LABELING_QUEUE_PATH, "utf8");
    assert.doesNotMatch(queueRaw, /"participantId"/);
    assert.doesNotMatch(queueRaw, /fixture-participant-1/);
    assert.doesNotMatch(queueRaw, /sensitive therapist note must not leak/);
  });

  it("writes deterministic canonical readiness and labeling-queue outputs", async () => {
    const manifest = cleanManifest([
      manifestSample({ sourceLineIndex: 0, labels: [manifestLabel()] }),
      manifestSample({ sourceLineIndex: 1, labels: [] }),
    ]);
    await writeFile(MANIFEST_PATH, serializeShoulderAbductionReachManifest(manifest), "utf8");

    const exportResult = await buildShoulderAbductionTrainingExport(manifest);
    await writeFile(QC_REPORT_PATH, serializeTrainingExportQcReport(exportResult.qcReport), "utf8");

    await runShoulderAbductionDatasetReadinessCli({
      manifestPath: MANIFEST_PATH,
      qcReportPath: QC_REPORT_PATH,
      trainingExportPath: null,
      outputName: READINESS_NAME,
      print: false,
      nowMs: 1_700_000_000_000,
    });

    const firstReadiness = await readFile(READINESS_REPORT_PATH, "utf8");
    const firstQueue = await readFile(LABELING_QUEUE_PATH, "utf8");

    await removeIfExists(READINESS_REPORT_PATH);
    await removeIfExists(LABELING_QUEUE_PATH);
    await removeIfExists(READINESS_RUN_PATH);

    await runShoulderAbductionDatasetReadinessCli({
      manifestPath: MANIFEST_PATH,
      qcReportPath: QC_REPORT_PATH,
      trainingExportPath: null,
      outputName: READINESS_NAME,
      print: false,
      nowMs: 1_700_000_000_001,
    });

    const secondReadiness = await readFile(READINESS_REPORT_PATH, "utf8");
    const secondQueue = await readFile(LABELING_QUEUE_PATH, "utf8");

    assert.equal(firstReadiness, secondReadiness);
    assert.equal(firstQueue, secondQueue);
    assert.ok((await stat(READINESS_RUN_PATH)).isFile());
  });

  it("restricts output to the dedicated dev-data readiness directory", async () => {
    const manifest = cleanManifest([manifestSample()]);
    await writeFile(MANIFEST_PATH, serializeShoulderAbductionReachManifest(manifest), "utf8");

    await runShoulderAbductionDatasetReadinessCli({
      manifestPath: MANIFEST_PATH,
      qcReportPath: null,
      trainingExportPath: null,
      outputName: READINESS_NAME,
      print: false,
      nowMs: 1_700_000_000_000,
    });

    assert.ok(READINESS_REPORT_PATH.startsWith(ML_RESEARCH_DATASET_READINESS_DATA_DIR));
    assert.ok(LABELING_QUEUE_PATH.startsWith(ML_RESEARCH_DATASET_READINESS_DATA_DIR));
    assert.ok(READINESS_RUN_PATH.startsWith(ML_RESEARCH_DATASET_READINESS_DATA_DIR));
  });
});
