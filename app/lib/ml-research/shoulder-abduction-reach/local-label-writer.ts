/**
 * Shoulder Abduction Reach — dev-only local label JSONL writer.
 * RASQ ML bridge, First Labeling Slice (2026-08-19).
 *
 * NODE-ONLY. Mirrors `local-jsonl-writer.ts`'s posture exactly, for label
 * records instead of capture records: writes ONE JSON line per label
 * submission to a local file under `dev-data/rasq-ml/shoulder-abduction-labels/`
 * (a sibling of `dev-data/rasq-ml/shoulder-abduction/`, covered by the same
 * `/dev-data/` gitignore entry). No Supabase client, no database import,
 * never runs in production. The only caller is the dev-only API route
 * `app/api/dev/ml-research/shoulder-abduction-reach-label/route.ts`.
 *
 * Append-only by design (never edits/overwrites a line in place) — if a
 * rater re-labels the same repetition, a second line is appended for the
 * same `(repetitionId, raterId)` pair. `label-reader.ts` resolves that by
 * keeping the latest label per `(repetitionId, raterId)` pair when reading
 * a session's labels back — a DIFFERENT rater labeling the same repetition
 * is a separate pair, never collapsed together.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ShoulderAbductionReachLabelRecord } from "./label-schema";

export const ML_RESEARCH_LABEL_DATA_DIR = join(
  process.cwd(),
  "dev-data",
  "rasq-ml",
  "shoulder-abduction-labels",
);

/** Test-only read-path override — null restores default `dev-data` resolution. */
let labelDataDirReadOverride: string | null = null;

export function setMlResearchLabelDataDirForTests(dir: string | null): void {
  labelDataDirReadOverride = dir;
}

function labelDataDirForReads(): string {
  return labelDataDirReadOverride ?? ML_RESEARCH_LABEL_DATA_DIR;
}

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function resolveDevSessionLabelsJsonlPath(devSessionId: string): string {
  return join(labelDataDirForReads(), `${sanitizeFileNameSegment(devSessionId)}.labels.jsonl`);
}

export async function appendShoulderAbductionReachLabelLocally(
  record: ShoulderAbductionReachLabelRecord,
): Promise<{ filePath: string }> {
  await mkdir(ML_RESEARCH_LABEL_DATA_DIR, { recursive: true });
  const filePath = resolveDevSessionLabelsJsonlPath(record.devSessionId);
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return { filePath };
}
