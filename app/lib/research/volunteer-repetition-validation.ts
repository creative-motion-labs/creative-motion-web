import { createHash } from "node:crypto";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_CAPTURED_JOINT_IDS,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
  type MlResearchCapturedJointId,
  type ShoulderAbductionReachCapturedFrame,
  type ShoulderAbductionReachDerivedFeatures,
  type ShoulderAbductionReachTrackingQualitySummary,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { MotionFrameJoint } from "@/app/lib/motion-intelligence";

/** Generous technical anti-abuse ceiling — not a clinical bound (observed max ~67 frames). */
export const VOLUNTEER_REPETITION_MAX_FRAMES = 512;

/** Maximum JSON body size for repetition submission (1 MiB). */
export const VOLUNTEER_REPETITION_MAX_JSON_BYTES = 1024 * 1024;

const SUPPORTED_FEATURE_SCHEMA_VERSIONS = new Set<string>([
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION_V1,
]);

const CAPTURED_JOINT_SET = new Set<string>(ML_RESEARCH_CAPTURED_JOINT_IDS);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FRAME_KEYS = new Set(["relativeTimestampMs", "frameIndex", "joints"]);
const JOINT_OBJECT_KEYS = new Set(["landmark", "confidence"]);
const CONFIDENCE_KEYS = new Set(["visibility", "present"]);
const DERIVED_FEATURE_KEYS = new Set([
  "peakNormalizedTrunkDriftRatio",
  "peakShoulderAngleDegrees",
  "movementDurationMs",
  "peakAngularVelocityDegPerSec",
  "trackingQuality",
]);
const TRACKING_QUALITY_KEYS = new Set([
  "framesTotal",
  "framesWithUsableAngle",
  "usableFrameRatio",
  "minCoreJointVisibility",
]);

const REPETITION_TOP_LEVEL_ALLOWED_KEYS = new Set([
  "movementSessionId",
  "clientSubmissionId",
  "repetitionIndex",
  "captureSchemaVersion",
  "featureSchemaVersion",
  "startedAtMs",
  "endedAtMs",
  "frames",
  "derivedFeatures",
]);

const REPETITION_SERVER_OWNED_REJECTED_KEYS = new Set([
  "participantId",
  "participant_id",
  "collectionSessionId",
  "collection_session_id",
  "payloadHash",
  "payload_hash",
  "sessionToken",
  "session_token",
  "session_token_hash",
  "deletionCode",
  "deletion_code",
  "status",
  "repetitionId",
  "devSessionId",
  "simulationCondition",
  "movementType",
  "side",
  "protocolCondition",
  "video",
  "image",
  "base64",
  "blob",
  "photo",
  "media",
  "rawVideo",
  "imageData",
]);

/** Floating-point tolerance for usableFrameRatio consistency checks. */
export const VOLUNTEER_REPETITION_RATIO_TOLERANCE = 1e-6;

export type VolunteerRepetitionSubmissionBody = {
  movementSessionId?: unknown;
  clientSubmissionId?: unknown;
  repetitionIndex?: unknown;
  captureSchemaVersion?: unknown;
  featureSchemaVersion?: unknown;
  startedAtMs?: unknown;
  endedAtMs?: unknown;
  frames?: unknown;
  derivedFeatures?: unknown;
  participantId?: unknown;
  devSessionId?: unknown;
  repetitionId?: unknown;
  simulationCondition?: unknown;
  movementType?: unknown;
  side?: unknown;
  protocolCondition?: unknown;
};

export type ValidatedVolunteerRepetitionPayload = {
  movementSessionId: string;
  clientSubmissionId: string;
  repetitionIndex: number;
  captureSchemaVersion: typeof ML_RESEARCH_CAPTURE_SCHEMA_VERSION;
  featureSchemaVersion: string;
  startedAtMs: number;
  endedAtMs: number;
  frames: ShoulderAbductionReachCapturedFrame[];
  derivedFeatures: ShoulderAbductionReachDerivedFeatures;
};

