/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/frozen-geometry.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachNoiseFloorConfig,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import { constructLateralReachFrozenGeometry } from "@/app/lib/interaction-calibration/lateral-reach/frozen-geometry";

function noiseFloor(
  minDirectionAlignedMagnitude: number,
): LateralReachNoiseFloorConfig {
  return {
    kind: LATERAL_REACH_NOISE_FLOOR_KIND,
    minDirectionAlignedMagnitude,
  };
}

const DEFAULT_RADII = {
  startingZoneRadius: 0.05,
  fixedTargetRadius: 0.05,
};

function construct(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sign: 1 | -1,
  floor = 0.05,
  radii = DEFAULT_RADII,
) {
  return constructLateralReachFrozenGeometry(
    start,
    end,
    sign,
    noiseFloor(floor),
    radii,
  );
}

describe("constructLateralReachFrozenGeometry — success", () => {
  it("constructs +1 geometry successfully", () => {
    const start = { x: 0.25, y: 0.5 };
    const end = { x: 0.75, y: 0.5 };
    const result = construct(start, end, 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.startingZone.point, { x: 0.25, y: 0.5 });
      assert.deepEqual(result.fixedTarget.point, { x: 0.75, y: 0.5 });
      assert.equal(result.startingZone.radius, 0.05);
      assert.equal(result.fixedTarget.radius, 0.05);
    }
  });

  it("constructs -1 geometry successfully", () => {
    const result = construct({ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.5 }, -1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.startingZone.point.x, 0.75);
      assert.equal(result.fixedTarget.point.x, 0.25);
    }
  });

  it("clones startingZone from startWrist and fixedTarget from heldEndpoint", () => {
    const start = { x: 0.2, y: 0.4 };
    const end = { x: 0.8, y: 0.6 };
    const result = construct(start, end, 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.startingZone.point, start);
      assert.notEqual(result.fixedTarget.point, end);
      assert.deepEqual(result.startingZone.point, { x: start.x, y: start.y });
      assert.deepEqual(result.fixedTarget.point, { x: end.x, y: end.y });
    }
  });

  it("preserves external radii exactly and does not mutate zoneRadii", () => {
    const radii = { startingZoneRadius: 0.04, fixedTargetRadius: 0.06 };
    const result = construct(
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
      1,
      0.05,
      radii,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.startingZone.radius, 0.04);
      assert.equal(result.fixedTarget.radius, 0.06);
    }
    assert.equal(radii.startingZoneRadius, 0.04);
    assert.equal(radii.fixedTargetRadius, 0.06);
  });

  it("is deterministic across repeated calls", () => {
    const a = construct({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1);
    const b = construct({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1);
    assert.deepEqual(a, b);
  });

  it("preserves raw coordinates with no 1-x mirroring", () => {
    const start = { x: 0.2, y: 0.3 };
    const end = { x: 0.8, y: 0.7 };
    const result = construct(start, end, 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.startingZone.point.x, 0.2);
      assert.notEqual(result.startingZone.point.x, 1 - 0.2);
      assert.equal(result.fixedTarget.point.x, 0.8);
      assert.notEqual(result.fixedTarget.point.x, 1 - 0.8);
    }
  });

  it("allows frame bounds exactly 0 and 1 when geometry otherwise valid", () => {
    // start at x=0, end at x=1, y=0.5; radii small enough for separation
    const atZero = construct(
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      1,
      0.05,
      { startingZoneRadius: 0.05, fixedTargetRadius: 0.05 },
    );
    assert.equal(atZero.ok, true);

    const atOneY = construct(
      { x: 0.2, y: 0 },
      { x: 0.8, y: 1 },
      1,
      0.05,
      { startingZoneRadius: 0.05, fixedTargetRadius: 0.05 },
    );
    assert.equal(atOneY.ok, true);
  });
});

