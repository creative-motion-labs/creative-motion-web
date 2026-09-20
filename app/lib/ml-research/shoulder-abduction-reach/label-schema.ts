/**
 * Shoulder Abduction Reach — dev-only therapist labeling schema.
 * RASQ ML bridge, First Labeling Slice (2026-08-19).
 *
 * DEV/RESEARCH ONLY — same posture as `capture-schema.ts`: not
 * `cv_session_metrics`, not any production table, never written to
 * Supabase. A label is a therapist's own visual judgment made from the
 * skeleton replay, deliberately independent of:
 *  - the existing rule-based compensation flag
 *    (`updateShoulderAbductionReachCompensation` /
 *    `shoulder-abduction-reach-compensation.ts`),
 *  - any derived numeric feature (`peakNormalizedTrunkDriftRatio`,
 *    `peakShoulderAngleDegrees`, `peakAngularVelocityDegPerSec`), and
 *  - `simulationCondition` (the internal test-fixture hint).
 * None of the above are ever sent to the labeling UI — `capture-reader.ts`
 * redacts them server-side before a rep ever reaches the browser.
 *
 * Kept entirely separate from `ShoulderAbductionReachRepCaptureRecord` —
 * different lifecycle, different versioning, joined only by
 * `(devSessionId, repetitionId)` at read time. The original capture files
 * are never modified by anything in this module.
 */

import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

/** Bumped whenever the on-disk label record shape changes. */
export const ML_RESEARCH_LABEL_SCHEMA_VERSION = "shoulder-abduction-label-schema-v1" as const;

/**
 * Identifies which batch of labeled repetitions this record belongs to.
 * Distinct from the label SCHEMA version above: this can be bumped to mark
 * a new labeled dataset without the record shape itself changing.
 */
export const ML_RESEARCH_DATASET_VERSION = "shoulder-abduction-dataset-v1" as const;

/**
 * Maximum length for a dev/research `raterId` after trim. Not an auth identity —
 * just a conservative bound to reject malformed payloads.
 */
export const ML_RESEARCH_RATER_ID_MAX_LENGTH = 64;

/** Rejects ASCII control characters and DEL in a trimmed rater id. */
const RESEARCH_RATER_ID_CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

/**
 * Shared normalization for dev/research `raterId` values.
 *
 * - trims leading/trailing whitespace only (does NOT lowercase or collapse
 *   internal whitespace — `Aisha-Rater-01` and `aisha-rater-01` stay distinct)
 * - rejects empty / whitespace-only values
 * - rejects unreasonably long values
 * - rejects control-character payloads
 *
 * This is NOT authentication or verified clinician identity.
 */
