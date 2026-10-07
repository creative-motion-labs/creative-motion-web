/**
 * Lateral Reach camera lab — Slice 17: technical-config intake tests.
 *
 * Behavioral tests for lab-local technical-config lock, structural validation,
 * fail-closed semantics, and compatibility with Slice 11 + Slice 7.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createLateralReachCalibrationController } from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import { buildLateralReachEngineConfig } from "@/app/lib/interaction-calibration/lateral-reach/engine-config-adapter";
import { LATERAL_REACH_CALIBRATION_SCHEMA_VERSION } from "@/app/lib/interaction-calibration/lateral-reach/types";
import {
  lockLateralReachLabTechnicalConfig,
  tryLockLateralReachLabTechnicalConfig,
  canLockLateralReachLabTechnicalConfig,
  parseLabTechnicalConfigInput,
} from "./technical-config-intake";

// Test-only fixture — NOT for production
const TEST_VALID_CONFIG = {
  startCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 10,
    totalTimeoutMs: 3000,
  },
  endpointCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 10,
    totalTimeoutMs: 3000,
    minDisplacementFromStart: 0.15,
  },
  zoneRadii: {
    startingZoneRadius: 0.05,
    fixedTargetRadius: 0.05,
  },
  noiseFloor: {
    minDirectionAlignedMagnitude: 0.08,
  },
  tracking: {
    minWristVisibility: 0.3,
    maxAllowedGapMs: 300,
  },
  timing: {
    onsetConfirmationMs: 100,
    dwellDurationMs: 200,
    returnConfirmationMs: 150,
  },
};

describe("lockLateralReachLabTechnicalConfig — complete valid config", () => {
  it("locks complete explicit structured input successfully", () => {
    const lock = lockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    assert.ok(lock.lockedConfig);
    assert.equal(
      lock.lockedConfig.startCaptureConfig.minStableDurationMs,
      500,
    );
    assert.equal(
      lock.lockedConfig.endpointCaptureConfig.minDisplacementFromStart,
      0.15,
    );
    assert.equal(lock.lockedConfig.zoneRadii.startingZoneRadius, 0.05);
    assert.equal(
      lock.lockedConfig.noiseFloor.minDirectionAlignedMagnitude,
      0.08,
    );
    assert.equal(lock.lockedConfig.tracking.minWristVisibility, 0.3);
    assert.equal(lock.lockedConfig.timing.onsetConfirmationMs, 100);
  });

  it("locked config contains all 17 numeric values", () => {
    const lock = lockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    const { lockedConfig } = lock;

    // Start capture: 4
    assert.ok(
      typeof lockedConfig.startCaptureConfig.minStableDurationMs === "number",
    );
    assert.ok(
      typeof lockedConfig.startCaptureConfig.maxJitterRadius === "number",
    );
    assert.ok(
      typeof lockedConfig.startCaptureConfig.minStableSampleCount === "number",
    );
    assert.ok(
      typeof lockedConfig.startCaptureConfig.totalTimeoutMs === "number",
    );

    // Endpoint capture: 5
    assert.ok(
      typeof lockedConfig.endpointCaptureConfig.minStableDurationMs ===
        "number",
    );
    assert.ok(
      typeof lockedConfig.endpointCaptureConfig.maxJitterRadius === "number",
    );
    assert.ok(
      typeof lockedConfig.endpointCaptureConfig.minStableSampleCount ===
        "number",
    );
    assert.ok(
      typeof lockedConfig.endpointCaptureConfig.totalTimeoutMs === "number",
    );
    assert.ok(
      typeof lockedConfig.endpointCaptureConfig.minDisplacementFromStart ===
        "number",
    );

    // Zone radii: 2
    assert.ok(
      typeof lockedConfig.zoneRadii.startingZoneRadius === "number",
    );
    assert.ok(
      typeof lockedConfig.zoneRadii.fixedTargetRadius === "number",
    );

    // Noise floor: 1
    assert.ok(
      typeof lockedConfig.noiseFloor.minDirectionAlignedMagnitude === "number",
    );

    // Tracking: 2
    assert.ok(typeof lockedConfig.tracking.minWristVisibility === "number");
    assert.ok(typeof lockedConfig.tracking.maxAllowedGapMs === "number");

    // Timing: 3
    assert.ok(typeof lockedConfig.timing.onsetConfirmationMs === "number");
    assert.ok(typeof lockedConfig.timing.dwellDurationMs === "number");
    assert.ok(typeof lockedConfig.timing.returnConfirmationMs === "number");

    // Total: 17
  });
});

describe("lockLateralReachLabTechnicalConfig — delegation to existing validators", () => {
  it("delegates startCaptureConfig to Slice 2 validator", () => {
    const invalid = {
      ...TEST_VALID_CONFIG,
      startCaptureConfig: {
        ...TEST_VALID_CONFIG.startCaptureConfig,
        minStableSampleCount: 0, // Invalid — must be >= 1
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(invalid),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minStableSampleCount_must_be_at_least_1"),
    );
  });

  it("delegates endpointCaptureConfig to Slice 3 validator", () => {
    const invalid = {
      ...TEST_VALID_CONFIG,
      endpointCaptureConfig: {
        ...TEST_VALID_CONFIG.endpointCaptureConfig,
        totalTimeoutMs: 100, // Invalid — must be >= minStableDurationMs (500)
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(invalid),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("totalTimeoutMs_must_be_gte_minStableDurationMs"),
    );
  });

  it("delegates zoneRadii to Slice 9 factory", () => {
    const invalid = {
      ...TEST_VALID_CONFIG,
      zoneRadii: {
        ...TEST_VALID_CONFIG.zoneRadii,
        startingZoneRadius: 0, // Invalid — must be > 0
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(invalid),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("startingZoneRadius must be a finite number greater than 0"),
    );
  });

  it("delegates noiseFloor to Slice 9 factory", () => {
    const invalid = {
      ...TEST_VALID_CONFIG,
      noiseFloor: {
        minDirectionAlignedMagnitude: -0.1, // Invalid — must be > 0
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(invalid),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minDirectionAlignedMagnitude must be a finite number greater than 0"),
    );
  });
});

describe("lockLateralReachLabTechnicalConfig — fail-closed semantics", () => {
  it("missing group fails closed", () => {
    const missingTracking = { ...TEST_VALID_CONFIG };
    delete (missingTracking as { tracking?: unknown }).tracking;
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(missingTracking),
      RangeError,
    );
  });

  it("missing field fails closed", () => {
    const missingField = {
      ...TEST_VALID_CONFIG,
      tracking: {
        minWristVisibility: 0.3,
        // maxAllowedGapMs missing
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(missingField),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("maxAllowedGapMs"),
    );
  });

  it("programmatic NaN fails", () => {
    const withNaN = {
      ...TEST_VALID_CONFIG,
      tracking: {
        ...TEST_VALID_CONFIG.tracking,
        minWristVisibility: NaN,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(withNaN),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minWristVisibility"),
    );
  });

  it("programmatic Infinity fails", () => {
    const withInfinity = {
      ...TEST_VALID_CONFIG,
      timing: {
        ...TEST_VALID_CONFIG.timing,
        onsetConfirmationMs: Infinity,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(withInfinity),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("onsetConfirmationMs"),
    );
  });

  it("programmatic -Infinity fails", () => {
    const withNegInfinity = {
      ...TEST_VALID_CONFIG,
      timing: {
        ...TEST_VALID_CONFIG.timing,
        dwellDurationMs: -Infinity,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(withNegInfinity),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("dwellDurationMs"),
    );
  });

  it("string number is not coerced", () => {
    const withString = {
      ...TEST_VALID_CONFIG,
      tracking: {
        ...TEST_VALID_CONFIG.tracking,
        minWristVisibility: "0.3" as unknown as number,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(withString),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minWristVisibility"),
    );
  });
});

describe("lockLateralReachLabTechnicalConfig — zero and negative behavior", () => {
  it("zero minStableDurationMs succeeds (valid >= 0)", () => {
    const withZero = {
      ...TEST_VALID_CONFIG,
      startCaptureConfig: {
        ...TEST_VALID_CONFIG.startCaptureConfig,
        minStableDurationMs: 0,
        totalTimeoutMs: 0, // Also adjust to maintain constraint
      },
    };
    assert.doesNotThrow(() => lockLateralReachLabTechnicalConfig(withZero));
  });

  it("zero minWristVisibility succeeds (valid [0,1])", () => {
    const withZero = {
      ...TEST_VALID_CONFIG,
      tracking: {
        ...TEST_VALID_CONFIG.tracking,
        minWristVisibility: 0,
      },
    };
    assert.doesNotThrow(() => lockLateralReachLabTechnicalConfig(withZero));
  });

  it("minWristVisibility = 1 succeeds (upper bound)", () => {
    const withOne = {
      ...TEST_VALID_CONFIG,
      tracking: {
        ...TEST_VALID_CONFIG.tracking,
        minWristVisibility: 1,
      },
    };
    assert.doesNotThrow(() => lockLateralReachLabTechnicalConfig(withOne));
  });

  it("minWristVisibility > 1 fails", () => {
    const overOne = {
      ...TEST_VALID_CONFIG,
      tracking: {
        ...TEST_VALID_CONFIG.tracking,
        minWristVisibility: 1.1,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(overOne),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minWristVisibility"),
    );
  });

  it("negative minStableDurationMs fails", () => {
    const negative = {
      ...TEST_VALID_CONFIG,
      startCaptureConfig: {
        ...TEST_VALID_CONFIG.startCaptureConfig,
        minStableDurationMs: -100,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(negative),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minStableDurationMs_must_be_non_negative"),
    );
  });

  it("minStableSampleCount non-integer fails", () => {
    const nonInteger = {
      ...TEST_VALID_CONFIG,
      startCaptureConfig: {
        ...TEST_VALID_CONFIG.startCaptureConfig,
        minStableSampleCount: 10.5,
      },
    };
    assert.throws(
      () => lockLateralReachLabTechnicalConfig(nonInteger),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("minStableSampleCount_must_be_integer"),
    );
  });
});

describe("lockLateralReachLabTechnicalConfig — snapshot isolation", () => {
  it("locked snapshot is isolated from input mutation", () => {
    const mutableInput = { ...TEST_VALID_CONFIG };
    const lock = lockLateralReachLabTechnicalConfig(mutableInput);

    // Mutate original input
    mutableInput.tracking.minWristVisibility = 0.9;
    mutableInput.timing.onsetConfirmationMs = 999;

    // Locked config unchanged
    assert.equal(lock.lockedConfig.tracking.minWristVisibility, 0.3);
    assert.equal(lock.lockedConfig.timing.onsetConfirmationMs, 100);
  });
});

describe("tryLockLateralReachLabTechnicalConfig — safe wrapper", () => {
  it("success path returns lock", () => {
    const result = tryLockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.lock.lockedConfig);
    }
  });

  it("failure preserves previous valid lock", () => {
    const validLock = lockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    const invalid = { ...TEST_VALID_CONFIG };
    delete (invalid as { tracking?: unknown }).tracking;

    const result = tryLockLateralReachLabTechnicalConfig(invalid, validLock);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.deepEqual(result.previousLock, validLock);
    }
  });

  it("failure returns clear error message", () => {
    const invalid = { not: "a valid config" };
    const result = tryLockLateralReachLabTechnicalConfig(invalid);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.ok(result.error.length > 0);
    }
  });
});

describe("canLockLateralReachLabTechnicalConfig — pre-validation", () => {
  it("empty string returns false", () => {
    assert.equal(canLockLateralReachLabTechnicalConfig(""), false);
  });

  it("whitespace-only returns false", () => {
    assert.equal(canLockLateralReachLabTechnicalConfig("   "), false);
  });

  it("invalid JSON returns false", () => {
    assert.equal(canLockLateralReachLabTechnicalConfig("{ invalid }"), false);
  });

  it("valid JSON object structure returns true", () => {
    const jsonString = JSON.stringify(TEST_VALID_CONFIG);
    assert.equal(canLockLateralReachLabTechnicalConfig(jsonString), true);
  });

  it("JSON array returns false", () => {
    assert.equal(canLockLateralReachLabTechnicalConfig("[]"), false);
  });
});

describe("parseLabTechnicalConfigInput — JSON parsing", () => {
  it("empty input fails closed", () => {
    assert.throws(
      () => parseLabTechnicalConfigInput(""),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("Config input cannot be empty"),
    );
  });

  it("invalid JSON fails closed", () => {
    assert.throws(
      () => parseLabTechnicalConfigInput("{ not valid }"),
      (err: unknown) =>
        err instanceof RangeError && err.message.includes("Invalid JSON"),
    );
  });

  it("valid JSON parses successfully", () => {
    const jsonString = JSON.stringify(TEST_VALID_CONFIG);
    const parsed = parseLabTechnicalConfigInput(jsonString);
    assert.ok(typeof parsed === "object");
  });
});

describe("Slice 11 controller compatibility", () => {
  it("locked config feeds controller creation with minimal extraction", () => {
    const lock = lockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    const { lockedConfig } = lock;

    // Controller expects raw input for factories, validated types for configs
    // noiseFloor: controller re-validates via factory, so extract magnitude
    // zoneRadii: controller re-validates via factory, pass object directly
    const controllerInput = {
      testedSide: "right",
      plan: { screenHorizontalDirection: "positive_x" },
      startCaptureConfig: lockedConfig.startCaptureConfig,
      endpointCaptureConfig: lockedConfig.endpointCaptureConfig,
      noiseFloor: lockedConfig.noiseFloor.minDirectionAlignedMagnitude,
      zoneRadii: lockedConfig.zoneRadii,
    };

    assert.doesNotThrow(() =>
      createLateralReachCalibrationController(controllerInput),
    );
  });
});

describe("Slice 7 engine adapter compatibility", () => {
  it("locked tracking and timing feed engine adapter without transformation", () => {
    const lock = lockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    const { lockedConfig } = lock;

    // Mock geometry-ready result
    const mockGeometryReadyResult = {
      schemaVersion: LATERAL_REACH_CALIBRATION_SCHEMA_VERSION,
      captureOutcome: "valid" as const,
      geometryOutcome: "ready" as const,
      testedSide: "right" as const,
      observations: {
        startWrist: { x: 0.3, y: 0.5 },
        heldEndpoint: { x: 0.7, y: 0.5 },
      },
      derivedMeasurements: {
        rawDeltaX: 0.4,
        expectedHorizontalDirectionSign: 1 as const,
        directionAlignedMagnitude: 0.4,
      },
      frozenGeometry: {
        startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
      },
      requestedInteractionFraction: 0.8,
      effectiveInteractionFraction: 0.8,
      technicalAdjustments: [],
    };

    // Engine adapter expects these exact property names
    const engineConfigResult = buildLateralReachEngineConfig(
      mockGeometryReadyResult,
      lockedConfig.tracking,
      lockedConfig.timing,
    );

    assert.ok(engineConfigResult.ok);
  });
});

describe("minWristVisibility single-source proof", () => {
  it("tracking contains exactly one minWristVisibility field", () => {
    const lock = lockLateralReachLabTechnicalConfig(TEST_VALID_CONFIG);
    const { tracking } = lock.lockedConfig;

    assert.ok("minWristVisibility" in tracking);
    assert.equal(typeof tracking.minWristVisibility, "number");

    // Verify no duplicate in other groups
    const { startCaptureConfig, endpointCaptureConfig, zoneRadii, noiseFloor, timing } =
      lock.lockedConfig;

    assert.ok(!("minWristVisibility" in startCaptureConfig));
    assert.ok(!("minWristVisibility" in endpointCaptureConfig));
    assert.ok(!("minWristVisibility" in zoneRadii));
    assert.ok(!("minWristVisibility" in noiseFloor));
    assert.ok(!("minWristVisibility" in timing));
  });
});

describe("Slice 17 scope guards", () => {
  it("helper does not call createLateralReachCalibrationController", () => {
    const source = readFileSync(
      path.join(__dirname, "technical-config-intake.ts"),
      "utf8",
    );
    assert.equal(
      source.includes("createLateralReachCalibrationController"),
      false,
    );
  });

  it("helper does not call resolveLateralReachCalibrationSampleFromFrame", () => {
    const source = readFileSync(
      path.join(__dirname, "technical-config-intake.ts"),
      "utf8",
    );
    assert.equal(
      source.includes("resolveLateralReachCalibrationSampleFromFrame"),
      false,
    );
  });

  it("helper does not call startAcquisition", () => {
    const source = readFileSync(
      path.join(__dirname, "technical-config-intake.ts"),
      "utf8",
    );
    assert.equal(source.includes("startAcquisition"), false);
  });

  it("helper does not call startEngine", () => {
    const source = readFileSync(
      path.join(__dirname, "technical-config-intake.ts"),
      "utf8",
    );
    assert.equal(source.includes("startEngine"), false);
  });

  it("helper does not call buildLateralReachEngineConfig", () => {
    const source = readFileSync(
      path.join(__dirname, "technical-config-intake.ts"),
      "utf8",
    );
    assert.equal(source.includes("buildLateralReachEngineConfig"), false);
  });

  it("no numeric defaults exported", () => {
    const source = readFileSync(
      path.join(__dirname, "technical-config-intake.ts"),
      "utf8",
    );
    // Should not export any constant matching the test config structure
    assert.equal(source.includes("export const"), false);
  });
});
