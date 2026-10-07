/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/calibration-acquisition-diagnostics.test.ts"
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LateralReachCameraAcquisitionObservation } from "@/app/lib/cv/lateral-reach-camera-detector";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence/types";
import { resolveLateralReachCalibrationSampleFromObservation } from "./calibration-frame-bridge";
import {
  resolveCalibrationAcquisitionDiagnostics,
  type CalibrationAcquisitionDetectorSnapshotEvidence,
} from "./calibration-acquisition-diagnostics";

const TEST_MIN_WRIST_VISIBILITY = 0.4;

const EMPTY_DETECTOR_SNAPSHOT: CalibrationAcquisitionDetectorSnapshotEvidence = {
  status: "acquiring",
  rightWristVisibility: 0.55,
  leftWristVisibility: 0.45,
  rightWristCoords: { x: 0.7, y: 0.5 },
  leftWristCoords: { x: 0.3, y: 0.5 },
};

type FrameJointOverrides = {
  x?: number;
  y?: number;
  visibility?: number;
  present?: boolean;
};

function buildTestFrame(
  capturedAtMs: number,
  options: {
    left?: FrameJointOverrides | null;
    right?: FrameJointOverrides | null;
  } = {},
): NormalizedMotionFrame {
  const joints: NormalizedMotionFrame["joints"] = {};

  for (const [side, overrides] of [
    ["left", options.left],
    ["right", options.right],
  ] as const) {
    if (overrides === null || overrides === undefined) continue;
    const jointId: JointId = side === "left" ? "left_wrist" : "right_wrist";
    joints[jointId] = {
      landmark: {
        x: overrides.x ?? 0.3,
        y: overrides.y ?? 0.5,
      },
      confidence: {
        visibility: overrides.visibility ?? 0.9,
        present: overrides.present ?? true,
      },
    };
  }

  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      kind: "web_camera_pose",
      capturedAtMs,
      frameIndex: 0,
      coordinateSpace: "normalized_2d",
    },
    joints,
  };
}

function observation(
  capturedAtMs: number,
  frame: NormalizedMotionFrame | null,
): LateralReachCameraAcquisitionObservation {
  return { capturedAtMs, frame };
}

function resolveForSide(
  obs: LateralReachCameraAcquisitionObservation,
  testedSide: "left" | "right",
) {
  return resolveCalibrationAcquisitionDiagnostics({
    observation: obs,
    testedSide,
    minWristVisibility: TEST_MIN_WRIST_VISIBILITY,
    detectorSnapshot: EMPTY_DETECTOR_SNAPSHOT,
  });
}

function assertAgreesWithSampleResolver(
  diagnostic: ReturnType<typeof resolveCalibrationAcquisitionDiagnostics>,
  obs: LateralReachCameraAcquisitionObservation,
  testedSide: "left" | "right",
) {
  const sample = resolveLateralReachCalibrationSampleFromObservation(
    obs,
    testedSide,
    TEST_MIN_WRIST_VISIBILITY,
  );
  assert.equal(diagnostic.trackingValid, sample.trackingValid);
  if (sample.trackingValid) {
    assert.equal(diagnostic.reasonLabel, "tracking_valid");
  } else {
    assert.notEqual(diagnostic.reasonLabel, "tracking_valid");
  }
}

describe("resolveCalibrationAcquisitionDiagnostics — provable reason labels", () => {
  it("normalized_frame_unavailable when observation.frame is null", () => {
    const obs = observation(100, null);
    const diagnostic = resolveForSide(obs, "right");
    assert.equal(diagnostic.normalizedFramePresent, false);
    assert.equal(diagnostic.trackingValid, false);
    assert.equal(diagnostic.reasonLabel, "normalized_frame_unavailable");
    assertAgreesWithSampleResolver(diagnostic, obs, "right");
  });

  it("selected_wrist_missing when frame present but tested wrist absent", () => {
    const obs = observation(
      100,
      buildTestFrame(100, { left: { x: 0.3, y: 0.5, visibility: 0.9 } }),
    );
    const diagnostic = resolveForSide(obs, "right");
    assert.equal(diagnostic.normalizedFramePresent, true);
    assert.equal(diagnostic.selectedWristPresentInFrame, false);
    assert.equal(diagnostic.trackingValid, false);
    assert.equal(diagnostic.reasonLabel, "selected_wrist_missing");
    assertAgreesWithSampleResolver(diagnostic, obs, "right");
  });

  it("confidence_not_present when joint exists with present false", () => {
    const obs = observation(
      100,
      buildTestFrame(100, {
        right: { x: 0.7, y: 0.5, visibility: 0.9, present: false },
      }),
    );
    const diagnostic = resolveForSide(obs, "right");
    assert.equal(diagnostic.selectedWristPresentInFrame, true);
    assert.equal(diagnostic.selectedWristConfidencePresent, false);
    assert.equal(diagnostic.trackingValid, false);
    assert.equal(diagnostic.reasonLabel, "confidence_not_present");
    assertAgreesWithSampleResolver(diagnostic, obs, "right");
  });

  it("visibility_below_threshold when present true and visibility below frozen min", () => {
    const obs = observation(
      100,
      buildTestFrame(100, {
        right: { x: 0.7, y: 0.5, visibility: 0.39, present: true },
      }),
    );
    const diagnostic = resolveForSide(obs, "right");
    assert.equal(diagnostic.selectedWristConfidencePresent, true);
    assert.equal(diagnostic.selectedWristVisibility, 0.39);
    assert.equal(diagnostic.minWristVisibility, TEST_MIN_WRIST_VISIBILITY);
    assert.equal(diagnostic.trackingValid, false);
    assert.equal(diagnostic.reasonLabel, "visibility_below_threshold");
    assertAgreesWithSampleResolver(diagnostic, obs, "right");
  });

  it("tracking_valid when sample resolver accepts the wrist", () => {
    const obs = observation(
      100,
      buildTestFrame(100, {
        right: { x: 0.7, y: 0.5, visibility: 0.41, present: true },
      }),
    );
    const diagnostic = resolveForSide(obs, "right");
    assert.equal(diagnostic.trackingValid, true);
    assert.equal(diagnostic.reasonLabel, "tracking_valid");
    assertAgreesWithSampleResolver(diagnostic, obs, "right");
  });

  it("reasonLabel is null when invalid but no provable post-normalization label", () => {
    const obs = observation(
      100,
      buildTestFrame(100, {
        right: { x: 1.01, y: 0.5, visibility: 0.9, present: true },
      }),
    );
    const diagnostic = resolveForSide(obs, "right");
    assert.equal(diagnostic.selectedWristPresentInFrame, true);
    assert.equal(diagnostic.trackingValid, false);
    assert.equal(diagnostic.reasonLabel, null);
    assertAgreesWithSampleResolver(diagnostic, obs, "right");
  });
});

