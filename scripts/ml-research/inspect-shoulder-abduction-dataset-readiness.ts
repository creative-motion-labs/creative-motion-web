#!/usr/bin/env -S npx tsx
/**
 * Shoulder Abduction Reach — dev-only dataset readiness CLI.
 * RASQ ML bridge, Slice 7 (2026-08-21).
 *
 * Usage:
 *   npx tsx scripts/ml-research/inspect-shoulder-abduction-dataset-readiness.ts \
 *     --manifest <manifest.json> \
 *     [--qc <qc-report.json>] \
 *     [--export <training-export.jsonl>] \
 *     [--name <report-name>] \
 *     [--print]
 *
 * Exit codes:
 *   0  readiness report written (collection may still be incomplete)
 *   1  usage error, manifest/QC/export integrity failure, or unexpected failure
 */

import { runShoulderAbductionDatasetReadinessCli } from "@/app/lib/ml-research/shoulder-abduction-reach/dataset-readiness-cli";

const USAGE = `Usage: npx tsx scripts/ml-research/inspect-shoulder-abduction-dataset-readiness.ts \\
  --manifest <path.manifest.json> \\
  [--qc <path.qc-report.json>] \\
  [--export <path.training-export.jsonl>] \\
  [--name <report-name>] \\
  [--print]`;

type CliOptions = {
  manifestPath: string;
  qcReportPath: string | null;
  trainingExportPath: string | null;
  outputName: string | null;
  print: boolean;
};

function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const options: CliOptions = {
    manifestPath: "",
    qcReportPath: null,
    trainingExportPath: null,
    outputName: null,
    print: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--manifest requires a file path" };
      options.manifestPath = value;
      i += 1;
    } else if (arg === "--qc") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--qc requires a file path" };
      options.qcReportPath = value;
      i += 1;
    } else if (arg === "--export") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--export requires a file path" };
      options.trainingExportPath = value;
      i += 1;
    } else if (arg === "--name") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--name requires a value" };
      options.outputName = value;
      i += 1;
    } else if (arg === "--print") {
      options.print = true;
    } else {
      return { error: `unrecognized argument: ${arg}` };
    }
  }

  if (options.manifestPath.length === 0) {
    return { error: "--manifest is required" };
  }

  return options;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exit(1);
  }

  const result = await runShoulderAbductionDatasetReadinessCli({
    manifestPath: parsed.manifestPath,
    qcReportPath: parsed.qcReportPath,
    trainingExportPath: parsed.trainingExportPath,
    print: parsed.print,
    outputName: parsed.outputName,
    nowMs: Date.now(),
  });

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(`\nFATAL ERROR:`);
  console.error(err);
  process.exit(1);
});
