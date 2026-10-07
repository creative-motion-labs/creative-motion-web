/**
 * Shoulder Abduction Reach — dev-only training export builder (pure + node I/O).
 * RASQ ML bridge, Slice 5 (2026-08-20).
 *
 * Takes a Slice 4 manifest, resolves source capture records, applies
 * supervised-training eligibility rules, and produces:
 *  - a deterministic array of training-export samples
 *  - a machine-readable QC report
 *
 * CRITICAL DATASET-LEVEL INTEGRITY GATE:
 * If the input manifest has unresolved integrity diagnostics
 * (`evaluateShoulderAbductionReachManifestIntegrity().ok === false`), the
 * entire export is aborted: 0 training candidates, no canonical JSONL written,
 * dataset-level failure status in the QC report. The manifest is the trusted
 * provenance boundary; unresolved diagnostics do not permit creating a
 * supervised training artifact that appears partially trustworthy.
 *
 * ELIGIBILITY RULES (sample-level, applied only if dataset integrity passes):
 *  - Exactly ONE label with non-null compensationLabel (not zero, not many, not exclusion)
 *  - Source capture exists, identity fields match exactly
 *  - Capture/feature schema versions supported
 *
 * NO INVENTED THRESHOLDS:
 *  - trackingQuality is preserved as QC metadata only
 *  - reviewCaution is preserved as QC metadata only
 *  - NO automatic rejection based on usableFrameRatio or minCoreJointVisibility
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { computeReviewCautionFlag } from "./capture-reader";
import {
  isValidShoulderAbductionReachRepCaptureRecordForTrainingExport,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import {
  MANIFEST_ACCEPTED_CAPTURE_SCHEMA_VERSIONS,
  MANIFEST_ACCEPTED_FEATURE_SCHEMA_VERSIONS,
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  type ShoulderAbductionReachResearchManifest,
  type ShoulderAbductionReachManifestSample,
} from "./manifest-schema";
import { evaluateShoulderAbductionReachManifestIntegrity } from "./manifest-assembly";
import {
  TRAINING_EXPORT_SCHEMA_VERSION,
  TRAINING_EXPORT_QC_SCHEMA_VERSION,
  type ShoulderAbductionTrainingExportSample,
  type ShoulderAbductionTrainingExportQcReport,
  type ShoulderAbductionTrainingExportRejectedSample,
  type ShoulderAbductionTrainingExportRejectionCounts,
  type ShoulderAbductionTrainingExportExclusionFlagCounts,
  type ShoulderAbductionTrainingExportDistributions,
  serializeTrainingExportSample,
} from "./training-export-schema";
import { resolveDevSessionJsonlPath } from "./local-jsonl-writer";

/**
 * Result of attempting to build a training export from a manifest. If
 * `datasetIntegrityOk === false`, `samples` is empty and no canonical export
 * should be written.
 */
export type BuildTrainingExportResult = {
  samples: ShoulderAbductionTrainingExportSample[];
  qcReport: ShoulderAbductionTrainingExportQcReport;
};

/**
 * Reads one line from a capture JSONL file and parses it as a capture record.
 * Returns a discriminated result so callers can distinguish missing files,
 * missing lines, and malformed JSON.
 */
async function readCaptureLineResult(
  devSessionId: string,
  lineIndex: number,
): Promise<
  | { kind: "ok"; record: ShoulderAbductionReachRepCaptureRecord }
  | { kind: "file_missing" }
  | { kind: "line_missing" }
  | { kind: "malformed_line" }
  | { kind: "malformed_record" }
> {
  const filePath = resolveDevSessionJsonlPath(devSessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "file_missing" };
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lineIndex < 0 || lineIndex >= lines.length) return { kind: "line_missing" };

  try {
    const parsed: unknown = JSON.parse(lines[lineIndex]);
    if (!isValidShoulderAbductionReachRepCaptureRecordForTrainingExport(parsed)) {
      return { kind: "malformed_record" };
    }
    return { kind: "ok", record: parsed };
  } catch {
    return { kind: "malformed_line" };
  }
}

/**
 * Verifies that a capture record's identity fields match the manifest sample's
 * assertions. Returns null if valid, or an array of mismatched field names if not.
 */
