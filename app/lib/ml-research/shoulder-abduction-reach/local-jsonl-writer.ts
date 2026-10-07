/**
 * Shoulder Abduction Reach — dev-only local JSONL writer.
 * RASQ ML bridge, Slice 1 (2026-08-19).
 *
 * NODE-ONLY. Must never be imported from client/browser code — it uses
 * `node:fs`. The only caller is the dev-only API route
 * `app/api/dev/ml-research/shoulder-abduction-reach-capture/route.ts`, which
 * itself refuses to run outside development (see that file).
 *
 * Writes ONE JSON line per repetition to a local file under
 * `dev-data/rasq-ml/shoulder-abduction/`, which is gitignored (see
 * `.gitignore`) so captured samples can never be accidentally committed.
 * This is a completely separate path from Supabase / `cv_session_metrics` —
 * this module has no Supabase client, no database import, and never runs in
 * production.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ShoulderAbductionReachRepCaptureRecord } from "./capture-schema";

export const ML_RESEARCH_DEV_DATA_DIR = join(
  process.cwd(),
  "dev-data",
  "rasq-ml",
  "shoulder-abduction",
);

/** Test-only read-path override — null restores default `dev-data` resolution. */
let captureDataDirReadOverride: string | null = null;

export function setMlResearchCaptureDataDirForTests(dir: string | null): void {
  captureDataDirReadOverride = dir;
}

function captureDataDirForReads(): string {
  return captureDataDirReadOverride ?? ML_RESEARCH_DEV_DATA_DIR;
}

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveDevSessionJsonlPath(devSessionId: string): string {
  return join(captureDataDirForReads(), `${sanitizeFileNameSegment(devSessionId)}.jsonl`);
}

/**
 * Appends one repetition record as a single JSON line. Creates the output
 * directory if it does not exist yet. Never overwrites — each call adds one
 * line, so a dev session's file accumulates one line per completed rep.
 */
export async function appendShoulderAbductionReachRepRecordLocally(
  record: ShoulderAbductionReachRepCaptureRecord,
): Promise<{ filePath: string }> {
  await mkdir(ML_RESEARCH_DEV_DATA_DIR, { recursive: true });
  const filePath = resolveDevSessionJsonlPath(record.context.devSessionId);
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return { filePath };
}
