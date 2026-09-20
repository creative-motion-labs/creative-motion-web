/**
 * Lateral Reach interaction-calibration — Slice 2: stable start capture.
 *
 * Pure accumulator over timestamped wrist samples. Captures a stable startWrist
 * or fails with existing LateralReachCaptureFailureReason values.
 *
 * Does NOT:
 * - capture heldEndpoint
 * - derive displacement
 * - build zones / LateralReachConfig
 * - import MediaPipe, camera, React, or the Lateral Reach engine
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import type { LateralReachCaptureFailureReason } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LateralReachStartCaptureSample = {
  atMs: number;
  wrist: NormalizedPoint | null;
  trackingValid: boolean;
  framingValid?: boolean;
};

export type LateralReachStartCaptureConfig = {
  minStableDurationMs: number;
  maxJitterRadius: number;
  minStableSampleCount: number;
  totalTimeoutMs: number;
};

/**
 * Opaque attempt-state handle for one start-capture attempt.
 * Treat as immutable; every progression returns a new state object.
 */
export type LateralReachStartCaptureState = {
  readonly config: Readonly<LateralReachStartCaptureConfig>;
  readonly startedAtMs: number;
  readonly lastAcceptedAtMs: number | null;
  readonly stableSinceMs: number | null;
  readonly currentStableSamples: readonly NormalizedPoint[];
  readonly maxStableSampleCountSeen: number;
  readonly sawTrackingInvalid: boolean;
  readonly sawFramingInvalid: boolean;
  readonly sawSpatialReset: boolean;
};

export type LateralReachStartCaptureUpdateResult =
  | {
      status: "collecting";
      state: LateralReachStartCaptureState;
    }
  | {
      status: "captured";
      startWrist: NormalizedPoint;
    }
  | {
      status: "failed";
      failureReasons: LateralReachCaptureFailureReason[];
    };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNormalizedPoint(value: NormalizedPoint): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function clonePoint(point: NormalizedPoint): NormalizedPoint {
  return { x: point.x, y: point.y };
}

function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function meanPoint(samples: readonly NormalizedPoint[]): NormalizedPoint {
  let sumX = 0;
  let sumY = 0;
  for (const sample of samples) {
    sumX += sample.x;
    sumY += sample.y;
  }
  const n = samples.length;
  return { x: sumX / n, y: sumY / n };
}

function deriveFailureReasons(
  state: LateralReachStartCaptureState,
): LateralReachCaptureFailureReason[] {
  const reasons: LateralReachCaptureFailureReason[] = ["start_timeout"];

  if (state.sawTrackingInvalid) {
    reasons.push("wrist_tracking_invalid");
  }
  if (state.sawFramingInvalid) {
    reasons.push("framing_not_acceptable");
  }

  if (state.maxStableSampleCountSeen < state.config.minStableSampleCount) {
    reasons.push("insufficient_start_samples");
  } else if (state.sawSpatialReset) {
    reasons.push("start_unstable");
  }

  return reasons;
}

