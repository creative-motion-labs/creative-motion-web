/**
 * Lateral Reach camera lab — Slice 17: technical-config intake (lab-local).
 *
 * Explicit structured intake for all calibration and engine numeric parameters.
 * Unblocks Slice 11 controller creation and Slice 7 engine activation without
 * inventing production defaults.
 *
 * Does NOT own: camera lifecycle, controller runtime, detector wiring, engine
 * activation, numeric production policy, clinical validation, or device testing.
 */

import type { LateralReachStartCaptureConfig } from "@/app/lib/interaction-calibration/lateral-reach/start-capture";
import { validateLateralReachStartCaptureConfig } from "@/app/lib/interaction-calibration/lateral-reach/start-capture";
import type { LateralReachEndpointCaptureConfig } from "@/app/lib/interaction-calibration/lateral-reach/endpoint-capture";
import { validateLateralReachEndpointCaptureConfig } from "@/app/lib/interaction-calibration/lateral-reach/endpoint-capture";
import {
  createLateralReachCalibrationNoiseFloor,
  createLateralReachCalibrationZoneRadii,
  type LateralReachCalibrationZoneRadii,
} from "@/app/lib/interaction-calibration/lateral-reach/technical-parameters";
import type { LateralReachNoiseFloorConfig } from "@/app/lib/interaction-calibration/lateral-reach/types";
import type {
  LateralReachTimingConfig,
  LateralReachTrackingConfig,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";

/**
 * Lab-local locked technical configuration containing all 17 numeric parameters
 * required by Slice 11 controller and Slice 7 engine adapter.
 *
 * Single source of truth for all calibration/engine numeric values.
 * No duplicate fields. minWristVisibility lives once in tracking group.
 */
export type LateralReachLabTechnicalConfig = {
  readonly startCaptureConfig: LateralReachStartCaptureConfig;
  readonly endpointCaptureConfig: LateralReachEndpointCaptureConfig;
  readonly zoneRadii: LateralReachCalibrationZoneRadii;
  readonly noiseFloor: LateralReachNoiseFloorConfig;
  readonly tracking: LateralReachTrackingConfig;
  readonly timing: LateralReachTimingConfig;
};

export type LabTechnicalConfigLock = {
  readonly lockedConfig: LateralReachLabTechnicalConfig;
};

export type LabTechnicalConfigLockResult =
  | {
      readonly ok: true;
      readonly lock: LabTechnicalConfigLock;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly previousLock: LabTechnicalConfigLock | null;
    };

// ---------------------------------------------------------------------------
// Lab-local tracking/timing structural validation
// ---------------------------------------------------------------------------

/**
 * Mirror of engine-private validateTrackingConfig structural semantics.
 * Validates domain constraints only — does NOT establish production policy.
 */
function validateLabTrackingConfig(
  candidate: unknown,
):
  | { ok: true; tracking: LateralReachTrackingConfig }
  | { ok: false; error: string } {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { ok: false, error: "tracking must be an object" };
  }

  const { minWristVisibility, maxAllowedGapMs } = candidate as Record<
    string,
    unknown
  >;

  if (
    typeof minWristVisibility !== "number" ||
    !Number.isFinite(minWristVisibility) ||
    minWristVisibility < 0 ||
    minWristVisibility > 1
  ) {
    return {
      ok: false,
      error: "tracking.minWristVisibility must be a finite number within [0,1]",
    };
  }

  if (
    typeof maxAllowedGapMs !== "number" ||
    !Number.isFinite(maxAllowedGapMs) ||
    maxAllowedGapMs < 0
  ) {
    return {
      ok: false,
      error: "tracking.maxAllowedGapMs must be a finite number >= 0",
    };
  }

  return { ok: true, tracking: { minWristVisibility, maxAllowedGapMs } };
}

/**
 * Mirror of engine-private validateTimingConfig structural semantics.
 * Validates domain constraints only — does NOT establish production policy.
 */
