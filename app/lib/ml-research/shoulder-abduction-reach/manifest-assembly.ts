/**
 * Shoulder Abduction Reach — dev-only research manifest assembler (pure).
 * RASQ ML bridge, Slice 4 (2026-08-20).
 *
 * No file I/O, no clock, no randomness, no network: takes already-read raw
 * JSONL lines and produces the manifest plus its diagnostics. All
 * classification (shape, version, join, identity) happens here so every
 * diagnostic is reachable from a synthetic in-memory fixture.
 *
 * JOIN IDENTITY — fail closed. A label is attached to a capture only when the
 * label's OWN persisted fields agree with the located capture line on all of:
 *
 *   devSessionId + sourceLineIndex  (the locator: unique per capture line)
 *   repetitionId                    (asserted, never the sole join key —
 *                                    Slice 1 ids can collide across sides)
 *   side                            (asserted)
 *   participantId                   (asserted; server-derived at label time,
 *                                    so a mismatch means tampering or a
 *                                    rewritten capture file)
 *
 * Any disagreement rejects the label with a diagnostic instead of attaching it
 * to a neighbouring repetition. Nothing is inferred, defaulted, or repaired.
 *
 * MULTI-RATER: labels stay as an array of independent judgments. The only
 * collapse applied is Slice 2's existing "latest label per (sourceLineIndex,
 * raterId)" rule, reused by calling `dedupeLatestLabelPerRepAndRater` directly
 * rather than restating it — a different rater is always a different pair and
 * is never merged.
 */

import { dedupeLatestLabelPerRepAndRater } from "./label-reader";
import {
  isValidShoulderAbductionReachLabelRecord,
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
  type ShoulderAbductionReachLabelRecord,
} from "./label-schema";
import {
  buildManifestSampleId,
  MANIFEST_ACCEPTED_CAPTURE_SCHEMA_VERSIONS,
  MANIFEST_ACCEPTED_DATASET_VERSIONS,
  MANIFEST_ACCEPTED_FEATURE_SCHEMA_VERSIONS,
  MANIFEST_ACCEPTED_LABEL_SCHEMA_VERSIONS,
  ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
  type ShoulderAbductionReachManifestLabel,
  type ShoulderAbductionReachManifestRejection,
  type ShoulderAbductionReachManifestSample,
  type ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

/** One raw source line, already read from disk but not yet interpreted. */
export type ManifestRawJsonlLine =
  | { lineIndex: number; kind: "json"; value: unknown }
  | { lineIndex: number; kind: "unparsable" };

export type ManifestSourceFileInput = {
  /** Repo-relative POSIX path recorded in each sample's source reference. */
  relativeFilePath: string;
  exists: boolean;
  /** Non-empty lines in file order. */
  lines: ManifestRawJsonlLine[];
};

export type ManifestSessionInput = {
  devSessionId: string;
  capture: ManifestSourceFileInput;
  labels: ManifestSourceFileInput;
};

/**
 * The manifest-relevant subset of a capture record. Only the fields the
 * manifest actually needs are required — a line missing any of them cannot be
 * given trustworthy provenance and is rejected rather than half-recorded.
 */
type ManifestCaptureContext = {
  captureSchemaVersion: string;
  featureSchemaVersion: string;
  participantId: string;
  devSessionId: string;
  repetitionIndex: number;
  repetitionId: string;
  side: ShoulderAbductionReachSide;
  movementType: string;
};

type ManifestCaptureLine = { context: ManifestCaptureContext; frameCount: number };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Locale-independent, code-unit ordering — `localeCompare` would make output depend on the host locale. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function readManifestCaptureLine(value: unknown): ManifestCaptureLine | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { context?: unknown; frames?: unknown };
  if (!record.context || typeof record.context !== "object") return null;
  if (!Array.isArray(record.frames)) return null;

  const context = record.context as Record<string, unknown>;
  if (!isNonEmptyString(context.captureSchemaVersion)) return null;
  if (!isNonEmptyString(context.featureSchemaVersion)) return null;
  if (!isNonEmptyString(context.participantId)) return null;
  if (!isNonEmptyString(context.devSessionId)) return null;
  if (!isNonEmptyString(context.repetitionId)) return null;
  if (!isNonEmptyString(context.movementType)) return null;
  if (!Number.isInteger(context.repetitionIndex)) return null;
  if (context.side !== "left" && context.side !== "right") return null;

  return {
    context: {
      captureSchemaVersion: context.captureSchemaVersion,
      featureSchemaVersion: context.featureSchemaVersion,
      participantId: context.participantId,
      devSessionId: context.devSessionId,
      repetitionIndex: context.repetitionIndex as number,
      repetitionId: context.repetitionId,
      side: context.side,
      movementType: context.movementType,
    },
    frameCount: record.frames.length,
  };
}

