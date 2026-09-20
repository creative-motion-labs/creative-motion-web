/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/derived-measurements.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachNoiseFloorConfig,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import {
  deriveLateralReachMeasurements,
  validateLateralReachDirectionAndMagnitude,
} from "@/app/lib/interaction-calibration/lateral-reach/derived-measurements";

function noiseFloor(
  minDirectionAlignedMagnitude: number,
): LateralReachNoiseFloorConfig {
  return {
    kind: LATERAL_REACH_NOISE_FLOOR_KIND,
    minDirectionAlignedMagnitude,
  };
}

describe("deriveLateralReachMeasurements", () => {
  it("expected +1 with positive displacement yields positive rawDeltaX and aligned", () => {
    const start = { x: 0.3, y: 0.5 };
    const end = { x: 0.5, y: 0.5 };
    const derived = deriveLateralReachMeasurements(start, end, 1);
    assert.equal(derived.rawDeltaX, 0.2);
    assert.equal(derived.expectedHorizontalDirectionSign, 1);
    assert.equal(derived.directionAlignedMagnitude, 0.2);
  });

  it("expected -1 with negative displacement yields positive aligned", () => {
    const start = { x: 0.5, y: 0.5 };
    const end = { x: 0.3, y: 0.5 };
    const derived = deriveLateralReachMeasurements(start, end, -1);
    assert.equal(derived.rawDeltaX, -0.2);
    assert.equal(derived.expectedHorizontalDirectionSign, -1);
    assert.equal(derived.directionAlignedMagnitude, 0.2);
  });

  it("proves rawDeltaX is heldEndpoint.x - startWrist.x with no mirroring", () => {
    const start = { x: 0.2, y: 0.4 };
    const end = { x: 0.8, y: 0.1 };
    const derived = deriveLateralReachMeasurements(start, end, 1);
    assert.equal(derived.rawDeltaX, end.x - start.x);
    assert.notEqual(derived.rawDeltaX, (1 - end.x) - start.x);
    assert.notEqual(derived.rawDeltaX, end.x - (1 - start.x));
    assert.equal(derived.directionAlignedMagnitude, end.x - start.x);
  });

  it("returns a fresh object and does not mutate inputs", () => {
    const start = { x: 0.3, y: 0.5 };
    const end = { x: 0.5, y: 0.5 };
    const first = deriveLateralReachMeasurements(start, end, 1);
    const second = deriveLateralReachMeasurements(start, end, 1);
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    start.x = 0.99;
    end.x = 0.01;
    assert.equal(first.rawDeltaX, 0.2);
    assert.equal(first.directionAlignedMagnitude, 0.2);
  });

  it("rejects non-finite startWrist with exact RangeError message", () => {
    const end = { x: 0.5, y: 0.5 };
    for (const start of [
      { x: Number.NaN, y: 0.5 },
      { x: 0.3, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0.5 },
      { x: 0.3, y: Number.NEGATIVE_INFINITY },
    ]) {
      assert.throws(
        () => deriveLateralReachMeasurements(start, end, 1),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message === "startWrist must have finite x and y",
      );
    }
  });

  it("rejects non-finite heldEndpoint with exact RangeError message", () => {
    const start = { x: 0.3, y: 0.5 };
    for (const end of [
      { x: Number.NaN, y: 0.5 },
      { x: 0.5, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0.5 },
      { x: 0.5, y: Number.NEGATIVE_INFINITY },
    ]) {
      assert.throws(
        () => deriveLateralReachMeasurements(start, end, 1),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message === "heldEndpoint must have finite x and y",
      );
    }
  });

  it("rejects expected sign that is not exactly 1 or -1", () => {
    const start = { x: 0.3, y: 0.5 };
    const end = { x: 0.5, y: 0.5 };
    for (const bad of [0, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () =>
          deriveLateralReachMeasurements(
            start,
            end,
            bad as 1 | -1,
          ),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "expectedHorizontalDirectionSign must be exactly 1 or -1",
      );
    }
  });
});

