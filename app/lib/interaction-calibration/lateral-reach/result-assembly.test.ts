/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/result-assembly.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachCaptureFailureReason,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import { createLateralReachCalibrationAttemptIntention } from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";
import { deriveLateralReachMeasurements } from "@/app/lib/interaction-calibration/lateral-reach/derived-measurements";
import { constructLateralReachFrozenGeometry } from "@/app/lib/interaction-calibration/lateral-reach/frozen-geometry";
import {
  assembleLateralReachCalibrationResult,
  type LateralReachResultAssemblyInput,
} from "@/app/lib/interaction-calibration/lateral-reach/result-assembly";
import {
  createLateralReachCalibrationNoiseFloor,
  createLateralReachCalibrationZoneRadii,
} from "@/app/lib/interaction-calibration/lateral-reach/technical-parameters";

function noiseFloor(minDirectionAlignedMagnitude = 0.05) {
  return createLateralReachCalibrationNoiseFloor(minDirectionAlignedMagnitude);
}

const READY_RADII = createLateralReachCalibrationZoneRadii({
  startingZoneRadius: 0.05,
  fixedTargetRadius: 0.05,
});

function capturedInput(
  overrides: Partial<Extract<LateralReachResultAssemblyInput, { stage: "captured" }>> = {},
): Extract<LateralReachResultAssemblyInput, { stage: "captured" }> {
  return {
    testedSide: "right",
    stage: "captured",
    startWrist: { x: 0.25, y: 0.5 },
    heldEndpoint: { x: 0.75, y: 0.5 },
    intention: createLateralReachCalibrationAttemptIntention(1),
    noiseFloor: noiseFloor(),
    zoneRadii: READY_RADII,
    ...overrides,
  };
}

function assertIntentionRangeError(run: () => unknown): void {
  assert.throws(
    run,
    (err: unknown) =>
      err instanceof RangeError &&
      err.message ===
        "expectedHorizontalDirectionSign must be exactly 1 or -1",
  );
}

describe("assembleLateralReachCalibrationResult — start_failed", () => {
  it("returns failed/not_applicable without observations and copies failureReasons", () => {
    const failureReasons: LateralReachCaptureFailureReason[] = [
      "start_timeout",
      "insufficient_start_samples",
    ];
    const inputReasons: LateralReachCaptureFailureReason[] = [...failureReasons];
    const result = assembleLateralReachCalibrationResult({
      testedSide: "left",
      stage: "start_failed",
      failureReasons: inputReasons,
    });

    assert.equal(result.schemaVersion, LATERAL_REACH_CALIBRATION_SCHEMA_VERSION);
    assert.equal(result.testedSide, "left");
    assert.equal(result.captureOutcome, "failed");
    assert.equal(result.geometryOutcome, "not_applicable");
    if (result.captureOutcome === "failed") {
      assert.deepEqual(result.failureReasons, ["start_timeout", "insufficient_start_samples"]);
      assert.notEqual(result.failureReasons, inputReasons);
      assert.equal("observations" in result, false);
      inputReasons.push("start_unstable");
      assert.deepEqual(result.failureReasons, ["start_timeout", "insufficient_start_samples"]);
    }
  });
});

describe("assembleLateralReachCalibrationResult — endpoint_failed", () => {
  it("returns failed/not_applicable with cloned startWrist only", () => {
    const startWrist = { x: 0.3, y: 0.5 };
    const failureReasons = ["endpoint_hold_not_confirmed"] as const;
    const inputReasons = [...failureReasons];
    const result = assembleLateralReachCalibrationResult({
      testedSide: "right",
      stage: "endpoint_failed",
      startWrist,
      failureReasons: inputReasons,
    });

    assert.equal(result.captureOutcome, "failed");
    assert.equal(result.geometryOutcome, "not_applicable");
    if (result.captureOutcome === "failed") {
      assert.deepEqual(result.failureReasons, ["endpoint_hold_not_confirmed"]);
      assert.notEqual(result.failureReasons, inputReasons);
      assert.ok(result.observations);
      assert.deepEqual(result.observations?.startWrist, { x: 0.3, y: 0.5 });
      assert.notEqual(result.observations?.startWrist, startWrist);
      assert.equal("heldEndpoint" in (result.observations ?? {}), false);
      startWrist.x = 0.99;
      assert.equal(result.observations?.startWrist?.x, 0.3);
    }
  });
});

