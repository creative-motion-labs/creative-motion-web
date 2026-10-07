#!/usr/bin/env -S npx tsx
/**
 * Shoulder Abduction Reach — dev-only baseline experiment CLI.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Usage:
 *   npx tsx scripts/ml-research/run-shoulder-abduction-baseline-experiment.ts \
 *     --export <path.training-export.jsonl> \
 *     [--name <experiment-name>] \
 *     [--seed <number>] \
 *     [--print]
 *
 * Exit codes:
 *   0  experiment completed OR intentional NOT_READY (scientifically inadequate data)
 *   1  usage error, malformed export, or unexpected failure
 */

import { runShoulderAbductionBaselineExperimentCli } from "@/app/lib/ml-research/shoulder-abduction-reach/baseline-experiment-cli";

const USAGE = `Usage: npx tsx scripts/ml-research/run-shoulder-abduction-baseline-experiment.ts \\
  --export <path.training-export.jsonl> \\
  [--name <experiment-name>] \\
  [--seed <number>] \\
  [--print]`;

type CliOptions = {
  trainingExportPath: string;
  experimentName: string | null;
  randomSeed: number;
  print: boolean;
};

function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const options: CliOptions = {
    trainingExportPath: "",
    experimentName: null,
    randomSeed: 42,
    print: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--export") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--export requires a file path" };
      options.trainingExportPath = value;
      i += 1;
    } else if (arg === "--name") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--name requires a value" };
      options.experimentName = value;
      i += 1;
    } else if (arg === "--seed") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--seed requires a number" };
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return { error: "--seed must be a finite number" };
      options.randomSeed = parsed;
      i += 1;
    } else if (arg === "--print") {
      options.print = true;
    } else {
      return { error: `unrecognized argument: ${arg}` };
    }
  }

  if (options.trainingExportPath.length === 0) {
    return { error: "--export is required" };
  }

  return options;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exit(1);
  }

  const result = await runShoulderAbductionBaselineExperimentCli({
    trainingExportPath: parsed.trainingExportPath,
    experimentName: parsed.experimentName,
    randomSeed: parsed.randomSeed,
    print: parsed.print,
    nowMs: Date.now(),
  });

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(`\nFATAL ERROR:`);
  console.error(err);
  process.exit(1);
});
