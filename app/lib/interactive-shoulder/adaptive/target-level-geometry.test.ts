/**
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/target-level-geometry.test.ts
 *
 * CLINICAL SAFETY: every degree value below is a TEST FIXTURE for target-placement
 * geometry only. None of these numbers is a clinically validated range-of-motion
 * limit, and none represents a measured shoulder abduction angle. Production
 * placement limits require therapist or clinical-team approval.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_TARGET_ANCHOR_SEPARATION_NORMALIZED,
  clampLevelDegrees,
  lateralDirectionForSide,
  projectTargetLevelPosition,
  resolveTargetLevelPosition,
  type TargetLevelGeometryInput,
} from "./target-level-geometry";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "../target-generator";
import type { NormalizedPoint } from "../types";

/** Mirror-image anchors about x = 0.5, matching the mirrored preview convention. */
const RIGHT_ANCHOR: NormalizedPoint = { x: 0.55, y: 0.35 };
const LEFT_ANCHOR: NormalizedPoint = { x: 0.45, y: 0.35 };
const REACH_RADIUS = 0.25;

// Test fixture placement limits — NOT clinically approved values.
const MIN_LEVEL_DEGREES = 30;
const MAX_LEVEL_DEGREES = 120;

function baseInput(
  overrides: Partial<TargetLevelGeometryInput> = {},
): TargetLevelGeometryInput {
  return {
    affectedSide: "right",
    shoulderAnchorNormalized: RIGHT_ANCHOR,
    reachRadiusNormalized: REACH_RADIUS,
    levelDegrees: 90,
    minimumLevelDegrees: MIN_LEVEL_DEGREES,
    maximumLevelDegrees: MAX_LEVEL_DEGREES,
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    ...overrides,
  };
}

function expectAvailable(result: ReturnType<typeof resolveTargetLevelPosition>) {
  assert.equal(result.available, true);
  if (!result.available) throw new Error("unreachable");
  return result;
}

const closeTo = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );

describe("target level geometry — coordinate mapping", () => {
  it("places a right-side target laterally toward higher x at 90 degrees", () => {
    const result = expectAvailable(resolveTargetLevelPosition(baseInput()));

    closeTo(result.position.x, RIGHT_ANCHOR.x + REACH_RADIUS);
    closeTo(result.position.y, RIGHT_ANCHOR.y);
    assert.equal(result.appliedLevelDegrees, 90);
    assert.equal(result.levelWasClamped, false);
    assert.equal(result.positionWasClampedToBounds, false);
  });

  it("mirrors a left-side target laterally toward lower x at 90 degrees", () => {
    const result = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({ affectedSide: "left", shoulderAnchorNormalized: LEFT_ANCHOR }),
      ),
    );

    closeTo(result.position.x, LEFT_ANCHOR.x - REACH_RADIUS);
    closeTo(result.position.y, LEFT_ANCHOR.y);
  });

  it("maps 0 degrees below and 180 degrees above the anchor (y grows downward)", () => {
    // Radius chosen so neither pole is altered by safe-bounds clamping, which would
    // otherwise mask the raw mapping under test.
    const radius = 0.2;

    const atRest = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({
          levelDegrees: 0,
          minimumLevelDegrees: 0,
          maximumLevelDegrees: 180,
          reachRadiusNormalized: radius,
        }),
      ),
    );
    closeTo(atRest.position.x, RIGHT_ANCHOR.x);
    closeTo(atRest.position.y, RIGHT_ANCHOR.y + radius);
    assert.equal(atRest.positionWasClampedToBounds, false);
    assert.ok(atRest.position.y > RIGHT_ANCHOR.y, "0 degrees must sit below the shoulder");

    const overhead = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({
          levelDegrees: 180,
          minimumLevelDegrees: 0,
          maximumLevelDegrees: 180,
          reachRadiusNormalized: radius,
        }),
      ),
    );
    closeTo(overhead.position.x, RIGHT_ANCHOR.x);
    closeTo(overhead.position.y, RIGHT_ANCHOR.y - radius);
    assert.equal(overhead.positionWasClampedToBounds, false);
    assert.ok(overhead.position.y < RIGHT_ANCHOR.y, "180 degrees must sit above the shoulder");
  });

  it("exposes the lateral direction per side", () => {
    assert.equal(lateralDirectionForSide("right"), 1);
    assert.equal(lateralDirectionForSide("left"), -1);
  });

  it("produces mirror-symmetric positions for mirror-symmetric inputs", () => {
    for (const levelDegrees of [0, 30, 45, 90, 135, 180]) {
      const right = projectTargetLevelPosition(
        RIGHT_ANCHOR,
        REACH_RADIUS,
        levelDegrees,
        "right",
      );
      const left = projectTargetLevelPosition(LEFT_ANCHOR, REACH_RADIUS, levelDegrees, "left");

      closeTo(left.x, 1 - right.x, 1e-9);
      closeTo(left.y, right.y, 1e-9);
    }
  });

  it("returns finite coordinates across the whole sweep", () => {
    for (let levelDegrees = 0; levelDegrees <= 180; levelDegrees += 5) {
      for (const affectedSide of ["right", "left"] as const) {
        const anchor = affectedSide === "right" ? RIGHT_ANCHOR : LEFT_ANCHOR;
        const result = resolveTargetLevelPosition(
          baseInput({
            affectedSide,
            shoulderAnchorNormalized: anchor,
            levelDegrees,
            minimumLevelDegrees: 0,
            maximumLevelDegrees: 180,
          }),
        );
        assert.equal(result.available, true, `level ${levelDegrees} ${affectedSide}`);
        if (!result.available) continue;
        assert.ok(Number.isFinite(result.position.x));
        assert.ok(Number.isFinite(result.position.y));
      }
    }
  });
});

