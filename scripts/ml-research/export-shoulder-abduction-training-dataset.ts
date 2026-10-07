#!/usr/bin/env -S npx tsx
/**
 * Shoulder Abduction Reach — dev-only training export CLI.
 * RASQ ML bridge, Slice 5 (2026-08-20).
 *
 * Usage:
 *   npx tsx scripts/ml-research/export-shoulder-abduction-training-dataset.ts \
 *     --manifest <path.manifest.json> \
 *     [--out <export-name>] \
 *     [--print]
 *
 * Exit codes:
 *   0  export completed with a trustworthy manifest (including 0 supervised candidates)
 *   1  usage error, dataset-level integrity failure, or unexpected failure
 */

import { runShoulderAbductionTrainingExportCli } from "@/app/lib/ml-research/shoulder-abduction-reach/training-export-cli";

const USAGE = `Usage: npx tsx scripts/ml-research/export-shoulder-abduction-training-dataset.ts \\
  --manifest <path.manifest.json> \\
  [--out <export-name>] \\
  [--print]`;

type CliOptions = {
  manifestPath: string;
  outName: string | null;
  print: boolean;
};

function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const options: CliOptions = {
    manifestPath: "",
    outName: null,
    print: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--manifest requires a file path" };
      options.manifestPath = value;
      i += 1;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--out requires an export name" };
      options.outName = value;
      i += 1;
    } else if (arg === "--print") {
      options.print = true;
    } else {
      return { error: `unrecognized argument: ${arg}` };
    }
  }

  if (options.manifestPath.length === 0) return { error: "--manifest is required" };
  return options;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exit(1);
  }

  const result = await runShoulderAbductionTrainingExportCli({
    manifestPath: parsed.manifestPath,
    outName: parsed.outName,
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
