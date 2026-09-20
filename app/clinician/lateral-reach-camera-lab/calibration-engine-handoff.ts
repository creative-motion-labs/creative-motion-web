/**
 * Lateral Reach Camera Lab — Slice 20: calibration → engine handoff eligibility.
 *
 * Pure helper: validates/narrows a completed Slice 18/19 calibration outcome
 * and the Slice 17 locked technical config into the exact inputs Slice 7's
 * buildLateralReachEngineConfig needs. Horizontal direction ownership stays
 * entirely inside the existing engine validator; this module never touches
 * geometry coordinates at all.
 *
 * Does NOT:
 * - import React, the camera detector class, or any capture device API
 * - mutate the detector or start the engine
 * - derive horizontal direction
 * - invent tracking/timing defaults
 * - run on a deferred execution path
 */

import type { LateralReachCalibrationControllerOutcome } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { LateralReachCameraStatus } from "@/app/lib/cv/lateral-reach-camera-detector";
import type {
  LateralReachTimingConfig,
  LateralReachTrackingConfig,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import type { LateralReachCalibrationGeometryReadyResult } from "@/app/lib/interaction-calibration/lateral-reach/types";
import type { LabTechnicalConfigLock } from "./technical-config-intake";
import type { CalibrationLifecycle } from "./calibration-attempt-runtime";

export type LateralReachEngineHandoffInputs = {
  readonly calibrationOutcome: LateralReachCalibrationControllerOutcome | null;
  readonly configLock: LabTechnicalConfigLock | null;
  readonly detectorStatus: LateralReachCameraStatus;
  readonly engineActive: boolean;
  readonly calibrationLifecycle: CalibrationLifecycle;
};

export type LateralReachEngineHandoffBlockReason =
  | "detector_not_acquiring"
  | "engine_already_active"
  | "no_calibration_outcome"
  | "calibration_cancelled"
  | "capture_failed"
  | "geometry_not_constructible"
  | "config_lock_missing"
  | "calibration_lifecycle_not_idle";

export type LateralReachEngineHandoffResolution =
  | {
      readonly ok: true;
      readonly readyResult: LateralReachCalibrationGeometryReadyResult;
      readonly tracking: LateralReachTrackingConfig;
      readonly timing: LateralReachTimingConfig;
    }
  | {
      readonly ok: false;
      readonly reason: LateralReachEngineHandoffBlockReason;
    };

export type CalibrationHandoffOutcomeBlockReason =
  | "no_calibration_outcome"
  | "calibration_cancelled"
  | "capture_failed"
  | "geometry_not_constructible";

export type CalibrationHandoffReadiness =
  | { readonly ready: true; readonly result: LateralReachCalibrationGeometryReadyResult }
  | {
      readonly ready: false;
      readonly reason: CalibrationHandoffOutcomeBlockReason;
    };

/**
 * Single source of truth for calibration-outcome handoff readiness.
 * Classifies terminal Slice 18/19 outcomes into ready geometry or a
 * fail-closed block reason reused by engine handoff and acquisition policy.
 */
export function classifyCalibrationHandoffReadiness(
  outcome: LateralReachCalibrationControllerOutcome | null,
): CalibrationHandoffReadiness {
  if (outcome === null) {
    return { ready: false, reason: "no_calibration_outcome" };
  }

  if (outcome.kind === "cancelled") {
    return { ready: false, reason: "calibration_cancelled" };
  }

  const { result } = outcome;

  if (result.captureOutcome === "failed") {
    return { ready: false, reason: "capture_failed" };
  }

  if (result.geometryOutcome === "not_constructible") {
    return { ready: false, reason: "geometry_not_constructible" };
  }

  return { ready: true, result };
}

/**
 * Whether a terminal calibration result should retain detector acquisition
 * for explicit Slice 20 engine handoff. Non-handoff-ready terminals must stop.
 */
export function shouldRetainDetectorAcquisitionForTerminalCalibration(
  outcome: LateralReachCalibrationControllerOutcome | null,
): boolean {
  return classifyCalibrationHandoffReadiness(outcome).ready;
}

/**
 * Resolve whether a Slice 7 engine handoff is eligible right now, and if so,
 * return the exact ready-geometry result plus locked tracking/timing to pass
 * into buildLateralReachEngineConfig. Fails closed on any ineligible input.
 */
export function resolveLateralReachEngineHandoffInputs(
  inputs: LateralReachEngineHandoffInputs,
): LateralReachEngineHandoffResolution {
  if (inputs.detectorStatus !== "acquiring") {
    return { ok: false, reason: "detector_not_acquiring" };
  }

  if (inputs.engineActive) {
    return { ok: false, reason: "engine_already_active" };
  }

  const readiness = classifyCalibrationHandoffReadiness(inputs.calibrationOutcome);
  if (!readiness.ready) {
    return { ok: false, reason: readiness.reason };
  }

  if (inputs.configLock === null) {
    return { ok: false, reason: "config_lock_missing" };
  }

  if (inputs.calibrationLifecycle !== "idle") {
    return { ok: false, reason: "calibration_lifecycle_not_idle" };
  }

  return {
    ok: true,
    readyResult: readiness.result,
    tracking: inputs.configLock.lockedConfig.tracking,
    timing: inputs.configLock.lockedConfig.timing,
  };
}