describe("target level geometry — level clamping", () => {
  it("clamps a requested level below the approved minimum", () => {
    const result = expectAvailable(resolveTargetLevelPosition(baseInput({ levelDegrees: 5 })));

    assert.equal(result.appliedLevelDegrees, MIN_LEVEL_DEGREES);
    assert.equal(result.levelWasClamped, true);
  });

  it("clamps a requested level above the approved maximum", () => {
    const result = expectAvailable(resolveTargetLevelPosition(baseInput({ levelDegrees: 400 })));

    assert.equal(result.appliedLevelDegrees, MAX_LEVEL_DEGREES);
    assert.equal(result.levelWasClamped, true);
  });

  it("leaves an in-range starting level untouched", () => {
    const result = expectAvailable(resolveTargetLevelPosition(baseInput({ levelDegrees: 60 })));

    assert.equal(result.appliedLevelDegrees, 60);
    assert.equal(result.levelWasClamped, false);
  });

  it("clamps levels directly through the exported helper", () => {
    assert.equal(clampLevelDegrees(5, 30, 120), 30);
    assert.equal(clampLevelDegrees(400, 30, 120), 120);
    assert.equal(clampLevelDegrees(60, 30, 120), 60);
  });

  it("rejects an inverted or non-finite approved range", () => {
    const inverted = resolveTargetLevelPosition(
      baseInput({ minimumLevelDegrees: 120, maximumLevelDegrees: 30 }),
    );
    assert.deepEqual(inverted, { available: false, reason: "invalidLevelRange" });

    const nonFinite = resolveTargetLevelPosition(
      baseInput({ maximumLevelDegrees: Number.NaN }),
    );
    assert.deepEqual(nonFinite, { available: false, reason: "invalidLevelRange" });
  });

  it("rejects a non-finite requested level", () => {
    assert.deepEqual(resolveTargetLevelPosition(baseInput({ levelDegrees: Number.NaN })), {
      available: false,
      reason: "invalidLevelDegrees",
    });
  });
});

describe("target level geometry — safe bounds", () => {
  it("keeps a far lateral target inside the safe horizontal bounds", () => {
    const right = expectAvailable(
      resolveTargetLevelPosition(baseInput({ reachRadiusNormalized: 0.6 })),
    );
    assert.equal(right.position.x, DEFAULT_SAFE_TARGET_BOUNDS.maxX);
    assert.equal(right.positionWasClampedToBounds, true);

    const left = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({
          affectedSide: "left",
          shoulderAnchorNormalized: LEFT_ANCHOR,
          reachRadiusNormalized: 0.6,
        }),
      ),
    );
    assert.equal(left.position.x, DEFAULT_SAFE_TARGET_BOUNDS.minX);
    assert.equal(left.positionWasClampedToBounds, true);
  });

  it("keeps overhead and at-rest targets inside the safe vertical bounds", () => {
    const overhead = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({
          levelDegrees: 180,
          minimumLevelDegrees: 0,
          maximumLevelDegrees: 180,
          reachRadiusNormalized: 0.6,
        }),
      ),
    );
    assert.equal(overhead.position.y, DEFAULT_SAFE_TARGET_BOUNDS.minY);

    const atRest = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({
          levelDegrees: 0,
          minimumLevelDegrees: 0,
          maximumLevelDegrees: 180,
          reachRadiusNormalized: 0.6,
        }),
      ),
    );
    assert.equal(atRest.position.y, DEFAULT_SAFE_TARGET_BOUNDS.maxY);
  });

  it("never leaves the safe bounds for any level or side", () => {
    for (let levelDegrees = 0; levelDegrees <= 180; levelDegrees += 10) {
      for (const affectedSide of ["right", "left"] as const) {
        const result = resolveTargetLevelPosition(
          baseInput({
            affectedSide,
            shoulderAnchorNormalized: affectedSide === "right" ? RIGHT_ANCHOR : LEFT_ANCHOR,
            levelDegrees,
            minimumLevelDegrees: 0,
            maximumLevelDegrees: 180,
            reachRadiusNormalized: 0.9,
          }),
        );
        if (!result.available) continue;
        assert.ok(result.position.x >= DEFAULT_SAFE_TARGET_BOUNDS.minX);
        assert.ok(result.position.x <= DEFAULT_SAFE_TARGET_BOUNDS.maxX);
        assert.ok(result.position.y >= DEFAULT_SAFE_TARGET_BOUNDS.minY);
        assert.ok(result.position.y <= DEFAULT_SAFE_TARGET_BOUNDS.maxY);
      }
    }
  });

  it("applies the existing side bias only when explicitly requested", () => {
    const unbiased = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({ affectedSide: "left", shoulderAnchorNormalized: LEFT_ANCHOR }),
      ),
    );
    const biased = expectAvailable(
      resolveTargetLevelPosition(
        baseInput({
          affectedSide: "left",
          shoulderAnchorNormalized: LEFT_ANCHOR,
          applySideBias: true,
        }),
      ),
    );

    // Left-biased bounds cap x at minX + 0.55 * width; the unbiased result is unaffected.
    assert.equal(unbiased.position.x, LEFT_ANCHOR.x - REACH_RADIUS);
    assert.ok(biased.position.x <= DEFAULT_SAFE_TARGET_BOUNDS.maxX);
  });
});

