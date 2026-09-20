/**
 * Lateral Reach interaction-calibration — Slice 3: held-endpoint capture.
 *
 * Pure accumulator over timestamped wrist samples. Captures a technically
 * stable heldEndpoint displaced from a frozen startWrist, or fails with
 * existing LateralReachCaptureFailureReason values.
 *
 * Does NOT:
 * - validate direction / expectedHorizontalDirectionSign
 * - derive rawDeltaX or directionAlignedMagnitude
 * - apply Slice 1 direction-aligned noise floor
 * - build zones / LateralReachConfig
 * - import MediaPipe, camera, React, or the Lateral Reach engine
 *
 * Note: calibration_timeout in THIS module means only that this endpoint-
 * capture attempt's totalTimeoutMs expired — not a broader orchestration timeout.
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import type { LateralReachCaptureFailureReason } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LateralReachEndpointCaptureSample = {
  atMs: number;
  wrist: NormalizedPoint | null;
  trackingValid: boolean;
  framingValid?: boolean;
};

export type LateralReachEndpointCaptureConfig = {
  minStableDurationMs: number;
  maxJitterRadius: number;
  minStableSampleCount: number;
  totalTimeoutMs: number;
  minDisplacementFromStart: number;
};

/**
 * Opaque attempt-state handle for one held-endpoint capture attempt.
 * Treat as immutable; every progression returns a new state object.
 */
export type LateralReachEndpointCaptureState = {
  readonly config: Readonly<LateralReachEndpointCaptureConfig>;
  readonly startWrist: NormalizedPoint;
  readonly startedAtMs: number;
  readonly lastAcceptedAtMs: number | null;
  readonly stableSinceMs: number | null;
  readonly currentStableSamples: readonly NormalizedPoint[];
  readonly maxStableSampleCountSeen: number;
  readonly maxDisplacementFromStartSeen: number;
  readonly sawTrackingInvalid: boolean;
  readonly sawFramingInvalid: boolean;
  readonly sawSpatialReset: boolean;
};

export type LateralReachEndpointCaptureUpdateResult =
  | {
      status: "collecting";
      state: LateralReachEndpointCaptureState;
    }
  | {
      status: "captured";
      heldEndpoint: NormalizedPoint;
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
  state: LateralReachEndpointCaptureState,
): LateralReachCaptureFailureReason[] {
  const reasons: LateralReachCaptureFailureReason[] = ["calibration_timeout"];

  if (state.sawTrackingInvalid) {
    reasons.push("wrist_tracking_invalid");
  }
  if (state.sawFramingInvalid) {
    reasons.push("framing_not_acceptable");
  }

  if (state.maxDisplacementFromStartSeen < state.config.minDisplacementFromStart) {
    reasons.push("displacement_indistinguishable_from_noise");
  } else {
    reasons.push("endpoint_hold_not_confirmed");
  }

  return reasons;
}

function withLastAccepted(
  state: LateralReachEndpointCaptureState,
  atMs: number,
  patch: Partial<
    Omit<
      LateralReachEndpointCaptureState,
      "config" | "startWrist" | "startedAtMs" | "lastAcceptedAtMs"
    >
  >,
): LateralReachEndpointCaptureState {
  return {
    config: state.config,
    startWrist: state.startWrist,
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
    maxDisplacementFromStartSeen:
      patch.maxDisplacementFromStartSeen !== undefined
        ? patch.maxDisplacementFromStartSeen
        : state.maxDisplacementFromStartSeen,
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

function captureSatisfied(
  state: LateralReachEndpointCaptureState,
  atMs: number,
): boolean {
  if (state.stableSinceMs === null || state.currentStableSamples.length === 0) {
    return false;
  }
  if (atMs - state.stableSinceMs < state.config.minStableDurationMs) {
    return false;
  }
  if (state.currentStableSamples.length < state.config.minStableSampleCount) {
    return false;
  }
  const mean = meanPoint(state.currentStableSamples);
  return distance(state.startWrist, mean) >= state.config.minDisplacementFromStart;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validateLateralReachEndpointCaptureConfig(
  candidate: unknown,
):
  | { ok: true; config: LateralReachEndpointCaptureConfig }
  | { ok: false; reason: string } {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "config_must_be_object" };
  }

  const {
    minStableDurationMs,
    maxJitterRadius,
    minStableSampleCount,
    totalTimeoutMs,
    minDisplacementFromStart,
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

  if (!isFiniteNumber(minDisplacementFromStart)) {
    return { ok: false, reason: "minDisplacementFromStart_must_be_finite_number" };
  }
  if (!(minDisplacementFromStart > 0)) {
    return { ok: false, reason: "minDisplacementFromStart_must_be_positive" };
  }

  return {
    ok: true,
    config: {
      minStableDurationMs,
      maxJitterRadius,
      minStableSampleCount,
      totalTimeoutMs,
      minDisplacementFromStart,
    },
  };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export function createLateralReachEndpointCaptureState(
  nowMs: number,
  startWrist: NormalizedPoint,
  config: LateralReachEndpointCaptureConfig,
): LateralReachEndpointCaptureState {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("nowMs must be a finite number");
  }
  if (!isFiniteNormalizedPoint(startWrist)) {
    throw new RangeError("startWrist must have finite x and y");
  }

  const frozenConfig = Object.freeze({
    minStableDurationMs: config.minStableDurationMs,
    maxJitterRadius: config.maxJitterRadius,
    minStableSampleCount: config.minStableSampleCount,
    totalTimeoutMs: config.totalTimeoutMs,
    minDisplacementFromStart: config.minDisplacementFromStart,
  });

  return {
    config: frozenConfig,
    startWrist: clonePoint(startWrist),
    startedAtMs: nowMs,
    lastAcceptedAtMs: null,
    stableSinceMs: null,
    currentStableSamples: [],
    maxStableSampleCountSeen: 0,
    maxDisplacementFromStartSeen: 0,
    sawTrackingInvalid: false,
    sawFramingInvalid: false,
    sawSpatialReset: false,
  };
}

export function updateLateralReachEndpointCapture(
  state: LateralReachEndpointCaptureState,
  sample: LateralReachEndpointCaptureSample,
): LateralReachEndpointCaptureUpdateResult {
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

  let next: LateralReachEndpointCaptureState;

  if (!usable) {
    next = withLastAccepted(state, sample.atMs, {
      stableSinceMs: null,
      currentStableSamples: [],
      sawTrackingInvalid,
      sawFramingInvalid,
    });
  } else {
    const wrist = clonePoint(sample.wrist!);
    const sampleDisplacement = distance(state.startWrist, wrist);
    const maxDisplacementFromStartSeen = Math.max(
      state.maxDisplacementFromStartSeen,
      sampleDisplacement,
    );
    const hasWindow =
      state.stableSinceMs !== null && state.currentStableSamples.length > 0;

    if (!hasWindow) {
      const windowSamples = [wrist];
      next = withLastAccepted(state, sample.atMs, {
        stableSinceMs: sample.atMs,
        currentStableSamples: windowSamples,
        maxStableSampleCountSeen: Math.max(state.maxStableSampleCountSeen, windowSamples.length),
        maxDisplacementFromStartSeen,
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
          maxDisplacementFromStartSeen,
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
          maxDisplacementFromStartSeen,
          sawTrackingInvalid,
          sawFramingInvalid,
        });
      }
    }
  }

  if (captureSatisfied(next, sample.atMs)) {
    return {
      status: "captured",
      heldEndpoint: meanPoint(next.currentStableSamples),
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
