/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/engine-config-adapter.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LATERAL_REACH_NOISE_FLOOR_KIND,
  type LateralReachCalibrationGeometryReadyResult,
  type LateralReachNoiseFloorConfig,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import { createLateralReachCalibrationAttemptIntention } from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";
import { assembleLateralReachCalibrationResult } from "@/app/lib/interaction-calibration/lateral-reach/result-assembly";
import {
  type LateralReachTimingConfig,
  type LateralReachTrackingConfig,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import { buildLateralReachEngineConfig } from "@/app/lib/interaction-calibration/lateral-reach/engine-config-adapter";

function noiseFloor(
  minDirectionAlignedMagnitude = 0.05,
): LateralReachNoiseFloorConfig {
  return {
    kind: LATERAL_REACH_NOISE_FLOOR_KIND,
    minDirectionAlignedMagnitude,
  };
}

const READY_RADII = {
  startingZoneRadius: 0.05,
  fixedTargetRadius: 0.05,
};

const VALID_TRACKING: LateralReachTrackingConfig = {
  minWristVisibility: 0.3,
  maxAllowedGapMs: 300,
};

const VALID_TIMING: LateralReachTimingConfig = {
  onsetConfirmationMs: 100,
  dwellDurationMs: 200,
  returnConfirmationMs: 150,
};

function buildReadyCalibration(input: {
  testedSide: "left" | "right";
  startWrist: { x: number; y: number };
  heldEndpoint: { x: number; y: number };
  expectedHorizontalDirectionSign: 1 | -1;
}): LateralReachCalibrationGeometryReadyResult {
  const result = assembleLateralReachCalibrationResult({
    testedSide: input.testedSide,
    stage: "captured",
    startWrist: input.startWrist,
    heldEndpoint: input.heldEndpoint,
    intention: createLateralReachCalibrationAttemptIntention(
      input.expectedHorizontalDirectionSign,
    ),
    noiseFloor: noiseFloor(),
    zoneRadii: { ...READY_RADII },
  });

  assert.equal(result.geometryOutcome, "ready");
  if (result.geometryOutcome !== "ready") {
    throw new Error("expected geometryOutcome ready");
  }
  return result;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("buildLateralReachEngineConfig — canonical +1", () => {
  it("maps ready calibration with testedSide left and +1 screen direction", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });
    assert.ok(calibration.observations.startWrist.x < calibration.observations.heldEndpoint.x);

    const result = buildLateralReachEngineConfig(
      calibration,
      { ...VALID_TRACKING },
      { ...VALID_TIMING },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const { config } = result;
    assert.deepEqual(config.startingZone, {
      point: { ...calibration.frozenGeometry.startingZone.point },
      radius: calibration.frozenGeometry.startingZone.radius,
    });
    assert.deepEqual(config.fixedTarget, {
      point: { ...calibration.frozenGeometry.fixedTarget.point },
      radius: calibration.frozenGeometry.fixedTarget.radius,
    });
    assert.deepEqual(config.tracking, VALID_TRACKING);
    assert.deepEqual(config.timing, VALID_TIMING);
    assert.equal(config.testedSide, "left");
    assert.equal(config.expectedHorizontalDirectionSign, 1);
    assert.equal(
      config.expectedHorizontalDirectionSign,
      calibration.derivedMeasurements.expectedHorizontalDirectionSign,
    );
  });
});

describe("buildLateralReachEngineConfig — canonical -1", () => {
  it("maps ready calibration with testedSide right and -1 screen direction", () => {
    const calibration = buildReadyCalibration({
      testedSide: "right",
      startWrist: { x: 0.75, y: 0.5 },
      heldEndpoint: { x: 0.25, y: 0.5 },
      expectedHorizontalDirectionSign: -1,
    });
    assert.ok(calibration.observations.startWrist.x > calibration.observations.heldEndpoint.x);

    const result = buildLateralReachEngineConfig(
      calibration,
      { ...VALID_TRACKING },
      { ...VALID_TIMING },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.config.testedSide, "right");
    assert.equal(result.config.expectedHorizontalDirectionSign, -1);
    assert.equal(
      result.config.expectedHorizontalDirectionSign,
      calibration.derivedMeasurements.expectedHorizontalDirectionSign,
    );
  });
});

describe("buildLateralReachEngineConfig — invalid tracking", () => {
  it("passes through invalid_tracking_config for visibility out of range", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });

    const result = buildLateralReachEngineConfig(
      calibration,
      { minWristVisibility: 1.1, maxAllowedGapMs: 300 },
      { ...VALID_TIMING },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_tracking_config");
  });

  it("passes through invalid_tracking_config for negative gap", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });

    const result = buildLateralReachEngineConfig(
      calibration,
      { minWristVisibility: 0.3, maxAllowedGapMs: -1 },
      { ...VALID_TIMING },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_tracking_config");
  });
});

describe("buildLateralReachEngineConfig — invalid timing", () => {
  it("passes through invalid_timing_config for each negative timing field", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });

    const cases: LateralReachTimingConfig[] = [
      { onsetConfirmationMs: -1, dwellDurationMs: 200, returnConfirmationMs: 150 },
      { onsetConfirmationMs: 100, dwellDurationMs: -1, returnConfirmationMs: 150 },
      { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: -1 },
    ];

    for (const timing of cases) {
      const result = buildLateralReachEngineConfig(
        calibration,
        { ...VALID_TRACKING },
        timing,
      );
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.reason, "invalid_timing_config");
    }
  });
});

