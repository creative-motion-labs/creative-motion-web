/**
 * Lateral Reach Camera Lab — Slice 18: explicit calibration startup + acquisition ownership.
 *
 * Production runtime helpers for safe one-shot calibration attempt initiation.
 * Prevents stale async getUserMedia/acquisition from mutating newer state.
 *
 * Architecture:
 * - Generation-based startup gate (prevents double-start, stale mutation)
 * - Exactly-once active controller ownership (prevents double-cancel)
 * - Locked input snapshot → Slice 11 controller creation
 * - Explicit detector.startAcquisition ordering
 * - Fresh performance.now() capture AFTER acquisition resolves
 *
 * Does NOT:
 * - Submit frames (Slice 19)
 * - Bridge frame→sample (Slice 19)
 * - Progress calibration from frames (Slice 19)
 * - Start engine (Slice 20)
 * - Create parallel lifecycle state machine
 */

import type {
  LateralReachCalibrationControllerInput,
  LateralReachCalibrationControllerState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import {
  createLateralReachCalibrationController,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { LateralReachCameraStatus } from "@/app/lib/cv/lateral-reach-camera-detector";

// ---------------------------------------------------------------------------
// Runtime gate (prevents stale async mutation)
// ---------------------------------------------------------------------------

/**
 * Generation-based startup ownership gate.
 * Prevents stale async acquisition continuations from mutating state.
 */
export type CalibrationRuntimeGate = {
  generation: number;
  startupOwner: number | null;
};

export function createCalibrationRuntimeGate(): CalibrationRuntimeGate {
  return {
    generation: 0,
    startupOwner: null,
  };
}

/**
 * Attempt to begin calibration startup.
 * Returns generation number if successful, or null if startup already owned.
 */
export function tryBeginCalibrationStartup(
  gate: CalibrationRuntimeGate,
): number | null {
  if (gate.startupOwner !== null) {
    return null; // Already owned, no mutation
  }

  gate.generation += 1;
  gate.startupOwner = gate.generation;
  return gate.generation;
}

/**
 * Invalidate calibration runtime (cancel/stop/error).
 * Increments generation and releases ownership.
 */
export function invalidateCalibrationRuntime(gate: CalibrationRuntimeGate): void {
  gate.generation += 1;
  gate.startupOwner = null;
}

/**
 * Check if a startup generation is still current.
 * Returns true only if BOTH generation matches AND ownership matches.
 */
export function isCalibrationStartupCurrent(
  gate: CalibrationRuntimeGate,
  generation: number,
): boolean {
  return gate.generation === generation && gate.startupOwner === generation;
}

/**
 * Release calibration startup ownership (called in finally blocks).
 * Only clears startupOwner if the supplied generation still owns it.
 * Old finally blocks cannot clear newer owners.
 */
export function releaseCalibrationStartup(
  gate: CalibrationRuntimeGate,
  generation: number,
): void {
  if (gate.startupOwner === generation) {
    gate.startupOwner = null;
  }
}

// ---------------------------------------------------------------------------
// Active controller ownership (exactly-once cancel)
// ---------------------------------------------------------------------------

/**
 * Mutable ref for active calibration controller.
 * Supports exactly-once cancellation semantics.
 */
export type ActiveCalibrationControllerOwner = {
  current: LateralReachCalibrationControllerState | null;
};

export function createActiveCalibrationControllerOwner(): ActiveCalibrationControllerOwner {
  return { current: null };
}

/**
 * Consume active calibration controller (exactly once).
 * Returns controller and clears ownership. Second call returns null.
 */
export function consumeActiveCalibrationController(
  owner: ActiveCalibrationControllerOwner,
): LateralReachCalibrationControllerState | null {
  const controller = owner.current;
  if (!controller) return null;

  owner.current = null;
  return controller;
}

// ---------------------------------------------------------------------------
// Host lifecycle (minimal coordination state)
// ---------------------------------------------------------------------------

export type CalibrationLifecycle = "idle" | "starting" | "active";

// ---------------------------------------------------------------------------
// Start eligibility
// ---------------------------------------------------------------------------

export type LegacyStartEligibility = {
  allowed: boolean;
  reason?: string;
};

/**
 * Check if legacy (non-calibration) start is eligible.
 * Allowed from idle or error, but not during calibration startup/active.
 */
export function checkLegacyStartEligibility(
  detectorStatus: LateralReachCameraStatus,
  legacyStartInProgress: boolean,
  calibrationStartupOwned: boolean,
  activeCalibrationExists: boolean,
): LegacyStartEligibility {
  if (legacyStartInProgress) {
    return { allowed: false, reason: "legacy_start_in_progress" };
  }

  if (calibrationStartupOwned) {
    return { allowed: false, reason: "calibration_startup_in_progress" };
  }

  if (activeCalibrationExists) {
    return { allowed: false, reason: "active_calibration_exists" };
  }

  if (detectorStatus !== "idle" && detectorStatus !== "error") {
    return { allowed: false, reason: "detector_not_idle_or_error" };
  }

  return { allowed: true };
}

export type CalibrationStartEligibility = {
  allowed: boolean;
  reason?: string;
};

/**
 * Check if calibration start is eligible.
 * Requires idle detector, no legacy start, no existing calibration, and both locks.
 */
export function checkCalibrationStartEligibility(
  detectorStatus: LateralReachCameraStatus,
  legacyStartInProgress: boolean,
  calibrationStartupOwned: boolean,
  activeCalibrationExists: boolean,
  attemptPlanLocked: boolean,
  technicalConfigLocked: boolean,
): CalibrationStartEligibility {
  if (legacyStartInProgress) {
    return { allowed: false, reason: "legacy_start_in_progress" };
  }

  if (calibrationStartupOwned) {
    return { allowed: false, reason: "calibration_startup_in_progress" };
  }

  if (activeCalibrationExists) {
    return { allowed: false, reason: "active_calibration_exists" };
  }

  if (!attemptPlanLocked) {
    return { allowed: false, reason: "attempt_plan_not_locked" };
  }

  if (!technicalConfigLocked) {
    return { allowed: false, reason: "technical_config_not_locked" };
  }

  if (detectorStatus !== "idle") {
    return { allowed: false, reason: "detector_not_idle" };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Configured controller creation
// ---------------------------------------------------------------------------

/**
 * Create a configured (not yet started) calibration controller from locked inputs.
 * Controller remains local to startup transaction. Throws on invalid configuration.
 */
export function createConfiguredCalibrationController(
  controllerInput: LateralReachCalibrationControllerInput,
): LateralReachCalibrationControllerState {
  return createLateralReachCalibrationController(controllerInput);
}

// ---------------------------------------------------------------------------
// Async startup transaction
// ---------------------------------------------------------------------------

export type StartupDependencies = {
  /** Async acquisition start (wraps detector.startAcquisition) */
  startAcquisition: () => Promise<void>;
  /** Sync detector stop */
  stopDetector: () => void;
  /** Get current detector status */
  getDetectorStatus: () => LateralReachCameraStatus;
  /** Get fresh timestamp (performance.now) */
  now: () => number;
  /** Start controller capture (Slice 11) */
  startController: (
    controller: LateralReachCalibrationControllerState,
    nowMs: number,
  ) => LateralReachCalibrationControllerState;
};

export type CalibrationStartupResult =
  | {
      kind: "active";
      capturingController: LateralReachCalibrationControllerState;
    }
  | {
      kind: "stale";
    }
  | {
      kind: "failed";
      error: string;
    };

/**
 * Execute calibration startup async transaction.
 *
 * CRITICAL ORDERING:
 * 1. await startAcquisition()
 * 2. Check ownership is still current
 * 3. Verify status === "acquiring"
 * 4. Capture fresh now()
 * 5. Start controller with fresh timestamp
 *
 * STALE SEMANTICS:
 * If ownership check fails at any point, return "stale" with ZERO mutation.
 * Stale transactions must not call stopDetector, now(), or startController.
 *
 * FAILURE SEMANTICS:
 * If acquisition rejects while still current, stop detector and return "failed".
 * If acquisition rejects while stale, return "stale" (do NOT stop detector).
 * If wrong status while current, stop detector and return "failed".
 */
export async function executeCalibrationStartupTransaction(
  gate: CalibrationRuntimeGate,
  generation: number,
  configuredController: LateralReachCalibrationControllerState,
  deps: StartupDependencies,
): Promise<CalibrationStartupResult> {
  // Step 1: Await acquisition (camera initialization, MediaPipe load, etc.)
  try {
    await deps.startAcquisition();
  } catch (err) {
    // Acquisition failed - check if still current
    if (!isCalibrationStartupCurrent(gate, generation)) {
      // Stale: do NOT stop detector (newer owner may exist)
      return { kind: "stale" };
    }

    // Still current: stop detector and fail
    deps.stopDetector();
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 2: Check ownership immediately after acquisition resolves
  if (!isCalibrationStartupCurrent(gate, generation)) {
    return { kind: "stale" }; // No mutation
  }

  // Step 3: Verify detector reached "acquiring" status
  const status = deps.getDetectorStatus();
  if (status !== "acquiring") {
    // Wrong status while current: stop and fail
    deps.stopDetector();
    return {
      kind: "failed",
      error: `detector_status_${status}_expected_acquiring`,
    };
  }

  // Step 4: Capture fresh timestamp AFTER acquisition
  const nowMs = deps.now();

  // Step 5: Start controller capture (Slice 11)
  let capturingController: LateralReachCalibrationControllerState;
  try {
    capturingController = deps.startController(configuredController, nowMs);
  } catch (err) {
    // Controller start failed while current: stop and fail
    deps.stopDetector();
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 6: Final ownership check before publishing (defensive)
  if (!isCalibrationStartupCurrent(gate, generation)) {
    // Stale owner: true no-op; do not stop a detector that may belong to a newer attempt.
    return { kind: "stale" };
  }

  return {
    kind: "active",
    capturingController,
  };
}
