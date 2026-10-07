/**
 * Shoulder Abduction Reach — baseline experiment input validation.
 * RASQ ML bridge, Slice 6 (2026-08-21).
 *
 * Trust boundary for Slice 5 training-export pose frames before feature
 * extraction. Fail-closed with actionable errors — no downstream TypeErrors.
 */

import type { ShoulderAbductionReachCapturedFrame } from "./capture-schema";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates one joint entry. Present joints require a landmark object with
 * finite numeric x and y — no null/boolean/string/NaN/Infinity coercion.
 */
export function validateBaselineExperimentJoint(
  joint: unknown,
  context: string,
): void {
  if (!joint || typeof joint !== "object") {
    throw new Error(`${context}: joint must be an object`);
  }

  const record = joint as { landmark?: unknown; confidence?: unknown };

  if (!record.confidence || typeof record.confidence !== "object") {
    throw new Error(`${context}: joint missing confidence object`);
  }

  const confidence = record.confidence as { present?: unknown; visibility?: unknown };
  if (typeof confidence.present !== "boolean") {
    throw new Error(`${context}: joint confidence.present must be boolean`);
  }

  if (!confidence.present) {
    return;
  }

  if (!record.landmark || typeof record.landmark !== "object") {
    throw new Error(`${context}: present joint missing landmark object`);
  }

  const landmark = record.landmark as { x?: unknown; y?: unknown; z?: unknown };
  if (!isFiniteNumber(landmark.x) || !isFiniteNumber(landmark.y)) {
    throw new Error(
      `${context}: present joint requires finite numeric landmark x and y`,
    );
  }

  if ("z" in landmark && landmark.z !== undefined && !isFiniteNumber(landmark.z)) {
    throw new Error(`${context}: landmark z must be a finite number when provided`);
  }
}

/**
 * Validates pose-frame sequences required by baseline feature extraction.
 * Rejects empty frame arrays and malformed frame/joint shapes.
 */
export function validateBaselineExperimentPoseFrames(
  frames: unknown,
  context: { lineNumber: number; sampleId: string },
): asserts frames is ShoulderAbductionReachCapturedFrame[] {
  if (!Array.isArray(frames)) {
    throw new Error(
      `missing pose-frame input at line ${context.lineNumber} (sampleId=${context.sampleId})`,
    );
  }

  if (frames.length === 0) {
    throw new Error(
      `empty pose-frame sequence at line ${context.lineNumber} (sampleId=${context.sampleId})`,
    );
  }

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    const frameContext = `line ${context.lineNumber} frame ${frameIndex} (sampleId=${context.sampleId})`;

    if (!frame || typeof frame !== "object") {
      throw new Error(`${frameContext}: frame must be an object`);
    }

    const record = frame as {
      relativeTimestampMs?: unknown;
      frameIndex?: unknown;
      joints?: unknown;
    };

    if (!isFiniteNumber(record.relativeTimestampMs)) {
      throw new Error(`${frameContext}: relativeTimestampMs must be a finite number`);
    }

    if (!Number.isInteger(record.frameIndex)) {
      throw new Error(`${frameContext}: frameIndex must be an integer`);
    }

    if (!record.joints || typeof record.joints !== "object" || Array.isArray(record.joints)) {
      throw new Error(`${frameContext}: joints must be an object`);
    }

    for (const [jointId, joint] of Object.entries(record.joints)) {
      validateBaselineExperimentJoint(joint, `${frameContext} joint ${jointId}`);
    }
  }
}
