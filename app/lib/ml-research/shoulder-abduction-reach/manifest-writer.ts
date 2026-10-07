/**
 * Shoulder Abduction Reach — dev-only manifest writer (node-only).
 * RASQ ML bridge, Slice 4 (2026-08-20).
 *
 * Writes derived manifests to their OWN gitignored directory,
 * `dev-data/rasq-ml/shoulder-abduction-manifests/` — a sibling of the capture
 * and label directories, covered by the same `/dev-data/` gitignore entry. No
 * Supabase, no production DB, no browser storage, no raw media.
 *
 * Manifest generation is derived and read-only with respect to research
 * source data: `assertManifestOutputPathIsSafe` refuses any output path inside
 * the capture or label directories, so even a mistyped `--out` cannot
 * overwrite a capture or label JSONL file.
 *
 * Two files are written per run:
 *  - `<name>.manifest.json` — CANONICAL content only. No timestamp, so two
 *    runs over identical inputs produce byte-identical output.
 *  - `<name>.run.json`      — the non-canonical run sidecar (wall clock, node
 *    version, integrity verdict). Kept out of the manifest precisely so
 *    determinism is checkable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { evaluateShoulderAbductionReachManifestIntegrity } from "./manifest-assembly";
import {
  serializeShoulderAbductionReachManifest,
  type ShoulderAbductionReachResearchManifest,
} from "./manifest-schema";

export const ML_RESEARCH_MANIFEST_DATA_DIR = join(
  process.cwd(),
  "dev-data",
  "rasq-ml",
  "shoulder-abduction-manifests",
);

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveManifestJsonPath(manifestName: string): string {
  return join(ML_RESEARCH_MANIFEST_DATA_DIR, `${sanitizeFileNameSegment(manifestName)}.manifest.json`);
}

export function resolveManifestRunSidecarPath(manifestJsonPath: string): string {
  return manifestJsonPath.replace(/\.manifest\.json$/i, ".run.json");
}

/**
 * F2 FIX: Allowlist-based safety guard. The manifest output path must resolve
 * to a child of the dedicated manifest directory. Rejects escape attempts,
 * the directory itself, tracked source files, .git paths, and research data.
 */
export function assertManifestOutputPathIsSafe(outputPath: string): void {
  const absoluteOutput = isAbsolute(outputPath) ? outputPath : resolve(process.cwd(), outputPath);
  const absoluteManifestDir = resolve(ML_RESEARCH_MANIFEST_DATA_DIR);

  // relative() returns a path from manifestDir to output. If output is a child,
  // the result won't start with '..' and won't be empty (directory itself).
  const rel = relative(absoluteManifestDir, absoluteOutput);

  // Reject if it escapes the manifest directory (starts with '..').
  if (rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error(
      `refusing to write manifest outside the dedicated directory: output would be at ${absoluteOutput}, which is not under ${absoluteManifestDir}`,
    );
  }

  // Reject if it IS the manifest directory itself (empty relative path).
  if (rel === "" || rel === ".") {
    throw new Error(
      `refusing to write manifest directly to the manifest directory itself: ${absoluteManifestDir}`,
    );
  }

  // Reject if the relative path still contains '..' after the first check
  // (shouldn't happen with relative(), but defense in depth).
  if (rel.includes("..")) {
    throw new Error(
      `refusing to write manifest: resolved path contains parent directory references: ${rel}`,
    );
  }

  // If we reach here, absoluteOutput is a proper child of absoluteManifestDir.
}

export type ManifestRunSidecar = {
  manifestSchemaVersion: string;
  /** Non-canonical on purpose: the only wall-clock value in this slice's output. */
  generatedAtMs: number;
  nodeVersion: string;
  requestedDevSessionIds: string[];
  integrityOk: boolean;
  blockingReasons: string[];
};

/**
 * Writes the canonical manifest plus its run sidecar. Creates the manifest
 * directory if needed; never touches the capture or label directories.
 */
export async function writeShoulderAbductionReachManifest(
  manifest: ShoulderAbductionReachResearchManifest,
  options: { outputPath: string; nowMs: number },
): Promise<{ manifestFilePath: string; runFilePath: string }> {
  const manifestFilePath = isAbsolute(options.outputPath)
    ? options.outputPath
    : resolve(process.cwd(), options.outputPath);
  assertManifestOutputPathIsSafe(manifestFilePath);

  const verdict = evaluateShoulderAbductionReachManifestIntegrity(manifest.diagnostics);
  const sidecar: ManifestRunSidecar = {
    manifestSchemaVersion: manifest.manifestSchemaVersion,
    generatedAtMs: options.nowMs,
    nodeVersion: process.version,
    requestedDevSessionIds: manifest.scope.devSessionIds,
    integrityOk: verdict.ok,
    blockingReasons: verdict.blockingReasons,
  };

  await mkdir(ML_RESEARCH_MANIFEST_DATA_DIR, { recursive: true });
  const runFilePath = resolveManifestRunSidecarPath(manifestFilePath);
  await writeFile(manifestFilePath, serializeShoulderAbductionReachManifest(manifest), "utf8");
  await writeFile(runFilePath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  return { manifestFilePath, runFilePath };
}
