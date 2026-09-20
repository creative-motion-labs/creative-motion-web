/**
 * Shoulder Abduction Reach — baseline experiment CLI runner.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 */

import { runShoulderAbductionBaselineExperiment } from "./baseline-experiment-runner";
import type { BaselineExperimentReport } from "./baseline-experiment-schema";
import {
  resolveBaselineExperimentCliExitCode,
  writeShoulderAbductionBaselineExperimentReport,
  type WriteBaselineExperimentResult,
} from "./baseline-experiment-writer";

export type BaselineExperimentCliOptions = {
  trainingExportPath: string;
  experimentName: string | null;
  randomSeed: number;
  print: boolean;
  nowMs: number;
};

export type BaselineExperimentCliRunResult = {
  exitCode: number;
  report: BaselineExperimentReport;
  writeResult: WriteBaselineExperimentResult;
};

function deriveExperimentName(trainingExportPath: string): string {
  const base = trainingExportPath.split(/[/\\]/).pop() ?? "baseline-experiment";
  return base.replace(/\.training-export\.jsonl$/i, "").replace(/\.jsonl$/i, "");
}

export function buildBaselineExperimentCliSummaryLines(
  report: BaselineExperimentReport,
): string[] {
  const lines: string[] = [];
  lines.push(`status: ${report.status}`);
  lines.push(`supervised candidates: ${report.provenance.supervisedCandidateCount}`);
  lines.push(`distinct participants: ${report.provenance.distinctParticipantCount}`);

  if (report.readinessReasons.length > 0) {
    lines.push("readiness reasons:");
    for (const reason of report.readinessReasons) {
      lines.push(`  - ${reason}`);
    }
  }

  if (report.status === "COMPLETED" && report.evaluation) {
    lines.push(`train samples: ${report.evaluation.totalTrainSamples}`);
    lines.push(`test samples: ${report.evaluation.totalTestSamples}`);
    lines.push(
      `accuracy: ${report.evaluation.accuracy === null ? "n/a" : report.evaluation.accuracy.toFixed(4)}`,
    );
    lines.push(
      `macro F1: ${report.evaluation.macroF1 === null ? "n/a" : report.evaluation.macroF1.toFixed(4)}`,
    );
  }

  return lines;
}

export async function runShoulderAbductionBaselineExperimentCli(
  options: BaselineExperimentCliOptions,
): Promise<BaselineExperimentCliRunResult> {
  const experimentName =
    options.experimentName ?? deriveExperimentName(options.trainingExportPath);

  console.log(`\nReading Slice 5 training export: ${options.trainingExportPath}`);

  const { report } = await runShoulderAbductionBaselineExperiment({
    trainingExportPath: options.trainingExportPath,
    randomSeed: options.randomSeed,
  });

  const writeResult = await writeShoulderAbductionBaselineExperimentReport(report, {
    experimentName,
    trainingExportPath: options.trainingExportPath,
    nowMs: options.nowMs,
  });

  console.log(`\n=== BASELINE EXPERIMENT STATUS ===`);
  for (const line of buildBaselineExperimentCliSummaryLines(report)) {
    console.log(line);
  }

  if (report.status === "NOT_READY_FOR_BASELINE_EXPERIMENT") {
    console.log(
      `\nExperiment NOT READY — baseline training/evaluation was intentionally skipped.`,
    );
    console.log(
      `This is expected for scientifically inadequate real datasets (e.g. one participant).`,
    );
    console.log(`No evaluation metrics were generated.`);
  } else if (report.status === "COMPLETED") {
    console.log(`\nExperiment completed. Metrics are technical research outputs only.`);
    console.log(report.evaluation?.disclaimer ?? "");
  }

  console.log(`\n=== OUTPUT FILES ===`);
  console.log(`experiment report: ${writeResult.reportFilePath}`);
  console.log(`run info:          ${writeResult.runFilePath}`);

  if (options.print && report.evaluation) {
    console.log(`\n=== EVALUATION SUMMARY ===`);
    console.log(JSON.stringify(report.evaluation, null, 2));
  }

  return {
    exitCode: resolveBaselineExperimentCliExitCode(report),
    report,
    writeResult,
  };
}
