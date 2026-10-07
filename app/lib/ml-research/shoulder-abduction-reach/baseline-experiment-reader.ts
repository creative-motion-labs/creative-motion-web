/**
 * Shoulder Abduction Reach — baseline experiment training-export reader.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Loads and validates the Slice 5 canonical training export JSONL ONLY.
 * Never reads raw capture files or therapist label files.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS } from "./label-schema";
import {
  SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION,
  type BaselineCompensationLabel,
} from "./baseline-experiment-schema";
import { validateBaselineExperimentPoseFrames } from "./baseline-input-validation";
import {
  TRAINING_EXPORT_SCHEMA_VERSION,
  type ShoulderAbductionTrainingExportSample,
} from "./training-export-schema";

export type BaselineExperimentLoadedSample = {
  sampleId: string;
  participantId: string;
  side: ShoulderAbductionTrainingExportSample["provenance"]["side"];
  frames: ShoulderAbductionTrainingExportSample["input"]["frames"];
  compensationLabel: BaselineCompensationLabel;
  datasetVersion: string;
  exportSchemaVersion: string;
};

export type LoadTrainingExportResult = {
  samples: BaselineExperimentLoadedSample[];
  sourceTrainingExportSha256: string;
  trainingExportSchemaVersion: string;
  datasetVersion: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidCompensationLabel(value: unknown): value is BaselineCompensationLabel {
  return (
    typeof value === "string" &&
    (SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS as readonly string[]).includes(value)
  );
}

function parseTrainingExportLine(
  line: string,
  lineNumber: number,
): ShoulderAbductionTrainingExportSample {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`malformed training export JSON at line ${lineNumber}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`invalid training export record at line ${lineNumber}`);
  }

  const record = parsed as Partial<ShoulderAbductionTrainingExportSample>;

  if (record.exportSchemaVersion !== TRAINING_EXPORT_SCHEMA_VERSION) {
    throw new Error(
      `unsupported training export schema at line ${lineNumber}: ${String(record.exportSchemaVersion)}`,
    );
  }

  if (!isNonEmptyString(record.sampleId)) {
    throw new Error(`missing sampleId at line ${lineNumber}`);
  }

  if (!record.provenance || typeof record.provenance !== "object") {
    throw new Error(`missing provenance at line ${lineNumber}`);
  }

  if (!isNonEmptyString(record.provenance.participantId)) {
    throw new Error(`missing participantId in provenance at line ${lineNumber}`);
  }

  if (!record.input || typeof record.input !== "object") {
    throw new Error(`missing pose-frame input at line ${lineNumber}`);
  }

  validateBaselineExperimentPoseFrames(record.input.frames, {
    lineNumber,
    sampleId: record.sampleId,
  });

  if (!record.target || typeof record.target !== "object") {
    throw new Error(`missing target at line ${lineNumber}`);
  }

  if (!isValidCompensationLabel(record.target.compensationLabel)) {
    throw new Error(
      `invalid compensation label at line ${lineNumber}: ${String(record.target.compensationLabel)}`,
    );
  }

  if (record.provenance.side !== "left" && record.provenance.side !== "right") {
    throw new Error(`invalid side in provenance at line ${lineNumber}`);
  }

  return record as ShoulderAbductionTrainingExportSample;
}

/**
 * Reads a Slice 5 `.training-export.jsonl` file. Fail-closed on malformed or
 * unsupported exports. Does NOT dereference capture JSONL sources.
 */
export async function loadShoulderAbductionTrainingExportForBaselineExperiment(
  trainingExportPath: string,
): Promise<LoadTrainingExportResult> {
  const raw = await readFile(trainingExportPath, "utf8");
  const sourceTrainingExportSha256 = createHash("sha256").update(raw).digest("hex");

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("training export contains no samples");
  }

  const parsedSamples: BaselineExperimentLoadedSample[] = [];
  let datasetVersion: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const sample = parseTrainingExportLine(lines[index], index + 1);

    if (sample.exportSchemaVersion !== SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION) {
      throw new Error(`unsupported training export schema version: ${sample.exportSchemaVersion}`);
    }

    if (datasetVersion === null) {
      datasetVersion = sample.provenance.datasetVersion;
    } else if (sample.provenance.datasetVersion !== datasetVersion) {
      throw new Error(
        `mixed datasetVersion values in training export: ${datasetVersion} vs ${sample.provenance.datasetVersion}`,
      );
    }

    parsedSamples.push({
      sampleId: sample.sampleId,
      participantId: sample.provenance.participantId,
      side: sample.provenance.side,
      frames: sample.input.frames,
      compensationLabel: sample.target.compensationLabel,
      datasetVersion: sample.provenance.datasetVersion,
      exportSchemaVersion: sample.exportSchemaVersion,
    });
  }

  parsedSamples.sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  return {
    samples: parsedSamples,
    sourceTrainingExportSha256,
    trainingExportSchemaVersion: SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION,
    datasetVersion,
  };
}