describe("validateLateralReachDirectionAndMagnitude", () => {
  it("classifies expected +1 with negative displacement as wrong_direction_reach", () => {
    const result = validateLateralReachDirectionAndMagnitude(
      { x: 0.3, y: 0.5 },
      { x: 0.2, y: 0.5 },
      1,
      noiseFloor(0.05),
    );
    assert.deepEqual(result, { ok: false, reason: "wrong_direction_reach" });
    assert.equal("derived" in result, false);
  });

  it("classifies expected -1 with positive displacement as wrong_direction_reach", () => {
    const result = validateLateralReachDirectionAndMagnitude(
      { x: 0.3, y: 0.5 },
      { x: 0.5, y: 0.5 },
      -1,
      noiseFloor(0.05),
    );
    assert.deepEqual(result, { ok: false, reason: "wrong_direction_reach" });
  });

  it("classifies zero rawDeltaX as direction_aligned_magnitude_not_positive", () => {
    const result = validateLateralReachDirectionAndMagnitude(
      { x: 0.3, y: 0.5 },
      { x: 0.3, y: 0.5 },
      1,
      noiseFloor(0.05),
    );
    assert.deepEqual(result, {
      ok: false,
      reason: "direction_aligned_magnitude_not_positive",
    });
  });

  it("treats -0 aligned magnitude like 0 (not wrong_direction_reach)", () => {
    // same x → rawDeltaX = 0; expected -1 → aligned = -0
    const start = { x: 0.3, y: 0.5 };
    const end = { x: 0.3, y: 0.5 };
    const derived = deriveLateralReachMeasurements(start, end, -1);
    assert.equal(derived.rawDeltaX, 0);
    assert.equal(derived.directionAlignedMagnitude, -0);
    assert.equal(Object.is(derived.directionAlignedMagnitude, -0), true);
    assert.equal(derived.directionAlignedMagnitude < 0, false);
    assert.equal(derived.directionAlignedMagnitude === 0, true);

    const result = validateLateralReachDirectionAndMagnitude(
      start,
      end,
      -1,
      noiseFloor(0.05),
    );
    assert.deepEqual(result, {
      ok: false,
      reason: "direction_aligned_magnitude_not_positive",
    });
    assert.notEqual(
      (result as { ok: false; reason: string }).reason,
      "wrong_direction_reach",
    );
  });

  it("classifies aligned just below noise threshold as displacement_indistinguishable_from_noise", () => {
    // Binary-friendly: aligned = 0.125 < 0.25
    const result = validateLateralReachDirectionAndMagnitude(
      { x: 0.25, y: 0.5 },
      { x: 0.375, y: 0.5 },
      1,
      noiseFloor(0.25),
    );
    assert.deepEqual(result, {
      ok: false,
      reason: "displacement_indistinguishable_from_noise",
    });
  });

  it("exact threshold equality passes", () => {
    // 0.5 - 0.25 = 0.25 exactly in IEEE-754
    const result = validateLateralReachDirectionAndMagnitude(
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.5 },
      1,
      noiseFloor(0.25),
    );
    assert.deepEqual(result, { ok: true });
    assert.equal("derived" in result, false);
  });

  it("aligned above threshold passes", () => {
    const result = validateLateralReachDirectionAndMagnitude(
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
      1,
      noiseFloor(0.25),
    );
    assert.deepEqual(result, { ok: true });
  });

  it("covers four-bucket deterministic classification", () => {
    const startX = 0.25;
    const floor = noiseFloor(0.25);
    const buckets = [
      {
        endX: 0,
        expected: "wrong_direction_reach" as const,
      },
      {
        endX: 0.25,
        expected: "direction_aligned_magnitude_not_positive" as const,
      },
      {
        endX: 0.375,
        expected: "displacement_indistinguishable_from_noise" as const,
      },
      {
        endX: 0.5,
        expected: null,
      },
    ];
    for (const bucket of buckets) {
      const result = validateLateralReachDirectionAndMagnitude(
        { x: startX, y: 0.5 },
        { x: bucket.endX, y: 0.5 },
        1,
        floor,
      );
      const derived = deriveLateralReachMeasurements(
        { x: startX, y: 0.5 },
        { x: bucket.endX, y: 0.5 },
        1,
      );
      if (bucket.expected === null) {
        assert.equal(result.ok, true);
        assert.ok(derived.directionAlignedMagnitude >= 0.25);
      } else {
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.reason, bucket.expected);
        }
      }
    }
  });

  it("validator verdict matches manual derivation classification", () => {
    const start = { x: 0.75, y: 0.25 };
    const end = { x: 0.25, y: 0.25 };
    const sign = -1 as const;
    const floor = noiseFloor(0.25);
    const derived = deriveLateralReachMeasurements(start, end, sign);
    // aligned = (-1) * (0.25 - 0.75) = 0.5 >= 0.25 → ok
    assert.equal(derived.rawDeltaX, end.x - start.x);
    assert.equal(derived.directionAlignedMagnitude, sign * derived.rawDeltaX);
    assert.equal(derived.directionAlignedMagnitude, 0.5);
    const result = validateLateralReachDirectionAndMagnitude(
      start,
      end,
      sign,
      floor,
    );
    assert.deepEqual(result, { ok: true });
  });

  it("success and failure results have no derived property", () => {
    const ok = validateLateralReachDirectionAndMagnitude(
      { x: 0.3, y: 0.5 },
      { x: 0.5, y: 0.5 },
      1,
      noiseFloor(0.05),
    );
    const fail = validateLateralReachDirectionAndMagnitude(
      { x: 0.3, y: 0.5 },
      { x: 0.2, y: 0.5 },
      1,
      noiseFloor(0.05),
    );
    assert.equal("derived" in ok, false);
    assert.equal("derived" in fail, false);
    assert.equal("rawDeltaX" in ok, false);
    assert.equal("rawDeltaX" in fail, false);
    assert.equal("directionAlignedMagnitude" in ok, false);
    assert.equal("directionAlignedMagnitude" in fail, false);
  });

  it("rejects invalid noise floor with exact RangeError message", () => {
    const start = { x: 0.3, y: 0.5 };
    const end = { x: 0.5, y: 0.5 };
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () =>
          validateLateralReachDirectionAndMagnitude(
            start,
            end,
            1,
            noiseFloor(bad),
          ),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "minDirectionAlignedMagnitude must be a finite number greater than 0",
      );
    }
  });

  it("propagates point and sign RangeErrors from derive", () => {
    assert.throws(
      () =>
        validateLateralReachDirectionAndMagnitude(
          { x: Number.NaN, y: 0.5 },
          { x: 0.5, y: 0.5 },
          1,
          noiseFloor(0.05),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "startWrist must have finite x and y",
    );
    assert.throws(
      () =>
        validateLateralReachDirectionAndMagnitude(
          { x: 0.3, y: 0.5 },
          { x: 0.5, y: Number.POSITIVE_INFINITY },
          1,
          noiseFloor(0.05),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "heldEndpoint must have finite x and y",
    );
    assert.throws(
      () =>
        validateLateralReachDirectionAndMagnitude(
          { x: 0.3, y: 0.5 },
          { x: 0.5, y: 0.5 },
          0 as 1 | -1,
          noiseFloor(0.05),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "expectedHorizontalDirectionSign must be exactly 1 or -1",
    );
  });

  it("does not mutate noiseFloor or points", () => {
    const start = { x: 0.3, y: 0.5 };
    const end = { x: 0.5, y: 0.5 };
    const floor = noiseFloor(0.05);
    validateLateralReachDirectionAndMagnitude(start, end, 1, floor);
    assert.equal(start.x, 0.3);
    assert.equal(end.x, 0.5);
    assert.equal(floor.minDirectionAlignedMagnitude, 0.05);
  });
});

describe("slice 4 isolation", () => {
  it("module source has no geometry/engine/testedSide imports", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "app/lib/interaction-calibration/lateral-reach/derived-measurements.ts",
      "utf8",
    );
    assert.equal(/from\s+["'][^"']*lateral-reach-engine/.test(source), false);
    assert.equal(/\btestedSide\b/.test(source), false);
    assert.equal(/\bstartingZone\b/.test(source), false);
    assert.equal(/\bfixedTarget\b/.test(source), false);
    assert.equal(/from\s+["'][^"']*upper-limb-motor-screen/.test(source), false);
  });
});