describe("assembleLateralReachCalibrationResult — calibration_invalid", () => {
  it("maps wrong_direction_reach without derivedMeasurements or frozenGeometry", () => {
    const start = { x: 0.25, y: 0.5 };
    const end = { x: 0.1, y: 0.5 };
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        startWrist: start,
        heldEndpoint: end,
        intention: createLateralReachCalibrationAttemptIntention(1),
      }),
    );
    assert.equal(result.captureOutcome, "failed");
    assert.equal(result.geometryOutcome, "not_applicable");
    if (result.captureOutcome === "failed") {
      assert.deepEqual(result.failureReasons, ["wrong_direction_reach"]);
      assert.equal(result.failureReasons.length, 1);
      assert.deepEqual(result.observations, {
        startWrist: { x: 0.25, y: 0.5 },
        heldEndpoint: { x: 0.1, y: 0.5 },
      });
      assert.equal("derivedMeasurements" in result, false);
      assert.equal("frozenGeometry" in result, false);
    }
  });

  it("maps direction_aligned_magnitude_not_positive for zero horizontal delta", () => {
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        startWrist: { x: 0.4, y: 0.5 },
        heldEndpoint: { x: 0.4, y: 0.8 },
      }),
    );
    assert.equal(result.captureOutcome, "failed");
    if (result.captureOutcome === "failed") {
      assert.deepEqual(result.failureReasons, ["direction_aligned_magnitude_not_positive"]);
      assert.equal("derivedMeasurements" in result, false);
      assert.equal("frozenGeometry" in result, false);
    }
  });

  it("maps displacement_indistinguishable_from_noise below floor", () => {
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        startWrist: { x: 0.25, y: 0.5 },
        heldEndpoint: { x: 0.375, y: 0.5 },
        noiseFloor: noiseFloor(0.25),
      }),
    );
    assert.equal(result.captureOutcome, "failed");
    if (result.captureOutcome === "failed") {
      assert.deepEqual(result.failureReasons, [
        "displacement_indistinguishable_from_noise",
      ]);
    }
  });
});

describe("assembleLateralReachCalibrationResult — geometry_not_constructible", () => {
  it("returns valid/not_constructible with derived measurements and blockers", () => {
    // Euclidean + horizontal fail (touch): dx = 0.25 === radii sum
    const start = { x: 0.25, y: 0.5 };
    const end = { x: 0.5, y: 0.5 };
    const sign = 1 as const;
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        startWrist: start,
        heldEndpoint: end,
        intention: createLateralReachCalibrationAttemptIntention(sign),
        noiseFloor: noiseFloor(0.05),
        zoneRadii: createLateralReachCalibrationZoneRadii({
          startingZoneRadius: 0.125,
          fixedTargetRadius: 0.125,
        }),
      }),
    );

    assert.equal(result.captureOutcome, "valid");
    assert.equal(result.geometryOutcome, "not_constructible");
    if (result.geometryOutcome === "not_constructible") {
      assert.deepEqual(result.observations, {
        startWrist: { x: 0.25, y: 0.5 },
        heldEndpoint: { x: 0.5, y: 0.5 },
      });
      assert.deepEqual(
        result.derivedMeasurements,
        deriveLateralReachMeasurements(start, end, sign),
      );
      assert.deepEqual(result.geometryBlockers, ["geometry_constraints_unsatisfied"]);
      assert.equal("frozenGeometry" in result, false);
      assert.equal(JSON.stringify(result).includes("engine_config_invalid"), false);
    }
  });
});