export function normalizeResearchRaterId(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > ML_RESEARCH_RATER_ID_MAX_LENGTH) return null;
  if (RESEARCH_RATER_ID_CONTROL_CHAR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Ordinal compensation severity — the therapist's own visual judgment, never
 * derived from `peakNormalizedTrunkDriftRatio` or any other stored feature.
 */
export const SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS = [
  "NO_COMPENSATION",
  "MILD_COMPENSATION",
  "CLEAR_COMPENSATION",
] as const;
export type ShoulderAbductionReachCompensationLabel =
  (typeof SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS)[number];

/**
 * Exclusion reasons — mutually exclusive with a compensation label. A rep
 * carrying one of these was NOT assigned a severity judgment at all.
 *  - WRONG_MOVEMENT_PLANE: looks like forward flexion, not lateral abduction.
 *  - INCOMPLETE_REPETITION: visible, but a partial/aborted attempt.
 *  - NOT_REVIEWABLE: tracking/replay is too broken to judge at all.
 */
export const SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS = [
  "WRONG_MOVEMENT_PLANE",
  "INCOMPLETE_REPETITION",
  "NOT_REVIEWABLE",
] as const;
export type ShoulderAbductionReachExclusionFlag =
  (typeof SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS)[number];

export const SHOULDER_ABDUCTION_REACH_LABEL_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ShoulderAbductionReachLabelConfidence =
  (typeof SHOULDER_ABDUCTION_REACH_LABEL_CONFIDENCE_LEVELS)[number];

export type ShoulderAbductionReachLabelRecord = {
  labelSchemaVersion: typeof ML_RESEARCH_LABEL_SCHEMA_VERSION;
  datasetVersion: typeof ML_RESEARCH_DATASET_VERSION;
  /** Capture session this label was made against. */
  devSessionId: string;
  /** Side-qualified, unique repetition identifier from the capture record. */
  repetitionId: string;
  /**
   * Traceability locator — the 0-based line number of the labeled rep inside
   * its capture JSONL file. NOT sufficient repetition identity alone: the POST
   * route verifies `sourceLineIndex` together with `repetitionId` and `side`
   * against the server-side capture record before accepting a label.
   */
  sourceLineIndex: number;
  /** Server-derived from the verified capture record — never trusted from the client. */
  participantId: string;
  /** Server-verified against the capture record at write time — not blindly trusted from the client. */
  side: ShoulderAbductionReachSide;
  /**
   * Dev/research identifier the rater typed in — normalized (trim only) at
   * write time via `normalizeResearchRaterId`. NOT authentication or verified
   * clinician identity.
   */
  raterId: string;
  /** Exactly one of compensationLabel / exclusionFlag must be non-null — never both, never neither. */
  compensationLabel: ShoulderAbductionReachCompensationLabel | null;
  exclusionFlag: ShoulderAbductionReachExclusionFlag | null;
  raterConfidence: ShoulderAbductionReachLabelConfidence;
  /** Optional free-text observation — never fed into ML features, qualitative only. */
  note: string;
  /** Server-authoritative wall-clock time (ms since epoch) when the label was accepted. */
  labeledAtMs: number;
};

export type VerifiedCaptureIdentityForLabelWrite = Pick<
  ShoulderAbductionReachLabelRecord,
  "devSessionId" | "repetitionId" | "sourceLineIndex" | "side" | "participantId"
>;

/**
 * Assembles the persisted label record from server-verified capture identity,
 * normalized rater id, user research input, and a server-owned timestamp.
 * `labeledAtMs` is never accepted from the browser submission contract.
 */
export function buildPersistedShoulderAbductionReachLabelRecord(
  verifiedCapture: VerifiedCaptureIdentityForLabelWrite,
  normalizedRaterId: string,
  submission: Pick<
    ShoulderAbductionReachLabelSubmission,
    "compensationLabel" | "exclusionFlag" | "raterConfidence" | "note"
  >,
  labeledAtMs: number,
): ShoulderAbductionReachLabelRecord {
  return {
    ...verifiedCapture,
    raterId: normalizedRaterId,
    compensationLabel: submission.compensationLabel,
    exclusionFlag: submission.exclusionFlag,
    raterConfidence: submission.raterConfidence,
    note: submission.note,
    labeledAtMs,
    labelSchemaVersion: ML_RESEARCH_LABEL_SCHEMA_VERSION,
    datasetVersion: ML_RESEARCH_DATASET_VERSION,
  };
}

/**
 * The BROWSER-FACING view of a persisted label — omits `participantId`, which is
 * server-owned provenance. `capture-reader.ts` already strips `participantId` from
 * the rater-facing rep payload; this type applies the same blinding to the labels
 * the GET route echoes back, so no part of the response carries participant
 * identity. The persisted record itself is unchanged and still keeps
 * `participantId` — this narrows only the HTTP representation.
 */
export type ShoulderAbductionReachLabelForRater = Omit<
  ShoulderAbductionReachLabelRecord,
  "participantId"
>;

/**
 * Projects a persisted label into its rater-facing view.
 *
 * Deliberately an explicit field allowlist rather than a rest-spread omission:
 * if a future provenance field is added to `ShoulderAbductionReachLabelRecord`,
 * this fails to compile and forces a decision about whether the browser may see
 * it, instead of silently leaking it.
 */
export function projectShoulderAbductionReachLabelForRater(
  record: ShoulderAbductionReachLabelRecord,
): ShoulderAbductionReachLabelForRater {
  return {
    labelSchemaVersion: record.labelSchemaVersion,
    datasetVersion: record.datasetVersion,
    devSessionId: record.devSessionId,
    repetitionId: record.repetitionId,
    sourceLineIndex: record.sourceLineIndex,
    side: record.side,
    raterId: record.raterId,
    compensationLabel: record.compensationLabel,
    exclusionFlag: record.exclusionFlag,
    raterConfidence: record.raterConfidence,
    note: record.note,
    labeledAtMs: record.labeledAtMs,
  };
}

/**
 * What the BROWSER submits — deliberately missing server-owned fields:
 * `participantId`, `labelSchemaVersion`, `datasetVersion`, and `labeledAtMs`.
 * Locator fields (`devSessionId`, `sourceLineIndex`, `repetitionId`, `side`) are
 * sent by the client but verified server-side against capture data before persist.
 */
export type ShoulderAbductionReachLabelSubmission = Omit<
  ShoulderAbductionReachLabelRecord,
  "participantId" | "labelSchemaVersion" | "datasetVersion" | "labeledAtMs"
>;

function isCompensationLabel(value: unknown): value is ShoulderAbductionReachCompensationLabel {
  return (
    typeof value === "string" &&
    (SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS as readonly string[]).includes(value)
  );
}

function isExclusionFlag(value: unknown): value is ShoulderAbductionReachExclusionFlag {
  return (
    typeof value === "string" &&
    (SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS as readonly string[]).includes(value)
  );
}

function isConfidence(value: unknown): value is ShoulderAbductionReachLabelConfidence {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * Client-submitted label input — excludes server-owned `labeledAtMs`.
 */
function hasValidClientSubmissionFields(
  r: Partial<ShoulderAbductionReachLabelRecord>,
): boolean {
  const compensationSet = isCompensationLabel(r.compensationLabel);
  const exclusionSet = isExclusionFlag(r.exclusionFlag);
  const compensationNull = r.compensationLabel === null;
  const exclusionNull = r.exclusionFlag === null;
  const exactlyOneLabelSet = (compensationSet && exclusionNull) || (exclusionSet && compensationNull);

  return (
    typeof r.devSessionId === "string" &&
    r.devSessionId.length > 0 &&
    typeof r.repetitionId === "string" &&
    r.repetitionId.length > 0 &&
    Number.isInteger(r.sourceLineIndex) &&
    (r.sourceLineIndex as number) >= 0 &&
    (r.side === "left" || r.side === "right") &&
    normalizeResearchRaterId(typeof r.raterId === "string" ? r.raterId : "") !== null &&
    exactlyOneLabelSet &&
    isConfidence(r.raterConfidence) &&
    typeof r.note === "string"
  );
}

/** Validates a browser-submitted label payload (pre server-stamping). */
export function isValidShoulderAbductionReachLabelSubmission(
  value: unknown,
): value is ShoulderAbductionReachLabelSubmission {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if ("labeledAtMs" in payload) return false;
  if ("participantId" in payload) return false;
  if ("labelSchemaVersion" in payload) return false;
  if ("datasetVersion" in payload) return false;
  return hasValidClientSubmissionFields(value as Partial<ShoulderAbductionReachLabelRecord>);
}

/** Validates a fully-assembled (server-stamped or persisted-and-reread) label record. */
export function isValidShoulderAbductionReachLabelRecord(
  value: unknown,
): value is ShoulderAbductionReachLabelRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ShoulderAbductionReachLabelRecord>;
  return (
    r.labelSchemaVersion === ML_RESEARCH_LABEL_SCHEMA_VERSION &&
    r.datasetVersion === ML_RESEARCH_DATASET_VERSION &&
    typeof r.participantId === "string" &&
    r.participantId.length > 0 &&
    Number.isFinite(r.labeledAtMs) &&
    hasValidClientSubmissionFields(r)
  );
}
