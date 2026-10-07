/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/types.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as domain from "@/app/lib/interaction-calibration/lateral-reach";
import {
  LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  LATERAL_REACH_CAPTURE_FAILURE_REASONS,
  LATERAL_REACH_GEOMETRY_BLOCKERS,
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachCalibrationObservations,
  type LateralReachCalibrationResult,
  type LateralReachDerivedMeasurements,
  type LateralReachFrozenZone,
} from "@/app/lib/interaction-calibration/lateral-reach/types";

function assertUniqueStrings(values: readonly string[], label: string): void {
  assert.equal(new Set(values).size, values.length, `${label} must contain unique entries`);
}

const observations: LateralReachCalibrationObservations = {
  startWrist: { x: 0.32, y: 0.55 },
  heldEndpoint: { x: 0.48, y: 0.54 },
};

const derivedMeasurements: LateralReachDerivedMeasurements = {
  rawDeltaX: 0.16,
  expectedHorizontalDirectionSign: 1,
  directionAlignedMagnitude: 0.16,
};

const frozenGeometry: {
  startingZone: LateralReachFrozenZone;
  fixedTarget: LateralReachFrozenZone;
} = {
  startingZone: {
    point: { x: observations.startWrist.x, y: observations.startWrist.y },
    radius: 0.05,
  },
  fixedTarget: {
    point: { x: observations.heldEndpoint.x, y: observations.heldEndpoint.y },
    radius: 0.06,
  },
};

describe("schema version", () => {
  it("locks the Slice 1 schema version string", () => {
    assert.equal(LATERAL_REACH_CALIBRATION_SCHEMA_VERSION, "lateral-reach-calibration/v1");
  });
});

describe("closed runtime vocabularies", () => {
  it("keeps capture-failure reasons unique and includes noise-floor technical failure", () => {
    assertUniqueStrings(LATERAL_REACH_CAPTURE_FAILURE_REASONS, "capture failure reasons");
    assert.ok(
      LATERAL_REACH_CAPTURE_FAILURE_REASONS.includes("displacement_indistinguishable_from_noise"),
    );
    assert.equal(
      (LATERAL_REACH_CAPTURE_FAILURE_REASONS as readonly string[]).includes(
        "comfortable_reach_too_small",
      ),
      false,
    );
  });

  it("keeps geometry blockers unique, separate, and algorithm-agnostic", () => {
    assertUniqueStrings(LATERAL_REACH_GEOMETRY_BLOCKERS, "geometry blockers");
    assert.deepEqual([...LATERAL_REACH_GEOMETRY_BLOCKERS], [
      "geometry_constraints_unsatisfied",
      "engine_config_invalid",
    ]);
    for (const blocker of LATERAL_REACH_GEOMETRY_BLOCKERS) {
      assert.equal(
        (LATERAL_REACH_CAPTURE_FAILURE_REASONS as readonly string[]).includes(blocker),
        false,
      );
    }
    assert.equal(
      (LATERAL_REACH_GEOMETRY_BLOCKERS as readonly string[]).includes(
        "interaction_fraction_reduction_exhausted",
      ),
      false,
    );
    assert.equal(
      (LATERAL_REACH_GEOMETRY_BLOCKERS as readonly string[]).includes(
        "insufficient_separation_for_current_geometry",
      ),
      false,
    );
  });

  it("locks noise-floor vocabulary kind", () => {
    assert.equal(LATERAL_REACH_NOISE_FLOOR_KIND, "direction_aligned_magnitude_noise_floor");
  });

  it("excludes prohibited clinical and premature difficulty vocabulary", () => {
    const vocabulary = new Set<string>([
      ...LATERAL_REACH_CAPTURE_FAILURE_REASONS,
      ...LATERAL_REACH_GEOMETRY_BLOCKERS,
      LATERAL_REACH_NOISE_FLOOR_KIND,
      ...Object.keys(domain),
    ]);
    const prohibited = [
      "rom",
      "limited_rom",
      "impairment",
      "severity",
      "capacity",
      "safe_maximum",
      "recovery_score",
      "signed_displacement",
      "signedDisplacement",
      "comfortable_reach_too_small",
      "comfortableEndpoint",
      "short",
      "standard",
      "long",
      "LATERAL_REACH_INTERACTION_GEOMETRY_LABELS",
      "requestedInteractionFraction",
      "attemptedInteractionFraction",
      "effectiveInteractionFraction",
      "interaction_fraction_reduced_for_camera_margin",
      "LATERAL_REACH_TECHNICAL_GEOMETRY_ADJUSTMENT_KINDS",
    ];
    for (const term of prohibited) {
      assert.equal(vocabulary.has(term), false, `${term} must not be exported/vocabulary`);
    }
  });
});

describe("outcome and observation contracts", () => {
  it("keeps the three legal outcome combinations representable", () => {
    const failed: LateralReachCalibrationResult = {
      schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
      testedSide: "right",
      captureOutcome: "failed",
      geometryOutcome: "not_applicable",
      failureReasons: ["endpoint_hold_not_confirmed"],
    };
    const notConstructible: LateralReachCalibrationResult = {
      schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
      testedSide: "right",
      captureOutcome: "valid",
      geometryOutcome: "not_constructible",
      observations,
      derivedMeasurements,
      geometryBlockers: ["geometry_constraints_unsatisfied"],
    };
    const ready: LateralReachCalibrationResult = {
      schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
      testedSide: "left",
      captureOutcome: "valid",
      geometryOutcome: "ready",
      observations,
      derivedMeasurements,
      frozenGeometry,
    };

    assert.equal(failed.captureOutcome, "failed");
    assert.equal(failed.geometryOutcome, "not_applicable");
    assert.equal(notConstructible.captureOutcome, "valid");
    assert.equal(notConstructible.geometryOutcome, "not_constructible");
    assert.equal(ready.captureOutcome, "valid");
    assert.equal(ready.geometryOutcome, "ready");
    assert.equal("frozenGeometry" in ready, true);
  });

  it("uses factual heldEndpoint naming and omits foundational interactionFraction fields", () => {
    assert.equal("heldEndpoint" in observations, true);
    assert.equal("comfortableEndpoint" in observations, false);
    assert.equal("startWrist" in observations, true);

    const ready: LateralReachCalibrationResult = {
      schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
      testedSide: "left",
      captureOutcome: "valid",
      geometryOutcome: "ready",
      observations,
      derivedMeasurements,
      frozenGeometry,
    };
    assert.equal("requestedInteractionFraction" in ready, false);
    assert.equal("attemptedInteractionFraction" in ready, false);
    assert.equal("effectiveInteractionFraction" in ready, false);
    assert.equal("technicalAdjustments" in ready, false);
    assert.equal("interactionGeometryLabel" in ready, false);
    assert.equal("startingZone" in ready, false);
    assert.equal("fixedTarget" in ready, false);
    assert.equal("frozenGeometry" in ready, true);
  });
});
