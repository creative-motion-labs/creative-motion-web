/**
 * Slice 4 research manifest — disk-level integration tests.
 *
 * Uses an unmistakable synthetic fixture session written through the EXISTING
 * capture/label writers, so it exercises the real on-disk layout without ever
 * depending on real research data. Verifies that assembly is read-only with
 * respect to source files, that the manifest lands in its own gitignored
 * directory, and that the Slice 1–3 persisted record shapes still hold.
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/manifest-source-integrity.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { appendFile, readFile, stat, unlink } from "node:fs/promises";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import {
  buildPersistedShoulderAbductionReachLabelRecord,
  projectShoulderAbductionReachLabelForRater,
  type ShoulderAbductionReachLabelRecord,
} from "./label-schema";
import {
  appendShoulderAbductionReachRepRecordLocally,
  ML_RESEARCH_DEV_DATA_DIR,
  resolveDevSessionJsonlPath,
} from "./local-jsonl-writer";
import {
  appendShoulderAbductionReachLabelLocally,
  ML_RESEARCH_LABEL_DATA_DIR,
  resolveDevSessionLabelsJsonlPath,
} from "./local-label-writer";
import { buildShoulderAbductionReachManifest } from "./manifest-builder";
import { serializeShoulderAbductionReachManifest } from "./manifest-schema";
import {
  assertManifestOutputPathIsSafe,
  ML_RESEARCH_MANIFEST_DATA_DIR,
  resolveManifestJsonPath,
  resolveManifestRunSidecarPath,
  writeShoulderAbductionReachManifest,
} from "./manifest-writer";

const TEST_SESSION_ID = "test-fixture-manifest-assembly-do-not-use";
const RATER_ID = "fixture-rater-a";

const CAPTURE_PATH = resolveDevSessionJsonlPath(TEST_SESSION_ID);
const LABELS_PATH = resolveDevSessionLabelsJsonlPath(TEST_SESSION_ID);
const MANIFEST_PATH = resolveManifestJsonPath(TEST_SESSION_ID);
const RUN_PATH = resolveManifestRunSidecarPath(MANIFEST_PATH);

function captureRecord(
  lineIndex: number,
  side: "left" | "right",
): ShoulderAbductionReachRepCaptureRecord {
  return {
    context: {
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: `fixture-participant-${lineIndex}`,
      devSessionId: TEST_SESSION_ID,
      repetitionIndex: lineIndex + 1,
      repetitionId: `${TEST_SESSION_ID}-rep-${lineIndex + 1}`,
      side,
      movementType: "shoulder_abduction_reach",
      startedAtMs: 1000,
      endedAtMs: 2000,
    },
    frames: [
      { relativeTimestampMs: 0, frameIndex: 0, joints: {} },
      { relativeTimestampMs: 100, frameIndex: 1, joints: {} },
    ],
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.3,
      peakShoulderAngleDegrees: 121,
      movementDurationMs: 100,
      peakAngularVelocityDegPerSec: 200,
      trackingQuality: {
        framesTotal: 2,
        framesWithUsableAngle: 2,
        usableFrameRatio: 1,
        minCoreJointVisibility: 0.8,
      },
    },
  };
}

function labelFor(lineIndex: number, side: "left" | "right"): ShoulderAbductionReachLabelRecord {
  return buildPersistedShoulderAbductionReachLabelRecord(
    {
      devSessionId: TEST_SESSION_ID,
      repetitionId: `${TEST_SESSION_ID}-rep-${lineIndex + 1}`,
      sourceLineIndex: lineIndex,
      side,
      participantId: `fixture-participant-${lineIndex}`,
    },
    RATER_ID,
    {
      compensationLabel: "NO_COMPENSATION",
      exclusionFlag: null,
      raterConfidence: "high",
      note: "fixture label",
    },
    1_700_000_000_000,
  );
}

before(async () => {
  // Start from a clean slate in case an earlier interrupted run left fixtures behind.
  for (const path of [CAPTURE_PATH, LABELS_PATH, MANIFEST_PATH, RUN_PATH]) {
    await unlink(path).catch(() => {});
  }
  await appendShoulderAbductionReachRepRecordLocally(captureRecord(0, "right"));
  await appendShoulderAbductionReachRepRecordLocally(captureRecord(1, "left"));
  // A blank line and a truncated line, written directly: the writers cannot
  // produce these, but a partially-flushed real research file can.
  await appendFile(CAPTURE_PATH, "\n", "utf8");
  await appendFile(CAPTURE_PATH, '{"context":{"devSessionId":"trunc\n', "utf8");
  await appendShoulderAbductionReachLabelLocally(labelFor(0, "right"));
});

after(async () => {
  for (const path of [CAPTURE_PATH, LABELS_PATH, MANIFEST_PATH, RUN_PATH]) {
    await unlink(path).catch(() => {});
  }
});

describe("manifest build from disk", () => {
  it("indexes samples by non-empty line position, matching how sourceLineIndex was assigned at label time", async () => {
    const { manifest } = await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    assert.equal(manifest.diagnostics.captureRecordsRead, 3);
    assert.equal(manifest.samples.length, 2);
    assert.deepEqual(
      manifest.samples.map((sample) => sample.sourceLineIndex),
      [0, 1],
    );
    assert.equal(manifest.samples[0].labels.length, 1);
    assert.equal(manifest.samples[1].labels.length, 0);
  });

  it("surfaces the truncated line instead of quietly reading a clean dataset", async () => {
    const { manifest, integrity } = await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    assert.equal(manifest.diagnostics.malformedCaptureRecords, 1);
    assert.equal(manifest.diagnostics.rejections.length, 1);
    assert.equal(manifest.diagnostics.rejections[0].reason, "unparsable_json");
    assert.equal(manifest.diagnostics.rejections[0].fileLineIndex, 2);
    assert.equal(integrity.ok, false);
  });

  it("records a repo-relative POSIX source path, not a machine-specific absolute path", async () => {
    const { manifest } = await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    const { relativeFilePath } = manifest.samples[0].source;
    assert.equal(
      relativeFilePath,
      `dev-data/rasq-ml/shoulder-abduction/${TEST_SESSION_ID}.jsonl`,
    );
    assert.doesNotMatch(relativeFilePath, /\\|^[A-Za-z]:/);
  });

  it("reports a session with no capture file rather than returning an empty manifest as success", async () => {
    const { manifest, integrity } = await buildShoulderAbductionReachManifest([
      "test-fixture-session-that-does-not-exist",
    ]);
    assert.equal(manifest.samples.length, 0);
    assert.deepEqual(manifest.diagnostics.missingCaptureSessions, [
      "test-fixture-session-that-does-not-exist",
    ]);
    assert.equal(integrity.ok, false);
  });

  it("collapses a repeated session argument instead of double-counting its records", async () => {
    const { manifest } = await buildShoulderAbductionReachManifest([
      TEST_SESSION_ID,
      TEST_SESSION_ID,
    ]);
    assert.equal(manifest.samples.length, 2);
    assert.equal(manifest.diagnostics.captureRecordsRead, 3);
  });
});

describe("manifest generation never mutates research source data", () => {
  it("leaves capture and label files byte-identical and untouched", async () => {
    const before = {
      capture: await readFile(CAPTURE_PATH, "utf8"),
      labels: await readFile(LABELS_PATH, "utf8"),
      captureStat: await stat(CAPTURE_PATH),
      labelsStat: await stat(LABELS_PATH),
    };

    await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    const { manifest } = await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    await writeShoulderAbductionReachManifest(manifest, {
      outputPath: MANIFEST_PATH,
      nowMs: 1_700_000_000_000,
    });

    assert.equal(await readFile(CAPTURE_PATH, "utf8"), before.capture);
    assert.equal(await readFile(LABELS_PATH, "utf8"), before.labels);
    assert.equal((await stat(CAPTURE_PATH)).mtimeMs, before.captureStat.mtimeMs);
    assert.equal((await stat(LABELS_PATH)).mtimeMs, before.labelsStat.mtimeMs);
  });

  it("writes the manifest to its own dev-data directory, separate from both sources", () => {
    assert.notEqual(ML_RESEARCH_MANIFEST_DATA_DIR, ML_RESEARCH_DEV_DATA_DIR);
    assert.notEqual(ML_RESEARCH_MANIFEST_DATA_DIR, ML_RESEARCH_LABEL_DATA_DIR);
    assert.match(MANIFEST_PATH, /[\\/]dev-data[\\/]rasq-ml[\\/]shoulder-abduction-manifests[\\/]/);
  });
});

describe("F2 fix: manifest output path must be allowlisted under the dedicated directory", () => {
  it("rejects package.json", () => {
    assert.throws(() => assertManifestOutputPathIsSafe("package.json"), /refusing to write manifest/);
  });

  it("rejects tracked CV source file", () => {
    assert.throws(
      () =>
        assertManifestOutputPathIsSafe(
          "app/lib/cv/shoulder-abduction-reach-pose-detector.ts",
        ),
      /refusing to write manifest/,
    );
  });

  it("rejects tracked manifest source file", () => {
    assert.throws(
      () =>
        assertManifestOutputPathIsSafe(
          "app/lib/ml-research/shoulder-abduction-reach/manifest-assembly.ts",
        ),
      /refusing to write manifest/,
    );
  });

  it("rejects .git/config", () => {
    assert.throws(() => assertManifestOutputPathIsSafe(".git/config"), /refusing to write manifest/);
  });

  it("rejects capture data directory", () => {
    assert.throws(
      () => assertManifestOutputPathIsSafe(CAPTURE_PATH),
      /refusing to write manifest/,
    );
  });

  it("rejects label data directory", () => {
    assert.throws(
      () => assertManifestOutputPathIsSafe(LABELS_PATH),
      /refusing to write manifest/,
    );
  });

  it("rejects ../ escape attempt", () => {
    assert.throws(
      () => assertManifestOutputPathIsSafe("../../../package.json"),
      /refusing to write manifest/,
    );
  });

  it("rejects the manifest directory itself", () => {
    assert.throws(
      () => assertManifestOutputPathIsSafe(ML_RESEARCH_MANIFEST_DATA_DIR),
      /refusing to write manifest directly to the manifest directory itself/,
    );
  });

  it("accepts a valid path under the dedicated manifest directory", () => {
    assert.doesNotThrow(() => assertManifestOutputPathIsSafe(MANIFEST_PATH));
    assert.doesNotThrow(() =>
      assertManifestOutputPathIsSafe(
        resolveManifestJsonPath("nested/path/to/session"),
      ),
    );
  });
});

describe("manifest file determinism", () => {
  it("writes byte-identical manifest content on a second run and keeps the clock in the sidecar", async () => {
    const first = await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    await writeShoulderAbductionReachManifest(first.manifest, {
      outputPath: MANIFEST_PATH,
      nowMs: 1_700_000_000_000,
    });
    const firstBytes = await readFile(MANIFEST_PATH, "utf8");

    const second = await buildShoulderAbductionReachManifest([TEST_SESSION_ID]);
    await writeShoulderAbductionReachManifest(second.manifest, {
      outputPath: MANIFEST_PATH,
      nowMs: 1_800_000_000_000,
    });
    const secondBytes = await readFile(MANIFEST_PATH, "utf8");

    assert.equal(firstBytes, secondBytes);
    assert.equal(firstBytes, serializeShoulderAbductionReachManifest(second.manifest));
    assert.doesNotMatch(firstBytes, /generatedAtMs/);

    const sidecar = JSON.parse(await readFile(RUN_PATH, "utf8")) as Record<string, unknown>;
    assert.equal(sidecar.generatedAtMs, 1_800_000_000_000);
    assert.equal(sidecar.integrityOk, false);
    assert.ok(Array.isArray(sidecar.blockingReasons));
  });
});

describe("existing persisted record schemas remain unchanged", () => {
  it("keeps the capture record's persisted top-level shape", async () => {
    const raw = await readFile(CAPTURE_PATH, "utf8");
    const firstLine = raw.split("\n").filter((line) => line.trim().length > 0)[0];
    const record = JSON.parse(firstLine) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record), ["context", "frames", "derivedFeatures"]);
    assert.deepEqual(Object.keys(record.context as Record<string, unknown>), [
      "captureSchemaVersion",
      "featureSchemaVersion",
      "participantId",
      "devSessionId",
      "repetitionIndex",
      "repetitionId",
      "side",
      "movementType",
      "startedAtMs",
      "endedAtMs",
    ]);
  });

  it("keeps the persisted label record's field set, including server-owned participantId", async () => {
    const raw = await readFile(LABELS_PATH, "utf8");
    const firstLine = raw.split("\n").filter((line) => line.trim().length > 0)[0];
    const record = JSON.parse(firstLine) as Record<string, unknown>;
    assert.deepEqual(new Set(Object.keys(record)), new Set([
      "labelSchemaVersion",
      "datasetVersion",
      "devSessionId",
      "repetitionId",
      "sourceLineIndex",
      "participantId",
      "side",
      "raterId",
      "compensationLabel",
      "exclusionFlag",
      "raterConfidence",
      "note",
      "labeledAtMs",
    ]));
  });

  it("keeps the rater-facing label projection blind to participantId", () => {
    const projected = projectShoulderAbductionReachLabelForRater(labelFor(0, "right"));
    assert.equal("participantId" in projected, false);
  });
});
