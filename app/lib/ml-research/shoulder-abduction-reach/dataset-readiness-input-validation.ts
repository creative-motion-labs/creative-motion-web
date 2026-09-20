/**
 * Shoulder Abduction Reach — dataset readiness input validation.
 * RASQ ML bridge, Slice 7 (2026-08-21).
 *
 * Trust boundary for Slice 4 manifest JSON before readiness builder logic.
 * Fail-closed with actionable errors — no downstream TypeErrors.
 */

import {
  SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS,
  SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS,
} from "./label-schema";
import type {
  ShoulderAbductionReachManifestLabel,
  ShoulderAbductionReachManifestSample,
  ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";
import { SUPPORTED_MANIFEST_SCHEMA_VERSION } from "./dataset-readiness-schema";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidSide(value: unknown): value is "left" | "right" {
  return value === "left" || value === "right";
}

function isValidCompensationLabel(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      (SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS as readonly string[]).includes(value))
  );
}

function isValidExclusionFlag(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      (SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS as readonly string[]).includes(value))
  );
}

/**
 * Validates exactly-one-of invariant for a therapist label record.
 * Returns an actionable message, or null when valid.
 */
export function validateManifestLabelCompensationExclusionInvariant(
  label: Pick<ShoulderAbductionReachManifestLabel, "compensationLabel" | "exclusionFlag">,
  context: string,
): string | null {
  const hasCompensation = label.compensationLabel !== null;
  const hasExclusion = label.exclusionFlag !== null;

  if (!hasCompensation && !hasExclusion) {
    return `${context}: label invariant violated (compensationLabel and exclusionFlag both null)`;
  }
  if (hasCompensation && hasExclusion) {
    return `${context}: label invariant violated (compensationLabel and exclusionFlag both non-null)`;
  }
  return null;
}

function validateManifestLabel(
  label: unknown,
  context: string,
): ShoulderAbductionReachManifestLabel {
  if (!label || typeof label !== "object") {
    throw new Error(`${context}: label must be an object`);
  }

  const record = label as Partial<ShoulderAbductionReachManifestLabel>;

  if (!isNonEmptyString(record.labelSchemaVersion)) {
    throw new Error(`${context}: missing labelSchemaVersion`);
  }
  if (!isNonEmptyString(record.datasetVersion)) {
    throw new Error(`${context}: missing datasetVersion`);
  }
  if (!isNonEmptyString(record.raterId)) {
    throw new Error(`${context}: missing raterId`);
  }
  if (!("compensationLabel" in record)) {
    throw new Error(`${context}: missing compensationLabel`);
  }
  if (!("exclusionFlag" in record)) {
    throw new Error(`${context}: missing exclusionFlag`);
  }
  if (!isValidCompensationLabel(record.compensationLabel)) {
    throw new Error(`${context}: invalid compensationLabel`);
  }
  if (!isValidExclusionFlag(record.exclusionFlag)) {
    throw new Error(`${context}: invalid exclusionFlag`);
  }

  const invariantViolation = validateManifestLabelCompensationExclusionInvariant(
    {
      compensationLabel: record.compensationLabel ?? null,
      exclusionFlag: record.exclusionFlag ?? null,
    },
    context,
  );
  if (invariantViolation !== null) {
    throw new Error(invariantViolation);
  }

  if (
    record.raterConfidence !== "low" &&
    record.raterConfidence !== "medium" &&
    record.raterConfidence !== "high"
  ) {
    throw new Error(`${context}: invalid raterConfidence`);
  }
  if (!isFiniteNumber(record.labeledAtMs)) {
    throw new Error(`${context}: labeledAtMs must be a finite number`);
  }
  if (typeof record.note !== "string") {
    throw new Error(`${context}: note must be a string`);
  }

  return record as ShoulderAbductionReachManifestLabel;
}

