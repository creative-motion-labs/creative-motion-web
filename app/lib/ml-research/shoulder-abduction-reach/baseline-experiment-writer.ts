/**
 * Shoulder Abduction Reach — baseline experiment output writer (node-only).
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Writes experiment reports to a dedicated gitignored directory with strict
 * path allowlisting. Never overwrites Slice 5 training exports or source data.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  serializeBaselineExperimentReport,
  type BaselineExperimentReport,
} from "./baseline-experiment-schema";

export const ML_RESEARCH_BASELINE_EXPERIMENT_DATA_DIR = join(
  process.cwd(),
  "dev-data",
  "rasq-ml",
  "shoulder-abduction-baseline-experiments",
);

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveBaselineExperimentReportPath(experimentName: string): string {
  return join(
    ML_RESEARCH_BASELINE_EXPERIMENT_DATA_DIR,
    `${sanitizeFileNameSegment(experimentName)}.baseline-experiment.json`,
  );
}

export function resolveBaselineExperimentRunSidecarPath(reportPath: string): string {
  return reportPath.replace(/\.baseline-experiment\.json$/i, ".experiment-run.json");
}

/**
 * Allowlist-based safety guard. Output must be a child of the dedicated
 * baseline experiment directory — never source captures, labels, manifests,
 * training exports, source code, or package files.
 */
export function assertBaselineExperimentOutputPathIsSafe(outputPath: string): void {
  const absoluteOutput = isAbsolute(outputPath) ? outputPath : resolve(process.cwd(), outputPath);
  const absoluteExperimentDir = resolve(ML_RESEARCH_BASELINE_EXPERIMENT_DATA_DIR);
  const rel = relative(absoluteExperimentDir, absoluteOutput);

  if (rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error(
      `refusing to write baseline experiment output outside dedicated directory: ${absoluteOutput}`,
    );
  }

  if (rel === "" || rel === ".") {
    throw new Error(
      `refusing to write baseline experiment output directly to directory itself: ${absoluteExperimentDir}`,
    );
  }

  if (rel.includes("..")) {
    throw new Error(
      `refusing to write baseline experiment output: path contains parent references: ${rel}`,
    );
  }
}

export type BaselineExperimentRunSidecar = {
  experimentSchemaVersion: string;
  /** Non-canonical wall-clock metadata. */
  generatedAtMs: number;
  nodeVersion: string;
  trainingExportPath: string;
  status: BaselineExperimentReport["status"];
  readinessReasons: BaselineExperimentReport["readinessReasons"];
};

export type WriteBaselineExperimentResult = {
  reportFilePath: string;
  runFilePath: string;
};

/**
 * CLI exit policy:
 *  - 0 for completed experiments AND intentional NOT_READY outcomes
 *  - 1 for input/usage failures thrown before a report is written
 */
export function resolveBaselineExperimentCliExitCode(
  report: BaselineExperimentReport,
): number {
  if (
    report.status === "COMPLETED" ||
    report.status === "NOT_READY_FOR_BASELINE_EXPERIMENT"
  ) {
    return 0;
  }
  return 1;
}

export async function writeShoulderAbductionBaselineExperimentReport(
  report: BaselineExperimentReport,
  options: { experimentName: string; trainingExportPath: string; nowMs: number },
): Promise<WriteBaselineExperimentResult> {
  await mkdir(ML_RESEARCH_BASELINE_EXPERIMENT_DATA_DIR, { recursive: true });

  const reportFilePath = resolveBaselineExperimentReportPath(options.experimentName);
  const runFilePath = resolveBaselineExperimentRunSidecarPath(reportFilePath);

  assertBaselineExperimentOutputPathIsSafe(reportFilePath);
  assertBaselineExperimentOutputPathIsSafe(runFilePath);

  const sidecar: BaselineExperimentRunSidecar = {
    experimentSchemaVersion: report.experimentSchemaVersion,
    generatedAtMs: options.nowMs,
    nodeVersion: process.version,
    trainingExportPath: options.trainingExportPath,
    status: report.status,
    readinessReasons: report.readinessReasons,
  };

  await writeFile(reportFilePath, serializeBaselineExperimentReport(report), "utf8");
  await writeFile(runFilePath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

  return { reportFilePath, runFilePath };
}
