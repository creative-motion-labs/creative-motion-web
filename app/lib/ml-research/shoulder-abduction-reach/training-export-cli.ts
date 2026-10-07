/**
 * Shoulder Abduction Reach — dev-only training export CLI runner.
 * RASQ ML bridge, Slice 5 (2026-08-20).
 *
 * Shared by the CLI script and tests so exit-code policy is exercised without
 * spawning a subprocess.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { buildShoulderAbductionTrainingExport } from "./training-export-builder";
import type { ShoulderAbductionReachResearchManifest } from "./manifest-schema";
import {
  resolveTrainingExportCliExitCode,
  writeShoulderAbductionTrainingExport,
  type WriteTrainingExportResult,
} from "./training-export-writer";
import {
  QC_REJECTION_REASONS,
  type ShoulderAbductionTrainingExportQcReport,
} from "./training-export-schema";

export type TrainingExportCliOptions = {
  manifestPath: string;
  outName: string | null;
  print: boolean;
  nowMs: number;
};

export type TrainingExportCliRunResult = {
  exitCode: number;
  qcReport: ShoulderAbductionTrainingExportQcReport;
  writeResult: WriteTrainingExportResult;
  sampleCount: number;
};

const CLI_REJECTION_REASON_COLUMN_WIDTH = 30;

/**
 * Deterministic human-readable rejection breakdown lines for the CLI. Iterates
 * the canonical QC rejection-reason set so newly added reasons cannot be
 * silently omitted from printed output.
 */
export function buildTrainingExportCliRejectionBreakdownLines(
  qcReport: ShoulderAbductionTrainingExportQcReport,
): string[] {
  const lines: string[] = [];

  for (const reason of QC_REJECTION_REASONS) {
    const count = qcReport.rejectionCounts[reason];
    if (count > 0) {
      lines.push(`  ${reason.padEnd(CLI_REJECTION_REASON_COLUMN_WIDTH)} ${count}`);
    }
  }

  if (qcReport.rejectionCounts.THERAPIST_EXCLUSION > 0) {
    if (qcReport.exclusionFlagCounts.WRONG_MOVEMENT_PLANE > 0) {
      lines.push(
        `    WRONG_MOVEMENT_PLANE:       ${qcReport.exclusionFlagCounts.WRONG_MOVEMENT_PLANE}`,
      );
    }
    if (qcReport.exclusionFlagCounts.INCOMPLETE_REPETITION > 0) {
      lines.push(
        `    INCOMPLETE_REPETITION:      ${qcReport.exclusionFlagCounts.INCOMPLETE_REPETITION}`,
      );
    }
    if (qcReport.exclusionFlagCounts.NOT_REVIEWABLE > 0) {
      lines.push(`    NOT_REVIEWABLE:             ${qcReport.exclusionFlagCounts.NOT_REVIEWABLE}`);
    }
  }

  return lines;
}

export async function runShoulderAbductionTrainingExportCli(
  options: TrainingExportCliOptions,
): Promise<TrainingExportCliRunResult> {
  const manifestRaw = await readFile(options.manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as ShoulderAbductionReachResearchManifest;

  console.log(`\nReading manifest: ${options.manifestPath}`);
  console.log(`manifest schema:     ${manifest.manifestSchemaVersion}`);
  console.log(`dataset version:     ${manifest.datasetVersion}`);
  console.log(`manifest samples:    ${manifest.samples.length}`);

  const { samples, qcReport } = await buildShoulderAbductionTrainingExport(manifest);

  const outName =
    options.outName ??
    basename(options.manifestPath)
      .replace(/\.manifest\.json$/i, "")
      .replace(/\.json$/i, "");

  const writeResult = await writeShoulderAbductionTrainingExport(samples, qcReport, {
    outputName: outName,
    manifestPath: options.manifestPath,
    nowMs: options.nowMs,
  });

  console.log(`\n=== DATASET-LEVEL STATUS ===`);
  if (qcReport.datasetIntegrityOk) {
    console.log(`dataset integrity:   OK`);
  } else {
    console.log(`dataset integrity:   FAILED`);
    console.log(`\nIntegrity blockers:`);
    for (const blocker of qcReport.datasetIntegrityBlockers) {
      console.log(`  - ${blocker}`);
    }
    console.log(
      `\nExport ABORTED — no training candidates written. The manifest contains unresolved`,
    );
    console.log(
      `integrity diagnostics. Review the manifest diagnostics and re-assemble with valid`,
    );
    console.log(`source data before attempting training export.`);
  }

  console.log(`\n=== SAMPLE-LEVEL SUMMARY ===`);
  console.log(`samples reviewed:    ${qcReport.manifestSamplesReviewed}`);
  console.log(`candidates exported: ${qcReport.supervisedCandidatesExported}`);

  const totalRejected =
    qcReport.manifestSamplesReviewed - qcReport.supervisedCandidatesExported;
  console.log(`samples rejected:    ${totalRejected}`);

  if (totalRejected > 0) {
    console.log(`\nRejection breakdown:`);
    for (const line of buildTrainingExportCliRejectionBreakdownLines(qcReport)) {
      console.log(line);
    }
  }

  console.log(`\n=== OUTPUT FILES ===`);
  if (writeResult.exportFilePath) {
    console.log(`training export: ${writeResult.exportFilePath}`);
  } else {
    console.log(`training export: NOT WRITTEN (dataset integrity failed or 0 candidates)`);
  }
  console.log(`QC report:       ${writeResult.qcReportFilePath}`);
  console.log(`run info:        ${writeResult.runFilePath}`);

  if (!qcReport.datasetIntegrityOk) {
    console.log(`\nExport completed with dataset-level integrity failure (see QC report).`);
  } else if (qcReport.supervisedCandidatesExported === 0) {
    console.log(`\nExport completed with 0 supervised candidates (see QC report for rejections).`);
  } else {
    console.log(`\nExport completed successfully.`);
  }

  if (options.print && samples.length > 0) {
    console.log(`\n=== SAMPLE OUTPUT (first 3) ===`);
    for (const sample of samples.slice(0, 3)) {
      console.log(JSON.stringify(sample, null, 2));
    }
    if (samples.length > 3) {
      console.log(`\n... (${samples.length - 3} more samples omitted)`);
    }
  }

  return {
    exitCode: resolveTrainingExportCliExitCode(qcReport),
    qcReport,
    writeResult,
    sampleCount: samples.length,
  };
}