function verifyCaptureIdentity(
  manifestSample: ShoulderAbductionReachManifestSample,
  captureRecord: ShoulderAbductionReachRepCaptureRecord,
): string[] | null {
  const mismatches: string[] = [];

  if (captureRecord.context.devSessionId !== manifestSample.devSessionId) {
    mismatches.push("devSessionId");
  }
  if (captureRecord.context.repetitionId !== manifestSample.repetitionId) {
    mismatches.push("repetitionId");
  }
  if (captureRecord.context.side !== manifestSample.side) {
    mismatches.push("side");
  }
  if (captureRecord.context.participantId !== manifestSample.participantId) {
    mismatches.push("participantId");
  }
  if (captureRecord.context.captureSchemaVersion !== manifestSample.captureSchemaVersion) {
    mismatches.push("captureSchemaVersion");
  }
  if (captureRecord.context.featureSchemaVersion !== manifestSample.featureSchemaVersion) {
    mismatches.push("featureSchemaVersion");
  }
  if (captureRecord.context.movementType !== manifestSample.movementType) {
    mismatches.push("movementType");
  }
  if (captureRecord.context.repetitionIndex !== manifestSample.repetitionIndex) {
    mismatches.push("repetitionIndex");
  }
  if (captureRecord.frames.length !== manifestSample.source.frameCount) {
    mismatches.push("frameCount");
  }

  return mismatches.length > 0 ? mismatches : null;
}

/**
 * Determines eligibility and builds an export sample or rejection for one
 * manifest sample. Returns either a training sample or a rejection reason.
 *
 * ELIGIBILITY REQUIREMENTS:
 *  - Exactly one label
 *  - That label has a non-null compensationLabel (not an exclusion flag)
 *  - Source capture exists and identity matches
 *  - Capture/feature schema versions are supported
 */
async function processManifestSample(
  manifestSample: ShoulderAbductionReachManifestSample,
): Promise<
  | { kind: "exported"; sample: ShoulderAbductionTrainingExportSample }
  | { kind: "rejected"; rejection: ShoulderAbductionTrainingExportRejectedSample }
> {
  const sampleId = manifestSample.sampleId;

  // Rule: Exactly one label required
  if (manifestSample.labels.length === 0) {
    return { kind: "rejected", rejection: { sampleId, reason: "UNLABELED" } };
  }

  if (manifestSample.labels.length > 1) {
    return { kind: "rejected", rejection: { sampleId, reason: "MULTI_RATER_REQUIRES_POLICY" } };
  }

  const label = manifestSample.labels[0];

  // Rule: Label must have a compensationLabel (not an exclusion flag)
  if (label.exclusionFlag !== null) {
    return {
      kind: "rejected",
      rejection: {
        sampleId,
        reason: "THERAPIST_EXCLUSION",
        exclusionFlag: label.exclusionFlag,
      },
    };
  }

  if (label.compensationLabel === null) {
    // Defensive: should not happen given label schema validation, but fail closed
    return { kind: "rejected", rejection: { sampleId, reason: "THERAPIST_EXCLUSION" } };
  }

  // Rule: Capture schema version must be supported
  if (!MANIFEST_ACCEPTED_CAPTURE_SCHEMA_VERSIONS.includes(manifestSample.captureSchemaVersion)) {
    return {
      kind: "rejected",
      rejection: {
        sampleId,
        reason: "UNSUPPORTED_CAPTURE_SCHEMA",
        observedVersion: manifestSample.captureSchemaVersion,
      },
    };
  }

  // Rule: Feature schema version must be supported
  if (!MANIFEST_ACCEPTED_FEATURE_SCHEMA_VERSIONS.includes(manifestSample.featureSchemaVersion)) {
    return {
      kind: "rejected",
      rejection: {
        sampleId,
        reason: "UNSUPPORTED_FEATURE_SCHEMA",
        observedVersion: manifestSample.featureSchemaVersion,
      },
    };
  }

  // Rule: Source capture must exist and be readable
  const captureLineResult = await readCaptureLineResult(
    manifestSample.devSessionId,
    manifestSample.sourceLineIndex,
  );

  if (captureLineResult.kind === "file_missing") {
    return { kind: "rejected", rejection: { sampleId, reason: "SOURCE_NOT_FOUND" } };
  }
  if (captureLineResult.kind === "line_missing") {
    return { kind: "rejected", rejection: { sampleId, reason: "SOURCE_LINE_MISSING" } };
  }
  if (captureLineResult.kind === "malformed_line") {
    return { kind: "rejected", rejection: { sampleId, reason: "MALFORMED_SOURCE_LINE" } };
  }
  if (captureLineResult.kind === "malformed_record") {
    return { kind: "rejected", rejection: { sampleId, reason: "MALFORMED_SOURCE_RECORD" } };
  }

  const captureRecord = captureLineResult.record;

  // Rule: Source identity must match manifest assertions
  const mismatchedFields = verifyCaptureIdentity(manifestSample, captureRecord);
  if (mismatchedFields !== null) {
    return {
      kind: "rejected",
      rejection: {
        sampleId,
        reason: "SOURCE_IDENTITY_MISMATCH",
        mismatchedFields,
      },
    };
  }

  // All checks passed — build the training export sample
  const reviewCaution = computeReviewCautionFlag(
    captureRecord.frames.length,
    captureRecord.derivedFeatures.trackingQuality.usableFrameRatio,
  );

  const exportSample: ShoulderAbductionTrainingExportSample = {
    exportSchemaVersion: TRAINING_EXPORT_SCHEMA_VERSION,
    sampleId,
    provenance: {
      participantId: manifestSample.participantId,
      devSessionId: manifestSample.devSessionId,
      sourceLineIndex: manifestSample.sourceLineIndex,
      repetitionId: manifestSample.repetitionId,
      repetitionIndex: manifestSample.repetitionIndex,
      side: manifestSample.side,
      movementType: manifestSample.movementType,
      captureSchemaVersion: manifestSample.captureSchemaVersion,
      featureSchemaVersion: manifestSample.featureSchemaVersion,
      labelSchemaVersion: label.labelSchemaVersion,
      manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
      datasetVersion: label.datasetVersion,
      raterId: label.raterId,
      labeledAtMs: label.labeledAtMs,
      manifestSourceReference: manifestSample.source,
    },
    input: {
      frames: captureRecord.frames,
    },
    target: {
      compensationLabel: label.compensationLabel,
    },
    qc: {
      raterConfidence: label.raterConfidence,
      trackingQuality: captureRecord.derivedFeatures.trackingQuality,
      frameCount: captureRecord.frames.length,
      movementDurationMs: captureRecord.derivedFeatures.movementDurationMs,
      reviewCaution,
    },
  };

  return { kind: "exported", sample: exportSample };
}