describe("constructLateralReachFrozenGeometry — bounds and inherited validation", () => {
  it("rejects finite coordinate just below 0 as geometry_not_constructible", () => {
    // Pass Slice 4 with in-bounds y-like displacement via x, but out-of-bounds y on start
    // Need Slice 4 to succeed first — so use valid x displacement, invalid y after.
    // start y = -0.001 is finite but out of [0,1]; x displacement still validates direction.
    const result = construct(
      { x: 0.25, y: -0.001 },
      { x: 0.75, y: 0.5 },
      1,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "geometry_not_constructible");
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
    }
  });

  it("rejects finite coordinate just above 1 as geometry_not_constructible", () => {
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 1.001 },
      1,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "geometry_not_constructible");
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
    }
  });

  it("inherits exact RangeErrors for non-finite points and invalid sign", () => {
    assert.throws(
      () =>
        constructLateralReachFrozenGeometry(
          { x: Number.NaN, y: 0.5 },
          { x: 0.75, y: 0.5 },
          1,
          noiseFloor(0.05),
          DEFAULT_RADII,
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "startWrist must have finite x and y",
    );
    assert.throws(
      () =>
        constructLateralReachFrozenGeometry(
          { x: 0.25, y: 0.5 },
          { x: 0.75, y: Number.POSITIVE_INFINITY },
          1,
          noiseFloor(0.05),
          DEFAULT_RADII,
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "heldEndpoint must have finite x and y",
    );
    for (const bad of [0, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () =>
          constructLateralReachFrozenGeometry(
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
            bad as 1 | -1,
            noiseFloor(0.05),
            DEFAULT_RADII,
          ),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "expectedHorizontalDirectionSign must be exactly 1 or -1",
      );
    }
  });

  it("rejects invalid startingZoneRadius with exact Slice 5 RangeError", () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () =>
          constructLateralReachFrozenGeometry(
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
            1,
            noiseFloor(0.05),
            { startingZoneRadius: bad, fixedTargetRadius: 0.05 },
          ),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "startingZoneRadius must be a finite number greater than 0",
      );
    }
  });

  it("rejects invalid fixedTargetRadius with exact Slice 5 RangeError", () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () =>
          constructLateralReachFrozenGeometry(
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
            1,
            noiseFloor(0.05),
            { startingZoneRadius: 0.05, fixedTargetRadius: bad },
          ),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "fixedTargetRadius must be a finite number greater than 0",
      );
    }
  });

  it("inherits exact RangeError for invalid noise floor", () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () =>
          constructLateralReachFrozenGeometry(
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
            1,
            noiseFloor(bad),
            DEFAULT_RADII,
          ),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "minDirectionAlignedMagnitude must be a finite number greater than 0",
      );
    }
  });
});

describe("constructLateralReachFrozenGeometry — calibration_invalid", () => {
  it("maps wrong-direction to calibration_invalid", () => {
    const result = construct({ x: 0.25, y: 0.5 }, { x: 0.1, y: 0.5 }, 1);
    assert.deepEqual(result, {
      ok: false,
      kind: "calibration_invalid",
      reason: "wrong_direction_reach",
    });
  });

  it("maps zero horizontal delta to calibration_invalid not geometry", () => {
    const result = construct({ x: 0.4, y: 0.5 }, { x: 0.4, y: 0.8 }, 1);
    assert.deepEqual(result, {
      ok: false,
      kind: "calibration_invalid",
      reason: "direction_aligned_magnitude_not_positive",
    });
  });

  it("maps below noise floor to calibration_invalid", () => {
    // aligned = 0.125 < 0.25
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.375, y: 0.5 },
      1,
      0.25,
    );
    assert.deepEqual(result, {
      ok: false,
      kind: "calibration_invalid",
      reason: "displacement_indistinguishable_from_noise",
    });
  });

  it("exact noise threshold passes Slice 4 and proceeds to geometry success", () => {
    // aligned = 0.25, floor = 0.25; radii 0.05+0.05 < 0.25
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.5 },
      1,
      0.25,
      { startingZoneRadius: 0.05, fixedTargetRadius: 0.05 },
    );
    assert.equal(result.ok, true);
  });
});

