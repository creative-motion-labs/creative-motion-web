/**
 * Shoulder Abduction Reach — dev-only label reader.
 * RASQ ML bridge, First Labeling Slice (2026-08-19).
 *
 * NODE-ONLY (file I/O) except `dedupeLatestLabelPerRepAndRater`, which is a
 * pure function kept import-safe for unit testing.
 *
 * Labels are keyed by `(sourceLineIndex, raterId)` — `sourceLineIndex` is the
 * traceability locator that disambiguates Slice 1 `repetitionId` collisions
 * across sides. Two different raters labeling the same repetition must both be
 * preserved independently, never collapsed into "whichever was written last."
 * Only *re-submissions by the same rater* for the same line collapse to the
 * latest one (append-only writer, "latest labeledAtMs wins" per pair).
 */

import { readFile } from "node:fs/promises";
import { resolveDevSessionLabelsJsonlPath } from "./local-label-writer";
import {
  isValidShoulderAbductionReachLabelRecord,
  normalizeResearchRaterId,
  type ShoulderAbductionReachLabelRecord,
} from "./label-schema";

function labelDedupeKey(
  label: Pick<ShoulderAbductionReachLabelRecord, "sourceLineIndex" | "raterId">,
): string {
  // Match filter semantics: trim-only normalization, preserve case/internal spacing.
  const normalizedRaterId = normalizeResearchRaterId(label.raterId);
  const raterKey = normalizedRaterId ?? label.raterId;
  return `${label.sourceLineIndex}::${raterKey}`;
}

/**
 * Labels are append-only, so a session's file may contain more than one
 * label for the same `(sourceLineIndex, normalizedRaterId)` pair (a rater correcting an
 * earlier submission). Keeps the record with the largest `labeledAtMs` per
 * pair — falls back to last-in-file-order if timestamps tie, matching the
 * writer's append order.
 */
export function dedupeLatestLabelPerRepAndRater(
  labels: readonly ShoulderAbductionReachLabelRecord[],
): ShoulderAbductionReachLabelRecord[] {
  const byKey = new Map<string, ShoulderAbductionReachLabelRecord>();
  for (const label of labels) {
    const key = labelDedupeKey(label);
    const existing = byKey.get(key);
    if (!existing || label.labeledAtMs >= existing.labeledAtMs) {
      byKey.set(key, label);
    }
  }
  return [...byKey.values()];
}

async function readRawLabelLines(devSessionId: string): Promise<ShoulderAbductionReachLabelRecord[]> {
  const filePath = resolveDevSessionLabelsJsonlPath(devSessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const labels: ShoulderAbductionReachLabelRecord[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isValidShoulderAbductionReachLabelRecord(parsed)) labels.push(parsed);
  }
  return labels;
}

/**
 * Reads and dedupes ALL raters' labels for a session. Administrative use
 * only (e.g. a future agreement-computation script) — never expose this to
 * the labeling UI itself, which must only ever see one rater's own labels
 * (see `readShoulderAbductionCaptureSessionLabelsForRater`).
 */
export async function readShoulderAbductionCaptureSessionLabels(
  devSessionId: string,
): Promise<ShoulderAbductionReachLabelRecord[]> {
  return dedupeLatestLabelPerRepAndRater(await readRawLabelLines(devSessionId));
}

/**
 * Reads and dedupes only the given rater's own labels for a session — this
 * is what the labeling API route must use when serving the review UI, so
 * Rater A structurally cannot receive Rater B's labels in the response.
 */
export async function readShoulderAbductionCaptureSessionLabelsForRater(
  devSessionId: string,
  raterId: string,
): Promise<ShoulderAbductionReachLabelRecord[]> {
  const normalizedRaterId = normalizeResearchRaterId(raterId);
  if (!normalizedRaterId) return [];

  const raw = await readRawLabelLines(devSessionId);
  return dedupeLatestLabelPerRepAndRater(
    raw.filter((label) => normalizeResearchRaterId(label.raterId) === normalizedRaterId),
  );
}