/**
 * Computes distribution summaries for exported samples. Returns all zeros if
 * no samples were exported.
 */
function computeExportedDistributions(
  samples: ShoulderAbductionTrainingExportSample[],
): ShoulderAbductionTrainingExportDistributions {
  const compensationLabels = {
    NO_COMPENSATION: 0,
    MILD_COMPENSATION: 0,
    CLEAR_COMPENSATION: 0,
  };
  const raterConfidence = { low: 0, medium: 0, high: 0 };
  const sides = { left: 0, right: 0 };
  const participants = new Set<string>();
  const sessions = new Set<string>();
  const raters = new Set<string>();

  for (const sample of samples) {
    compensationLabels[sample.target.compensationLabel] += 1;
    raterConfidence[sample.qc.raterConfidence] += 1;
    sides[sample.provenance.side] += 1;
    participants.add(sample.provenance.participantId);
    sessions.add(sample.provenance.devSessionId);
    raters.add(sample.provenance.raterId);
  }

  return {
    compensationLabels,
    raterConfidence,
    sides,
    distinctParticipants: participants.size,
    distinctSessions: sessions.size,
    distinctRaters: raters.size,
    participantLevelSplitPossible: participants.size >= 2,
  };
}

/**
 * Computes SHA-256 content hash of the canonical training export JSONL
 * (deterministic line ordering, no timestamps).
 */
function computeExportContentHash(samples: ShoulderAbductionTrainingExportSample[]): string {
  const hash = createHash("sha256");
  const sortedSamples = [...samples].sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  for (const sample of sortedSamples) {
    hash.update(serializeTrainingExportSample(sample));
  }
  return hash.digest("hex");
}

/**
 * Builds a training export from a Slice 4 manifest. CRITICAL: checks manifest
 * integrity FIRST. If the manifest has unresolved diagnostics, exports 0
 * candidates and returns dataset-level failure status.
 *
 * Otherwise, processes each manifest sample and applies supervised-training
 * eligibility rules (one compensation label, source exists and matches,
 * supported schemas).
 */
