/**
 * Shoulder Abduction Reach — dev-only research dataset MANIFEST schema.
 * RASQ ML bridge, Slice 4 (2026-08-20).
 *
 * DEV/RESEARCH ONLY, same posture as `capture-schema.ts` / `label-schema.ts`:
 * no Supabase, no production table, never served to a browser. Pure types +
 * constants + canonical serialization — no file I/O, no clock, no randomness.
 *
 * A manifest is an INTERNAL, derived, read-only research artifact: the
 * deterministic join of capture JSONL lines with therapist label JSONL lines.
 * It is NOT a training dataset, NOT a clinical dataset, NOT adjudicated
 * ground truth, and NOT a train/test split. Deliberately absent, and reserved
 * for a later research-methodology slice: consensus/majority/reference label,
 * numeric label encoding, severity score, training eligibility, split
 * assignment, and any automated prediction.
 *
 * Multi-rater by construction: a sample carries an ARRAY of independent
 * rater labels (0, 1, or many). Nothing here collapses them into one value.
 *
 * The manifest holds a source REFERENCE per sample, never the captured frame
 * sequence: no `frames`, no `joints`, no landmark coordinates, no video, no
 * images. A future exporter recovers the frames from
 * `(devSessionId, sourceLineIndex)` in the original capture file.
 */

import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
} from "./capture-schema";
import {
  ML_RESEARCH_DATASET_VERSION,
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
  type ShoulderAbductionReachCompensationLabel,
  type ShoulderAbductionReachExclusionFlag,
  type ShoulderAbductionReachLabelConfidence,
} from "./label-schema";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

/**
 * Bumped whenever the manifest artifact's own shape changes. Deliberately a
 * FIFTH, independent version alongside the four it reports on, because each
 * answers a different provenance question:
 *  - `captureSchemaVersion`  — what shape the recorded repetition was in
 *  - `featureSchemaVersion`  — how derived features were computed
 *  - `labelSchemaVersion`    — what shape a therapist label was in
 *  - `datasetVersion`        — which labeled batch the records belong to
 *  - `manifestSchemaVersion` — how the join artifact itself is structured
 */
export const ML_RESEARCH_MANIFEST_SCHEMA_VERSION = "shoulder-abduction-manifest-v1" as const;

/**
 * Source versions this manifest generation is allowed to join. Anything else
 * is rejected with a diagnostic rather than joined on the assumption that the
 * shapes still line up — see `manifest-assembly.ts`.
 */
export const MANIFEST_ACCEPTED_CAPTURE_SCHEMA_VERSIONS: readonly string[] = [
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
];

/** Both feature-schema generations on disk are joinable: the manifest references features, never copies their values. */
export const MANIFEST_ACCEPTED_FEATURE_SCHEMA_VERSIONS: readonly string[] = [
  ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
];

export const MANIFEST_ACCEPTED_LABEL_SCHEMA_VERSIONS: readonly string[] = [
  ML_RESEARCH_LABEL_SCHEMA_VERSION,
];

export const MANIFEST_ACCEPTED_DATASET_VERSIONS: readonly string[] = [ML_RESEARCH_DATASET_VERSION];

/** Where a manifest sample's repetition can be recovered from, without duplicating it. */
export type ShoulderAbductionReachManifestSourceReference = {
  /** Only kind in v1: one JSON line of a local capture JSONL file. */
  kind: "capture_jsonl_line";
  /** Repo-relative POSIX path, so the manifest is not tied to one machine's absolute paths. */
  relativeFilePath: string;
  /** 0-based line number inside that file — the same locator `sourceLineIndex` uses. */
  lineIndex: number;
  /**
   * Number of captured frames on the referenced line. A source-integrity
   * descriptor for a future exporter to re-verify against, NOT a copy of the
   * frames and NOT a clinical or derived measurement.
   */
  frameCount: number;
};

/**
 * One independent therapist label as preserved in the manifest. A neighbour in
 * the same array is a DIFFERENT rater's independent judgment — never merged,
 * never averaged, never ranked.
 */
export type ShoulderAbductionReachManifestLabel = {
  labelSchemaVersion: string;
  /** The label record's own datasetVersion — kept per label, not assumed from the manifest root. */
  datasetVersion: string;
  raterId: string;
  compensationLabel: ShoulderAbductionReachCompensationLabel | null;
  exclusionFlag: ShoulderAbductionReachExclusionFlag | null;
  raterConfidence: ShoulderAbductionReachLabelConfidence;
  /** Qualitative research note as persisted. Internal provenance only — never an ML feature. */
  note: string;
  /** Server-authoritative acceptance time from the persisted label record. */
  labeledAtMs: number;
};

/**
 * One captured repetition plus every independent label that verifiably belongs
 * to it. Canonical identity is `(devSessionId, sourceLineIndex)` — the only
 * pair guaranteed unique, since Slice 1 `repetitionId` values can collide
 * across sides. `repetitionId`, `side`, and `participantId` are carried as
 * cross-checked identity ASSERTIONS, not as the join key.
 *
 * `participantId` stays here on purpose: participant-level grouping is what
 * makes a later leakage-safe split possible. This artifact is local research
 * tooling and is never returned by the labeling API.
 */
