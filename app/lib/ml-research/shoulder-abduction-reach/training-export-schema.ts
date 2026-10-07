/**
 * Shoulder Abduction Reach — dev-only TRAINING EXPORT schema.
 * RASQ ML bridge, Slice 5 (2026-08-20).
 *
 * DEV/RESEARCH ONLY — same posture as all prior slices: no Supabase, no
 * production table, never served to a browser. A training export is a
 * deterministic, QC-gated derivation of a Slice 4 manifest: it resolves
 * source capture records, applies supervised-training eligibility rules, and
 * produces a canonical research dataset artifact for a future baseline ML
 * experiment (Slice 6).
 *
 * CRITICAL BOUNDARIES:
 *  - `participantId` lives in PROVENANCE, never in model input (leakage protection).
 *  - Multi-rater samples are NOT automatically collapsed (no consensus invented).
 *  - Unlabeled samples are NOT treated as NO_COMPENSATION.
 *  - Exclusion flags are NOT compensation classes.
 *  - Free-text therapist notes are NOT copied into training rows.
 *  - Derived features (trunk drift ratio, angle, velocity) are NOT exported as
 *    model input by default (label-leakage risk from rule-based logic).
 *  - NO train/validation/test split in this slice (participant-level split required later).
 *
 * A training export is NOT:
 *  - a model (no training happens here)
 *  - adjudicated ground truth (labels remain independent therapist judgments)
 *  - clinically validated (research dataset only)
 *  - a prediction or performance claim
 */

import type {
  ShoulderAbductionReachCapturedFrame,
  ShoulderAbductionReachTrackingQualitySummary,
} from "./capture-schema";
import type { ShoulderAbductionReachLabelConfidence } from "./label-schema";
import type { ShoulderAbductionReachManifestSourceReference } from "./manifest-schema";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

/** Bumped whenever the training export artifact's shape changes. */
export const TRAINING_EXPORT_SCHEMA_VERSION = "shoulder-abduction-training-export-v1" as const;

/** QC report schema version — tracks the QC artifact structure independently. */
export const TRAINING_EXPORT_QC_SCHEMA_VERSION = "shoulder-abduction-training-export-qc-v1" as const;

/**
 * Provenance/grouping metadata for one exported training sample. Every field
 * here is research traceability, NOT a model feature.
 *
 * `participantId` is retained on purpose: participant-level grouping makes
 * future leakage-safe splitting possible. This artifact is local research
 * tooling and is never returned by any production API.
 */
export type ShoulderAbductionTrainingExportProvenance = {
  /** Anonymous dev participant — required for future participant-level splits. */
  participantId: string;
  devSessionId: string;
  /** 0-based line number in the original capture JSONL file. */
  sourceLineIndex: number;
  repetitionId: string;
  /** 1-based repetition index within the dev session. */
  repetitionIndex: number;
  side: ShoulderAbductionReachSide;
  movementType: string;
  captureSchemaVersion: string;
  featureSchemaVersion: string;
  labelSchemaVersion: string;
  manifestSchemaVersion: string;
  datasetVersion: string;
  /** Dev/research rater identifier — NOT authentication or verified clinician identity. */
  raterId: string;
  /** Server-authoritative acceptance time from the persisted label record. */
  labeledAtMs: number;
  /** Where the original capture record lives, for audit/re-verification. */
  manifestSourceReference: ShoulderAbductionReachManifestSourceReference;
};

/**
 * Model input candidate: the technical pose sequence. Deliberately excludes
 * derived features by default to avoid label leakage from rule-based logic.
 * Future experiments can choose to re-derive or include specific features explicitly.
 */
export type ShoulderAbductionTrainingExportInput = {
  frames: ShoulderAbductionReachCapturedFrame[];
};

/**
 * Supervision target: the therapist's compensation label. Single-value only —
 * multi-rater samples are not exported by default (no automatic adjudication).
 */