export async function buildShoulderAbductionTrainingExport(
  manifest: ShoulderAbductionReachResearchManifest,
): Promise<BuildTrainingExportResult> {
  const manifestIntegrity = evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics);

  // CRITICAL DATASET-LEVEL GATE: abort export if manifest has unresolved diagnostics
  if (!manifestIntegrity.ok) {
    const emptyRejectionCounts: ShoulderAbductionTrainingExportRejectionCounts = {
      UNLABELED: 0,
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
    };

    const emptyExclusionCounts: ShoulderAbductionTrainingExportExclusionFlagCounts = {
      WRONG_MOVEMENT_PLANE: 0,
      INCOMPLETE_REPETITION: 0,
      NOT_REVIEWABLE: 0,
    };

    const emptyDistributions: ShoulderAbductionTrainingExportDistributions = {
      compensationLabels: { NO_COMPENSATION: 0, MILD_COMPENSATION: 0, CLEAR_COMPENSATION: 0 },
      raterConfidence: { low: 0, medium: 0, high: 0 },
      sides: { left: 0, right: 0 },
      distinctParticipants: 0,
      distinctSessions: 0,
      distinctRaters: 0,
      participantLevelSplitPossible: false,
    };

    const qcReport: ShoulderAbductionTrainingExportQcReport = {
      qcSchemaVersion: TRAINING_EXPORT_QC_SCHEMA_VERSION,
      datasetIntegrityOk: false,
      datasetIntegrityBlockers: manifestIntegrity.blockingReasons,
      manifestSchemaVersion: manifest.manifestSchemaVersion,
      datasetVersion: manifest.datasetVersion,
      manifestSamplesReviewed: manifest.samples.length,
      supervisedCandidatesExported: 0,
      rejectionCounts: emptyRejectionCounts,
      exclusionFlagCounts: emptyExclusionCounts,
      exportedDistributions: emptyDistributions,
      captureSchemaVersions: [],
      featureSchemaVersions: [],
      labelSchemaVersions: [],
      rejectedSamples: [],
      exportContentSha256: null,
    };

    return { samples: [], qcReport };
  }

  // Manifest integrity passed — process each sample
  const exportedSamples: ShoulderAbductionTrainingExportSample[] = [];
  const rejectedSamples: ShoulderAbductionTrainingExportRejectedSample[] = [];
  const seenSampleIds = new Set<string>();

  for (const manifestSample of manifest.samples) {
    if (seenSampleIds.has(manifestSample.sampleId)) {
      rejectedSamples.push({
        sampleId: manifestSample.sampleId,
        reason: "DUPLICATE_MANIFEST_SAMPLE_IDENTITY",
      });
      continue;
    }
    seenSampleIds.add(manifestSample.sampleId);

    const result = await processManifestSample(manifestSample);
    if (result.kind === "exported") {
      exportedSamples.push(result.sample);
    } else {
      rejectedSamples.push(result.rejection);
    }
  }

  // Sort deterministically
  exportedSamples.sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  rejectedSamples.sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  // Compute rejection counts
  const rejectionCounts: ShoulderAbductionTrainingExportRejectionCounts = {
    UNLABELED: 0,
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
  };

  const exclusionFlagCounts: ShoulderAbductionTrainingExportExclusionFlagCounts = {
    WRONG_MOVEMENT_PLANE: 0,
    INCOMPLETE_REPETITION: 0,
    NOT_REVIEWABLE: 0,
  };

  for (const rejected of rejectedSamples) {
    rejectionCounts[rejected.reason] += 1;
    if (rejected.reason === "THERAPIST_EXCLUSION" && rejected.exclusionFlag) {
      const flag = rejected.exclusionFlag as keyof ShoulderAbductionTrainingExportExclusionFlagCounts;
      if (flag in exclusionFlagCounts) {
        exclusionFlagCounts[flag] += 1;
      }
    }
  }

  // Collect observed schema versions
  const captureSchemaVersions = [
    ...new Set(manifest.samples.map((s) => s.captureSchemaVersion)),
  ].sort();
  const featureSchemaVersions = [
    ...new Set(manifest.samples.map((s) => s.featureSchemaVersion)),
  ].sort();
  const labelSchemaVersions = [
    ...new Set(manifest.samples.flatMap((s) => s.labels.map((l) => l.labelSchemaVersion))),
  ].sort();

  // Compute distributions and content hash
  const exportedDistributions = computeExportedDistributions(exportedSamples);
  const exportContentSha256 =
    exportedSamples.length > 0 ? computeExportContentHash(exportedSamples) : null;

  const qcReport: ShoulderAbductionTrainingExportQcReport = {
    qcSchemaVersion: TRAINING_EXPORT_QC_SCHEMA_VERSION,
    datasetIntegrityOk: true,
    datasetIntegrityBlockers: [],
    manifestSchemaVersion: manifest.manifestSchemaVersion,
    datasetVersion: manifest.datasetVersion,
    manifestSamplesReviewed: manifest.samples.length,
    supervisedCandidatesExported: exportedSamples.length,
    rejectionCounts,
    exclusionFlagCounts,
    exportedDistributions,
    captureSchemaVersions,
    featureSchemaVersions,
    labelSchemaVersions,
    rejectedSamples,
    exportContentSha256,
  };

  return { samples: exportedSamples, qcReport };
}
