/**
 * Shoulder Abduction Reach — dev-only capture reader/redactor for labeling.
 * RASQ ML bridge, First Labeling Slice (2026-08-19).
 *
 * NODE-ONLY. Reads existing local capture JSONL files under
 * `dev-data/rasq-ml/shoulder-abduction/` (written by
 * `local-jsonl-writer.ts` / the capture lab) and produces the therapist-blind
 * view served to the labeling UI: raw landmark frames (needed for the
 * skeleton replay) plus enough bookkeeping to submit a label, with
 * `simulationCondition`, `derivedFeatures`, and `participantId` stripped —
 * see `label-schema.ts` for why. This module never writes anything; it only
 * reads the existing, already-captured files as-is (including any known
 * upstream oddities, e.g. the repetitionId-collision-across-sides issue —
 * this reader works around that at read time via `sourceLineIndex` rather
 * than "fixing" the capture files themselves, which is out of scope here).
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ML_RESEARCH_DEV_DATA_DIR, resolveDevSessionJsonlPath } from "./local-jsonl-writer";
import type {
  ShoulderAbductionReachCapturedFrame,
  ShoulderAbductionReachRepCaptureRecord,
  ShoulderAbductionReachTrackingQualitySummary,
} from "./capture-schema";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

export type ShoulderAbductionCaptureSessionSummary = {
  devSessionId: string;
  repCount: number;
};

/**
 * Neutral, technical-quality-only threshold for the "REVIEW WITH CAUTION"
 * badge — reuses the exact heuristic already applied when manually
 * inspecting `dev-session-2026-08-18T23-18-39-738Z` (frame count < 20, or
 * usable-angle tracking ratio < 1.0), kept here as one documented,
 * consistent definition rather than re-derived ad hoc each time. Computed
 * ONLY from capture-quality metadata — never from trunk drift, angle, or
 * any compensation-relevant value. See `label-schema.ts`'s doc comment for
 * why that separation matters.
 */
const REVIEW_CAUTION_MIN_FRAMES = 20;
const REVIEW_CAUTION_MIN_USABLE_RATIO = 1.0;

export function computeReviewCautionFlag(
  frameCount: number,
  usableFrameRatio: number | null,
): boolean {
  if (frameCount < REVIEW_CAUTION_MIN_FRAMES) return true;
  if (usableFrameRatio !== null && usableFrameRatio < REVIEW_CAUTION_MIN_USABLE_RATIO) return true;
  return false;
}

/** The redacted, labeling-safe view of one captured repetition. */
export type ShoulderAbductionReachRepForLabeling = {
  devSessionId: string;
  /** Bonus robustness key — see `label-schema.ts`'s doc comment on `sourceLineIndex`. */
  sourceLineIndex: number;
  repetitionId: string;
  repetitionIndex: number;
  side: ShoulderAbductionReachSide;
  frameCount: number;
  movementDurationMs: number;
  trackingQuality: ShoulderAbductionReachTrackingQualitySummary;
  /** Neutral technical-quality flag — see `computeReviewCautionFlag`. Never a movement-content judgment. */
  reviewCaution: boolean;
  frames: ShoulderAbductionReachCapturedFrame[];
};

function isJsonlFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".jsonl");
}

function devSessionIdFromFileName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "");
}

/** Lists available capture sessions by scanning the capture directory. Empty array if none yet. */
export async function listShoulderAbductionCaptureSessions(): Promise<
  ShoulderAbductionCaptureSessionSummary[]