describe("resolveCalibrationAcquisitionDiagnostics — evidence fields", () => {
  it("copies raw detector snapshot fields verbatim", () => {
    const snapshot: CalibrationAcquisitionDetectorSnapshotEvidence = {
      status: "acquiring",
      rightWristVisibility: 0.88,
      leftWristVisibility: 0.22,
      rightWristCoords: { x: 0.71, y: 0.52 },
      leftWristCoords: { x: 0.29, y: 0.48 },
    };
    const diagnostic = resolveCalibrationAcquisitionDiagnostics({
      observation: observation(42, null),
      testedSide: "left",
      minWristVisibility: TEST_MIN_WRIST_VISIBILITY,
      detectorSnapshot: snapshot,
    });
    assert.equal(diagnostic.detectorStatus, "acquiring");
    assert.equal(diagnostic.rawRightWristVisibility, 0.88);
    assert.equal(diagnostic.rawLeftWristVisibility, 0.22);
    assert.deepEqual(diagnostic.rawRightWristCoords, { x: 0.71, y: 0.52 });
    assert.deepEqual(diagnostic.rawLeftWristCoords, { x: 0.29, y: 0.48 });
  });

  it("uses caller frozen testedSide for selected wrist evidence", () => {
    const frame = buildTestFrame(10, {
      left: { x: 0.25, y: 0.4, visibility: 0.9 },
      right: { x: 0.75, y: 0.6, visibility: 0.9 },
    });
    const leftDiagnostic = resolveCalibrationAcquisitionDiagnostics({
      observation: observation(10, frame),
      testedSide: "left",
      minWristVisibility: TEST_MIN_WRIST_VISIBILITY,
      detectorSnapshot: EMPTY_DETECTOR_SNAPSHOT,
    });
    const rightDiagnostic = resolveCalibrationAcquisitionDiagnostics({
      observation: observation(10, frame),
      testedSide: "right",
      minWristVisibility: TEST_MIN_WRIST_VISIBILITY,
      detectorSnapshot: EMPTY_DETECTOR_SNAPSHOT,
    });
    assert.equal(leftDiagnostic.testedSide, "left");
    assert.equal(rightDiagnostic.testedSide, "right");
    assert.equal(leftDiagnostic.trackingValid, true);
    assert.equal(rightDiagnostic.trackingValid, true);
  });

  it("echoes frozen minWristVisibility from input without defaults", () => {
    const diagnostic = resolveCalibrationAcquisitionDiagnostics({
      observation: observation(1, null),
      testedSide: "right",
      minWristVisibility: 0.73,
      detectorSnapshot: EMPTY_DETECTOR_SNAPSHOT,
    });
    assert.equal(diagnostic.minWristVisibility, 0.73);
  });
});

describe("resolveCalibrationAcquisitionDiagnostics — resolver agreement", () => {
  const cases: Array<{
    label: string;
    testedSide: "left" | "right";
    frame: NormalizedMotionFrame | null;
  }> = [
    { label: "null frame", testedSide: "right", frame: null },
    {
      label: "missing tested wrist",
      testedSide: "left",
      frame: buildTestFrame(5, { right: { visibility: 0.9 } }),
    },
    {
      label: "present false",
      testedSide: "right",
      frame: buildTestFrame(5, { right: { present: false, visibility: 0.9 } }),
    },
    {
      label: "below threshold",
      testedSide: "left",
      frame: buildTestFrame(5, { left: { visibility: 0.1, present: true } }),
    },
    {
      label: "valid",
      testedSide: "right",
      frame: buildTestFrame(5, { right: { visibility: 0.95, present: true } }),
    },
    {
      label: "invalid coords unclassified",
      testedSide: "right",
      frame: buildTestFrame(5, { right: { x: -0.01, visibility: 0.95, present: true } }),
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.label}: trackingValid agrees with sample resolver`, () => {
      const obs = observation(5, testCase.frame);
      const diagnostic = resolveCalibrationAcquisitionDiagnostics({
        observation: obs,
        testedSide: testCase.testedSide,
        minWristVisibility: TEST_MIN_WRIST_VISIBILITY,
        detectorSnapshot: EMPTY_DETECTOR_SNAPSHOT,
      });
      assertAgreesWithSampleResolver(diagnostic, obs, testCase.testedSide);
    });
  }
});