function validateLabTimingConfig(
  candidate: unknown,
):
  | { ok: true; timing: LateralReachTimingConfig }
  | { ok: false; error: string } {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { ok: false, error: "timing must be an object" };
  }

  const record = candidate as Record<string, unknown>;
  const fields = [
    "onsetConfirmationMs",
    "dwellDurationMs",
    "returnConfirmationMs",
  ] as const;

  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return {
        ok: false,
        error: `timing.${field} must be a finite number >= 0`,
      };
    }
  }

  return {
    ok: true,
    timing: {
      onsetConfirmationMs: record.onsetConfirmationMs as number,
      dwellDurationMs: record.dwellDurationMs as number,
      returnConfirmationMs: record.returnConfirmationMs as number,
    },
  };
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

function parseLabConfigInput(rawInput: string): unknown {
  if (rawInput.trim() === "") {
    throw new RangeError("Config input cannot be empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch (err) {
    throw new RangeError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Lock / validation
// ---------------------------------------------------------------------------

/**
 * Canonical lock validator. Delegates to existing public validators where
 * available, mirrors engine-private tracking/timing validation locally.
 * Fail-closed: rejects invalid, never repairs or defaults.
 */
export function lockLateralReachLabTechnicalConfig(
  input: unknown,
): LabTechnicalConfigLock {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    throw new RangeError("Config must be an object");
  }

  const record = input as Record<string, unknown>;

  // Delegate to Slice 2 validator
  const startCaptureResult = validateLateralReachStartCaptureConfig(
    record.startCaptureConfig,
  );
  if (!startCaptureResult.ok) {
    throw new RangeError(`startCaptureConfig: ${startCaptureResult.reason}`);
  }

  // Delegate to Slice 3 validator
  const endpointCaptureResult = validateLateralReachEndpointCaptureConfig(
    record.endpointCaptureConfig,
  );
  if (!endpointCaptureResult.ok) {
    throw new RangeError(
      `endpointCaptureConfig: ${endpointCaptureResult.reason}`,
    );
  }

  // Delegate to Slice 9 factory (validates internally)
  let zoneRadii: LateralReachCalibrationZoneRadii;
  try {
    zoneRadii = createLateralReachCalibrationZoneRadii(record.zoneRadii);
  } catch (err) {
    throw new RangeError(
      `zoneRadii: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Delegate to Slice 9 factory (validates internally)
  // Extract minDirectionAlignedMagnitude from noiseFloor object
  let noiseFloor: LateralReachNoiseFloorConfig;
  try {
    const noiseFloorInput = record.noiseFloor;
    if (
      typeof noiseFloorInput !== "object" ||
      noiseFloorInput === null ||
      Array.isArray(noiseFloorInput)
    ) {
      throw new RangeError("noiseFloor must be an object");
    }
    const magnitude = (noiseFloorInput as Record<string, unknown>)
      .minDirectionAlignedMagnitude;
    noiseFloor = createLateralReachCalibrationNoiseFloor(magnitude);
  } catch (err) {
    throw new RangeError(
      `noiseFloor: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Local tracking validation (mirrors engine-private semantics)
  const trackingResult = validateLabTrackingConfig(record.tracking);
  if (!trackingResult.ok) {
    throw new RangeError(trackingResult.error);
  }

  // Local timing validation (mirrors engine-private semantics)
  const timingResult = validateLabTimingConfig(record.timing);
  if (!timingResult.ok) {
    throw new RangeError(timingResult.error);
  }

  // Build canonical snapshot (no aliasing)
  return {
    lockedConfig: {
      startCaptureConfig: startCaptureResult.config,
      endpointCaptureConfig: endpointCaptureResult.config,
      zoneRadii,
      noiseFloor,
      tracking: trackingResult.tracking,
      timing: timingResult.timing,
    },
  };
}

/**
 * Safe wrapper for lock attempts. Preserves previous valid lock on failure.
 */
export function tryLockLateralReachLabTechnicalConfig(
  input: unknown,
  previousLock: LabTechnicalConfigLock | null = null,
): LabTechnicalConfigLockResult {
  try {
    return { ok: true, lock: lockLateralReachLabTechnicalConfig(input) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      previousLock,
    };
  }
}

/**
 * Pre-validation helper for UI button state. Does basic JSON parse check only.
 */
export function canLockLateralReachLabTechnicalConfig(
  input: string,
): boolean {
  if (input.trim() === "") {
    return false;
  }

  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Parse raw textarea input, fail-closed. Use for initial parse before lock.
 */
export function parseLabTechnicalConfigInput(rawInput: string): unknown {
  return parseLabConfigInput(rawInput);
}