describe("assembleLateralReachCalibrationResult — ready", () => {
  it("returns valid/ready with exact frozenGeometry and freeze nesting", () => {
    const start = { x: 0.25, y: 0.5 };
    const end = { x: 0.75, y: 0.5 };
    const sign = 1 as const;
    const radii = createLateralReachCalibrationZoneRadii({
      startingZoneRadius: 0.04,
      fixedTargetRadius: 0.06,
    });
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        startWrist: start,
        heldEndpoint: end,
        intention: createLateralReachCalibrationAttemptIntention(sign),
        zoneRadii: radii,
      }),
    );

    assert.equal(result.captureOutcome, "valid");
    assert.equal(result.geometryOutcome, "ready");
    if (result.geometryOutcome === "ready") {
      assert.deepEqual(
        result.derivedMeasurements,
        deriveLateralReachMeasurements(start, end, sign),
      );
      assert.deepEqual(result.frozenGeometry.startingZone.point, { x: 0.25, y: 0.5 });
      assert.deepEqual(result.frozenGeometry.fixedTarget.point, { x: 0.75, y: 0.5 });
      assert.equal(result.frozenGeometry.startingZone.radius, 0.04);
      assert.equal(result.frozenGeometry.fixedTarget.radius, 0.06);

      const independent = constructLateralReachFrozenGeometry(
        start,
        end,
        sign,
        noiseFloor(),
        radii,
      );
      assert.equal(independent.ok, true);
      if (independent.ok) {
        assert.deepEqual(result.frozenGeometry.startingZone, independent.startingZone);
        assert.deepEqual(result.frozenGeometry.fixedTarget, independent.fixedTarget);
      }

      assert.equal(Object.isFrozen(result), false);
      assert.equal(Object.isFrozen(result.frozenGeometry), true);
      assert.equal(Object.isFrozen(result.frozenGeometry.startingZone), true);
      assert.equal(Object.isFrozen(result.frozenGeometry.fixedTarget), true);
      assert.equal(Object.isFrozen(result.frozenGeometry.startingZone.point), true);
      assert.equal(Object.isFrozen(result.frozenGeometry.fixedTarget.point), true);
    }
  });

  it("isolates caller mutation of points and zoneRadii after assembly", () => {
    const start = { x: 0.25, y: 0.5 };
    const end = { x: 0.75, y: 0.5 };
    const zoneRadii = createLateralReachCalibrationZoneRadii({
      startingZoneRadius: 0.05,
      fixedTargetRadius: 0.05,
    });
    const result = assembleLateralReachCalibrationResult(
      capturedInput({ startWrist: start, heldEndpoint: end, zoneRadii }),
    );
    assert.equal(result.geometryOutcome, "ready");
    if (result.geometryOutcome !== "ready") return;

    start.x = 0.99;
    end.x = 0.01;

    assert.equal(result.observations.startWrist.x, 0.25);
    assert.equal(result.observations.heldEndpoint.x, 0.75);
    assert.equal(result.frozenGeometry.startingZone.radius, 0.05);
    assert.equal(result.frozenGeometry.fixedTarget.radius, 0.05);
  });
});

describe("assembleLateralReachCalibrationResult — intention boundary", () => {
  it("accepts valid +1 intention", () => {
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        intention: createLateralReachCalibrationAttemptIntention(1),
        startWrist: { x: 0.25, y: 0.5 },
        heldEndpoint: { x: 0.75, y: 0.5 },
      }),
    );
    assert.equal(result.geometryOutcome, "ready");
    if (result.geometryOutcome === "ready") {
      assert.equal(result.derivedMeasurements.expectedHorizontalDirectionSign, 1);
    }
  });

  it("accepts valid -1 intention", () => {
    const result = assembleLateralReachCalibrationResult(
      capturedInput({
        intention: createLateralReachCalibrationAttemptIntention(-1),
        startWrist: { x: 0.75, y: 0.5 },
        heldEndpoint: { x: 0.25, y: 0.5 },
      }),
    );
    assert.equal(result.geometryOutcome, "ready");
    if (result.geometryOutcome === "ready") {
      assert.equal(result.derivedMeasurements.expectedHorizontalDirectionSign, -1);
    }
  });

  it("keeps testedSide orthogonal to intention for all four combinations", () => {
    const cases = [
      {
        testedSide: "left" as const,
        sign: 1 as const,
        startWrist: { x: 0.25, y: 0.5 },
        heldEndpoint: { x: 0.75, y: 0.5 },
      },
      {
        testedSide: "left" as const,
        sign: -1 as const,
        startWrist: { x: 0.75, y: 0.5 },
        heldEndpoint: { x: 0.25, y: 0.5 },
      },
      {
        testedSide: "right" as const,
        sign: 1 as const,
        startWrist: { x: 0.25, y: 0.5 },
        heldEndpoint: { x: 0.75, y: 0.5 },
      },
      {
        testedSide: "right" as const,
        sign: -1 as const,
        startWrist: { x: 0.75, y: 0.5 },
        heldEndpoint: { x: 0.25, y: 0.5 },
      },
    ];

    for (const c of cases) {
      const result = assembleLateralReachCalibrationResult(
        capturedInput({
          testedSide: c.testedSide,
          intention: createLateralReachCalibrationAttemptIntention(c.sign),
          startWrist: c.startWrist,
          heldEndpoint: c.heldEndpoint,
        }),
      );
      assert.equal(result.testedSide, c.testedSide);
      assert.equal(result.geometryOutcome, "ready");
      if (result.geometryOutcome === "ready") {
        assert.equal(
          result.derivedMeasurements.expectedHorizontalDirectionSign,
          c.sign,
        );
      }
    }
  });

  it("fails closed with RangeError for missing/null/malformed/invalid intention", () => {
    assertIntentionRangeError(() =>
      assembleLateralReachCalibrationResult({
        ...capturedInput(),
        intention: undefined,
      } as unknown as LateralReachResultAssemblyInput),
    );

    assertIntentionRangeError(() =>
      assembleLateralReachCalibrationResult({
        ...capturedInput(),
        intention: null,
      } as unknown as LateralReachResultAssemblyInput),
    );

    assertIntentionRangeError(() =>
      assembleLateralReachCalibrationResult({
        ...capturedInput(),
        intention: {},
      } as unknown as LateralReachResultAssemblyInput),
    );

    assertIntentionRangeError(() =>
      assembleLateralReachCalibrationResult(
        capturedInput({
          intention: {
            expectedHorizontalDirectionSign: 0 as 1,
          },
        }),
      ),
    );
  });
});