export type VolunteerRepetitionValidationResult =
  | { ok: true; value: ValidatedVolunteerRepetitionPayload }
  | { ok: false; error: string };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnitInterval(value: number): boolean {
  return value >= 0 && value <= 1;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectDisallowedTopLevelKeys(
  body: unknown,
): VolunteerRepetitionValidationResult | { ok: true; value: Record<string, unknown> } {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Invalid request body." };
  }

  for (const key of Object.keys(body)) {
    if (REPETITION_SERVER_OWNED_REJECTED_KEYS.has(key)) {
      return { ok: false, error: "Request contains unsupported fields." };
    }
    if (!REPETITION_TOP_LEVEL_ALLOWED_KEYS.has(key)) {
      return { ok: false, error: "Request contains unsupported fields." };
    }
    if (key !== "frames" && key !== "derivedFeatures") {
      const value = body[key];
      if (value !== null && typeof value === "object") {
        return { ok: false, error: "Request contains unsupported fields." };
      }
    }
  }

  return { ok: true, value: body };
}

function sanitizeLandmark(
  raw: unknown,
): { x: number; y: number; z?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const landmark = raw as Record<string, unknown>;
  const keys = Object.keys(landmark);
  if (!keys.includes("x") || !keys.includes("y")) return null;
  if (!keys.every((key) => key === "x" || key === "y" || key === "z")) return null;

  const { x, y, z } = landmark;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isUnitInterval(x) || !isUnitInterval(y)) {
    return null;
  }
  if (z !== undefined) {
    if (!isFiniteNumber(z)) return null;
    return { x, y, z };
  }
  return { x, y };
}

function sanitizeConfidence(raw: unknown): MotionFrameJoint["confidence"] | null {
  if (!raw || typeof raw !== "object") return null;
  const confidence = raw as Record<string, unknown>;
  if (!hasOnlyKeys(confidence, CONFIDENCE_KEYS)) return null;

  const { visibility, present } = confidence;
  if (!isFiniteNumber(visibility) || !isUnitInterval(visibility)) return null;
  if (typeof present !== "boolean") return null;

  return { visibility, present };
}

function sanitizeMotionFrameJoint(raw: unknown): MotionFrameJoint | null {
  if (!raw || typeof raw !== "object") return null;
  const joint = raw as Record<string, unknown>;
  if (!hasOnlyKeys(joint, JOINT_OBJECT_KEYS)) return null;

  const landmark = sanitizeLandmark(joint.landmark);
  const confidence = sanitizeConfidence(joint.confidence);
  if (!landmark || !confidence) return null;

  return { landmark, confidence };
}

function sanitizeCapturedJoints(
  raw: unknown,
): ShoulderAbductionReachCapturedFrame["joints"] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const joints: ShoulderAbductionReachCapturedFrame["joints"] = {};
  for (const [key, joint] of Object.entries(raw as Record<string, unknown>)) {
    if (!CAPTURED_JOINT_SET.has(key)) return null;
    const sanitizedJoint = sanitizeMotionFrameJoint(joint);
    if (!sanitizedJoint) return null;
    joints[key as MlResearchCapturedJointId] = sanitizedJoint;
  }
  return joints;
}

function sanitizeFrame(raw: unknown): ShoulderAbductionReachCapturedFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as Record<string, unknown>;
  if (!hasOnlyKeys(frame, FRAME_KEYS)) return null;

  const { relativeTimestampMs, frameIndex, joints } = frame;
  if (!isFiniteNumber(relativeTimestampMs) || relativeTimestampMs < 0) return null;
  if (!Number.isInteger(frameIndex) || (frameIndex as number) < 0) return null;

  const sanitizedJoints = sanitizeCapturedJoints(joints);
  if (!sanitizedJoints) return null;

  return {
    relativeTimestampMs,
    frameIndex: frameIndex as number,
    joints: sanitizedJoints,
  };
}

function isUsableFrameRatioConsistent(
  framesWithUsableAngle: number,
  framesTotal: number,
  usableFrameRatio: number,
): boolean {
  const expected = framesWithUsableAngle / framesTotal;
  return Math.abs(usableFrameRatio - expected) <= VOLUNTEER_REPETITION_RATIO_TOLERANCE;
}

