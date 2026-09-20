/**
 * Shoulder Abduction Reach — dataset readiness output writer (node-only).
 * RASQ ML bridge, Slice 7 (2026-08-21).
 *
 * Writes readiness reports to a dedicated gitignored directory with strict
 * path allowlisting. Never overwrites captures, labels, manifests, Slice 5
 * exports/QC, Slice 6 experiments, source code, or package files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  serializeDatasetReadinessReport,
  serializeLabelingQueueReport,
  type LabelingQueueReport,
  type ShoulderAbductionDatasetReadinessReport,
} from "./dataset-readiness-schema";

export const ML_RESEARCH_DATASET_READINESS_DATA_DIR = join(
  process.cwd(),
  "dev-data",
  "rasq-ml",
  "shoulder-abduction-dataset-readiness",
);

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveDatasetReadinessReportPath(reportName: string): string {
  return join(
    ML_RESEARCH_DATASET_READINESS_DATA_DIR,
    `${sanitizeFileNameSegment(reportName)}.dataset-readiness.json`,
  );
}

export function resolveLabelingQueueReportPath(reportName: string): string {
  return join(
    ML_RESEARCH_DATASET_READINESS_DATA_DIR,
    `${sanitizeFileNameSegment(reportName)}.labeling-queue.json`,
  );
}

export function resolveDatasetReadinessRunSidecarPath(reportPath: string): string {
  return reportPath.replace(/\.dataset-readiness\.json$/i, ".readiness-run.json");
}

/**
 * Allowlist-based safety guard. Output must be a child of the dedicated
 * dataset-readiness directory — never source captures, labels, manifests,
 * training exports, baseline experiments, source code, or package files.
 */
export function assertDatasetReadinessOutputPathIsSafe(outputPath: string): void {
  const absoluteOutput = isAbsolute(outputPath) ? outputPath : resolve(process.cwd(), outputPath);
  const absoluteReadinessDir = resolve(ML_RESEARCH_DATASET_READINESS_DATA_DIR);
  const rel = relative(absoluteReadinessDir, absoluteOutput);

  if (rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error(
      `refusing to write dataset readiness output outside dedicated directory: ${absoluteOutput}`,
    );
  }

  if (rel === "" || rel === ".") {
    throw new Error(
      `refusing to write dataset readiness output directly to directory itself: ${absoluteReadinessDir}`,
    );
  }

  if (rel.includes("..")) {
    throw new Error(
      `refusing to write dataset readiness output: path contains parent references: ${rel}`,
    );
  }
}

export type DatasetReadinessRunSidecar = {
  readinessSchemaVersion: string;
  /** Non-canonical wall-clock metadata. */
  generatedAtMs: number;
  nodeVersion: string;
  manifestPath: string;
  qcReportPath: string | null;
  trainingExportPath: string | null;
  collectionStatus: ShoulderAbductionDatasetReadinessReport["collectionStatus"];
  collectionGapCount: number;
};

export type WriteDatasetReadinessResult = {
  readinessReportPath: string;
  labelingQueuePath: string;
  runSidecarPath: string;
};

export function resolveDatasetReadinessCliExitCode(
  report: ShoulderAbductionDatasetReadinessReport,
): number {
  if (
    report.crossArtifactIntegrity.checked &&
    !report.crossArtifactIntegrity.ok
  ) {
    return 1;
  }
  if (report.collectionGaps.some((gap) => gap.code === "DATASET_INTEGRITY_BLOCKER")) {
    return 1;
  }
  return 0;
}

export async function writeShoulderAbductionDatasetReadiness(
  readinessReport: ShoulderAbductionDatasetReadinessReport,
  labelingQueue: LabelingQueueReport,
  options: {
    outputName: string;
    manifestPath: string;
    qcReportPath: string | null;
    trainingExportPath: string | null;
    nowMs: number;
  },
): Promise<WriteDatasetReadinessResult> {
  await mkdir(ML_RESEARCH_DATASET_READINESS_DATA_DIR, { recursive: true });

  const readinessReportPath = resolveDatasetReadinessReportPath(options.outputName);
  const labelingQueuePath = resolveLabelingQueueReportPath(options.outputName);
  const runSidecarPath = resolveDatasetReadinessRunSidecarPath(readinessReportPath);

  assertDatasetReadinessOutputPathIsSafe(readinessReportPath);
  assertDatasetReadinessOutputPathIsSafe(labelingQueuePath);
  assertDatasetReadinessOutputPathIsSafe(runSidecarPath);

  const sidecar: DatasetReadinessRunSidecar = {
    readinessSchemaVersion: readinessReport.readinessSchemaVersion,
    generatedAtMs: options.nowMs,
    nodeVersion: process.version,
    manifestPath: options.manifestPath,
    qcReportPath: options.qcReportPath,
    trainingExportPath: options.trainingExportPath,
    collectionStatus: readinessReport.collectionStatus,
    collectionGapCount: readinessReport.collectionGaps.length,
  };

  await writeFile(readinessReportPath, serializeDatasetReadinessReport(readinessReport), "utf8");
  await writeFile(labelingQueuePath, serializeLabelingQueueReport(labelingQueue), "utf8");
  await writeFile(runSidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

  return { readinessReportPath, labelingQueuePath, runSidecarPath };
}
