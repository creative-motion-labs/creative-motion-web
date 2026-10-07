/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/upper-limb-lateral-reach-capture-calibration-policy.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  type LateralReachCalibrationCaptureFailedResult,
  type LateralReachCalibrationGeometryReadyResult,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import type { LateralReachCalibrationControllerOutcome } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import {
  CLINICIAN_CALIBRATION_FAILURE_MESSAGE,
  checkClinicianCalibrationRetryEligibility,
  getClinicianCalibrationFailureMessage,
  shouldRetainAcquisitionAfterTerminalCalibration,
  shouldStopDetectorAfterTerminalCalibrationObservation,
} from "./upper-limb-lateral-reach-capture-calibration-policy";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const READY_OUTCOME: LateralReachCalibrationControllerOutcome = {
  kind: "result",
  result: {
    schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
    testedSide: "right",
    captureOutcome: "valid",
    geometryOutcome: "ready",
    observations: {
      startWrist: { x: 0.3, y: 0.5 },
      heldEndpoint: { x: 0.7, y: 0.5 },
    },
    derivedMeasurements: {
      rawDeltaX: 0.4,
      expectedHorizontalDirectionSign: 1,
      directionAlignedMagnitude: 0.4,
    },
    frozenGeometry: {
      startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
      fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
    },
  } satisfies LateralReachCalibrationGeometryReadyResult,
};

const FAILED_OUTCOME: LateralReachCalibrationControllerOutcome = {
  kind: "result",
  result: {
    schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
    testedSide: "right",
    captureOutcome: "failed",
    geometryOutcome: "not_applicable",
    failureReasons: ["start_timeout"],
  } satisfies LateralReachCalibrationCaptureFailedResult,
};

describe("upper-limb-lateral-reach-capture-calibration-policy", () => {
  it("does not stop the detector after failed terminal calibration", () => {
    assert.equal(shouldStopDetectorAfterTerminalCalibrationObservation(FAILED_OUTCOME), false);
  });

  it("does not stop the detector after successful terminal calibration", () => {
    assert.equal(shouldStopDetectorAfterTerminalCalibrationObservation(READY_OUTCOME), false);
  });

  it("surfaces a clinician-safe message for failed calibration", () => {
    assert.equal(getClinicianCalibrationFailureMessage(FAILED_OUTCOME), CLINICIAN_CALIBRATION_FAILURE_MESSAGE);
  });

  it("does not surface a failure message for successful calibration", () => {
    assert.equal(getClinicianCalibrationFailureMessage(READY_OUTCOME), null);
  });

  it("retains acquisition after successful calibration", () => {
    assert.equal(shouldRetainAcquisitionAfterTerminalCalibration(READY_OUTCOME), true);
  });

  it("allows retry calibration while acquisition is still live", () => {
    const eligibility = checkClinicianCalibrationRetryEligibility(
      "acquiring",
      false,
      false,
      false,
      true,
      true,
      false,
    );
    assert.equal(eligibility.allowed, true);
  });

  it("blocks retry when an engine is already active", () => {
    const eligibility = checkClinicianCalibrationRetryEligibility(
      "acquiring",
      false,
      false,
      false,
      true,
      true,
      true,
    );
    assert.equal(eligibility.allowed, false);
    assert.equal(eligibility.reason, "engine_already_active");
  });

  it("wires clinician capture shell to retain acquisition on terminal calibration", () => {
    const source = readFileSync(
      join(ROOT, "app/components/clinician/upper-limb-motor-screen/UpperLimbLateralReachCaptureSession.tsx"),
      "utf8",
    );
    assert.match(source, /shouldStopDetectorAfterTerminalCalibrationObservation/);
    assert.match(source, /getClinicianCalibrationFailureMessage/);
    assert.doesNotMatch(source, /shouldRetainDetectorAcquisitionForTerminalCalibration\(outcome\)/);
  });
});
