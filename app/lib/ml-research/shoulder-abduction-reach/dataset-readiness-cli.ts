/**
 * Shoulder Abduction Reach — dataset readiness CLI runner.
 * RASQ ML bridge, Slice 7 (2026-08-21).
 *
 * Shared by the CLI script and tests so exit-code policy is exercised without
 * spawning a subprocess.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  buildDatasetReadinessCliSummaryLines,
  buildLabelingQueue,
  buildShoulderAbductionDatasetReadinessReport,
} from "./dataset-readiness-builder";
import { validateShoulderAbductionReachManifestForDatasetReadiness } from "./dataset-readiness-input-validation";
import {
  SUPPORTED_QC_SCHEMA_VERSION,
  SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION_FOR_READINESS,
  type ShoulderAbductionDatasetReadinessReport,
} from "./dataset-readiness-schema";
import {
  resolveDatasetReadinessCliExitCode,
  writeShoulderAbductionDatasetReadiness,
  type WriteDatasetReadinessResult,
} from "./dataset-readiness-writer";
import type {
  ShoulderAbductionTrainingExportQcReport,
  ShoulderAbductionTrainingExportSample,
} from "./training-export-schema";
import { TRAINING_EXPORT_SCHEMA_VERSION } from "./training-export-schema";

export type DatasetReadinessCliOptions = {
  manifestPath: string;
  qcReportPath: string | null;
  trainingExportPath: string | null;
  outputName: string | null;
  print: boolean;
  nowMs: number;
};

export type DatasetReadinessCliRunResult = {
  exitCode: number;
  readinessReport: ShoulderAbductionDatasetReadinessReport;
  writeResult: WriteDatasetReadinessResult;
};

function parseTrainingExportLines(raw: string): ShoulderAbductionTrainingExportSample[] {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const samples: ShoulderAbductionTrainingExportSample[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = JSON.parse(lines[index]) as ShoulderAbductionTrainingExportSample;
    if (parsed.exportSchemaVersion !== TRAINING_EXPORT_SCHEMA_VERSION) {
      throw new Error(
        `unsupported training export schema at line ${index + 1}: ${String(parsed.exportSchemaVersion)}`,
      );
    }
    samples.push(parsed);
  }

  samples.sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  return samples;
}

export async function runShoulderAbductionDatasetReadinessCli(
  options: DatasetReadinessCliOptions,
): Promise<DatasetReadinessCliRunResult> {
  const manifestRaw = await readFile(options.manifestPath, "utf8");
  const sourceManifestSha256 = createHash("sha256").update(manifestRaw).digest("hex");
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestRaw);
  } catch {
    throw new Error(`malformed manifest JSON: ${options.manifestPath}`);
  }
  const manifest = validateShoulderAbductionReachManifestForDatasetReadiness(parsedManifest);

  let qcReport: ShoulderAbductionTrainingExportQcReport | null = null;
  let sourceQcReportSha256: string | null = null;
  if (options.qcReportPath) {
    const qcRaw = await readFile(options.qcReportPath, "utf8");
    sourceQcReportSha256 = createHash("sha256").update(qcRaw).digest("hex");
    qcReport = JSON.parse(qcRaw) as ShoulderAbductionTrainingExportQcReport;
    if (qcReport.qcSchemaVersion !== SUPPORTED_QC_SCHEMA_VERSION) {
      throw new Error(`unsupported QC schema version: ${qcReport.qcSchemaVersion}`);
    }
  }

  let trainingExportSamples: ShoulderAbductionTrainingExportSample[] | null = null;
  let sourceTrainingExportSha256: string | null = null;
  if (options.trainingExportPath) {
    const exportRaw = await readFile(options.trainingExportPath, "utf8");
    sourceTrainingExportSha256 = createHash("sha256").update(exportRaw).digest("hex");
    trainingExportSamples = parseTrainingExportLines(exportRaw);
    if (
      trainingExportSamples.length > 0 &&
      trainingExportSamples[0].exportSchemaVersion !==
        SUPPORTED_TRAINING_EXPORT_SCHEMA_VERSION_FOR_READINESS
    ) {
      throw new Error(
        `unsupported training export schema version: ${trainingExportSamples[0].exportSchemaVersion}`,
      );
    }
  }

  const readinessReport = buildShoulderAbductionDatasetReadinessReport({
    manifest,
    sourceManifestSha256,
    qcReport,
    sourceQcReportSha256,
    trainingExportSamples,
    sourceTrainingExportSha256,
  });

  const labelingQueue = buildLabelingQueue(manifest);

  const outputName =
    options.outputName ??
    (basename(options.manifestPath).replace(/\.manifest\.json$/i, "") || "dataset-readiness");

  const writeResult = await writeShoulderAbductionDatasetReadiness(readinessReport, labelingQueue, {
    outputName,
    manifestPath: options.manifestPath,
    qcReportPath: options.qcReportPath,
    trainingExportPath: options.trainingExportPath,
    nowMs: options.nowMs,
  });

  if (options.print) {
    for (const line of buildDatasetReadinessCliSummaryLines(readinessReport)) {
      console.log(line);
    }
    console.log(`readiness report: ${writeResult.readinessReportPath}`);
    console.log(`labeling queue: ${writeResult.labelingQueuePath}`);
  }

  return {
    exitCode: resolveDatasetReadinessCliExitCode(readinessReport),
    readinessReport,
    writeResult,
  };
}
