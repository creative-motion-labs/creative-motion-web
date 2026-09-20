/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/attempt-intention.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createLateralReachCalibrationAttemptIntention,
} from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";

describe("createLateralReachCalibrationAttemptIntention", () => {
  it("accepts +1", () => {
    assert.deepEqual(createLateralReachCalibrationAttemptIntention(1), {
      expectedHorizontalDirectionSign: 1,
    });
  });

  it("accepts -1", () => {
    assert.deepEqual(createLateralReachCalibrationAttemptIntention(-1), {
      expectedHorizontalDirectionSign: -1,
    });
  });

  it("rejects invalid runtime values with exact RangeError", () => {
    const invalidValues: unknown[] = [
      0,
      -0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      2,
      -2,
      undefined,
      null,
      "1",
      "-1",
      true,
      false,
      {},
      [],
    ];

    for (const value of invalidValues) {
      assert.throws(
        () => createLateralReachCalibrationAttemptIntention(value),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "expectedHorizontalDirectionSign must be exactly 1 or -1",
      );
    }
  });
});

describe("createLateralReachCalibrationAttemptIntention — source contracts", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "attempt-intention.ts"),
    "utf8",
  );

  it("does not use Math.sign or testedSide", () => {
    assert.equal(source.includes("Math.sign"), false);
    assert.equal(source.includes("testedSide"), false);
  });

  it("has no geometry, engine, camera, or UI dependencies", () => {
    assert.equal(source.includes("startWrist"), false);
    assert.equal(source.includes("heldEndpoint"), false);
    assert.equal(source.includes("rawDeltaX"), false);
    assert.equal(source.includes("startingZone"), false);
    assert.equal(source.includes("fixedTarget"), false);
    assert.equal(source.includes("frozenGeometry"), false);
    assert.equal(source.includes("lateral-reach-engine"), false);
    assert.equal(source.includes("validateLateralReachConfig"), false);
    assert.equal(/\bcamera\b/i.test(source), false);
    assert.equal(/MediaPipe/i.test(source), false);
    assert.equal(/\bReact\b/.test(source), false);
    assert.equal(source.includes("page.tsx"), false);
    assert.equal(source.includes("Object.freeze"), false);
  });
});