describe("assembleLateralReachCalibrationResult — technical-parameter ownership", () => {
  it("fails closed for malformed noiseFloor without TypeError", () => {
    for (const noiseFloorValue of [undefined, null, {}, { minDirectionAlignedMagnitude: 0 }] as unknown[]) {
      assert.throws(
        () =>
          assembleLateralReachCalibrationResult({
            ...capturedInput(),
            noiseFloor: noiseFloorValue,
          } as unknown as LateralReachResultAssemblyInput),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "minDirectionAlignedMagnitude must be a finite number greater than 0",
      );
    }
  });

  it("fails closed for malformed zoneRadii without TypeError", () => {
    for (const zoneRadiiValue of [undefined, null, {}] as unknown[]) {
      assert.throws(
        () =>
          assembleLateralReachCalibrationResult({
            ...capturedInput(),
            zoneRadii: zoneRadiiValue,
          } as unknown as LateralReachResultAssemblyInput),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message ===
            "startingZoneRadius must be a finite number greater than 0",
      );
    }

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult({
          ...capturedInput(),
          zoneRadii: {
            startingZoneRadius: 0,
            fixedTargetRadius: 0.1,
          },
        } as unknown as LateralReachResultAssemblyInput),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );
  });

  it("does not tighten noiseFloor.kind; unexpected kind is canonicalized", () => {
    const result = assembleLateralReachCalibrationResult({
      ...capturedInput(),
      noiseFloor: {
        kind: "unexpected-runtime-kind",
        minDirectionAlignedMagnitude: 0.05,
      },
    } as unknown as LateralReachResultAssemblyInput);

    assert.equal(result.geometryOutcome, "ready");
    if (result.geometryOutcome === "ready") {
      assert.equal(
        result.derivedMeasurements.directionAlignedMagnitude > 0,
        true,
      );
    }
  });

  it("preserves ownership-gate error precedence", () => {
    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({ testedSide: "bilateral" as "left" }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === 'testedSide must be exactly "left" or "right"',
    );

    assertIntentionRangeError(() =>
      assembleLateralReachCalibrationResult({
        ...capturedInput({
          zoneRadii: {
            startingZoneRadius: 0,
            fixedTargetRadius: 0,
          } as ReturnType<typeof createLateralReachCalibrationZoneRadii>,
        }),
        intention: undefined,
      } as unknown as LateralReachResultAssemblyInput),
    );

    const invalidNoiseFloor = {
      kind: LATERAL_REACH_NOISE_FLOOR_KIND,
      minDirectionAlignedMagnitude: 0,
    };

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult({
          ...capturedInput({
            zoneRadii: {
              startingZoneRadius: 0,
              fixedTargetRadius: 0,
            } as ReturnType<typeof createLateralReachCalibrationZoneRadii>,
          }),
          noiseFloor: invalidNoiseFloor,
        } as unknown as LateralReachResultAssemblyInput),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult({
          ...capturedInput({
            zoneRadii: {
              startingZoneRadius: 0.05,
              fixedTargetRadius: 0,
            } as ReturnType<typeof createLateralReachCalibrationZoneRadii>,
          }),
          noiseFloor: invalidNoiseFloor,
        } as unknown as LateralReachResultAssemblyInput),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "fixedTargetRadius must be a finite number greater than 0",
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult({
          ...capturedInput({
            startWrist: { x: 0.25, y: 0.5 },
            heldEndpoint: { x: 0.1, y: 0.5 },
          }),
          noiseFloor: invalidNoiseFloor,
        } as unknown as LateralReachResultAssemblyInput),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "minDirectionAlignedMagnitude must be a finite number greater than 0",
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({
            zoneRadii: {
              startingZoneRadius: 0,
              fixedTargetRadius: 0.05,
            } as ReturnType<typeof createLateralReachCalibrationZoneRadii>,
            startWrist: { x: 0.25, y: 0.5 },
            heldEndpoint: { x: 0.1, y: 0.5 },
          }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );
  });
});