describe("buildLateralReachEngineConfig — isolation", () => {
  it("does not mutate caller-owned calibration, tracking, or timing inputs", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });
    const tracking: LateralReachTrackingConfig = { ...VALID_TRACKING };
    const timing: LateralReachTimingConfig = { ...VALID_TIMING };

    const calibrationBefore = cloneJson(calibration);
    const trackingBefore = cloneJson(tracking);
    const timingBefore = cloneJson(timing);

    const result = buildLateralReachEngineConfig(calibration, tracking, timing);
    assert.equal(result.ok, true);

    assert.deepEqual(cloneJson(calibration), calibrationBefore);
    assert.deepEqual(tracking, trackingBefore);
    assert.deepEqual(timing, timingBefore);
  });

  it("isolates validated config from later caller tracking/timing mutation", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });
    const tracking: LateralReachTrackingConfig = { ...VALID_TRACKING };
    const timing: LateralReachTimingConfig = { ...VALID_TIMING };

    const result = buildLateralReachEngineConfig(calibration, tracking, timing);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const trackingSnapshot = cloneJson(result.config.tracking);
    const timingSnapshot = cloneJson(result.config.timing);

    tracking.minWristVisibility = 0.99;
    tracking.maxAllowedGapMs = 999;
    timing.onsetConfirmationMs = 999;
    timing.dwellDurationMs = 999;
    timing.returnConfirmationMs = 999;

    assert.deepEqual(result.config.tracking, trackingSnapshot);
    assert.deepEqual(result.config.timing, timingSnapshot);
  });

  it("deep-equals output geometry to frozenGeometry without requiring reference identity", () => {
    const calibration = buildReadyCalibration({
      testedSide: "left",
      startWrist: { x: 0.25, y: 0.5 },
      heldEndpoint: { x: 0.75, y: 0.5 },
      expectedHorizontalDirectionSign: 1,
    });

    const result = buildLateralReachEngineConfig(
      calibration,
      { ...VALID_TRACKING },
      { ...VALID_TIMING },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(result.config.startingZone, {
      point: { ...calibration.frozenGeometry.startingZone.point },
      radius: calibration.frozenGeometry.startingZone.radius,
    });
    assert.deepEqual(result.config.fixedTarget, {
      point: { ...calibration.frozenGeometry.fixedTarget.point },
      radius: calibration.frozenGeometry.fixedTarget.radius,
    });
    assert.notEqual(result.config.startingZone, calibration.frozenGeometry.startingZone);
    assert.notEqual(result.config.fixedTarget, calibration.frozenGeometry.fixedTarget);
    assert.notEqual(
      result.config.startingZone.point,
      calibration.frozenGeometry.startingZone.point,
    );
    assert.notEqual(
      result.config.fixedTarget.point,
      calibration.frozenGeometry.fixedTarget.point,
    );
  });
});

describe("buildLateralReachEngineConfig — source contracts", () => {
  const adapterSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "engine-config-adapter.ts"),
    "utf8",
  );

  it("does not derive direction in adapter runtime source", () => {
    assert.equal(adapterSource.includes("Math.sign"), false);
    assert.equal(adapterSource.includes("expectedHorizontalDirectionSign"), false);
    assert.equal(adapterSource.includes('testedSide === "left"'), false);
    assert.equal(adapterSource.includes("testedSide === 'left'"), false);
    assert.equal(adapterSource.includes('testedSide === "right"'), false);
    assert.equal(adapterSource.includes("testedSide === 'right'"), false);

    const directionCompare =
      /fixedTarget[\s\S]{0,80}startingZone[\s\S]{0,40}\.x|startingZone[\s\S]{0,80}fixedTarget[\s\S]{0,40}\.x/;
    assert.equal(directionCompare.test(adapterSource), false);
  });

  it("contains no numeric tracking/timing defaults", () => {
    assert.match(
      adapterSource,
      /tracking,\s*\n\s*timing,/,
    );
    assert.equal(/\bminWristVisibility\s*:/.test(adapterSource), false);
    assert.equal(/\bmaxAllowedGapMs\s*:/.test(adapterSource), false);
    assert.equal(/\bonsetConfirmationMs\s*:/.test(adapterSource), false);
    assert.equal(/\bdwellDurationMs\s*:/.test(adapterSource), false);
    assert.equal(/\breturnConfirmationMs\s*:/.test(adapterSource), false);
    assert.equal(/\b0\.\d+/.test(adapterSource), false);
  });

  it("keeps dependency and vocabulary isolation", () => {
    const forbiddenSubstrings = [
      "camera",
      "MediaPipe",
      "mediapipe",
      "page.tsx",
      "supabase",
      "Supabase",
      "persistence",
      "Session Orchestrator",
      "session-orchestrator",
      "maximal reach",
      "safe reach",
      "comfortable reach",
      "engine_config_invalid",
    ];
    for (const token of forbiddenSubstrings) {
      assert.equal(
        adapterSource.toLowerCase().includes(token.toLowerCase()),
        false,
        `adapter must not contain ${token}`,
      );
    }

    const forbiddenWords = [
      "React",
      "ROM",
      "strength",
      "impairment",
      "ability",
      "diagnosis",
      "prognosis",
    ];
    for (const word of forbiddenWords) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      assert.equal(re.test(adapterSource), false, `adapter must not contain word ${word}`);
    }

    assert.equal(/from\s+["'][^"']*\/api\/[^"']*["']/.test(adapterSource), false);
  });
});
