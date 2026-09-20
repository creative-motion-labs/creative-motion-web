/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/cv-quality-diagnostics.test.ts"
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areNormalizedCoordsInCameraFrame,
  isWristLandmarkDataAvailable,
  resolveCvQualityDiagnostic,
} from "./cv-quality-diagnostics";

const EMPTY_SNAPSHOT = {
  status: "acquiring" as const,
  rightWristVisibility: null,
  leftWristVisibility: null,
  rightWristCoords: null,
  leftWristCoords: null,
};

describe("areNormalizedCoordsInCameraFrame", () => {
  it("returns null checks when coordinates are unavailable", () => {
    assert.deepEqual(areNormalizedCoordsInCameraFrame(null), {
      xInFrame: null,
      yInFrame: null,
      coordsInFrame: null,
    });
  });

  it("accepts boundary values 0 and 1", () => {
    assert.deepEqual(areNormalizedCoordsInCameraFrame({ x: 0, y: 1 }), {
      xInFrame: true,
      yInFrame: true,
      coordsInFrame: true,
    });
  });

  it("rejects out-of-frame normalized coordinates", () => {
    assert.deepEqual(areNormalizedCoordsInCameraFrame({ x: -0.01, y: 0.5 }), {
      xInFrame: false,
      yInFrame: true,
      coordsInFrame: false,
    });
    assert.deepEqual(areNormalizedCoordsInCameraFrame({ x: 0.5, y: 1.01 }), {
      xInFrame: true,
      yInFrame: false,
      coordsInFrame: false,
    });
  });

  it("rejects non-finite coordinates", () => {
    assert.deepEqual(areNormalizedCoordsInCameraFrame({ x: Number.NaN, y: 0.5 }), {
      xInFrame: false,
      yInFrame: true,
      coordsInFrame: false,
    });
  });
});

describe("isWristLandmarkDataAvailable", () => {
  it("is false when all wrist evidence is null", () => {
    assert.equal(isWristLandmarkDataAvailable(EMPTY_SNAPSHOT), false);
  });

  it("is true when any wrist visibility or coordinate is present during active acquisition", () => {
    assert.equal(
      isWristLandmarkDataAvailable({
        ...EMPTY_SNAPSHOT,
        rightWristVisibility: 0.8,
      }),
      true,
    );
    assert.equal(
      isWristLandmarkDataAvailable({
        ...EMPTY_SNAPSHOT,
        leftWristCoords: { x: 0.3, y: 0.5 },
      }),
      true,
    );
  });

  it("is false when retained wrist evidence exists but detector status is idle", () => {
    assert.equal(
      isWristLandmarkDataAvailable({
        status: "idle",
        rightWristVisibility: 0.91,
        leftWristVisibility: 0.42,
        rightWristCoords: { x: 0.72, y: 0.51 },
        leftWristCoords: { x: 0.28, y: 0.49 },
      }),
      false,
    );
  });
});

describe("resolveCvQualityDiagnostic", () => {
  it("assembles snapshot evidence and live video resolution read-only", () => {
    const diagnostic = resolveCvQualityDiagnostic(
      {
        status: "acquiring",
        rightWristVisibility: 0.91,
        leftWristVisibility: 0.42,
        rightWristCoords: { x: 0.72, y: 0.51 },
        leftWristCoords: { x: 0.28, y: 0.49 },
      },
      640,
      480,
    );

    assert.deepEqual(diagnostic.cameraResolution, { width: 640, height: 480 });
    assert.equal(diagnostic.detectorStatus, "acquiring");
    assert.equal(diagnostic.wristLandmarkDataAvailable, true);
    assert.equal(diagnostic.rightWristVisibility, 0.91);
    assert.equal(diagnostic.leftWristVisibility, 0.42);
    assert.deepEqual(diagnostic.rightWristCoords, { x: 0.72, y: 0.51 });
    assert.deepEqual(diagnostic.leftWristCoords, { x: 0.28, y: 0.49 });
    assert.equal(diagnostic.rightEstimatedWristCoordsInFrame.coordsInFrame, true);
    assert.equal(diagnostic.leftEstimatedWristCoordsInFrame.coordsInFrame, true);
  });

  it("returns null camera resolution when video dimensions are not yet available", () => {
    const diagnostic = resolveCvQualityDiagnostic(EMPTY_SNAPSHOT, 0, 0);
    assert.equal(diagnostic.cameraResolution, null);
    assert.equal(diagnostic.wristLandmarkDataAvailable, false);
  });

  it("idle snapshot with retained stale wrist values is not reported as current evidence", () => {
    const diagnostic = resolveCvQualityDiagnostic(
      {
        status: "idle",
        rightWristVisibility: 0.91,
        leftWristVisibility: 0.42,
        rightWristCoords: { x: 0.72, y: 0.51 },
        leftWristCoords: { x: 0.28, y: 0.49 },
      },
      0,
      0,
    );

    assert.equal(diagnostic.detectorStatus, "idle");
    assert.equal(diagnostic.cameraResolution, null);
    assert.equal(diagnostic.wristLandmarkDataAvailable, false);
    assert.equal(diagnostic.rightWristVisibility, null);
    assert.equal(diagnostic.leftWristVisibility, null);
    assert.equal(diagnostic.rightWristCoords, null);
    assert.equal(diagnostic.leftWristCoords, null);
    assert.deepEqual(diagnostic.rightEstimatedWristCoordsInFrame, {
      xInFrame: null,
      yInFrame: null,
      coordsInFrame: null,
    });
    assert.deepEqual(diagnostic.leftEstimatedWristCoordsInFrame, {
      xInFrame: null,
      yInFrame: null,
      coordsInFrame: null,
    });
  });
});