export type ShoulderAbductionTrainingExportTarget = {
  compensationLabel: "NO_COMPENSATION" | "MILD_COMPENSATION" | "CLEAR_COMPENSATION";
};

/**
 * QC/tracking metadata carried with each exported sample. Descriptive only —
 * NOT automatic acceptance thresholds. Free-text therapist note is deliberately
 * excluded (may contain identifying/contextual information; original
 * label/manifest remain source of truth).
 */
export type ShoulderAbductionTrainingExportQc = {
  raterConfidence: ShoulderAbductionReachLabelConfidence;
  trackingQuality: ShoulderAbductionReachTrackingQualitySummary;
  frameCount: number;
  movementDurationMs: number;
  /** Neutral technical-quality flag from capture-reader (frameCount < 20 OR usableFrameRatio < 1.0). */
  reviewCaution: boolean;
};

/**
 * One exported training sample: provenance + input + target + QC metadata.
 * Canonical identity is `sampleId` (same as manifest: `devSessionId#sourceLineIndex`).
 */
export type ShoulderAbductionTrainingExportSample = {
  exportSchemaVersion: typeof TRAINING_EXPORT_SCHEMA_VERSION;
  /** `${devSessionId}#${sourceLineIndex}` — printable canonical identity. */
  sampleId: string;
  provenance: ShoulderAbductionTrainingExportProvenance;
  input: ShoulderAbductionTrainingExportInput;
  target: ShoulderAbductionTrainingExportTarget;
  qc: ShoulderAbductionTrainingExportQc;
};

/**
 * Why a manifest sample was NOT exported as a supervised training candidate.
 * Every non-exported sample gets exactly one reason.
 */
export const QC_REJECTION_REASONS = [
  "UNLABELED",
  "THERAPIST_EXCLUSION",
  "MULTI_RATER_REQUIRES_POLICY",
  "SOURCE_NOT_FOUND",
  "SOURCE_LINE_MISSING",
  "SOURCE_IDENTITY_MISMATCH",
  "UNSUPPORTED_CAPTURE_SCHEMA",
  "UNSUPPORTED_FEATURE_SCHEMA",
  "MALFORMED_SOURCE_LINE",
  "MALFORMED_SOURCE_RECORD",
  "DUPLICATE_MANIFEST_SAMPLE_IDENTITY",
] as const;

export type ShoulderAbductionTrainingExportQcRejectionReason =
  (typeof QC_REJECTION_REASONS)[number];

/**
 * One rejected sample: identity + reason + optional diagnostic details. Does
 * NOT copy free-text therapist notes or arbitrary manifest content.
 */
export type ShoulderAbductionTrainingExportRejectedSample = {
  sampleId: string;
  reason: ShoulderAbductionTrainingExportQcRejectionReason;
  /** For THERAPIST_EXCLUSION: which exclusion flag was set. */
  exclusionFlag?: string;
  /** For SOURCE_IDENTITY_MISMATCH: which fields disagreed (names only, not values). */
  mismatchedFields?: string[];
  /** For UNSUPPORTED_*_SCHEMA: the observed version string. */
  observedVersion?: string;
};

/**
 * Distribution/count summary for exported training candidates. Deliberately
 * descriptive only — no automatic balancing, no claim of statistical/clinical
 * sufficiency.
 */
export type ShoulderAbductionTrainingExportDistributions = {
  compensationLabels: {
    NO_COMPENSATION: number;
    MILD_COMPENSATION: number;
    CLEAR_COMPENSATION: number;
  };
  raterConfidence: {
    low: number;
    medium: number;
    high: number;
  };
  sides: {
    left: number;
    right: number;
  };
  distinctParticipants: number;
  distinctSessions: number;
  distinctRaters: number;
  /**
   * Factual observation only: whether participant-level evaluation is
   * structurally possible (>= 2 participants). NOT a claim that the dataset
   * size is clinically or statistically sufficient.
   */
  participantLevelSplitPossible: boolean;
};

/**
 * QC rejection counts by reason. Every rejected sample increments exactly one
 * counter here.
 */
