/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/technical-parameters.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { LATERAL_REACH_NOISE_FLOOR_KIND } from "@/app/lib/interaction-calibration/lateral-reach/types";
import {
  createLateralReachCalibrationNoiseFloor,
  createLateralReachCalibrationZoneRadii,
} from "@/app/lib/interaction-calibration/lateral-reach/technical-parameters";

describe("createLateralReachCalibrationNoiseFloor", () => {
  it("accepts finite positive magnitudes as structural fixtures", () => {
    assert.deepEqual(createLateralReachCalibrationNoiseFloor(0.05), {
      kind: LATERAL_REACH_NOISE_FLOOR_KIND,
      minDirectionAlignedMagnitude: 0.05,
    });
    assert.deepEqual(createLateralReachCalibrationNoiseFloor(1), {
      kind: LATERAL_REACH_NOISE_FLOOR_KIND,
      minDirectionAlignedMagnitude: 1,
    });
  });

  it("rejects invalid magnitudes with exact RangeError", () => {
    const invalid: unknown[] = [
      0,
      -0,
      -0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
      null,
      "0.05",
      {},
    ];
    for (const value of invalid) {
      assert.throws(
        () => createLateralReachCalibrationNoiseFloor(value),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "minDirectionAlignedMagnitude must be a finite number greater than 0",
      );
    }
  });
});

describe("createLateralReachCalibrationZoneRadii", () => {
  it("accepts both finite positive radii", () => {
    assert.deepEqual(
      createLateralReachCalibrationZoneRadii({
        startingZoneRadius: 0.04,
        fixedTargetRadius: 0.06,
      }),
      {
        startingZoneRadius: 0.04,
        fixedTargetRadius: 0.06,
      },
    );
  });

  it("rejects invalid startingZoneRadius with exact RangeError", () => {
    const invalidStarting: unknown[] = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const startingZoneRadius of invalidStarting) {
      assert.throws(
        () =>
          createLateralReachCalibrationZoneRadii({
            startingZoneRadius,
            fixedTargetRadius: 0.05,
          }),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "startingZoneRadius must be a finite number greater than 0",
      );
    }

    assert.throws(
      () =>
        createLateralReachCalibrationZoneRadii({
          fixedTargetRadius: 0.05,
        }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );
  });

  it("rejects invalid fixedTargetRadius with exact RangeError", () => {
    const invalidFixed: unknown[] = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const fixedTargetRadius of invalidFixed) {
      assert.throws(
        () =>
          createLateralReachCalibrationZoneRadii({
            startingZoneRadius: 0.05,
            fixedTargetRadius,
          }),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "fixedTargetRadius must be a finite number greater than 0",
      );
    }

    assert.throws(
      () =>
        createLateralReachCalibrationZoneRadii({
          startingZoneRadius: 0.05,
        }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "fixedTargetRadius must be a finite number greater than 0",
    );
  });

  it("rejects undefined/null/empty/non-object without TypeError", () => {
    for (const value of [undefined, null, {}, [], "radii", 1] as unknown[]) {
      assert.throws(
        () => createLateralReachCalibrationZoneRadii(value),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "startingZoneRadius must be a finite number greater than 0",
      );
    }
  });

  it("prefers startingZoneRadius error when both radii are invalid", () => {
    assert.throws(
      () =>
        createLateralReachCalibrationZoneRadii({
          startingZoneRadius: 0,
          fixedTargetRadius: 0,
        }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );
  });
});

describe("technical-parameters — source contracts", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "technical-parameters.ts"),
    "utf8",
  );

  it("contains no defaults, testedSide, engine, or camera/UI dependencies", () => {
    assert.equal(/DEFAULT_/.test(source), false);
    assert.equal(source.includes("testedSide"), false);
    assert.equal(source.includes("lateral-reach-engine"), false);
    assert.equal(source.includes("validateLateralReachConfig"), false);
    assert.equal(/\bcamera\b/i.test(source), false);
    assert.equal(/MediaPipe/i.test(source), false);
    assert.equal(/\bReact\b/.test(source), false);
    assert.equal(source.includes("Object.freeze"), false);
  });
});