function validateManifestSample(
  sample: unknown,
  sampleIndex: number,
): ShoulderAbductionReachManifestSample {
  const context = `manifest.samples[${sampleIndex}]`;

  if (!sample || typeof sample !== "object") {
    throw new Error(`${context}: sample must be an object`);
  }

  const record = sample as Partial<ShoulderAbductionReachManifestSample>;

  if (!isNonEmptyString(record.sampleId)) {
    throw new Error(`${context}: missing sampleId`);
  }
  if (!isNonEmptyString(record.participantId)) {
    throw new Error(`${context}: missing participantId`);
  }
  if (!isNonEmptyString(record.devSessionId)) {
    throw new Error(`${context}: missing devSessionId`);
  }
  if (!isNonEmptyString(record.repetitionId)) {
    throw new Error(`${context}: missing repetitionId`);
  }
  if (!isFiniteNumber(record.repetitionIndex)) {
    throw new Error(`${context}: repetitionIndex must be a finite number`);
  }
  if (!isValidSide(record.side)) {
    throw new Error(`${context}: side must be left or right`);
  }
  if (!Array.isArray(record.labels)) {
    throw new Error(`${context}: labels must be an array`);
  }

  const labels = record.labels.map((label, labelIndex) =>
    validateManifestLabel(label, `${context}.labels[${labelIndex}]`),
  );

  if (!record.source || typeof record.source !== "object") {
    throw new Error(`${context}: missing source reference`);
  }

  const source = record.source as Partial<ShoulderAbductionReachManifestSample["source"]>;
  if (source.kind !== "capture_jsonl_line") {
    throw new Error(`${context}: source.kind must be capture_jsonl_line`);
  }
  if (!isNonEmptyString(source.relativeFilePath)) {
    throw new Error(`${context}: source.relativeFilePath must be a non-empty string`);
  }
  if (!isFiniteNumber(source.lineIndex)) {
    throw new Error(`${context}: source.lineIndex must be a finite number`);
  }
  if (!isFiniteNumber(source.frameCount)) {
    throw new Error(`${context}: source.frameCount must be a finite number`);
  }

  return {
    ...(record as ShoulderAbductionReachManifestSample),
    labels,
    source: {
      kind: "capture_jsonl_line",
      relativeFilePath: source.relativeFilePath,
      lineIndex: source.lineIndex,
      frameCount: source.frameCount,
    },
  };
}

function validateManifestDiagnostics(
  diagnostics: unknown,
): ShoulderAbductionReachResearchManifest["diagnostics"] {
  if (!diagnostics || typeof diagnostics !== "object") {
    throw new Error("manifest.diagnostics must be an object");
  }

  const record = diagnostics as Partial<ShoulderAbductionReachResearchManifest["diagnostics"]>;
  const numericFields = [
    "captureRecordsRead",
    "labelRecordsRead",
    "manifestSamplesProduced",
    "labeledSamples",
    "unlabeledSamples",
    "totalAcceptedLabels",
    "excludedLabels",
    "compensationLabels",
    "distinctParticipants",
    "distinctSessions",
    "distinctRaters",
    "malformedCaptureRecords",
    "malformedLabelRecords",
    "orphanLabels",
    "labelIdentityMismatches",
    "incompatibleVersionRecords",
    "supersededLabelRevisions",
  ] as const;

  for (const field of numericFields) {
    if (!isFiniteNumber(record[field])) {
      throw new Error(`manifest.diagnostics.${field} must be a finite number`);
    }
  }

  if (!Array.isArray(record.missingCaptureSessions)) {
    throw new Error("manifest.diagnostics.missingCaptureSessions must be an array");
  }
  if (!Array.isArray(record.rejections)) {
    throw new Error("manifest.diagnostics.rejections must be an array");
  }

  return record as ShoulderAbductionReachResearchManifest["diagnostics"];
}

/**
 * Runtime validation for Slice 4 manifest JSON consumed by Slice 7.
 * Throws actionable domain errors — never returns partially coerced manifests.
 */
export function validateShoulderAbductionReachManifestForDatasetReadiness(
  parsed: unknown,
): ShoulderAbductionReachResearchManifest {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("manifest must be a JSON object");
  }

  const record = parsed as Partial<ShoulderAbductionReachResearchManifest>;

  if (record.manifestSchemaVersion !== SUPPORTED_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `unsupported manifest schema version: ${String(record.manifestSchemaVersion)}`,
    );
  }
  if (!isNonEmptyString(record.datasetVersion)) {
    throw new Error("manifest.datasetVersion must be a non-empty string");
  }
  if (!Array.isArray(record.samples)) {
    throw new Error("manifest.samples must be an array");
  }

  const diagnostics = validateManifestDiagnostics(record.diagnostics);
  const samples = record.samples.map((sample, index) => validateManifestSample(sample, index));

  if (!record.scope || typeof record.scope !== "object") {
    throw new Error("manifest.scope must be an object");
  }
  if (!Array.isArray(record.scope.devSessionIds)) {
    throw new Error("manifest.scope.devSessionIds must be an array");
  }

  return {
    manifestSchemaVersion: SUPPORTED_MANIFEST_SCHEMA_VERSION,
    datasetVersion: record.datasetVersion as ShoulderAbductionReachResearchManifest["datasetVersion"],
    scope: { devSessionIds: record.scope.devSessionIds },
    samples,
    diagnostics,
  };
}
