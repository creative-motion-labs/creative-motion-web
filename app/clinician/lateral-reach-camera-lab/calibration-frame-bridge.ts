/**
 * Lateral Reach Camera Lab — Slice 19: calibration frame bridge.
 *
 * Connects acquisition-only camera observations (Slice 14 seam on the
 * detector) to the existing Slice 12 sample adapter and Slice 11
 * calibration controller.
 *
 * Camera observation → Slice 12 sample adapter → Slice 11 controller →
 * terminal calibration outcome.
 *
 * Does NOT own: camera technology, engine config, controller lifecycle,
 * calibration math/geometry, direction intention, framing validity,
 * numeric production thresholds, timestamp repair, or React
 * ownership/lifecycle (see page.tsx). No ENGINE activation.
 */

import type { LateralReachCameraAcquisitionObservation } from "@/app/lib/cv/lateral-reach-camera-detector";
import { resolveLateralReachCalibrationSampleFromFrame } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-camera-sample-adapter";
import {
  submitLateralReachCalibrationSample,
  type LateralReachCalibrationControllerSample,
  type LateralReachCalibrationControllerState,
  type LateralReachCalibrationSampleDisposition,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

/**
 * Resolve one calibration controller sample from a camera acquisition
 * observation. testedSide and minWristVisibility are caller-frozen values —
 * this function does not read mutable UI state and performs no timestamp
 * repair, x inversion, or direction inference.
 */
export function resolveLateralReachCalibrationSampleFromObservation(
  observation: LateralReachCameraAcquisitionObservation,
  testedSide: UpperLimbSide,
  minWristVisibility: number,
): LateralReachCalibrationControllerSample {
  if (observation.frame === null) {
    return {
      atMs: observation.capturedAtMs,
      wrist: null,
      trackingValid: false,
    };
  }

  return resolveLateralReachCalibrationSampleFromFrame(
    observation.frame,
    testedSide,
    minWristVisibility,
  );
}

/**
 * Bridge one camera acquisition observation into the active Slice 11
 * controller. Always uses the controller's own frozen testedSide — never a
 * separately supplied or mutable UI value.
 */
export function submitLateralReachCalibrationObservation(
  state: LateralReachCalibrationControllerState,
  observation: LateralReachCameraAcquisitionObservation,
  minWristVisibility: number,
): {
  state: LateralReachCalibrationControllerState;
  disposition: LateralReachCalibrationSampleDisposition;
} {
  const sample = resolveLateralReachCalibrationSampleFromObservation(
    observation,
    state.testedSide,
    minWristVisibility,
  );

  return submitLateralReachCalibrationSample(state, sample);
}