export type ShoulderAbductionTrainingExportRejectionCounts = {
  UNLABELED: number;
  THERAPIST_EXCLUSION: number;
  MULTI_RATER_REQUIRES_POLICY: number;
  SOURCE_NOT_FOUND: number;
  SOURCE_LINE_MISSING: number;
  SOURCE_IDENTITY_MISMATCH: number;
  UNSUPPORTED_CAPTURE_SCHEMA: number;
  UNSUPPORTED_FEATURE_SCHEMA: number;
  MALFORMED_SOURCE_LINE: number;
  MALFORMED_SOURCE_RECORD: number;
  DUPLICATE_MANIFEST_SAMPLE_IDENTITY: number;
};

/**
 * Therapist exclusion flag breakdown (subset of THERAPIST_EXCLUSION rejections).
 */
export type ShoulderAbductionTrainingExportExclusionFlagCounts = {
  WRONG_MOVEMENT_PLANE: number;
  INCOMPLETE_REPETITION: number;
  NOT_REVIEWABLE: number;
};

/**
 * Machine-readable QC report: dataset-level status + sample-level rejection
 * summary + exported distribution summary. Deterministic and canonical —
 * identical inputs produce byte-identical QC reports.
 *
 * CRITICAL: If `datasetIntegrityOk === false`, NO training candidates are
 * exported and no canonical training-export JSONL is written. The manifest
 * itself is the trusted provenance boundary; unresolved manifest integrity
 * diagnostics abort the entire export.
 */
export type ShoulderAbductionTrainingExportQcReport = {
  qcSchemaVersion: typeof TRAINING_EXPORT_QC_SCHEMA_VERSION;
  /** DATASET-LEVEL integrity status from the input manifest. */
  datasetIntegrityOk: boolean;
  /**
   * Manifest-assembly integrity findings that blocked export (empty if
   * datasetIntegrityOk === true). Human-readable reasons only — see the
   * manifest's own `.diagnostics` for full rejection details.
   */
  datasetIntegrityBlockers: string[];
  manifestSchemaVersion: string;
  datasetVersion: string;
  /** How many samples the input manifest contained. */
  manifestSamplesReviewed: number;
  /** How many supervised training candidates were exported (0 if datasetIntegrityOk === false). */
  supervisedCandidatesExported: number;
  /** Per-reason rejection counts. */
  rejectionCounts: ShoulderAbductionTrainingExportRejectionCounts;
  /** Therapist exclusion flag breakdown. */
  exclusionFlagCounts: ShoulderAbductionTrainingExportExclusionFlagCounts;
  /** Distribution summary for exported samples (all zeros if datasetIntegrityOk === false). */
  exportedDistributions: ShoulderAbductionTrainingExportDistributions;
  /** Capture schema versions observed in the manifest samples. */
  captureSchemaVersions: string[];
  /** Feature schema versions observed in the manifest samples. */
  featureSchemaVersions: string[];
  /** Label schema versions observed in the manifest samples. */
  labelSchemaVersions: string[];
  /** Every rejected sample, in deterministic (sampleId) order. */
  rejectedSamples: ShoulderAbductionTrainingExportRejectedSample[];
  /**
   * SHA-256 content hash of the canonical training-export JSONL (if written).
   * Null if no export was written (datasetIntegrityOk === false, or zero candidates).
   */
  exportContentSha256: string | null;
};

/**
 * Canonical text form of one training sample (JSONL line). Fixed key order for
 * determinism; JSON.stringify alone is already stable given the object
 * construction order, but this wrapper makes the contract explicit.
 */
export function serializeTrainingExportSample(
  sample: ShoulderAbductionTrainingExportSample,
): string {
  return `${JSON.stringify(sample)}\n`;
}

/**
 * Canonical text form of the QC report. Deterministic — no timestamps by
 * design (generation metadata goes to a separate `.export-run.json` sidecar).
 */
export function serializeTrainingExportQcReport(
  report: ShoulderAbductionTrainingExportQcReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