function sanitizeTrackingQuality(
  raw: unknown,
  framesLength: number,
): ShoulderAbductionReachTrackingQualitySummary | null {
  if (!raw || typeof raw !== "object") return null;
  const trackingQuality = raw as Record<string, unknown>;
  if (!hasOnlyKeys(trackingQuality, TRACKING_QUALITY_KEYS)) return null;

  const { framesTotal, framesWithUsableAngle, usableFrameRatio, minCoreJointVisibility } =
    trackingQuality;

  const framesTotalNum = framesTotal as number;
  const framesWithUsableAngleNum = framesWithUsableAngle as number;

  if (!Number.isInteger(framesTotalNum) || framesTotalNum !== framesLength) return null;
  if (
    !Number.isInteger(framesWithUsableAngleNum) ||
    framesWithUsableAngleNum < 0 ||
    framesWithUsableAngleNum > framesLength
  ) {
    return null;
  }
  if (!isFiniteNumber(usableFrameRatio) || !isUnitInterval(usableFrameRatio)) return null;
  if (
    !isUsableFrameRatioConsistent(
      framesWithUsableAngleNum,
      framesTotalNum,
      usableFrameRatio,
    )
  ) {
    return null;
  }

  const sanitized: ShoulderAbductionReachTrackingQualitySummary = {
    framesTotal: framesTotalNum,
    framesWithUsableAngle: framesWithUsableAngleNum,
    usableFrameRatio,
  };

  if ("minCoreJointVisibility" in trackingQuality) {
    if (minCoreJointVisibility === null || minCoreJointVisibility === undefined) {
      sanitized.minCoreJointVisibility = null;
    } else if (
      isFiniteNumber(minCoreJointVisibility) &&
      isUnitInterval(minCoreJointVisibility)
    ) {
      sanitized.minCoreJointVisibility = minCoreJointVisibility;
    } else {
      return null;
    }
  }

  return sanitized;
}

function sanitizeDerivedFeatures(
  raw: unknown,
  framesLength: number,
): ShoulderAbductionReachDerivedFeatures | null {
  if (!raw || typeof raw !== "object") return null;
  const derivedFeatures = raw as Record<string, unknown>;
  if (!hasOnlyKeys(derivedFeatures, DERIVED_FEATURE_KEYS)) return null;

  const nullableFinite = (field: unknown) => field === null || isFiniteNumber(field);
  const {
    peakNormalizedTrunkDriftRatio,
    peakShoulderAngleDegrees,
    movementDurationMs,
    peakAngularVelocityDegPerSec,
    trackingQuality,
  } = derivedFeatures;

  if (!nullableFinite(peakNormalizedTrunkDriftRatio)) return null;
  if (!nullableFinite(peakShoulderAngleDegrees)) return null;
  if (!nullableFinite(peakAngularVelocityDegPerSec)) return null;
  if (!isFiniteNumber(movementDurationMs) || movementDurationMs < 0) return null;

  const sanitizedTrackingQuality = sanitizeTrackingQuality(trackingQuality, framesLength);
  if (!sanitizedTrackingQuality) return null;

  return {
    peakNormalizedTrunkDriftRatio: peakNormalizedTrunkDriftRatio as number | null,
    peakShoulderAngleDegrees: peakShoulderAngleDegrees as number | null,
    movementDurationMs,
    peakAngularVelocityDegPerSec: peakAngularVelocityDegPerSec as number | null,
    trackingQuality: sanitizedTrackingQuality,
  };
}

function validateFramesSequence(frames: ShoulderAbductionReachCapturedFrame[]): boolean {
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i]!.frameIndex !== i) return false;
    if (i > 0 && frames[i]!.relativeTimestampMs < frames[i - 1]!.relativeTimestampMs) {
      return false;
    }
  }
  return true;
}

export function isVolunteerRepetitionBodyTooLarge(contentLengthHeader: string | null): boolean {
  if (!contentLengthHeader) return false;
  const n = Number(contentLengthHeader);
  if (!Number.isFinite(n) || n < 0) return false;
  return n > VOLUNTEER_REPETITION_MAX_JSON_BYTES;
}