/**
 * Separates "wrong version" from "wrong shape" while reusing the SINGLE
 * existing label validator rather than restating its field rules: re-probe the
 * same record with the currently accepted version strings substituted. If it
 * validates then, the only defect was the version.
 */
function classifyLabelLine(
  value: unknown,
):
  | { outcome: "accepted"; record: ShoulderAbductionReachLabelRecord }
  | { outcome: "incompatible_label_schema_version"; observed: Record<string, string> }
  | { outcome: "incompatible_dataset_version"; observed: Record<string, string> }
  | { outcome: "invalid_label_shape" } {
  if (isValidShoulderAbductionReachLabelRecord(value)) {
    return { outcome: "accepted", record: value };
  }
  if (!value || typeof value !== "object") return { outcome: "invalid_label_shape" };

  const probe = {
    ...(value as Record<string, unknown>),
    labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
  };
  if (!isValidShoulderAbductionReachLabelRecord(probe)) return { outcome: "invalid_label_shape" };

  const raw = value as Record<string, unknown>;
  const observedLabelSchemaVersion =
    typeof raw.labelSchemaVersion === "string" ? raw.labelSchemaVersion : "(missing)";
  const observedDatasetVersion =
    typeof raw.datasetVersion === "string" ? raw.datasetVersion : "(missing)";

  if (!MANIFEST_ACCEPTED_LABEL_SCHEMA_VERSIONS.includes(observedLabelSchemaVersion)) {
    return {
      outcome: "incompatible_label_schema_version",
      observed: { labelSchemaVersion: observedLabelSchemaVersion },
    };
  }
  if (!MANIFEST_ACCEPTED_DATASET_VERSIONS.includes(observedDatasetVersion)) {
    return {
      outcome: "incompatible_dataset_version",
      observed: { datasetVersion: observedDatasetVersion },
    };
  }
  return { outcome: "invalid_label_shape" };
}

function toManifestLabel(record: ShoulderAbductionReachLabelRecord): ShoulderAbductionReachManifestLabel {
  return {
    labelSchemaVersion: record.labelSchemaVersion,
    datasetVersion: record.datasetVersion,
    raterId: record.raterId,
    compensationLabel: record.compensationLabel,
    exclusionFlag: record.exclusionFlag,
    raterConfidence: record.raterConfidence,
    note: record.note,
    labeledAtMs: record.labeledAtMs,
  };
}

const REJECTION_KIND_ORDER: Record<ShoulderAbductionReachManifestRejection["recordKind"], number> = {
  session: 0,
  capture: 1,
  label: 2,
};

function compareRejections(
  a: ShoulderAbductionReachManifestRejection,
  b: ShoulderAbductionReachManifestRejection,
): number {
  return (
    compareStrings(a.devSessionId, b.devSessionId) ||
    REJECTION_KIND_ORDER[a.recordKind] - REJECTION_KIND_ORDER[b.recordKind] ||
    a.fileLineIndex - b.fileLineIndex ||
    compareStrings(a.reason, b.reason)
  );
}

/**
 * Joins capture and label lines into a manifest.
 *
 * Deterministic by construction: sessions are sorted by `devSessionId`,
 * samples by `sourceLineIndex` within a session, a sample's labels by
 * `raterId` then `labeledAtMs`, and rejections by session/kind/line/reason.
 * Input array order, filesystem enumeration order, and object insertion order
 * never reach the output.
 */
