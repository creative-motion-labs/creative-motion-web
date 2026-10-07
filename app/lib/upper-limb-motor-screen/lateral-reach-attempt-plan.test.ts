/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/lateral-reach-attempt-plan.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createLateralReachCalibrationAttemptIntention } from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";
import { resolveLateralReachCalibrationAttemptIntentionFromPlan } from "@/app/lib/upper-limb-motor-screen/lateral-reach-attempt-plan";

const EXACT_MESSAGE =
  'screenHorizontalDirection must be exactly "positive_x" or "negative_x"';

function assertPlanRangeError(fn: () => unknown) {
  assert.throws(
    fn,
    (err: unknown) =>
      err instanceof RangeError && err.message === EXACT_MESSAGE,
  );
}

describe("resolveLateralReachCalibrationAttemptIntentionFromPlan", () => {
  it("maps positive_x to Slice 8 intention sign +1", () => {
    const result = resolveLateralReachCalibrationAttemptIntentionFromPlan({
      screenHorizontalDirection: "positive_x",
    });
    assert.deepEqual(result, { expectedHorizontalDirectionSign: 1 });
    assert.deepEqual(
      result,
      createLateralReachCalibrationAttemptIntention(1),
    );
  });

  it("maps negative_x to Slice 8 intention sign -1", () => {
    const result = resolveLateralReachCalibrationAttemptIntentionFromPlan({
      screenHorizontalDirection: "negative_x",
    });
    assert.deepEqual(result, { expectedHorizontalDirectionSign: -1 });
    assert.deepEqual(
      result,
      createLateralReachCalibrationAttemptIntention(-1),
    );
  });

  it("fails closed for undefined/null/non-object/missing field", () => {
    for (const value of [undefined, null, 0, "positive_x", [], {}]) {
      assertPlanRangeError(() =>
        resolveLateralReachCalibrationAttemptIntentionFromPlan(value),
      );
    }
    assertPlanRangeError(() =>
      resolveLateralReachCalibrationAttemptIntentionFromPlan({
        testedSide: "left",
      }),
    );
  });

  it("rejects free-text and numeric product values with exact RangeError", () => {
    const invalidDirections: unknown[] = [
      "",
      "forward",
      "left",
      "right",
      1,
      -1,
      "arbitrary",
    ];
    for (const screenHorizontalDirection of invalidDirections) {
      assertPlanRangeError(() =>
        resolveLateralReachCalibrationAttemptIntentionFromPlan({
          screenHorizontalDirection,
        }),
      );
    }
  });

  it("ignores testedSide; same typed direction yields identical intention", () => {
    const left = resolveLateralReachCalibrationAttemptIntentionFromPlan({
      screenHorizontalDirection: "positive_x",
      testedSide: "left",
    });
    const right = resolveLateralReachCalibrationAttemptIntentionFromPlan({
      screenHorizontalDirection: "positive_x",
      testedSide: "right",
    });
    assert.deepEqual(left, right);
    assert.equal(left.expectedHorizontalDirectionSign, 1);
  });

  it("ignores free-text direction when typed field is valid", () => {
    const result = resolveLateralReachCalibrationAttemptIntentionFromPlan({
      screenHorizontalDirection: "positive_x",
      direction: "left",
    });
    assert.deepEqual(result, { expectedHorizontalDirectionSign: 1 });
  });

  it("rejects free-text direction alone", () => {
    assertPlanRangeError(() =>
      resolveLateralReachCalibrationAttemptIntentionFromPlan({
        direction: "forward",
      }),
    );
  });

  it("requires no geometry or motion inputs", () => {
    const result = resolveLateralReachCalibrationAttemptIntentionFromPlan({
      screenHorizontalDirection: "negative_x",
    });
    assert.deepEqual(result, { expectedHorizontalDirectionSign: -1 });
  });
});

describe("lateral-reach-attempt-plan — source contracts", () => {
  const source = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "lateral-reach-attempt-plan.ts",
    ),
    "utf8",
  );

  it("uses direct Slice 8 leaf import and forbids forbidden dependencies", () => {
    assert.equal(
      source.includes(
        "@/app/lib/interaction-calibration/lateral-reach/attempt-intention",
      ),
      true,
    );
    assert.equal(
      /from\s+["']@\/app\/lib\/interaction-calibration\/lateral-reach["']/.test(
        source,
      ),
      false,
    );
    assert.equal(source.includes("Math.sign"), false);
    assert.equal(/1\s*-\s*x|1\s*-\s*[a-zA-Z]/.test(source), false);
    assert.equal(source.includes("testedSide"), false);
    assert.equal(source.includes("targetPlacement"), false);
    assert.equal(source.includes("lateral-reach-engine"), false);
    assert.equal(source.includes("start-capture"), false);
    assert.equal(source.includes("endpoint-capture"), false);
    assert.equal(
      source.includes("createLateralReachCalibrationAttemptPlan"),
      false,
    );
  });
});