describe("assembleLateralReachCalibrationResult — testedSide and inherited errors", () => {
  it("accepts left and right; rejects invalid with exact RangeError", () => {
    const left = assembleLateralReachCalibrationResult(
      capturedInput({ testedSide: "left" }),
    );
    const right = assembleLateralReachCalibrationResult(
      capturedInput({ testedSide: "right" }),
    );
    assert.equal(left.testedSide, "left");
    assert.equal(right.testedSide, "right");

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({ testedSide: "bilateral" as "left" }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === 'testedSide must be exactly "left" or "right"',
    );
  });

  it("preserves Slice 5 radii-first RangeError precedence through captured path", () => {
    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({
            zoneRadii: { startingZoneRadius: 0, fixedTargetRadius: 0.05 },
            startWrist: { x: Number.NaN, y: 0.5 },
          }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({
            zoneRadii: { startingZoneRadius: 0.05, fixedTargetRadius: -1 },
          }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "fixedTargetRadius must be a finite number greater than 0",
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({ startWrist: { x: Number.NaN, y: 0.5 } }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "startWrist must have finite x and y",
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({ heldEndpoint: { x: 0.75, y: Number.POSITIVE_INFINITY } }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "heldEndpoint must have finite x and y",
    );

    assertIntentionRangeError(() =>
      assembleLateralReachCalibrationResult(
        capturedInput({
          intention: {
            expectedHorizontalDirectionSign: 0 as 1,
          },
        }),
      ),
    );

    assert.throws(
      () =>
        assembleLateralReachCalibrationResult(
          capturedInput({ noiseFloor: noiseFloor(0) }),
        ),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "minDirectionAlignedMagnitude must be a finite number greater than 0",
    );
  });
});

describe("assembleLateralReachCalibrationResult — isolation", () => {
  it("module source has no engine adapter / direction inference creep", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "app/lib/interaction-calibration/lateral-reach/result-assembly.ts",
      "utf8",
    );
    assert.equal(/from\s+["'][^"']*lateral-reach-engine/.test(source), false);
    assert.equal(/validateLateralReachConfig/.test(source), false);
    assert.equal(/tracking/.test(source), false);
    assert.equal(/timing/.test(source), false);
    assert.equal(/Math\.sign\s*\(/.test(source), false);
    assert.equal(/interactionFraction/.test(source), false);
    assert.equal(/engine_config_invalid/.test(source), false);
    // testedSide is metadata only — must not map to direction
    assert.equal(/testedSide\s*===\s*["']right["']/.test(source), false);
    assert.equal(/testedSide\s*===\s*["']left["']\s*\?/.test(source), false);
  });

  it("never emits engine_config_invalid on any stage", () => {
    const results = [
      assembleLateralReachCalibrationResult({
        testedSide: "right",
        stage: "start_failed",
        failureReasons: ["start_timeout"],
      }),
      assembleLateralReachCalibrationResult({
        testedSide: "right",
        stage: "endpoint_failed",
        startWrist: { x: 0.3, y: 0.5 },
        failureReasons: ["endpoint_hold_not_confirmed"],
      }),
      assembleLateralReachCalibrationResult(capturedInput()),
      assembleLateralReachCalibrationResult(
        capturedInput({
          heldEndpoint: { x: 0.1, y: 0.5 },
        }),
      ),
      assembleLateralReachCalibrationResult(
        capturedInput({
          heldEndpoint: { x: 0.5, y: 0.5 },
          zoneRadii: createLateralReachCalibrationZoneRadii({
            startingZoneRadius: 0.125,
            fixedTargetRadius: 0.125,
          }),
        }),
      ),
    ];
    for (const result of results) {
      assert.equal(JSON.stringify(result).includes("engine_config_invalid"), false);
    }
  });
});