export function assembleShoulderAbductionReachManifest(
  sessions: readonly ManifestSessionInput[],
): ShoulderAbductionReachResearchManifest {
  const orderedSessions = [...sessions].sort((a, b) =>
    compareStrings(a.devSessionId, b.devSessionId),
  );

  const samples: ShoulderAbductionReachManifestSample[] = [];
  const rejections: ShoulderAbductionReachManifestRejection[] = [];
  const missingCaptureSessions: string[] = [];
  const participantIds = new Set<string>();
  const sessionIdsWithSamples = new Set<string>();
  const raterIds = new Set<string>();

  let captureRecordsRead = 0;
  let labelRecordsRead = 0;
  let totalAcceptedLabels = 0;
  let excludedLabels = 0;
  let compensationLabels = 0;
  let malformedCaptureRecords = 0;
  let malformedLabelRecords = 0;
  let orphanLabels = 0;
  let labelIdentityMismatches = 0;
  let incompatibleVersionRecords = 0;
  let supersededLabelRevisions = 0;

  for (const session of orderedSessions) {
    const { devSessionId } = session;

    if (!session.capture.exists) {
      missingCaptureSessions.push(devSessionId);
      rejections.push({
        recordKind: "session",
        reason: "capture_file_missing",
        devSessionId,
        fileLineIndex: -1,
      });
    }

    const sampleByLineIndex = new Map<number, ShoulderAbductionReachManifestSample>();
    const rejectedCaptureLineIndexes = new Set<number>();

    for (const line of session.capture.lines) {
      captureRecordsRead += 1;

      if (line.kind === "unparsable") {
        malformedCaptureRecords += 1;
        rejectedCaptureLineIndexes.add(line.lineIndex);
        rejections.push({
          recordKind: "capture",
          reason: "unparsable_json",
          devSessionId,
          fileLineIndex: line.lineIndex,
        });
        continue;
      }

      const captureLine = readManifestCaptureLine(line.value);
      if (!captureLine) {
        malformedCaptureRecords += 1;
        rejectedCaptureLineIndexes.add(line.lineIndex);
        rejections.push({
          recordKind: "capture",
          reason: "invalid_capture_shape",
          devSessionId,
          fileLineIndex: line.lineIndex,
        });
        continue;
      }

      const { context, frameCount } = captureLine;

      if (context.devSessionId !== devSessionId) {
        malformedCaptureRecords += 1;
        rejectedCaptureLineIndexes.add(line.lineIndex);
        rejections.push({
          recordKind: "capture",
          reason: "capture_session_file_mismatch",
          devSessionId,
          fileLineIndex: line.lineIndex,
          mismatchedFields: ["devSessionId"],
        });
        continue;
      }

      if (!MANIFEST_ACCEPTED_CAPTURE_SCHEMA_VERSIONS.includes(context.captureSchemaVersion)) {
        incompatibleVersionRecords += 1;
        rejectedCaptureLineIndexes.add(line.lineIndex);
        rejections.push({
          recordKind: "capture",
          reason: "incompatible_capture_schema_version",
          devSessionId,
          fileLineIndex: line.lineIndex,
          observedVersions: { captureSchemaVersion: context.captureSchemaVersion },
        });
        continue;
      }

      if (!MANIFEST_ACCEPTED_FEATURE_SCHEMA_VERSIONS.includes(context.featureSchemaVersion)) {
        incompatibleVersionRecords += 1;
        rejectedCaptureLineIndexes.add(line.lineIndex);
        rejections.push({
          recordKind: "capture",
          reason: "incompatible_feature_schema_version",
          devSessionId,
          fileLineIndex: line.lineIndex,
          observedVersions: { featureSchemaVersion: context.featureSchemaVersion },
        });
        continue;
      }

      const sample: ShoulderAbductionReachManifestSample = {
        sampleId: buildManifestSampleId(devSessionId, line.lineIndex),
        devSessionId,
        sourceLineIndex: line.lineIndex,
        repetitionId: context.repetitionId,
        repetitionIndex: context.repetitionIndex,
        side: context.side,
        participantId: context.participantId,
        movementType: context.movementType,
        captureSchemaVersion: context.captureSchemaVersion,
        featureSchemaVersion: context.featureSchemaVersion,
        source: {
          kind: "capture_jsonl_line",
          relativeFilePath: session.capture.relativeFilePath,
          lineIndex: line.lineIndex,
          frameCount,
        },
        labels: [],
      };
      sampleByLineIndex.set(line.lineIndex, sample);
      samples.push(sample);
      participantIds.add(context.participantId);
      sessionIdsWithSamples.add(devSessionId);
    }

    // Identity-verified labels only, keeping each record's own file line index for diagnostics.
    const identityVerifiedLabels: ShoulderAbductionReachLabelRecord[] = [];
    const labelFileLineIndex = new Map<ShoulderAbductionReachLabelRecord, number>();

    for (const line of session.labels.lines) {
      labelRecordsRead += 1;

      if (line.kind === "unparsable") {
        malformedLabelRecords += 1;
        rejections.push({
          recordKind: "label",
          reason: "unparsable_json",
          devSessionId,
          fileLineIndex: line.lineIndex,
        });
        continue;
      }

      const classified = classifyLabelLine(line.value);
      if (classified.outcome === "invalid_label_shape") {
        malformedLabelRecords += 1;
        rejections.push({
          recordKind: "label",
          reason: "invalid_label_shape",
          devSessionId,
          fileLineIndex: line.lineIndex,
        });
        continue;
      }
      if (classified.outcome !== "accepted") {
        incompatibleVersionRecords += 1;
        rejections.push({
          recordKind: "label",
          reason: classified.outcome,
          devSessionId,
          fileLineIndex: line.lineIndex,
          observedVersions: classified.observed,
        });
        continue;
      }

      const label = classified.record;

      // Checked before dedupe: a foreign-session label must never take part in
      // the latest-per-rater comparison and supersede a legitimate label.
      if (label.devSessionId !== devSessionId) {
        labelIdentityMismatches += 1;
        rejections.push({
          recordKind: "label",
          reason: "label_session_file_mismatch",
          devSessionId,
          fileLineIndex: line.lineIndex,
          claimedSourceLineIndex: label.sourceLineIndex,
          mismatchedFields: ["devSessionId"],
        });
        continue;
      }

      // F1 FIX: Verify capture identity BEFORE dedupe. A corrupted label with
      // wrong repetitionId/side/participantId must not supersede a valid one.
      const sample = sampleByLineIndex.get(label.sourceLineIndex);

      if (!sample) {
        orphanLabels += 1;
        rejections.push({
          recordKind: "label",
          reason: rejectedCaptureLineIndexes.has(label.sourceLineIndex)
            ? "capture_line_rejected"
            : "capture_line_not_found",
          devSessionId,
          fileLineIndex: line.lineIndex,
          claimedSourceLineIndex: label.sourceLineIndex,
        });
        continue;
      }

      const mismatchedFields: string[] = [];
      if (sample.repetitionId !== label.repetitionId) mismatchedFields.push("repetitionId");
      if (sample.side !== label.side) mismatchedFields.push("side");
      if (sample.participantId !== label.participantId) mismatchedFields.push("participantId");

      if (mismatchedFields.length > 0) {
        labelIdentityMismatches += 1;
        rejections.push({
          recordKind: "label",
          reason: "capture_identity_mismatch",
          devSessionId,
          fileLineIndex: line.lineIndex,
          claimedSourceLineIndex: label.sourceLineIndex,
          mismatchedFields,
        });
        continue;
      }

      // Only identity-verified labels enter dedupe.
      identityVerifiedLabels.push(label);
      labelFileLineIndex.set(label, line.lineIndex);
    }

    // Slice 2 semantics, reused verbatim: latest label per (sourceLineIndex, raterId).
    const deduped = dedupeLatestLabelPerRepAndRater(identityVerifiedLabels);
    supersededLabelRevisions += identityVerifiedLabels.length - deduped.length;

    const orderedLabels = [...deduped].sort(
      (a, b) =>
        a.sourceLineIndex - b.sourceLineIndex ||
        compareStrings(a.raterId, b.raterId) ||
        a.labeledAtMs - b.labeledAtMs ||
        (labelFileLineIndex.get(a) ?? 0) - (labelFileLineIndex.get(b) ?? 0),
    );

    for (const label of orderedLabels) {
      const sample = sampleByLineIndex.get(label.sourceLineIndex);
      // Sample must exist: we verified it above before adding to identityVerifiedLabels.
      if (!sample) continue;

      sample.labels.push(toManifestLabel(label));
      totalAcceptedLabels += 1;
      raterIds.add(label.raterId);
      if (label.exclusionFlag !== null) excludedLabels += 1;
      if (label.compensationLabel !== null) compensationLabels += 1;
    }
  }

  samples.sort(
    (a, b) =>
      compareStrings(a.devSessionId, b.devSessionId) || a.sourceLineIndex - b.sourceLineIndex,
  );
  for (const sample of samples) {
    sample.labels.sort(
      (a, b) => compareStrings(a.raterId, b.raterId) || a.labeledAtMs - b.labeledAtMs,
    );
  }
  rejections.sort(compareRejections);

  const labeledSamples = samples.filter((sample) => sample.labels.length > 0).length;

  return {
    manifestSchemaVersion: ML_RESEARCH_MANIFEST_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
    scope: { devSessionIds: orderedSessions.map((session) => session.devSessionId) },
    samples,
    diagnostics: {
      captureRecordsRead,
      labelRecordsRead,
      manifestSamplesProduced: samples.length,
      labeledSamples,
      unlabeledSamples: samples.length - labeledSamples,
      totalAcceptedLabels,
      excludedLabels,
      compensationLabels,
      distinctParticipants: participantIds.size,
      distinctSessions: sessionIdsWithSamples.size,
      distinctRaters: raterIds.size,
      malformedCaptureRecords,
      malformedLabelRecords,
      orphanLabels,
      labelIdentityMismatches,
      incompatibleVersionRecords,
      supersededLabelRevisions,
      missingCaptureSessions: [...missingCaptureSessions].sort(compareStrings),
      rejections,
    },
  };
}