> {
  let entries: string[];
  try {
    entries = await readdir(ML_RESEARCH_DEV_DATA_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const jsonlFiles = entries.filter(isJsonlFile).sort();
  const summaries: ShoulderAbductionCaptureSessionSummary[] = [];
  for (const fileName of jsonlFiles) {
    const raw = await readFile(join(ML_RESEARCH_DEV_DATA_DIR, fileName), "utf8");
    const lineCount = raw.split("\n").filter((line) => line.trim().length > 0).length;
    summaries.push({ devSessionId: devSessionIdFromFileName(fileName), repCount: lineCount });
  }
  return summaries;
}

function normalizeTrackingQualityForLabeling(
  trackingQuality: ShoulderAbductionReachTrackingQualitySummary,
): ShoulderAbductionReachTrackingQualitySummary {
  return {
    framesTotal: trackingQuality.framesTotal,
    framesWithUsableAngle: trackingQuality.framesWithUsableAngle,
    usableFrameRatio: trackingQuality.usableFrameRatio,
    minCoreJointVisibility: trackingQuality.minCoreJointVisibility ?? null,
  };
}

function redactRecordForLabeling(
  record: ShoulderAbductionReachRepCaptureRecord,
  sourceLineIndex: number,
): ShoulderAbductionReachRepForLabeling {
  return {
    devSessionId: record.context.devSessionId,
    sourceLineIndex,
    repetitionId: record.context.repetitionId,
    repetitionIndex: record.context.repetitionIndex,
    side: record.context.side,
    frameCount: record.frames.length,
    movementDurationMs: record.derivedFeatures.movementDurationMs,
    trackingQuality: normalizeTrackingQualityForLabeling(record.derivedFeatures.trackingQuality),
    reviewCaution: computeReviewCautionFlag(
      record.frames.length,
      record.derivedFeatures.trackingQuality.usableFrameRatio,
    ),
    frames: record.frames,
  };
}

/**
 * Reads and redacts every repetition in one capture session's JSONL file, in file order.
 * Returns an empty array if the session file does not exist.
 */
export async function readShoulderAbductionCaptureSessionForLabeling(
  devSessionId: string,
): Promise<ShoulderAbductionReachRepForLabeling[]> {
  const filePath = resolveDevSessionJsonlPath(devSessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const reps: ShoulderAbductionReachRepForLabeling[] = [];
  lines.forEach((line, index) => {
    let parsed: ShoulderAbductionReachRepCaptureRecord;
    try {
      parsed = JSON.parse(line) as ShoulderAbductionReachRepCaptureRecord;
    } catch {
      return; // skip an unparsable line rather than fail the whole session
    }
    reps.push(redactRecordForLabeling(parsed, index));
  });
  return reps;
}

/** Server-verified capture identity stamped onto a label record at write time. */
export type ResolvedCaptureIdentityForLabel = {
  devSessionId: string;
  sourceLineIndex: number;
  repetitionId: string;
  side: ShoulderAbductionReachSide;
  participantId: string;
};

/**
 * Resolves and verifies that submitted locator fields all refer to the SAME
 * capture record. Fail-closed: returns null on any mismatch, missing session,
 * out-of-range line index, or unparsable line.
 *
 * `sourceLineIndex` is a traceability locator — not sufficient identity alone.
 * For Slice 1 data where `repetitionId` may collide across sides, the composite
 * check `(sourceLineIndex, repetitionId, side)` disambiguates without rewriting
 * historical capture files.
 */
export async function resolveCaptureIdentityForLabel(params: {
  devSessionId: string;
  sourceLineIndex: number;
  repetitionId: string;
  side: ShoulderAbductionReachSide;
}): Promise<ResolvedCaptureIdentityForLabel | null> {
  const filePath = resolveDevSessionJsonlPath(params.devSessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const line = lines[params.sourceLineIndex];
  if (!line) return null;

  let parsed: ShoulderAbductionReachRepCaptureRecord;
  try {
    parsed = JSON.parse(line) as ShoulderAbductionReachRepCaptureRecord;
  } catch {
    return null;
  }

  if (parsed.context.devSessionId !== params.devSessionId) return null;
  if (parsed.context.repetitionId !== params.repetitionId) return null;
  if (parsed.context.side !== params.side) return null;

  return {
    devSessionId: parsed.context.devSessionId,
    sourceLineIndex: params.sourceLineIndex,
    repetitionId: parsed.context.repetitionId,
    side: parsed.context.side,
    participantId: parsed.context.participantId,
  };
}

/**
 * Server-only lookup used by the label POST route. Verifies
 * `(devSessionId, sourceLineIndex, repetitionId, side)` as a composite before
 * returning `participantId`. Returns null if verification fails.
 */
export async function lookupParticipantIdForRepetition(
  devSessionId: string,
  sourceLineIndex: number,
  expectedRepetitionId: string,
  expectedSide: ShoulderAbductionReachSide,
): Promise<string | null> {
  const resolved = await resolveCaptureIdentityForLabel({
    devSessionId,
    sourceLineIndex,
    repetitionId: expectedRepetitionId,
    side: expectedSide,
  });
  return resolved?.participantId ?? null;
}
