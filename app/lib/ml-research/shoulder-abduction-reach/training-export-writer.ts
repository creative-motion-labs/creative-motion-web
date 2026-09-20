/**
 * Shoulder Abduction Reach — dev-only training export writer (node-only).
 * RASQ ML bridge, Slice 5 (2026-08-20).
 *
 * Writes derived training exports to their OWN gitignored directory,
 * `dev-data/rasq-ml/shoulder-abduction-training-exports/` — a sibling of the
 * capture, label, and manifest directories, covered by the same `/dev-data/`
 * gitignore entry. No Supabase, no production DB, no browser storage, no raw media.
 *
 * Training export generation is derived and read-only with respect to research
 * source data: `assertTrainingExportOutputPathIsSafe` refuses any output path
 * inside the capture, label, or manifest directories, so even a mistyped
 * `--out` cannot overwrite source files.
 *
 * Three files are written per run:
 *  - `<name>.training-export.jsonl` — CANONICAL training samples (one per line).
 *    Only written if datasetIntegrityOk === true and samples.length > 0.
 *  - `<name>.qc-report.json`        — CANONICAL QC report. No timestamp, so
 *    identical inputs produce byte-identical output.
 *  - `<name>.export-run.json`       — non-canonical run sidecar (wall clock,
 *    node version, integrity verdict). Kept out of canonical files precisely
 *    so determinism is checkable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ShoulderAbductionTrainingExportSample,
  ShoulderAbductionTrainingExportQcReport,
} from "./training-export-schema";
import {
  serializeTrainingExportSample,
  serializeTrainingExportQcReport,
} from "./training-export-schema";

export const ML_RESEARCH_TRAINING_EXPORT_DATA_DIR = join(
  process.cwd(),
  "dev-data",
  "rasq-ml",
  "shoulder-abduction-training-exports",
);

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveTrainingExportJsonlPath(exportName: string): string {
  return join(
    ML_RESEARCH_TRAINING_EXPORT_DATA_DIR,
    `${sanitizeFileNameSegment(exportName)}.training-export.jsonl`,
  );
}

export function resolveTrainingExportQcReportPath(exportName: string): string {
  return join(
    ML_RESEARCH_TRAINING_EXPORT_DATA_DIR,
    `${sanitizeFileNameSegment(exportName)}.qc-report.json`,
  );
}

export function resolveTrainingExportRunSidecarPath(exportJsonlPath: string): string {
  return exportJsonlPath.replace(/\.training-export\.jsonl$/i, ".export-run.json");
}

/**
 * Allowlist-based safety guard (same F2 pattern as manifest-writer). The
 * training export output path must resolve to a child of the dedicated export
 * directory. Rejects escape attempts, the directory itself, tracked source
 * files, .git paths, and research data.
 */
export function assertTrainingExportOutputPathIsSafe(outputPath: string): void {
  const absoluteOutput = isAbsolute(outputPath) ? outputPath : resolve(process.cwd(), outputPath);
  const absoluteExportDir = resolve(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR);

  // relative() returns a path from exportDir to output. If output is a child,
  // the result won't start with '..' and won't be empty (directory itself).
  const rel = relative(absoluteExportDir, absoluteOutput);

  // Reject if it escapes the export directory (starts with '..').
  if (rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error(
      `refusing to write training export outside the dedicated directory: output would be at ${absoluteOutput}, which is not under ${absoluteExportDir}`,
    );
  }

  // Reject if it IS the export directory itself (empty relative path).
  if (rel === "" || rel === ".") {
    throw new Error(
      `refusing to write training export directly to the export directory itself: ${absoluteExportDir}`,
    );
  }

  // Reject if the relative path still contains '..' after the first check
  // (shouldn't happen with relative(), but defense in depth).
  if (rel.includes("..")) {
    throw new Error(
      `refusing to write training export: resolved path contains parent directory references: ${rel}`,
    );
  }

  // If we reach here, absoluteOutput is a proper child of absoluteExportDir.
}

export type TrainingExportRunSidecar = {
  exportSchemaVersion: string;
  qcSchemaVersion: string;
  /** Non-canonical on purpose: the only wall-clock value in this slice's output. */
  generatedAtMs: number;
  nodeVersion: string;
  manifestPath: string;
  datasetIntegrityOk: boolean;
  datasetIntegrityBlockers: string[];
  supervisedCandidatesExported: number;
};

export type WriteTrainingExportResult = {
  /** Path to the training export JSONL (null if not written: datasetIntegrityOk === false or 0 candidates). */
  exportFilePath: string | null;
  /** Path to the QC report JSON (always written). */
  qcReportFilePath: string;
  /** Path to the run sidecar JSON. */
  runFilePath: string;
};

/**
 * CLI/automation exit code policy: dataset-level manifest integrity failure is
 * a hard failure (non-zero). Sample-level rejections with a clean manifest
 * still exit 0 once the QC report is written.
 */
export function resolveTrainingExportCliExitCode(
  qcReport: ShoulderAbductionTrainingExportQcReport,
): number {
  return qcReport.datasetIntegrityOk ? 0 : 1;
}

/**
 * Writes the training export (if dataset integrity passed and samples exist),
 * the QC report (always), and the run sidecar. Creates the export directory if
 * needed; never touches the capture, label, or manifest directories.
 *
 * If `qcReport.datasetIntegrityOk === false`, NO training export JSONL is
 * written — only the QC report and run sidecar.
 */
export async function writeShoulderAbductionTrainingExport(
  samples: ShoulderAbductionTrainingExportSample[],
  qcReport: ShoulderAbductionTrainingExportQcReport,
  options: { outputName: string; manifestPath: string; nowMs: number },
): Promise<WriteTrainingExportResult> {
  await mkdir(ML_RESEARCH_TRAINING_EXPORT_DATA_DIR, { recursive: true });

  const exportJsonlPath = resolveTrainingExportJsonlPath(options.outputName);
  const qcReportPath = resolveTrainingExportQcReportPath(options.outputName);
  const runSidecarPath = resolveTrainingExportRunSidecarPath(exportJsonlPath);

  // Safety check on all three output paths
  assertTrainingExportOutputPathIsSafe(exportJsonlPath);
  assertTrainingExportOutputPathIsSafe(qcReportPath);
  assertTrainingExportOutputPathIsSafe(runSidecarPath);

  const sidecar: TrainingExportRunSidecar = {
    exportSchemaVersion: samples.length > 0 ? samples[0].exportSchemaVersion : "N/A",
    qcSchemaVersion: qcReport.qcSchemaVersion,
    generatedAtMs: options.nowMs,
    nodeVersion: process.version,
    manifestPath: options.manifestPath,
    datasetIntegrityOk: qcReport.datasetIntegrityOk,
    datasetIntegrityBlockers: qcReport.datasetIntegrityBlockers,
    supervisedCandidatesExported: qcReport.supervisedCandidatesExported,
  };

  // Write QC report and run sidecar (always)
  await writeFile(qcReportPath, serializeTrainingExportQcReport(qcReport), "utf8");
  await writeFile(runSidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

  // Write training export JSONL only if dataset integrity passed AND samples exist
  let exportFilePath: string | null = null;
  if (qcReport.datasetIntegrityOk && samples.length > 0) {
    const sortedSamples = [...samples].sort((a, b) => a.sampleId.localeCompare(b.sampleId));
    const exportContent = sortedSamples.map(serializeTrainingExportSample).join("");
    await writeFile(exportJsonlPath, exportContent, "utf8");
    exportFilePath = exportJsonlPath;
  }

  return { exportFilePath, qcReportFilePath: qcReportPath, runFilePath: runSidecarPath };
}
