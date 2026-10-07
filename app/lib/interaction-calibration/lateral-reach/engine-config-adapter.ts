/**
 * Lateral Reach interaction-calibration — Slice 7: engine config adapter.
 *
 * Maps a geometry-ready calibration result plus caller-supplied tracking and
 * timing into the Lateral Reach engine config validator. Interaction
 * calibration wiring only — not measurement interpretation.
 *
 * Does NOT:
 * - invent tracking or timing defaults
 * - derive horizontal direction
 * - preprocess or clamp geometry
 * - wrap or translate validator failures
 * - import capture devices, pose runtimes, view libraries, or page layers
 */

import type { LateralReachCalibrationGeometryReadyResult } from "./types";
import {
  validateLateralReachConfig,
  type LateralReachConfigValidationResult,
  type LateralReachTimingConfig,
  type LateralReachTrackingConfig,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";

/**
 * Build a LateralReachConfigValidationResult from ready calibration geometry
 * and explicit tracking/timing inputs. Semantics are owned entirely by
 * validateLateralReachConfig.
 */
export function buildLateralReachEngineConfig(
  calibration: LateralReachCalibrationGeometryReadyResult,
  tracking: LateralReachTrackingConfig,
  timing: LateralReachTimingConfig,
): LateralReachConfigValidationResult {
  const candidate = {
    testedSide: calibration.testedSide,
    startingZone: calibration.frozenGeometry.startingZone,
    fixedTarget: calibration.frozenGeometry.fixedTarget,
    tracking,
    timing,
  };

  return validateLateralReachConfig(candidate);
}