function withLastAccepted(
  state: LateralReachStartCaptureState,
  atMs: number,
  patch: Partial<
    Omit<LateralReachStartCaptureState, "config" | "startedAtMs" | "lastAcceptedAtMs">
  >,
): LateralReachStartCaptureState {
  return {
    config: state.config,
    startedAtMs: state.startedAtMs,
    lastAcceptedAtMs: atMs,
    stableSinceMs:
      patch.stableSinceMs !== undefined ? patch.stableSinceMs : state.stableSinceMs,
    currentStableSamples:
      patch.currentStableSamples !== undefined
        ? patch.currentStableSamples
        : state.currentStableSamples,
    maxStableSampleCountSeen:
      patch.maxStableSampleCountSeen !== undefined
        ? patch.maxStableSampleCountSeen
        : state.maxStableSampleCountSeen,
    sawTrackingInvalid:
      patch.sawTrackingInvalid !== undefined
        ? patch.sawTrackingInvalid
        : state.sawTrackingInvalid,
    sawFramingInvalid:
      patch.sawFramingInvalid !== undefined
        ? patch.sawFramingInvalid
        : state.sawFramingInvalid,
    sawSpatialReset:
      patch.sawSpatialReset !== undefined ? patch.sawSpatialReset : state.sawSpatialReset,
  };
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validateLateralReachStartCaptureConfig(
  candidate: unknown,
):
  | { ok: true; config: LateralReachStartCaptureConfig }
  | { ok: false; reason: string } {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "config_must_be_object" };
  }

  const {
    minStableDurationMs,
    maxJitterRadius,
    minStableSampleCount,
    totalTimeoutMs,
  } = candidate;

  if (!isFiniteNumber(minStableDurationMs)) {
    return { ok: false, reason: "minStableDurationMs_must_be_finite_number" };
  }
  if (minStableDurationMs < 0) {
    return { ok: false, reason: "minStableDurationMs_must_be_non_negative" };
  }

  if (!isFiniteNumber(maxJitterRadius)) {
    return { ok: false, reason: "maxJitterRadius_must_be_finite_number" };
  }
  if (maxJitterRadius < 0) {
    return { ok: false, reason: "maxJitterRadius_must_be_non_negative" };
  }

  if (!isFiniteNumber(minStableSampleCount)) {
    return { ok: false, reason: "minStableSampleCount_must_be_finite_number" };
  }
  if (!Number.isInteger(minStableSampleCount)) {
    return { ok: false, reason: "minStableSampleCount_must_be_integer" };
  }
  if (minStableSampleCount < 1) {
    return { ok: false, reason: "minStableSampleCount_must_be_at_least_1" };
  }

  if (!isFiniteNumber(totalTimeoutMs)) {
    return { ok: false, reason: "totalTimeoutMs_must_be_finite_number" };
  }
  if (totalTimeoutMs < minStableDurationMs) {
    return { ok: false, reason: "totalTimeoutMs_must_be_gte_minStableDurationMs" };
  }

  return {
    ok: true,
    config: {
      minStableDurationMs,
      maxJitterRadius,
      minStableSampleCount,
      totalTimeoutMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export function createLateralReachStartCaptureState(
  nowMs: number,
  config: LateralReachStartCaptureConfig,
): LateralReachStartCaptureState {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("nowMs must be a finite number");
  }

  const frozenConfig = Object.freeze({
    minStableDurationMs: config.minStableDurationMs,
    maxJitterRadius: config.maxJitterRadius,
    minStableSampleCount: config.minStableSampleCount,
    totalTimeoutMs: config.totalTimeoutMs,
  });

  return {
    config: frozenConfig,
    startedAtMs: nowMs,
    lastAcceptedAtMs: null,
    stableSinceMs: null,
    currentStableSamples: [],
    maxStableSampleCountSeen: 0,
    sawTrackingInvalid: false,
    sawFramingInvalid: false,
    sawSpatialReset: false,
  };
}

export function updateLateralReachStartCapture(
  state: LateralReachStartCaptureState,
  sample: LateralReachStartCaptureSample,
): LateralReachStartCaptureUpdateResult {
  // Timestamp contract: ignore malformed / out-of-order samples without mutation.
  if (!Number.isFinite(sample.atMs)) {
    return { status: "collecting", state };
  }
  if (state.lastAcceptedAtMs === null && sample.atMs < state.startedAtMs) {
    return { status: "collecting", state };
  }
  if (state.lastAcceptedAtMs !== null && sample.atMs < state.lastAcceptedAtMs) {
    return { status: "collecting", state };
  }

  const elapsedMs = sample.atMs - state.startedAtMs;

  // Strictly after deadline: fail from prior evidence; do not process sample.
  if (elapsedMs > state.config.totalTimeoutMs) {
    return {
      status: "failed",
      failureReasons: deriveFailureReasons(state),
    };
  }

  // Malformed wrist with trackingValid===true: ignore without fabricating diagnosis.
  if (
    sample.trackingValid === true &&
    sample.wrist !== null &&
    !isFiniteNormalizedPoint(sample.wrist)
  ) {
    return { status: "collecting", state };
  }

  const sawTrackingInvalid = state.sawTrackingInvalid || sample.trackingValid === false;
  const sawFramingInvalid = state.sawFramingInvalid || sample.framingValid === false;

  const usable =
    sample.wrist !== null &&
    sample.trackingValid === true &&
    sample.framingValid !== false &&
    isFiniteNormalizedPoint(sample.wrist);

  let next: LateralReachStartCaptureState;

  if (!usable) {
    next = withLastAccepted(state, sample.atMs, {
      stableSinceMs: null,
      currentStableSamples: [],
      sawTrackingInvalid,
      sawFramingInvalid,
    });
  } else {
    const wrist = clonePoint(sample.wrist!);
    const hasWindow =
      state.stableSinceMs !== null && state.currentStableSamples.length > 0;

    if (!hasWindow) {
      const windowSamples = [wrist];
      next = withLastAccepted(state, sample.atMs, {
        stableSinceMs: sample.atMs,
        currentStableSamples: windowSamples,
        maxStableSampleCountSeen: Math.max(state.maxStableSampleCountSeen, windowSamples.length),
        sawTrackingInvalid,
        sawFramingInvalid,
      });
    } else {
      const anchor = state.currentStableSamples[0]!;
      if (distance(anchor, wrist) <= state.config.maxJitterRadius) {
        const windowSamples = [...state.currentStableSamples, wrist];
        next = withLastAccepted(state, sample.atMs, {
          currentStableSamples: windowSamples,
          maxStableSampleCountSeen: Math.max(
            state.maxStableSampleCountSeen,
            windowSamples.length,
          ),
          sawTrackingInvalid,
          sawFramingInvalid,
        });
      } else {
        const windowSamples = [wrist];
        next = withLastAccepted(state, sample.atMs, {
          sawSpatialReset: true,
          stableSinceMs: sample.atMs,
          currentStableSamples: windowSamples,
          maxStableSampleCountSeen: Math.max(
            state.maxStableSampleCountSeen,
            windowSamples.length,
          ),
          sawTrackingInvalid,
          sawFramingInvalid,
        });
      }
    }
  }

  // Capture check (only meaningful after a usable window update).
  if (
    next.stableSinceMs !== null &&
    next.currentStableSamples.length > 0 &&
    sample.atMs - next.stableSinceMs >= next.config.minStableDurationMs &&
    next.currentStableSamples.length >= next.config.minStableSampleCount
  ) {
    return {
      status: "captured",
      startWrist: meanPoint(next.currentStableSamples),
    };
  }

  // Exact deadline without capture → fail using next (includes this sample's evidence).
  if (elapsedMs === state.config.totalTimeoutMs) {
    return {
      status: "failed",
      failureReasons: deriveFailureReasons(next),
    };
  }

  return { status: "collecting", state: next };
}
