/**
 * Slice 4 research manifest assembly — behavioral tests over synthetic,
 * fully isolated in-memory fixtures (no real research files, no disk).
 *
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/manifest-assembly.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
} from "./capture-schema";
import { ML_RESEARCH_DATASET_VERSION, ML_RESEARCH_LABEL_SCHEMA_VERSION } from "./label-schema";
import {
  assembleShoulderAbductionReachManifest,
  evaluateShoulderAbductionReachManifestIntegrity,
  type ManifestRawJsonlLine,
  type ManifestSessionInput,
} from "./manifest-assembly";
import {
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  serializeShoulderAbductionReachManifest,
} from "./manifest-schema";

const SESSION_A = "fixture-session-alpha";
const SESSION_B = "fixture-session-beta";
const CAPTURE_PATH_A = "dev-data/rasq-ml/shoulder-abduction/fixture-session-alpha.jsonl";

const UNPARSABLE = Symbol("unparsable-line");
type FixtureLine = unknown;

type CaptureOverrides = {
  devSessionId?: string;
  participantId?: string;
  repetitionId?: string;
  repetitionIndex?: number;
  side?: "left" | "right";
  captureSchemaVersion?: string;
  featureSchemaVersion?: string;
  frameCount?: number;
};

function captureRecord(overrides: CaptureOverrides = {}): Record<string, unknown> {
  const frameCount = overrides.frameCount ?? 3;
  return {
    context: {
      captureSchemaVersion: overrides.captureSchemaVersion ?? ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: overrides.featureSchemaVersion ?? ML_RESEARCH_FEATURE_SCHEMA_VERSION,
      participantId: overrides.participantId ?? "fixture-participant-1",
      devSessionId: overrides.devSessionId ?? SESSION_A,
      repetitionIndex: overrides.repetitionIndex ?? 1,
      repetitionId: overrides.repetitionId ?? `${SESSION_A}-rep-1`,
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
      trackingQuality: { framesTotal: frameCount, framesWithUsableAngle: frameCount, usableFrameRatio: 1 },
    },
  };
}

type LabelOverrides = {
  devSessionId?: string;
  sourceLineIndex?: number;
  repetitionId?: string;
  participantId?: string;
  side?: "left" | "right";
  raterId?: string;
  compensationLabel?: string | null;
  exclusionFlag?: string | null;
  raterConfidence?: string;
  note?: string;
  labeledAtMs?: number;
  labelSchemaVersion?: string;
  datasetVersion?: string;
};

function labelRecord(overrides: LabelOverrides = {}): Record<string, unknown> {
  const hasExclusion = overrides.exclusionFlag !== undefined && overrides.exclusionFlag !== null;
  return {
    labelSchemaVersion: overrides.labelSchemaVersion ?? ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: overrides.datasetVersion ?? ML_RESEARCH_DATASET_VERSION,
    devSessionId: overrides.devSessionId ?? SESSION_A,
    repetitionId: overrides.repetitionId ?? `${SESSION_A}-rep-1`,
    sourceLineIndex: overrides.sourceLineIndex ?? 0,
    participantId: overrides.participantId ?? "fixture-participant-1",
    side: overrides.side ?? "right",
    raterId: overrides.raterId ?? "fixture-rater-a",
    compensationLabel: hasExclusion
      ? null
      : overrides.compensationLabel !== undefined
        ? overrides.compensationLabel
        : "MILD_COMPENSATION",
    exclusionFlag: hasExclusion ? overrides.exclusionFlag : null,
    raterConfidence: overrides.raterConfidence ?? "medium",
    note: overrides.note ?? "",
    labeledAtMs: overrides.labeledAtMs ?? 1_700_000_000_000,
  };
}

function toLines(values: readonly FixtureLine[]): ManifestRawJsonlLine[] {
  return values.map((value, lineIndex) =>
    value === UNPARSABLE
      ? { lineIndex, kind: "unparsable" as const }
      : { lineIndex, kind: "json" as const, value },
  );
}

function sessionInput(
  devSessionId: string,
  captureLines: readonly FixtureLine[],
  labelLines: readonly FixtureLine[],
  options: { captureExists?: boolean; labelsExist?: boolean } = {},
): ManifestSessionInput {
  return {
    devSessionId,
    capture: {
      relativeFilePath: `dev-data/rasq-ml/shoulder-abduction/${devSessionId}.jsonl`,
      exists: options.captureExists ?? true,
      lines: toLines(captureLines),
    },
    labels: {
      relativeFilePath: `dev-data/rasq-ml/shoulder-abduction-labels/${devSessionId}.labels.jsonl`,
      exists: options.labelsExist ?? true,
      lines: toLines(labelLines),
    },
  };
}

describe("manifest assembly — one capture + one valid label", () => {
  const manifest = assembleShoulderAbductionReachManifest([
    sessionInput(SESSION_A, [captureRecord()], [labelRecord()]),
  ]);

  it("produces exactly one sample carrying full capture provenance", () => {
    assert.equal(manifest.samples.length, 1);
    const sample = manifest.samples[0];
    assert.equal(sample.sampleId, `${SESSION_A}#0`);
    assert.equal(sample.devSessionId, SESSION_A);
    assert.equal(sample.sourceLineIndex, 0);
    assert.equal(sample.repetitionId, `${SESSION_A}-rep-1`);
    assert.equal(sample.repetitionIndex, 1);
    assert.equal(sample.side, "right");
    assert.equal(sample.participantId, "fixture-participant-1");
    assert.equal(sample.movementType, "shoulder_abduction_reach");
    assert.equal(sample.captureSchemaVersion, ML_RESEARCH_CAPTURE_SCHEMA_VERSION);
    assert.equal(sample.featureSchemaVersion, ML_RESEARCH_FEATURE_SCHEMA_VERSION);
  });

  it("records a deterministic source reference instead of the frames", () => {
    const { source } = manifest.samples[0];
    assert.equal(source.kind, "capture_jsonl_line");
    assert.equal(source.relativeFilePath, CAPTURE_PATH_A);
    assert.equal(source.lineIndex, 0);
    assert.equal(source.frameCount, 3);
  });

  it("preserves the label's own provenance", () => {
    assert.equal(manifest.samples[0].labels.length, 1);
    const label = manifest.samples[0].labels[0];
    assert.deepEqual(label, {
      labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
      datasetVersion: ML_RESEARCH_DATASET_VERSION,
      raterId: "fixture-rater-a",
      compensationLabel: "MILD_COMPENSATION",
      exclusionFlag: null,
      raterConfidence: "medium",
      note: "",
      labeledAtMs: 1_700_000_000_000,
    });
  });

  it("keeps manifest, dataset, capture, feature and label versions separately identifiable", () => {
    assert.equal(manifest.manifestSchemaVersion, ML_RESEARCH_MANIFEST_SCHEMA_VERSION);
    assert.equal(manifest.datasetVersion, ML_RESEARCH_DATASET_VERSION);
    const versions = new Set([
      manifest.manifestSchemaVersion,
      manifest.datasetVersion,
      manifest.samples[0].captureSchemaVersion,
      manifest.samples[0].featureSchemaVersion,
      manifest.samples[0].labels[0].labelSchemaVersion,
    ]);
    assert.equal(versions.size, 5);
  });

  it("reports clean diagnostics and passes the integrity gate", () => {
    const d = manifest.diagnostics;
    assert.equal(d.captureRecordsRead, 1);
    assert.equal(d.labelRecordsRead, 1);
    assert.equal(d.manifestSamplesProduced, 1);
    assert.equal(d.labeledSamples, 1);
    assert.equal(d.unlabeledSamples, 0);
    assert.equal(d.totalAcceptedLabels, 1);
    assert.equal(d.compensationLabels, 1);
    assert.equal(d.excludedLabels, 0);
    assert.equal(d.distinctParticipants, 1);
    assert.equal(d.distinctSessions, 1);
    assert.equal(d.distinctRaters, 1);
    assert.deepEqual(d.rejections, []);
    assert.equal(evaluateShoulderAbductionReachManifestIntegrity(d).ok, true);
  });
});

describe("manifest assembly — unlabeled capture", () => {
  it("keeps the sample with an empty labels array and never invents a label", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord()], []),
    ]);
    assert.equal(manifest.samples.length, 1);
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.labeledSamples, 0);
    assert.equal(manifest.diagnostics.unlabeledSamples, 1);
    assert.equal(manifest.diagnostics.totalAcceptedLabels, 0);
    // "Not labeled yet" is legitimate evidence, not an integrity finding.
    assert.equal(evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics).ok, true);
  });

  it("treats a session whose label file does not exist the same way", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord()], [], { labelsExist: false }),
    ]);
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.labelRecordsRead, 0);
  });
});

describe("manifest assembly — multi-rater", () => {
  const manifest = assembleShoulderAbductionReachManifest([
    sessionInput(
      SESSION_A,
      [captureRecord()],
      [
        labelRecord({ raterId: "fixture-rater-b", compensationLabel: "CLEAR_COMPENSATION", labeledAtMs: 2_000 }),
        labelRecord({ raterId: "fixture-rater-a", compensationLabel: "NO_COMPENSATION", labeledAtMs: 1_000 }),
      ],
    ),
  ]);

  it("preserves both independent labels on the same sample", () => {
    assert.equal(manifest.samples[0].labels.length, 2);
    assert.equal(manifest.diagnostics.totalAcceptedLabels, 2);
    assert.equal(manifest.diagnostics.distinctRaters, 2);
    assert.equal(manifest.diagnostics.supersededLabelRevisions, 0);
  });

  it("orders labels by raterId, independent of file order", () => {
    assert.deepEqual(
      manifest.samples[0].labels.map((label) => label.raterId),
      ["fixture-rater-a", "fixture-rater-b"],
    );
  });

  it("synthesizes no consensus, majority, reference or encoded label", () => {
    const serialized = serializeShoulderAbductionReachManifest(manifest).toLowerCase();
    for (const forbidden of [
      "consensus",
      "majority",
      "referencelabel",
      "groundtruth",
      "labelencoding",
      "severityscore",
      "agreement",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden));
    }
    const sampleKeys = Object.keys(manifest.samples[0]);
    assert.deepEqual(sampleKeys.filter((key) => key.toLowerCase().includes("label")), ["labels"]);
  });

  it("counts an exclusion flag separately from a compensation label", () => {
    const withExclusion = assembleShoulderAbductionReachManifest([
      sessionInput(
        SESSION_A,
        [captureRecord()],
        [
          labelRecord({ raterId: "fixture-rater-a", exclusionFlag: "NOT_REVIEWABLE" }),
          labelRecord({ raterId: "fixture-rater-b", compensationLabel: "NO_COMPENSATION" }),
        ],
      ),
    ]);
    assert.equal(withExclusion.diagnostics.excludedLabels, 1);
    assert.equal(withExclusion.diagnostics.compensationLabels, 1);
    assert.equal(withExclusion.diagnostics.totalAcceptedLabels, 2);
  });
});

describe("manifest assembly — same rater re-labels the same repetition", () => {
  const manifest = assembleShoulderAbductionReachManifest([
    sessionInput(
      SESSION_A,
      [captureRecord()],
      [
        labelRecord({ raterId: "fixture-rater-a", compensationLabel: "NO_COMPENSATION", labeledAtMs: 1_000 }),
        labelRecord({ raterId: "fixture-rater-a", compensationLabel: "CLEAR_COMPENSATION", labeledAtMs: 5_000 }),
      ],
    ),
  ]);

  it("keeps only the latest label for that rater (Slice 2 semantics, unchanged)", () => {
    assert.equal(manifest.samples[0].labels.length, 1);
    assert.equal(manifest.samples[0].labels[0].compensationLabel, "CLEAR_COMPENSATION");
    assert.equal(manifest.samples[0].labels[0].labeledAtMs, 5_000);
  });

  it("reports the superseded revision instead of hiding it", () => {
    assert.equal(manifest.diagnostics.supersededLabelRevisions, 1);
    assert.equal(manifest.diagnostics.labelRecordsRead, 2);
    assert.equal(manifest.diagnostics.totalAcceptedLabels, 1);
    // An append-only correction is normal research behavior, not an integrity failure.
    assert.equal(evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics).ok, true);
  });

  it("still keeps case-distinct rater ids apart", () => {
    const caseDistinct = assembleShoulderAbductionReachManifest([
      sessionInput(
        SESSION_A,
        [captureRecord()],
        [labelRecord({ raterId: "Rater-A" }), labelRecord({ raterId: "rater-a" })],
      ),
    ]);
    assert.equal(caseDistinct.samples[0].labels.length, 2);
    assert.equal(caseDistinct.diagnostics.supersededLabelRevisions, 0);
  });
});

describe("manifest assembly — colliding repetitionId across sides", () => {
  const SHARED_REP_ID = `${SESSION_A}-shared-rep-id`;
  const manifest = assembleShoulderAbductionReachManifest([
    sessionInput(
      SESSION_A,
      [
        captureRecord({ side: "right", repetitionId: SHARED_REP_ID, participantId: "participant-line-0" }),
        captureRecord({ side: "left", repetitionId: SHARED_REP_ID, participantId: "participant-line-1" }),
      ],
      [
        labelRecord({
          sourceLineIndex: 1,
          side: "left",
          repetitionId: SHARED_REP_ID,
          participantId: "participant-line-1",
          raterId: "fixture-rater-a",
        }),
      ],
    ),
  ]);

  it("keeps the two colliding repetitions as separate samples", () => {
    assert.equal(manifest.samples.length, 2);
    assert.equal(manifest.samples[0].repetitionId, manifest.samples[1].repetitionId);
    assert.notEqual(manifest.samples[0].side, manifest.samples[1].side);
    assert.equal(manifest.diagnostics.distinctParticipants, 2);
  });

  it("attaches the label only to the matching side/line, never to its twin", () => {
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.samples[1].labels.length, 1);
    assert.equal(manifest.samples[1].side, "left");
    assert.deepEqual(manifest.diagnostics.rejections, []);
  });
});

describe("manifest assembly — fail-closed join integrity", () => {
  function assembleWithLabel(overrides: LabelOverrides) {
    return assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord()], [labelRecord(overrides)]),
    ]);
  }

  it("does not attach a label whose target capture line does not exist", () => {
    const manifest = assembleWithLabel({ sourceLineIndex: 7 });
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.orphanLabels, 1);
    assert.equal(manifest.diagnostics.rejections[0].reason, "capture_line_not_found");
    assert.equal(manifest.diagnostics.rejections[0].claimedSourceLineIndex, 7);
    assert.equal(evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics).ok, false);
  });

  it("rejects a valid line index carrying the wrong repetitionId", () => {
    const manifest = assembleWithLabel({ repetitionId: "forged-repetition-id" });
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.labelIdentityMismatches, 1);
    assert.equal(manifest.diagnostics.rejections[0].reason, "capture_identity_mismatch");
    assert.deepEqual(manifest.diagnostics.rejections[0].mismatchedFields, ["repetitionId"]);
  });

  it("rejects a valid line index carrying the wrong side", () => {
    const manifest = assembleWithLabel({ side: "left" });
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.deepEqual(manifest.diagnostics.rejections[0].mismatchedFields, ["side"]);
  });

  it("rejects a label whose persisted participantId contradicts the capture", () => {
    const manifest = assembleWithLabel({ participantId: "forged-participant" });
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.labelIdentityMismatches, 1);
    assert.deepEqual(manifest.diagnostics.rejections[0].mismatchedFields, ["participantId"]);
  });

  it("rejects a label written under a foreign devSessionId", () => {
    const manifest = assembleWithLabel({ devSessionId: SESSION_B });
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.labelIdentityMismatches, 1);
    assert.equal(manifest.diagnostics.rejections[0].reason, "label_session_file_mismatch");
  });

  it("reports mismatched field names only, never the compared values", () => {
    const manifest = assembleWithLabel({ participantId: "forged-participant" });
    const serialized = JSON.stringify(manifest.diagnostics.rejections);
    assert.doesNotMatch(serialized, /forged-participant|fixture-participant-1/);
  });

  it("does not let a foreign-session label supersede a legitimate one from the same rater", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(
        SESSION_A,
        [captureRecord()],
        [
          labelRecord({ raterId: "fixture-rater-a", compensationLabel: "NO_COMPENSATION", labeledAtMs: 1_000 }),
          labelRecord({
            raterId: "fixture-rater-a",
            devSessionId: SESSION_B,
            compensationLabel: "CLEAR_COMPENSATION",
            labeledAtMs: 9_000,
          }),
        ],
      ),
    ]);
    assert.equal(manifest.samples[0].labels.length, 1);
    assert.equal(manifest.samples[0].labels[0].compensationLabel, "NO_COMPENSATION");
    assert.equal(manifest.diagnostics.supersededLabelRevisions, 0);
    assert.equal(manifest.diagnostics.labelIdentityMismatches, 1);
  });

  describe("F1 regression: corrupted label must not supersede valid label via dedupe", () => {
    it("corrupted label with wrong side cannot supersede earlier valid label from same rater", () => {
      const manifest = assembleShoulderAbductionReachManifest([
        sessionInput(
          SESSION_A,
          [captureRecord({ side: "right" })],
          [
            labelRecord({
              sourceLineIndex: 0,
              side: "right",
              raterId: "aisha-rater-01",
              compensationLabel: "NO_COMPENSATION",
              labeledAtMs: 1_000,
            }),
            labelRecord({
              sourceLineIndex: 0,
              side: "left",
              raterId: "aisha-rater-01",
              compensationLabel: "CLEAR_COMPENSATION",
              labeledAtMs: 9_999,
            }),
          ],
        ),
      ]);
      assert.equal(manifest.samples[0].labels.length, 1);
      assert.equal(manifest.samples[0].labels[0].compensationLabel, "NO_COMPENSATION");
      assert.equal(manifest.samples[0].labels[0].labeledAtMs, 1_000);
      assert.equal(manifest.diagnostics.labelIdentityMismatches, 1);
      assert.equal(manifest.diagnostics.supersededLabelRevisions, 0);
      assert.equal(manifest.diagnostics.distinctRaters, 1);
      assert.deepEqual(manifest.diagnostics.rejections[0].mismatchedFields, ["side"]);
    });

    it("corrupted label with wrong repetitionId cannot supersede earlier valid label", () => {
      const manifest = assembleShoulderAbductionReachManifest([
        sessionInput(
          SESSION_A,
          [captureRecord({ repetitionId: `${SESSION_A}-rep-1` })],
          [
            labelRecord({
              sourceLineIndex: 0,
              repetitionId: `${SESSION_A}-rep-1`,
              raterId: "aisha-rater-01",
              compensationLabel: "NO_COMPENSATION",
              labeledAtMs: 1_000,
            }),
            labelRecord({
              sourceLineIndex: 0,
              repetitionId: `${SESSION_A}-rep-999`,
              raterId: "aisha-rater-01",
              compensationLabel: "CLEAR_COMPENSATION",
              labeledAtMs: 9_999,
            }),
          ],
        ),
      ]);
      assert.equal(manifest.samples[0].labels.length, 1);
      assert.equal(manifest.samples[0].labels[0].compensationLabel, "NO_COMPENSATION");
      assert.equal(manifest.diagnostics.supersededLabelRevisions, 0);
      assert.deepEqual(manifest.diagnostics.rejections[0].mismatchedFields, ["repetitionId"]);
    });

    it("corrupted label with wrong participantId cannot supersede earlier valid label", () => {
      const manifest = assembleShoulderAbductionReachManifest([
        sessionInput(
          SESSION_A,
          [captureRecord({ participantId: "fixture-participant-1" })],
          [
            labelRecord({
              sourceLineIndex: 0,
              participantId: "fixture-participant-1",
              raterId: "aisha-rater-01",
              compensationLabel: "NO_COMPENSATION",
              labeledAtMs: 1_000,
            }),
            labelRecord({
              sourceLineIndex: 0,
              participantId: "forged-participant",
              raterId: "aisha-rater-01",
              compensationLabel: "CLEAR_COMPENSATION",
              labeledAtMs: 9_999,
            }),
          ],
        ),
      ]);
      assert.equal(manifest.samples[0].labels.length, 1);
      assert.equal(manifest.samples[0].labels[0].compensationLabel, "NO_COMPENSATION");
      assert.equal(manifest.diagnostics.supersededLabelRevisions, 0);
      assert.deepEqual(manifest.diagnostics.rejections[0].mismatchedFields, ["participantId"]);
    });
  });
});

describe("manifest assembly — version compatibility", () => {
  it("joins a features-v1 capture record (real 29-rep session shape) unchanged", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(
        SESSION_A,
        [captureRecord({ featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1 })],
        [labelRecord()],
      ),
    ]);
    assert.equal(manifest.samples.length, 1);
    assert.equal(manifest.samples[0].featureSchemaVersion, ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1);
    assert.equal(manifest.samples[0].labels.length, 1);
    assert.equal(manifest.diagnostics.incompatibleVersionRecords, 0);
  });

  it("never joins a label whose labelSchemaVersion is not accepted", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(
        SESSION_A,
        [captureRecord()],
        [labelRecord({ labelSchemaVersion: "shoulder-abduction-label-schema-v99" })],
      ),
    ]);
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.incompatibleVersionRecords, 1);
    assert.equal(manifest.diagnostics.malformedLabelRecords, 0);
    assert.equal(manifest.diagnostics.rejections[0].reason, "incompatible_label_schema_version");
    assert.deepEqual(manifest.diagnostics.rejections[0].observedVersions, {
      labelSchemaVersion: "shoulder-abduction-label-schema-v99",
    });
    assert.equal(evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics).ok, false);
  });

  it("never joins a label from a different datasetVersion", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord()], [labelRecord({ datasetVersion: "shoulder-abduction-dataset-v2" })]),
    ]);
    assert.deepEqual(manifest.samples[0].labels, []);
    assert.equal(manifest.diagnostics.rejections[0].reason, "incompatible_dataset_version");
  });

  it("produces no sample for an unrecognized captureSchemaVersion, and marks its labels orphaned", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(
        SESSION_A,
        [captureRecord({ captureSchemaVersion: "shoulder-abduction-reach-capture-v99" })],
        [labelRecord()],
      ),
    ]);
    assert.equal(manifest.samples.length, 0);
    assert.equal(manifest.diagnostics.incompatibleVersionRecords, 1);
    assert.equal(manifest.diagnostics.orphanLabels, 1);
    assert.deepEqual(
      manifest.diagnostics.rejections.map((rejection) => rejection.reason),
      ["incompatible_capture_schema_version", "capture_line_rejected"],
    );
  });

  it("produces no sample for an unrecognized featureSchemaVersion", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord({ featureSchemaVersion: "features-v99" })], []),
    ]);
    assert.equal(manifest.samples.length, 0);
    assert.equal(manifest.diagnostics.rejections[0].reason, "incompatible_feature_schema_version");
  });
});

describe("manifest assembly — malformed source data is never silently absorbed", () => {
  it("counts and itemizes unparsable capture and label lines", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord(), UNPARSABLE], [UNPARSABLE, labelRecord()]),
    ]);
    assert.equal(manifest.diagnostics.captureRecordsRead, 2);
    assert.equal(manifest.diagnostics.labelRecordsRead, 2);
    assert.equal(manifest.diagnostics.manifestSamplesProduced, 1);
    assert.equal(manifest.diagnostics.malformedCaptureRecords, 1);
    assert.equal(manifest.diagnostics.malformedLabelRecords, 1);
    assert.equal(manifest.diagnostics.totalAcceptedLabels, 1);
    assert.equal(evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics).ok, false);
  });

  it("rejects a structurally invalid capture line rather than half-recording it", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [{ context: { devSessionId: SESSION_A }, frames: [] }], []),
    ]);
    assert.equal(manifest.samples.length, 0);
    assert.equal(manifest.diagnostics.malformedCaptureRecords, 1);
    assert.equal(manifest.diagnostics.rejections[0].reason, "invalid_capture_shape");
  });

  it("rejects a capture line stored under a foreign devSessionId", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord({ devSessionId: SESSION_B })], []),
    ]);
    assert.equal(manifest.samples.length, 0);
    assert.equal(manifest.diagnostics.rejections[0].reason, "capture_session_file_mismatch");
  });

  it("distinguishes a malformed label from a version-incompatible one", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_A, [captureRecord()], [labelRecord({ raterConfidence: "certain" })]),
    ]);
    assert.equal(manifest.diagnostics.malformedLabelRecords, 1);
    assert.equal(manifest.diagnostics.incompatibleVersionRecords, 0);
    assert.equal(manifest.diagnostics.rejections[0].reason, "invalid_label_shape");
  });

  it("reports a requested session whose capture file is missing", () => {
    const manifest = assembleShoulderAbductionReachManifest([
      sessionInput(SESSION_B, [], [], { captureExists: false, labelsExist: false }),
    ]);
    assert.deepEqual(manifest.diagnostics.missingCaptureSessions, [SESSION_B]);
    assert.equal(manifest.diagnostics.rejections[0].reason, "capture_file_missing");
    const verdict = evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics);
    assert.equal(verdict.ok, false);
    assert.match(verdict.blockingReasons.join(" "), /missing capture session/);
  });
});

describe("manifest assembly — determinism", () => {
  function buildSessions(): ManifestSessionInput[] {
    return [
      sessionInput(
        SESSION_B,
        [captureRecord({ devSessionId: SESSION_B, repetitionId: `${SESSION_B}-rep-1` })],
        [
          labelRecord({ devSessionId: SESSION_B, repetitionId: `${SESSION_B}-rep-1`, raterId: "rater-z" }),
          labelRecord({ devSessionId: SESSION_B, repetitionId: `${SESSION_B}-rep-1`, raterId: "rater-b" }),
        ],
      ),
      sessionInput(
        SESSION_A,
        [captureRecord(), captureRecord({ repetitionIndex: 2, repetitionId: `${SESSION_A}-rep-2`, side: "left" })],
        [labelRecord({ raterId: "rater-m" })],
      ),
    ];
  }

  it("produces byte-identical canonical output for the same inputs in a different order", () => {
    const sessions = buildSessions();
    const first = serializeShoulderAbductionReachManifest(
      assembleShoulderAbductionReachManifest(sessions),
    );
    const reversedSessions = [...buildSessions()].reverse();
    for (const session of reversedSessions) {
      session.labels.lines = [...session.labels.lines].reverse();
      session.capture.lines = [...session.capture.lines].reverse();
    }
    const second = serializeShoulderAbductionReachManifest(
      assembleShoulderAbductionReachManifest(reversedSessions),
    );
    assert.equal(first, second);
  });

  it("orders samples by session then sourceLineIndex, and contains no timestamp of its own", () => {
    const manifest = assembleShoulderAbductionReachManifest(buildSessions());
    assert.deepEqual(
      manifest.samples.map((sample) => sample.sampleId),
      [`${SESSION_A}#0`, `${SESSION_A}#1`, `${SESSION_B}#0`],
    );
    assert.deepEqual(manifest.scope.devSessionIds, [SESSION_A, SESSION_B]);
    const serialized = serializeShoulderAbductionReachManifest(manifest).toLowerCase();
    for (const forbidden of ["generatedat", "assembledat", "createdat", "\"now\""]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden));
    }
  });
});

describe("manifest assembly — content boundaries", () => {
  const manifest = assembleShoulderAbductionReachManifest([
    sessionInput(SESSION_A, [captureRecord()], [labelRecord({ note: "trunk shifts left near end" })]),
  ]);
  const serialized = serializeShoulderAbductionReachManifest(manifest);

  it("contains no raw video, image, or landmark-shaped payload", () => {
    const lowered = serialized.toLowerCase();
    for (const forbidden of [
      "video",
      "image",
      "base64",
      "dataurl",
      "frameblob",
      "landmark",
      "joints",
      "visibility",
      '"frames"',
    ]) {
      assert.doesNotMatch(lowered, new RegExp(forbidden));
    }
  });

  it("references the capture source instead of copying derived feature values", () => {
    const lowered = serialized.toLowerCase();
    for (const forbidden of [
      "peakshoulderangledegrees",
      "peaknormalizedtrunkdriftratio",
      "peakangularvelocitydegpersec",
      "derivedfeatures",
      "trackingquality",
      "simulationcondition",
    ]) {
      assert.doesNotMatch(lowered, new RegExp(forbidden));
    }
    assert.equal(manifest.samples[0].source.lineIndex, manifest.samples[0].sourceLineIndex);
  });

  it("makes no training-eligibility, split, or prediction decision", () => {
    const lowered = serialized.toLowerCase();
    for (const forbidden of [
      "trainingeligible",
      "eligible",
      "split",
      "train",
      "validation",
      "\"test\"",
      "prediction",
      "predicted",
      "classweight",
      "normalized",
      "imputed",
      "threshold",
    ]) {
      assert.doesNotMatch(lowered, new RegExp(forbidden));
    }
  });

  it("retains participantId as internal research provenance for future participant-level splitting", () => {
    assert.equal(manifest.samples[0].participantId, "fixture-participant-1");
  });
});