export type ManifestIntegrityVerdict = {
  ok: boolean;
  /** Human-readable blocking reasons, deterministic order. Empty when `ok`. */
  blockingReasons: string[];
};

/**
 * Fail-closed policy used by the CLI: any rejected record blocks writing a
 * manifest, so a research file with integrity problems can never be silently
 * turned into a "clean" dataset. Superseded label revisions are expected
 * append-only behavior and never block. Unlabeled samples never block —
 * "not labeled yet" is legitimate evidence, not a defect.
 */
export function evaluateShoulderAbductionReachManifestIntegrity(
  diagnostics: ShoulderAbductionReachResearchManifest["diagnostics"],
): ManifestIntegrityVerdict {
  const blockingReasons: string[] = [];
  if (diagnostics.missingCaptureSessions.length > 0) {
    blockingReasons.push(
      `missing capture session file(s): ${diagnostics.missingCaptureSessions.join(", ")}`,
    );
  }
  if (diagnostics.malformedCaptureRecords > 0) {
    blockingReasons.push(`malformedCaptureRecords=${diagnostics.malformedCaptureRecords}`);
  }
  if (diagnostics.malformedLabelRecords > 0) {
    blockingReasons.push(`malformedLabelRecords=${diagnostics.malformedLabelRecords}`);
  }
  if (diagnostics.orphanLabels > 0) {
    blockingReasons.push(`orphanLabels=${diagnostics.orphanLabels}`);
  }
  if (diagnostics.labelIdentityMismatches > 0) {
    blockingReasons.push(`labelIdentityMismatches=${diagnostics.labelIdentityMismatches}`);
  }
  if (diagnostics.incompatibleVersionRecords > 0) {
    blockingReasons.push(`incompatibleVersionRecords=${diagnostics.incompatibleVersionRecords}`);
  }
  return { ok: blockingReasons.length === 0, blockingReasons };
}