describe("target level geometry — unavailable geometry", () => {
  it("refuses a missing shoulder anchor instead of inventing one", () => {
    assert.deepEqual(
      resolveTargetLevelPosition(baseInput({ shoulderAnchorNormalized: null })),
      { available: false, reason: "missingShoulderAnchor" },
    );
  });

  it("refuses a non-finite shoulder anchor", () => {
    assert.deepEqual(
      resolveTargetLevelPosition(
        baseInput({ shoulderAnchorNormalized: { x: Number.NaN, y: 0.35 } }),
      ),
      { available: false, reason: "invalidShoulderAnchor" },
    );
  });

  it("refuses a missing reach radius", () => {
    assert.deepEqual(resolveTargetLevelPosition(baseInput({ reachRadiusNormalized: null })), {
      available: false,
      reason: "missingReachRadius",
    });
  });

  it("refuses a zero reach radius", () => {
    assert.deepEqual(resolveTargetLevelPosition(baseInput({ reachRadiusNormalized: 0 })), {
      available: false,
      reason: "invalidReachRadius",
    });
  });

  it("refuses a negative reach radius", () => {
    assert.deepEqual(resolveTargetLevelPosition(baseInput({ reachRadiusNormalized: -0.3 })), {
      available: false,
      reason: "invalidReachRadius",
    });
  });

  it("refuses a non-finite reach radius", () => {
    for (const radius of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.deepEqual(
        resolveTargetLevelPosition(baseInput({ reachRadiusNormalized: radius })),
        { available: false, reason: "invalidReachRadius" },
      );
    }
  });

  it("refuses a target that collapses onto the shoulder anchor", () => {
    const result = resolveTargetLevelPosition(
      baseInput({ reachRadiusNormalized: MIN_TARGET_ANCHOR_SEPARATION_NORMALIZED / 2 }),
    );

    assert.deepEqual(result, { available: false, reason: "targetCollapsedOntoAnchor" });
  });

  it("never returns coordinates on an unavailable result", () => {
    const result = resolveTargetLevelPosition(baseInput({ shoulderAnchorNormalized: null }));
    assert.equal("position" in result, false);
  });
});

describe("target level geometry — purity", () => {
  it("produces identical output for identical inputs", () => {
    const input = baseInput({ levelDegrees: 73 });

    assert.deepStrictEqual(
      resolveTargetLevelPosition(input),
      resolveTargetLevelPosition(input),
    );
  });

  it("does not mutate its inputs", () => {
    const anchor: NormalizedPoint = { ...RIGHT_ANCHOR };
    const bounds = { ...DEFAULT_SAFE_TARGET_BOUNDS };
    const input = Object.freeze(
      baseInput({
        shoulderAnchorNormalized: Object.freeze(anchor),
        bounds: Object.freeze(bounds),
        reachRadiusNormalized: 0.9,
      }),
    );
    const anchorSnapshot = { ...anchor };
    const boundsSnapshot = { ...bounds };

    resolveTargetLevelPosition(input);

    assert.deepEqual(anchor, anchorSnapshot);
    assert.deepEqual(bounds, boundsSnapshot);
  });

  it("returns a fresh position object each call", () => {
    const input = baseInput();
    const first = expectAvailable(resolveTargetLevelPosition(input));
    const second = expectAvailable(resolveTargetLevelPosition(input));

    assert.notEqual(first.position, second.position);
    assert.deepEqual(first.position, second.position);
  });
});
