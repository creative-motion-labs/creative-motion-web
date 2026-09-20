#!/usr/bin/env -S npx tsx
/**
 * Shoulder Abduction Reach — dev-only research dataset MANIFEST assembler CLI.
 * RASQ ML bridge, Slice 4 (2026-08-20).
 *
 * Joins local capture JSONL lines with therapist label JSONL lines into one
 * derived, internal research manifest under
 * `dev-data/rasq-ml/shoulder-abduction-manifests/` (gitignored). Read-only on
 * capture and label data. No Supabase, no production DB, no raw media, no
 * training/split/consensus decisions — see `manifest-schema.ts`.
 *
 * Sessions must be named EXPLICITLY. There is no auto-discovery, so the
 * `test-fixture-*` sessions that other tests write into the same capture
 * directory can never leak into a research manifest.
 *
 * Usage:
 *   npx tsx scripts/ml-research/assemble-shoulder-abduction-manifest.ts \
 *     --session <devSessionId> [--session <devSessionId> ...] \
 *     [--out <path.manifest.json>] [--allow-diagnostics] [--print]
 *
 * Exit codes:
 *   0  manifest written (or printed) with no integrity findings
 *   1  usage error, or integrity findings without --allow-diagnostics
 *      (nothing is written in that case: fail closed)
 */
import { buildShoulderAbductionReachManifest } from "@/app/lib/ml-research/shoulder-abduction-reach/manifest-builder";
import {
  resolveManifestJsonPath,
  writeShoulderAbductionReachManifest,
} from "@/app/lib/ml-research/shoulder-abduction-reach/manifest-writer";
import { serializeShoulderAbductionReachManifest } from "@/app/lib/ml-research/shoulder-abduction-reach/manifest-schema";

const USAGE = `Usage: npx tsx scripts/ml-research/assemble-shoulder-abduction-manifest.ts \\
  --session <devSessionId> [--session <devSessionId> ...] \\
  [--out <path.manifest.json>] [--allow-diagnostics] [--print]`;

type CliOptions = {
  devSessionIds: string[];
  outPath: string | null;
  allowDiagnostics: boolean;
  print: boolean;
};

function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const options: CliOptions = {
    devSessionIds: [],
    outPath: null,
    allowDiagnostics: false,
    print: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--session") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--session requires a devSessionId" };
      options.devSessionIds.push(value);
      i += 1;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--out requires a file path" };
      options.outPath = value;
      i += 1;
    } else if (arg === "--allow-diagnostics") {
      options.allowDiagnostics = true;
    } else if (arg === "--print") {
      options.print = true;
    } else {
      return { error: `unrecognized argument: ${arg}` };
    }
  }

  if (options.devSessionIds.length === 0) return { error: "at least one --session is required" };
  if (options.devSessionIds.length > 1 && options.outPath === null) {
    return { error: "--out is required when assembling more than one session" };
  }
  return options;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exit(1);
  }

  const { manifest, integrity } = await buildShoulderAbductionReachManifest(parsed.devSessionIds);
  const d = manifest.diagnostics;

  console.log(`\nmanifest schema:         ${manifest.manifestSchemaVersion}`);
  console.log(`dataset version:         ${manifest.datasetVersion}`);
  console.log(`sessions requested:      ${manifest.scope.devSessionIds.join(", ")}`);
  console.log(`\ncapture records read:    ${d.captureRecordsRead}`);
  console.log(`label records read:      ${d.labelRecordsRead}`);
  console.log(`manifest samples:        ${d.manifestSamplesProduced}`);
  console.log(`  labeled:               ${d.labeledSamples}`);
  console.log(`  unlabeled:             ${d.unlabeledSamples}`);
  console.log(`labels in manifest:      ${d.totalAcceptedLabels}`);
  console.log(`  with compensation lbl: ${d.compensationLabels}`);
  console.log(`  with exclusion flag:   ${d.excludedLabels}`);
  console.log(`distinct participants:   ${d.distinctParticipants}`);
  console.log(`distinct sessions:       ${d.distinctSessions}`);
  console.log(`distinct raters:         ${d.distinctRaters}`);
  console.log(`superseded revisions:    ${d.supersededLabelRevisions}`);
  console.log(`\nmalformed capture recs:  ${d.malformedCaptureRecords}`);
  console.log(`malformed label recs:    ${d.malformedLabelRecords}`);
  console.log(`orphan labels:           ${d.orphanLabels}`);
  console.log(`label identity mismatch: ${d.labelIdentityMismatches}`);
  console.log(`incompatible versions:   ${d.incompatibleVersionRecords}`);

  if (d.rejections.length > 0) {
    console.log(`\nrejections (${d.rejections.length}):`);
    for (const rejection of d.rejections) {
      const parts = [
        `${rejection.recordKind}`,
        `${rejection.devSessionId}`,
        `line ${rejection.fileLineIndex}`,
        rejection.reason,
      ];
      if (rejection.claimedSourceLineIndex !== undefined) {
        parts.push(`claimedSourceLineIndex=${rejection.claimedSourceLineIndex}`);
      }
      if (rejection.mismatchedFields) parts.push(`fields=${rejection.mismatchedFields.join("+")}`);
      if (rejection.observedVersions) parts.push(JSON.stringify(rejection.observedVersions));
      console.log(`  - ${parts.join(" | ")}`);
    }
  }

  if (parsed.print) {
    console.log(`\n${serializeShoulderAbductionReachManifest(manifest)}`);
  }

  if (!integrity.ok && !parsed.allowDiagnostics) {
    console.error(
      `\nFAIL CLOSED — nothing written. Integrity findings:\n  - ${integrity.blockingReasons.join("\n  - ")}\n` +
        `Re-run with --allow-diagnostics to persist the manifest WITH these diagnostics recorded in it.`,
    );
    process.exit(1);
  }

  const outPath = parsed.outPath ?? resolveManifestJsonPath(parsed.devSessionIds[0]);
  const { manifestFilePath, runFilePath } = await writeShoulderAbductionReachManifest(manifest, {
    outputPath: outPath,
    nowMs: Date.now(),
  });
  console.log(`\nmanifest: ${manifestFilePath}`);
  console.log(`run info: ${runFilePath}`);
  if (!integrity.ok) {
    console.log(`\nWARNING: written with integrity findings (--allow-diagnostics).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