describe("constructLateralReachFrozenGeometry — overlap and horizontal separation", () => {
  it("rejects Euclidean circle overlap (distance < radius sum)", () => {
    // Binary-friendly: dx=0.125 < radii sum 0.25; floor 0.05 so Slice 4 passes
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.375, y: 0.5 },
      1,
      0.05,
      { startingZoneRadius: 0.125, fixedTargetRadius: 0.125 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "geometry_not_constructible");
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
    }
  });

  it("rejects exact Euclidean circle touch (distance === radius sum)", () => {
    // dx=0.25 === 0.125+0.125
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.5 },
      1,
      0.05,
      { startingZoneRadius: 0.125, fixedTargetRadius: 0.125 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "geometry_not_constructible");
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
    }
  });

  it("does not reject by overlap alone when distance is just above radius sum", () => {
    // dx=0.5 > 0.25; success
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
      1,
      0.05,
      { startingZoneRadius: 0.125, fixedTargetRadius: 0.125 },
    );
    assert.equal(result.ok, true);
  });

  it("rejects exact horizontal-separation boundary with vertical clearance proving independence", () => {
    // |dx| = 0.25 === radius sum → horizontal fails.
    // Euclidean = hypot(0.25, 0.5) > 0.25 → would PASS overlap alone.
    const start = { x: 0.25, y: 0.25 };
    const end = { x: 0.5, y: 0.75 };
    const radii = { startingZoneRadius: 0.125, fixedTargetRadius: 0.125 };
    const euclidean = Math.hypot(0.25, 0.5);
    assert.ok(euclidean > radii.startingZoneRadius + radii.fixedTargetRadius);
    assert.equal(Math.abs(end.x - start.x), radii.startingZoneRadius + radii.fixedTargetRadius);

    const result = construct(start, end, 1, 0.05, radii);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, "geometry_not_constructible");
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
    }
  });

  it("succeeds when horizontal separation is just above boundary", () => {
    // |dx|=0.5 > 0.25
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
      1,
      0.05,
      { startingZoneRadius: 0.125, fixedTargetRadius: 0.125 },
    );
    assert.equal(result.ok, true);
  });

  it("emits a single geometry_constraints_unsatisfied blocker when both overlap and horizontal would fail", () => {
    // Coplanar close points: both Euclidean and horizontal fail
    const result = construct(
      { x: 0.25, y: 0.5 },
      { x: 0.375, y: 0.5 },
      1,
      0.05,
      { startingZoneRadius: 0.125, fixedTargetRadius: 0.125 },
    );
    assert.equal(result.ok, false);
    if (!result.ok && result.kind === "geometry_not_constructible") {
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
      assert.equal(result.geometryBlockers.length, 1);
    }
  });
});

describe("constructLateralReachFrozenGeometry — freeze, isolation, boundaries", () => {
  it("freezes success result and nested zones/points; isolates caller mutation", () => {
    const start = { x: 0.25, y: 0.5 };
    const end = { x: 0.75, y: 0.5 };
    const result = construct(start, end, 1);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.startingZone), true);
    assert.equal(Object.isFrozen(result.startingZone.point), true);
    assert.equal(Object.isFrozen(result.fixedTarget), true);
    assert.equal(Object.isFrozen(result.fixedTarget.point), true);

    start.x = 0.99;
    end.x = 0.01;
    assert.equal(result.startingZone.point.x, 0.25);
    assert.equal(result.fixedTarget.point.x, 0.75);

    assert.equal("derived" in result, false);
    assert.equal("rawDeltaX" in result, false);
    assert.equal("directionAlignedMagnitude" in result, false);
    assert.equal("testedSide" in result, false);
    assert.equal("noiseFloor" in result, false);
    assert.equal("interactionFraction" in result, false);
  });

  it("module source has no engine/testedSide/direction-sign derivation/result-assembly creep", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "app/lib/interaction-calibration/lateral-reach/frozen-geometry.ts",
      "utf8",
    );
    assert.equal(/from\s+["'][^"']*lateral-reach-engine/.test(source), false);
    assert.equal(/validateLateralReachConfig/.test(source), false);
    assert.equal(/\btestedSide\b/.test(source), false);
    assert.equal(/Math\.sign\s*\(/.test(source), false);
    assert.equal(/LateralReachCalibrationResult/.test(source), false);
    assert.equal(/engine_config_invalid/.test(source), false);
    assert.equal(/interactionFraction/.test(source), false);
    assert.equal(/LateralReachZone/.test(source), false);
  });

  it("never returns engine_config_invalid", () => {
    const cases = [
      construct({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1),
      construct({ x: 0.25, y: 0.5 }, { x: 0.1, y: 0.5 }, 1),
      construct({ x: 0.4, y: 0.5 }, { x: 0.45, y: 0.5 }, 1, 0.01),
      construct({ x: 0.25, y: -0.1 }, { x: 0.75, y: 0.5 }, 1),
    ];
    for (const result of cases) {
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes("engine_config_invalid"), false);
    }
  });
});