export function validateVolunteerRepetitionBody(
  body: VolunteerRepetitionSubmissionBody,
): VolunteerRepetitionValidationResult {
  const shape = rejectDisallowedTopLevelKeys(body);
  if (!shape.ok) return shape;

  const record = shape.value as VolunteerRepetitionSubmissionBody;

  if (!isUuid(record.movementSessionId)) {
    return { ok: false, error: "Movement session id is invalid." };
  }
  if (!isUuid(record.clientSubmissionId)) {
    return { ok: false, error: "Client submission id is invalid." };
  }
  if (!Number.isInteger(record.repetitionIndex) || (record.repetitionIndex as number) < 1) {
    return { ok: false, error: "Repetition index is invalid." };
  }
  if (record.captureSchemaVersion !== ML_RESEARCH_CAPTURE_SCHEMA_VERSION) {
    return { ok: false, error: "Capture schema version is not supported." };
  }
  if (
    typeof record.featureSchemaVersion !== "string" ||
    !SUPPORTED_FEATURE_SCHEMA_VERSIONS.has(record.featureSchemaVersion)
  ) {
    return { ok: false, error: "Feature schema version is not supported." };
  }
  if (!isFiniteNumber(record.startedAtMs) || record.startedAtMs < 0) {
    return { ok: false, error: "Started timestamp is invalid." };
  }
  if (!isFiniteNumber(record.endedAtMs) || record.endedAtMs < record.startedAtMs) {
    return { ok: false, error: "Ended timestamp is invalid." };
  }
  if (!Array.isArray(record.frames) || record.frames.length === 0) {
    return { ok: false, error: "Frames are required." };
  }
  if (record.frames.length > VOLUNTEER_REPETITION_MAX_FRAMES) {
    return { ok: false, error: "Frame count exceeds the allowed limit." };
  }

  const frames: ShoulderAbductionReachCapturedFrame[] = [];
  for (const frame of record.frames) {
    const sanitizedFrame = sanitizeFrame(frame);
    if (!sanitizedFrame) {
      return { ok: false, error: "Frame payload is invalid." };
    }
    frames.push(sanitizedFrame);
  }
  if (!validateFramesSequence(frames)) {
    return { ok: false, error: "Frame sequence is invalid." };
  }

  const derivedFeatures = sanitizeDerivedFeatures(record.derivedFeatures, frames.length);
  if (!derivedFeatures) {
    return { ok: false, error: "Derived features are invalid." };
  }

  return {
    ok: true,
    value: {
      movementSessionId: (record.movementSessionId as string).trim(),
      clientSubmissionId: (record.clientSubmissionId as string).trim(),
      repetitionIndex: record.repetitionIndex as number,
      captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
      featureSchemaVersion: record.featureSchemaVersion,
      startedAtMs: record.startedAtMs,
      endedAtMs: record.endedAtMs,
      frames,
      derivedFeatures,
    },
  };
}

export type VolunteerRepetitionPayloadFingerprintInput = Pick<
  ValidatedVolunteerRepetitionPayload,
  | "repetitionIndex"
  | "captureSchemaVersion"
  | "featureSchemaVersion"
  | "startedAtMs"
  | "endedAtMs"
  | "frames"
  | "derivedFeatures"
>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function hashVolunteerRepetitionPayload(
  payload: VolunteerRepetitionPayloadFingerprintInput,
): string {
  const canonical = stableStringify({
    captureSchemaVersion: payload.captureSchemaVersion,
    derivedFeatures: payload.derivedFeatures,
    endedAtMs: payload.endedAtMs,
    featureSchemaVersion: payload.featureSchemaVersion,
    frames: payload.frames,
    repetitionIndex: payload.repetitionIndex,
    startedAtMs: payload.startedAtMs,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Test helper — minimal valid repetition body for API/store tests. */
export function buildVolunteerRepetitionFixture(
  overrides: Partial<ValidatedVolunteerRepetitionPayload> = {},
): ValidatedVolunteerRepetitionPayload {
  const frames: ShoulderAbductionReachCapturedFrame[] = [
    {
      relativeTimestampMs: 0,
      frameIndex: 0,
      joints: {
        right_shoulder: {
          landmark: { x: 0.5, y: 0.3 },
          confidence: { visibility: 0.9, present: true },
        },
      },
    },
    {
      relativeTimestampMs: 400,
      frameIndex: 1,
      joints: {
        right_shoulder: {
          landmark: { x: 0.52, y: 0.28 },
          confidence: { visibility: 0.88, present: true },
        },
      },
    },
  ];

  return {
    movementSessionId: crypto.randomUUID(),
    clientSubmissionId: crypto.randomUUID(),
    repetitionIndex: 1,
    captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
    featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
    startedAtMs: 1_000,
    endedAtMs: 1_400,
    frames,
    derivedFeatures: {
      peakNormalizedTrunkDriftRatio: 0.12,
      peakShoulderAngleDegrees: 95,
      movementDurationMs: 400,
      peakAngularVelocityDegPerSec: 120,
      trackingQuality: {
        framesTotal: frames.length,
        framesWithUsableAngle: 2,
        usableFrameRatio: 1,
        minCoreJointVisibility: 0.88,
      },
    },
    ...overrides,
  };
}