export type ShoulderAbductionReachManifestSample = {
  /** `${devSessionId}#${sourceLineIndex}` — a printable form of the canonical identity. */
  sampleId: string;
  devSessionId: string;
  sourceLineIndex: number;
  repetitionId: string;
  repetitionIndex: number;
  side: ShoulderAbductionReachSide;
  participantId: string;
  movementType: string;
  captureSchemaVersion: string;
  featureSchemaVersion: string;
  source: ShoulderAbductionReachManifestSourceReference;
  /** Independent rater labels. Empty array means "not labeled yet" — never a default label. */
  labels: ShoulderAbductionReachManifestLabel[];
};

export const MANIFEST_REJECTION_REASONS = [
  "unparsable_json",
  "invalid_capture_shape",
  "invalid_label_shape",
  "capture_session_file_mismatch",
  "label_session_file_mismatch",
  "incompatible_capture_schema_version",
  "incompatible_feature_schema_version",
  "incompatible_label_schema_version",
  "incompatible_dataset_version",
  "capture_line_not_found",
  "capture_line_rejected",
  "capture_identity_mismatch",
  "capture_file_missing",
] as const;
export type ShoulderAbductionReachManifestRejectionReason =
  (typeof MANIFEST_REJECTION_REASONS)[number];

/**
 * One record the assembler refused to put in the manifest. Emitted for EVERY
 * rejection, so a dropped record is always visible rather than silently
 * absorbed into a "clean" dataset.
 */
export type ShoulderAbductionReachManifestRejection = {
  recordKind: "capture" | "label" | "session";
  reason: ShoulderAbductionReachManifestRejectionReason;
  devSessionId: string;
  /** 0-based line number of the rejected record inside its OWN file; -1 for a whole-session rejection. */
  fileLineIndex: number;
  /** For a label: the capture `sourceLineIndex` it claimed to belong to. */
  claimedSourceLineIndex?: number;
  /** Which identity assertions failed — field NAMES only, never the compared values. */
  mismatchedFields?: string[];
  /** Observed version strings for a version rejection: here the value IS the diagnostic. */
  observedVersions?: Record<string, string>;
};

/**
 * Machine-readable assembly diagnostics. Counts are derived from the same pass
 * that produced the samples, so they can never disagree with the manifest body.
 *
 * `captureRecordsRead` / `labelRecordsRead` count NON-EMPTY LINES observed in
 * the source files — deliberately counted before any validation, which is why
 * malformed-record counts are observable at all (the existing labeling readers
 * filter invalid lines away before a caller can see them; this path does not).
 */
export type ShoulderAbductionReachManifestDiagnostics = {
  captureRecordsRead: number;
  labelRecordsRead: number;
  manifestSamplesProduced: number;
  labeledSamples: number;
  unlabeledSamples: number;
  totalAcceptedLabels: number;
  /** Accepted labels carrying an `exclusionFlag` — reported, never filtered out (that is Slice 5's decision). */
  excludedLabels: number;
  /** Accepted labels carrying a `compensationLabel` (any severity, not just "compensated"). */
  compensationLabels: number;
  distinctParticipants: number;
  distinctSessions: number;
  distinctRaters: number;
  /** Unparsable, structurally invalid, or wrong-session capture lines. */
  malformedCaptureRecords: number;
  /** Unparsable or structurally invalid label lines. */
  malformedLabelRecords: number;
  /** Well-formed labels whose target capture is not in the manifest (missing line, or a rejected capture line). */
  orphanLabels: number;
  /** Well-formed labels whose located capture line contradicts the label's own identity fields. */
  labelIdentityMismatches: number;
  /** Capture or label lines rejected because a schema/dataset version is not accepted for joining. */
  incompatibleVersionRecords: number;
  /** Earlier labels replaced by the same rater's later label for the same repetition (Slice 2 latest-per-rater semantics). */
  supersededLabelRevisions: number;
  /** Requested sessions with no capture file on disk. */
  missingCaptureSessions: string[];
  /** Every individual rejection, in deterministic order. */
  rejections: ShoulderAbductionReachManifestRejection[];
};

export type ShoulderAbductionReachResearchManifest = {
  manifestSchemaVersion: typeof ML_RESEARCH_MANIFEST_SCHEMA_VERSION;
  /** The labeled batch this manifest was assembled for. */
  datasetVersion: typeof ML_RESEARCH_DATASET_VERSION;
  /** Exactly which sessions were requested — assembly scope is explicit, never "whatever was on disk". */
  scope: { devSessionIds: string[] };
  samples: ShoulderAbductionReachManifestSample[];
  diagnostics: ShoulderAbductionReachManifestDiagnostics;
};

export function buildManifestSampleId(devSessionId: string, sourceLineIndex: number): string {
  return `${devSessionId}#${sourceLineIndex}`;
}

/**
 * Canonical text form of a manifest. Every object in the manifest is built
 * with a fixed key order by the assembler, so `JSON.stringify` alone is
 * already stable; this wrapper exists so callers cannot accidentally use
 * different spacing and get a different file for identical content.
 *
 * Contains no timestamp by design — generation metadata is written to a
 * separate run sidecar (see `manifest-writer.ts`) so two runs over identical
 * inputs produce byte-identical manifest content.
 */
export function serializeShoulderAbductionReachManifest(
  manifest: ShoulderAbductionReachResearchManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
