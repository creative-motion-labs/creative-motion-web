/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/elbow-extension-engine.test.ts
 *
 * Synthetic NormalizedMotionFrame fixtures only — no camera, no UI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOTION_INTELLIGENCE_SCHEMA_VERSION, type JointId, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  applyElbowExtensionCommand,
  createElbowExtensionAttemptState,
  extractObserved2DElbowAngleDegrees,
  getElbowExtensionRuntimeSnapshot,
  validateElbowExtensionConfig,
  type ElbowExtensionAttemptState,
  type ElbowExtensionCommandResult,
  type ElbowExtensionConfig,
} from "@/app/lib/upper-limb-motor-screen/elbow-extension-engine";

const START_POINT = { x: 0.3, y: 0.5 };
const TARGET_POINT = { x: 0.7, y: 0.5 };

const CLINICAL_STOP_EVENT = {
  reason: "patient_requested_stop" as const,
  recordedAt: "2026-07-31T09:00:00.000Z",
  recordedBy: "clinician" as const,
  reviewRequired: true as const,
};

/** Collinear extended arm — interior elbow angle ~180°. */
const EXTENDED_ARM = {
  shoulder: { x: 0.25, y: 0.5 },
  elbow: { x: 0.4, y: 0.5 },
  wrist: { x: 0.55, y: 0.5 },
};

/** Flexed arm — interior elbow angle ~90°. */
const FLEXED_ARM = {
  shoulder: { x: 0.3, y: 0.5 },
  elbow: { x: 0.3, y: 0.62 },
  wrist: { x: 0.38, y: 0.62 },
};

type ArmPose = {
  shoulder?: { x: number; y: number } | null;
  elbow?: { x: number; y: number } | null;
  wrist: { x: number; y: number } | null;
};

function rawConfig(overrides: Record<string, unknown> = {}) {
  return {
    testedSide: "right",
    fixedTarget: { point: TARGET_POINT, radius: 0.05 },
    startingZone: { point: START_POINT, radius: 0.05 },
    tracking: {
      minWristVisibility: 0.3,
      maxAllowedGapMs: 300,
      minShoulderVisibility: 0.3,
      minElbowVisibility: 0.3,
    },
    timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
    ...overrides,
  };
}

function buildValidConfig(overrides: Record<string, unknown> = {}): ElbowExtensionConfig {
  const result = validateElbowExtensionConfig(rawConfig(overrides));
  if (!result.ok) throw new Error(`test fixture config invalid: ${result.reason}`);
  return result.config;
}

function mustCreateState(
  config: ElbowExtensionConfig,
  attemptIndex: number,
  armedAtMs: number,
): ElbowExtensionAttemptState {
  const result = createElbowExtensionAttemptState(config, attemptIndex, armedAtMs);
  if (!result.ok) throw new Error(`test fixture: failed to create state (${result.reason})`);
  return result.state;
}

function frame(
  side: "left" | "right",
  pose: ArmPose | null,
  atMs: number,
  visibility = 0.9,
  jointVisibility?: { shoulder?: number; elbow?: number; wrist?: number },
): NormalizedMotionFrame {
  const joints: NormalizedMotionFrame["joints"] = {};
  if (pose) {
    const prefix = side === "left" ? "left" : "right";
    const put = (suffix: "shoulder" | "elbow" | "wrist", point: { x: number; y: number } | null | undefined) => {
      if (!point) return;
      const jointId = `${prefix}_${suffix}` as JointId;
      const vis =
        suffix === "shoulder"
          ? (jointVisibility?.shoulder ?? visibility)
          : suffix === "elbow"
            ? (jointVisibility?.elbow ?? visibility)
            : (jointVisibility?.wrist ?? visibility);
      joints[jointId] = {
        landmark: { x: point.x, y: point.y },
        confidence: { visibility: vis, present: true },
      };
    };
    put("shoulder", pose.shoulder);
    put("elbow", pose.elbow);
    put("wrist", pose.wrist);
  }
  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: { kind: "web_camera_pose", capturedAtMs: atMs, frameIndex: 0, coordinateSpace: "normalized_2d" },
    joints,
  };
}

function sendFrame(
  state: ElbowExtensionAttemptState,
  config: ElbowExtensionConfig,
  pose: ArmPose | null,
  atMs: number,
  visibility = 0.9,
  jointVisibility?: { shoulder?: number; elbow?: number; wrist?: number },
): ElbowExtensionCommandResult {
  return applyElbowExtensionCommand(state, {
    type: "frame",
    nowMs: atMs,
    frame: frame(config.testedSide, pose, atMs, visibility, jointVisibility),
  });
}

function wristOnly(point: { x: number; y: number } | null): ArmPose | null {
  return point ? { wrist: point } : null;
}

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be approximately ${expected}`);
}

function targetFacingExitPoint(config: ElbowExtensionConfig): { x: number; y: number } {
  const margin = config.startingZone.radius + 0.05;
  return {
    x: config.startingZone.point.x + config.normalizedTargetDirection.x * margin,
    y: config.startingZone.point.y + config.normalizedTargetDirection.y * margin,
  };
}

function wrongDirectionPoint(config: ElbowExtensionConfig): { x: number; y: number } {
  const margin = config.startingZone.radius + 0.05;
  return {
    x: config.startingZone.point.x - config.normalizedTargetDirection.x * margin,
    y: config.startingZone.point.y - config.normalizedTargetDirection.y * margin,
  };
}

function perpendicularPoint(config: ElbowExtensionConfig): { x: number; y: number } {
  const margin = config.startingZone.radius + 0.05;
  return {
    x: config.startingZone.point.x - config.normalizedTargetDirection.y * margin,
    y: config.startingZone.point.y + config.normalizedTargetDirection.x * margin,
  };
}

function readyState(config: ElbowExtensionConfig): ElbowExtensionAttemptState {
  const initial = mustCreateState(config, 0, 0);
  const afterFrame = sendFrame(initial, config, wristOnly(config.startingZone.point), 0);
  assert.equal(afterFrame.status, "applied");
  const readiness = applyElbowExtensionCommand(afterFrame.state, {
    type: "readinessConfirmed",
    nowMs: 10,
    confirmedBy: "clinician",
  });
  assert.equal(readiness.status, "applied");
  return readiness.state;
}

function outboundState(config: ElbowExtensionConfig): ElbowExtensionAttemptState {
  let state = readyState(config);
  const exitPoint = targetFacingExitPoint(config);
  const r1 = sendFrame(state, config, wristOnly(exitPoint), 20);
  assert.equal(r1.status, "applied");
  state = r1.state;
  const confirmPoint = {
    x: exitPoint.x + config.normalizedTargetDirection.x * 0.05,
    y: exitPoint.y + config.normalizedTargetDirection.y * 0.05,
  };
  const r2 = sendFrame(state, config, wristOnly(confirmPoint), 20 + config.timing.onsetConfirmationMs);
  assert.equal(r2.status, "applied");
  return r2.state;
}

function openPause(
  state: ElbowExtensionAttemptState,
  config: ElbowExtensionConfig,
  baseMs: number,
): ElbowExtensionAttemptState {
  let r = sendFrame(state, config, null, baseMs);
  assert.equal(r.status, "applied");
  r = sendFrame(r.state, config, null, baseMs + config.tracking.maxAllowedGapMs + 10);
  assert.equal(r.status, "applied");
  assert.equal(getElbowExtensionRuntimeSnapshot(r.state).hasActivePause, true);
  return r.state;
}

function completedSequence(config: ElbowExtensionConfig, includeArmLandmarks = false) {
  let state = outboundState(config);

  const midPoint = {
    x: config.fixedTarget.point.x - 0.07,
    y: config.fixedTarget.point.y,
  };
  const midPose = includeArmLandmarks ? { ...EXTENDED_ARM, wrist: midPoint } : wristOnly(midPoint);
  const targetPose = includeArmLandmarks
    ? { ...EXTENDED_ARM, wrist: config.fixedTarget.point }
    : wristOnly(config.fixedTarget.point);
  const returnMidPoint = {
    x: (config.startingZone.point.x + config.fixedTarget.point.x) / 2,
    y: (config.startingZone.point.y + config.fixedTarget.point.y) / 2,
  };
  const returnMidPose = includeArmLandmarks ? { ...EXTENDED_ARM, wrist: returnMidPoint } : wristOnly(returnMidPoint);
  const startPose = includeArmLandmarks
    ? { ...FLEXED_ARM, wrist: config.startingZone.point }
    : wristOnly(config.startingZone.point);

  let r = sendFrame(state, config, midPose, 200);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, targetPose, 250);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, targetPose, 300);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, targetPose, 460);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, returnMidPose, 470);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, startPose, 600);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, startPose, 760);
  assert.equal(r.status, "applied");
  state = r.state;

  const finalRes = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 800 });
  assert.equal(finalRes.status, "applied");
  return finalRes;
}

describe("validateElbowExtensionConfig", () => {
  it("accepts a valid left-side config", () => {
    assert.equal(validateElbowExtensionConfig(rawConfig({ testedSide: "left" })).ok, true);
  });

  it("accepts a valid right-side config", () => {
    assert.equal(validateElbowExtensionConfig(rawConfig({ testedSide: "right" })).ok, true);
  });

  it("rejects invalid testedSide values with no fallback", () => {
    for (const testedSide of [undefined, null, "", "up", "bilateral", 1]) {
      const result = validateElbowExtensionConfig(rawConfig({ testedSide }));
      assert.equal(result.ok, false, `expected ${JSON.stringify(testedSide)} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_tested_side");
    }
  });

  it("rejects non-finite zone coordinates", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const result = validateElbowExtensionConfig(
        rawConfig({ fixedTarget: { point: { x: bad, y: 0.5 }, radius: 0.05 } }),
      );
      assert.equal(result.ok, false, `expected x=${bad} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_zone_geometry");
    }
  });

  it("rejects zone coordinates outside [0,1]", () => {
    for (const bad of [-0.01, 1.01]) {
      const result = validateElbowExtensionConfig(
        rawConfig({ startingZone: { point: { x: bad, y: 0.5 }, radius: 0.05 } }),
      );
      assert.equal(result.ok, false, `expected x=${bad} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_zone_geometry");
    }
  });

  it("rejects zero, negative, or non-finite radii", () => {
    for (const bad of [0, -0.01, NaN, Infinity]) {
      const result = validateElbowExtensionConfig(rawConfig({ startingZone: { point: START_POINT, radius: bad } }));
      assert.equal(result.ok, false, `expected radius=${bad} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_zone_geometry");
    }
  });

  it("rejects zones that exactly touch", () => {
    const result = validateElbowExtensionConfig(
      rawConfig({
        startingZone: { point: { x: 0.25, y: 0.5 }, radius: 0.125 },
        fixedTarget: { point: { x: 0.5, y: 0.5 }, radius: 0.125 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "zones_overlap");
  });

  it("rejects overlapping zones", () => {
    const result = validateElbowExtensionConfig(
      rawConfig({
        startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.32, y: 0.5 }, radius: 0.05 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "zones_overlap");
  });

  it("rejects identical start and target centers as zones_overlap or ambiguous_target_direction", () => {
    const result = validateElbowExtensionConfig(
      rawConfig({
        startingZone: { point: { x: 0.4, y: 0.5 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.4, y: 0.5 }, radius: 0.05 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.reason === "zones_overlap" || result.reason === "ambiguous_target_direction",
        `expected zones_overlap or ambiguous_target_direction, got ${result.reason}`,
      );
    }
  });

  it("rejects invalid timing config", () => {
    for (const timing of [
      { onsetConfirmationMs: NaN, dwellDurationMs: 200, returnConfirmationMs: 150 },
      { onsetConfirmationMs: 100, dwellDurationMs: Infinity, returnConfirmationMs: 150 },
      { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: -1 },
    ]) {
      const result = validateElbowExtensionConfig(rawConfig({ timing }));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "invalid_timing_config");
    }
  });

  it("rejects invalid visibility and maxAllowedGapMs in tracking config", () => {
    for (const tracking of [
      { minWristVisibility: NaN, maxAllowedGapMs: 300, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 },
      { minWristVisibility: 0.3, maxAllowedGapMs: Infinity, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 },
      { minWristVisibility: 0.3, maxAllowedGapMs: -1, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 },
      { minWristVisibility: 1.5, maxAllowedGapMs: 300, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 },
      { minWristVisibility: 0.3, maxAllowedGapMs: 300, minShoulderVisibility: -0.1, minElbowVisibility: 0.3 },
      { minWristVisibility: 0.3, maxAllowedGapMs: 300, minShoulderVisibility: 0.3, minElbowVisibility: 2 },
    ]) {
      const result = validateElbowExtensionConfig(rawConfig({ tracking }));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "invalid_tracking_config");
    }
  });

  it("populates normalizedTargetDirection from zone geometry", () => {
    const result = validateElbowExtensionConfig(rawConfig());
    assert.equal(result.ok, true);
    if (result.ok) {
      approxEqual(result.config.normalizedTargetDirection.x, 1);
      approxEqual(result.config.normalizedTargetDirection.y, 0);
    }
  });

  it("does not return a config object on validation failure", () => {
    const result = validateElbowExtensionConfig(rawConfig({ fixedTarget: { point: { x: 5, y: 0.5 }, radius: 0.05 } }));
    assert.equal(result.ok, false);
    assert.equal("config" in result, false);
  });
});

describe("createElbowExtensionAttemptState", () => {
  const config = buildValidConfig();

  it("rejects NaN armedAtMs", () => {
    const result = createElbowExtensionAttemptState(config, 0, NaN);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_armed_at_ms");
  });

  it("rejects Infinity armedAtMs", () => {
    const result = createElbowExtensionAttemptState(config, 0, Infinity);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_armed_at_ms");
  });

  it("rejects negative armedAtMs", () => {
    const result = createElbowExtensionAttemptState(config, 0, -1);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_armed_at_ms");
  });

  it("rejects a non-finite attemptIndex", () => {
    const result = createElbowExtensionAttemptState(config, NaN, 0);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_attempt_index");
  });

  it("defensively copies config so external mutation after state creation has no effect", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    config.startingZone.point.x = 0.99;
    config.fixedTarget.radius = 0.99;
    Object.assign(config.normalizedTargetDirection, { x: -1, y: 0 });
    assert.equal(state.config.startingZone.point.x, START_POINT.x);
    assert.equal(state.config.fixedTarget.radius, 0.05);
    approxEqual(state.config.normalizedTargetDirection.x, 1);
  });

  it("stores a deep-cloned config independent of the validated config object", () => {
    const validated = buildValidConfig();
    const state = mustCreateState(validated, 0, 0);
    validated.startingZone.point.x = 0.01;
    assert.notEqual(state.config.startingZone.point.x, validated.startingZone.point.x);
  });
});

describe("readiness and wrist selection", () => {
  it("rejects readinessConfirmed with no wrist tracked yet", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = applyElbowExtensionCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_wrist_in_starting_zone");
  });

  it("rejects readinessConfirmed while the wrist is outside the starting zone", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const f = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 0);
    assert.equal(f.status, "applied");
    state = f.state;
    const r = applyElbowExtensionCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_wrist_in_starting_zone");
  });

  it("rejects readinessConfirmed when the last wrist sample is stale", () => {
    const config = buildValidConfig({ tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 50, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, wristOnly(START_POINT), 0);
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, {
      type: "readinessConfirmed",
      nowMs: 0 + config.tracking.maxAllowedGapMs + 1,
      confirmedBy: "clinician",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_wrist_in_starting_zone");
  });

  it("rejects readinessConfirmed with an invalid confirmedBy actor", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const f = sendFrame(state, config, wristOnly(START_POINT), 0);
    assert.equal(f.status, "applied");
    state = f.state;
    const r = applyElbowExtensionCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "system" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_valid_confirmed_by");
  });

  it("ignores pre-readiness wrist movement — no onset effect before readiness is confirmed", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 0);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "awaiting_readiness");
  });

  it("a left-side config ignores right-wrist-only data", () => {
    const config = buildValidConfig({ testedSide: "left" });
    const state = mustCreateState(config, 0, 0);
    const r = applyElbowExtensionCommand(state, {
      type: "frame",
      nowMs: 0,
      frame: frame("right", wristOnly(START_POINT), 0),
    });
    assert.equal(r.status, "applied");
    const readiness = applyElbowExtensionCommand(r.state, {
      type: "readinessConfirmed",
      nowMs: 10,
      confirmedBy: "clinician",
    });
    assert.equal(readiness.status, "rejected");
    if (readiness.status === "rejected") assert.equal(readiness.reason, "readiness_requires_wrist_in_starting_zone");
  });
});

describe("target-facing onset — direction variants", () => {
  it("confirms onset for a rightward target", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "outbound");
    approxEqual(config.normalizedTargetDirection.x, 1);
  });

  it("confirms onset for a leftward target", () => {
    const config = buildValidConfig({
      startingZone: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
      fixedTarget: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
    });
    const state = outboundState(config);
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "outbound");
    approxEqual(config.normalizedTargetDirection.x, -1);
  });

  it("confirms onset for an upward target", () => {
    const config = buildValidConfig({
      startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
      fixedTarget: { point: { x: 0.3, y: 0.8 }, radius: 0.05 },
    });
    const state = outboundState(config);
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "outbound");
    approxEqual(config.normalizedTargetDirection.y, 1);
  });

  it("confirms onset for a downward target", () => {
    const config = buildValidConfig({
      startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
      fixedTarget: { point: { x: 0.3, y: 0.2 }, radius: 0.05 },
    });
    const state = outboundState(config);
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "outbound");
    approxEqual(config.normalizedTargetDirection.y, -1);
  });

  it("confirms onset for a diagonal target", () => {
    const config = buildValidConfig({
      startingZone: { point: { x: 0.3, y: 0.3 }, radius: 0.05 },
      fixedTarget: { point: { x: 0.6, y: 0.6 }, radius: 0.05 },
    });
    const state = outboundState(config);
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "outbound");
    assert.ok(config.normalizedTargetDirection.x > 0 && config.normalizedTargetDirection.y > 0);
  });

  it("re-arms readiness on opposite-direction exit before valid onset", () => {
    const config = buildValidConfig();
    const state = readyState(config);
    const r = sendFrame(state, config, wristOnly(wrongDirectionPoint(config)), 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "awaiting_readiness");
  });

  it("does not confirm onset on perpendicular exit without target-facing qualification", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const perp = perpendicularPoint(config);
    let r = sendFrame(state, config, wristOnly(perp), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(perp), 20 + config.timing.onsetConfirmationMs + 50);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("requires return inside the starting zone and a new readiness confirmation after wrong-direction exit", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    let r = sendFrame(state, config, wristOnly(wrongDirectionPoint(config)), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "awaiting_readiness");

    r = sendFrame(state, config, wristOnly(config.startingZone.point), 40);
    assert.equal(r.status, "applied");
    state = r.state;
    const readinessRetry = applyElbowExtensionCommand(state, {
      type: "readinessConfirmed",
      nowMs: 50,
      confirmedBy: "clinician",
    });
    assert.equal(readinessRetry.status, "applied");
    state = readinessRetry.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");

    const exitPoint = targetFacingExitPoint(config);
    r = sendFrame(state, config, wristOnly(exitPoint), 60);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly({ x: exitPoint.x + 0.05, y: exitPoint.y }), 60 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "outbound");
  });

  it("resets the onset candidate on bounce-back into the starting zone", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const exitPoint = targetFacingExitPoint(config);
    let r = sendFrame(state, config, wristOnly(exitPoint), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 50);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(exitPoint), 60);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("confirms onset immediately when onsetConfirmationMs is 0", () => {
    const config = buildValidConfig({
      timing: { onsetConfirmationMs: 0, dwellDurationMs: 200, returnConfirmationMs: 150 },
    });
    const state = readyState(config);
    const r = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "outbound");
      assert.equal(r.state.movementOnsetAtMs, 20);
    }
  });

  it("back-dates movementOnsetAtMs to the onset candidate start, not the confirming frame", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const exitPoint = targetFacingExitPoint(config);
    let r = sendFrame(state, config, wristOnly(exitPoint), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly({ x: exitPoint.x + 0.05, y: exitPoint.y }), 20 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.state.movementOnsetAtMs, 20);
      assert.notEqual(r.state.movementOnsetAtMs, 20 + config.timing.onsetConfirmationMs);
    }
  });

  it("does not finalize as not_started when the first post-readiness frame is already inside the target", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");

    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 20 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "dwelling");

    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 20 + config.timing.onsetConfirmationMs + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    const finalRes = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.notEqual(finalRes.attemptResult?.completionState, "not_started");
      assert.equal(finalRes.attemptResult?.targetReached, finalRes.attemptResult?.dwellConfirmed);
    }
  });

  it("records non_target_facing_exit_observed_before_valid_onset in factualNotes", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const r = sendFrame(state, config, wristOnly(wrongDirectionPoint(config)), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    const finalRes = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 100 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(
        finalRes.attemptResult?.factualNotes.includes("non_target_facing_exit_observed_before_valid_onset"),
        true,
      );
    }
  });
});

describe("dwell", () => {
  it("does not confirm dwell from a single frame when dwellDurationMs is nonzero", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.dwellConfirmed, false);
      assert.equal(r.snapshot.targetReached, false);
    }
  });

  it("anchors targetEntryAtMs to the successful dwell candidate start", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.state.targetEntryAtMs, 250);
  });

  it("excludes dwell duration from reachTimeMs", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.reachTimeMs, 230);
  });

  it("resets the dwell candidate on target exit", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly({ x: config.fixedTarget.point.x - 0.1, y: config.fixedTarget.point.y }), 300);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "outbound");
    r = sendFrame(r.state, config, wristOnly(config.fixedTarget.point), 300 + config.timing.dwellDurationMs - 1);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.dwellConfirmed, false);
  });

  it("resets the dwell candidate on a brief wrist tracking break within maxAllowedGapMs", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, null, 300);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 300 + config.timing.dwellDurationMs - 1);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.dwellConfirmed, false);
  });

  it("confirms dwell on the first target-entry frame when dwellDurationMs is 0", () => {
    const config = buildValidConfig({
      timing: { onsetConfirmationMs: 100, dwellDurationMs: 0, returnConfirmationMs: 150 },
    });
    const state = outboundState(config);
    const r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.dwellConfirmed, true);
      assert.equal(r.snapshot.phase, "reach_confirmed");
    }
  });

  it("failed first dwell followed by successful second dwell keeps failed approach in outbound path", () => {
    const config = buildValidConfig();
    let state = outboundState(config);

    let r = sendFrame(state, config, wristOnly({ x: config.fixedTarget.point.x - 0.07, y: config.fixedTarget.point.y }), 200);
    assert.equal(r.status, "applied");
    state = r.state;

    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    state = r.state;

    r = sendFrame(state, config, wristOnly({ x: config.fixedTarget.point.x - 0.1, y: config.fixedTarget.point.y }), 280);
    assert.equal(r.status, "applied");
    state = r.state;

    r = sendFrame(state, config, wristOnly({ x: 0.5, y: 0.4 }), 320);
    assert.equal(r.status, "applied");
    state = r.state;
    const samplesAfterFailed = state.outboundSamples.length;

    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 400);
    assert.equal(r.status, "applied");
    state = r.state;

    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 400 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;

    const finalRes = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 700 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(finalRes.attemptResult?.reachTimeMs, 380);
      assert.ok(samplesAfterFailed >= 3);
      assert.notEqual(finalRes.attemptResult?.normalizedPathLength, null);
    }
  });
});

describe("return to starting zone", () => {
  it("ignores return confirmation before dwell is confirmed", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 300);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.returnToStartCompleted, false);
  });

  it("does not confirm return from a single frame when returnConfirmationMs is nonzero", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.returnToStartCompleted, false);
  });

  it("resets the return candidate after leaving the starting zone", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470);
    state = r.state;
    r = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 500);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 520);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.returnToStartCompleted, false);
  });

  it("confirms return immediately when returnConfirmationMs is 0", () => {
    const config = buildValidConfig({
      timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 0 },
    });
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.returnToStartCompleted, true);
      assert.equal(r.snapshot.phase, "completed_pending_finalization");
    }
  });

  it("computes exact returnTimeMs from reach confirmation to return confirmation", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.returnTimeMs, 300);
  });

  it("computes exact totalMovementTimeMs from onset to completion", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.totalMovementTimeMs, 780);
  });
});

describe("optional 2D elbow angle observation", () => {
  const config = buildValidConfig();

  it("returns ~180 for a collinear extended arm", () => {
    const f = frame("right", EXTENDED_ARM, 0);
    const angle = extractObserved2DElbowAngleDegrees(f, config);
    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 180) < 1);
  });

  it("returns null when shoulder confidence is below threshold", () => {
    const f = frame("right", EXTENDED_ARM, 0, 0.9, { shoulder: 0.1, elbow: 0.9, wrist: 0.9 });
    assert.equal(extractObserved2DElbowAngleDegrees(f, config), null);
  });

  it("returns null when elbow confidence is below threshold", () => {
    const f = frame("right", EXTENDED_ARM, 0, 0.9, { shoulder: 0.9, elbow: 0.1, wrist: 0.9 });
    assert.equal(extractObserved2DElbowAngleDegrees(f, config), null);
  });

  it("uses testedSide landmarks only — opposite side cannot populate angle", () => {
    const leftFrame = frame("left", EXTENDED_ARM, 0);
    const rightConfig = buildValidConfig({ testedSide: "right" });
    assert.equal(extractObserved2DElbowAngleDegrees(leftFrame, rightConfig), null);
  });

  it("never returns NaN for degenerate collinear geometry", () => {
    const degenerate = {
      shoulder: { x: 0.3, y: 0.5 },
      elbow: { x: 0.4, y: 0.5 },
      wrist: { x: 0.5, y: 0.5 },
    };
    const angle = extractObserved2DElbowAngleDegrees(frame("right", degenerate, 0), config);
    assert.ok(angle === null || Number.isFinite(angle));
  });

  it("completes the wrist task with null peakElbowExtensionDeg when only wrist is tracked", () => {
    const result = completedSequence(buildValidConfig(), false);
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(result.attemptResult?.peakElbowExtensionDeg, null);
      assert.equal(result.attemptResult?.completionState, "completed");
    }
  });

  it("includes the onset-confirming frame in the peak angle observation", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const exitPoint = targetFacingExitPoint(config);
    const flexedAtOnset = {
      shoulder: { x: 0.25, y: 0.5 },
      elbow: { x: 0.35, y: 0.58 },
      wrist: exitPoint,
    };
    let r = sendFrame(state, config, flexedAtOnset, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    const extendedAtConfirm = {
      shoulder: { x: 0.25, y: 0.5 },
      elbow: { x: 0.42, y: 0.5 },
      wrist: { x: exitPoint.x + 0.05, y: exitPoint.y },
    };
    r = sendFrame(state, config, extendedAtConfirm, 20 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.notEqual(r.state.peakElbowExtensionDegRunning, null);
      assert.ok((r.state.peakElbowExtensionDegRunning as number) > 90);
    }
  });

  it("tracks the maximum angle across outbound and dwelling frames", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    const moderate = {
      shoulder: { x: 0.25, y: 0.5 },
      elbow: { x: 0.38, y: 0.55 },
      wrist: { x: 0.55, y: 0.5 },
    };
    let r = sendFrame(state, config, moderate, 200);
    assert.equal(r.status, "applied");
    state = r.state;
    const peakPose = {
      shoulder: { x: 0.25, y: 0.5 },
      elbow: { x: 0.45, y: 0.5 },
      wrist: config.fixedTarget.point,
    };
    r = sendFrame(state, config, peakPose, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    const afterPeak = (r.status === "applied" ? r.state.peakElbowExtensionDegRunning : null) as number;
    r = sendFrame(state, config, { ...peakPose, elbow: { x: 0.35, y: 0.58 } }, 300);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.state.peakElbowExtensionDegRunning, afterPeak);
    }
  });

  it("does not update peak angle during return phase", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    const atTarget = {
      shoulder: { x: 0.3, y: 0.5 },
      elbow: { x: 0.5, y: 0.5 },
      wrist: config.fixedTarget.point,
    };
    let r = sendFrame(state, config, atTarget, 250);
    state = r.state;
    r = sendFrame(state, config, atTarget, 250 + config.timing.dwellDurationMs);
    state = r.state;
    const peakBeforeReturn = state.peakElbowExtensionDegRunning;
    const returnPose = {
      shoulder: { x: 0.3, y: 0.5 },
      elbow: { x: 0.3, y: 0.62 },
      wrist: config.startingZone.point,
    };
    r = sendFrame(state, config, returnPose, 470);
    state = r.state;
    r = sendFrame(state, config, returnPose, 620);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.state.peakElbowExtensionDegRunning, peakBeforeReturn);
  });

  it("never opens a protective pause when shoulder or elbow are missing but wrist remains valid", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = sendFrame(state, config, wristOnly({ x: 0.6, y: 0.5 }), 150);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, false);
  });
});

describe("protective pauses and tracking continuity", () => {
  it("does not open a pause for a short wrist gap below maxAllowedGapMs", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, false);
    r = sendFrame(r.state, config, wristOnly({ x: 0.6, y: 0.5 }), 150 + config.tracking.maxAllowedGapMs - 1);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, false);
  });

  it("opens a pause exactly when the gap reaches maxAllowedGapMs", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    r = sendFrame(r.state, config, null, 150 + config.tracking.maxAllowedGapMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, true);
  });

  it("opens a pause immediately when maxAllowedGapMs is 0 and wrist is lost", () => {
    const config = buildValidConfig({
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 0, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 },
    });
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, wristOnly(config.startingZone.point), 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const readiness = applyElbowExtensionCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    });
    assert.equal(readiness.status, "applied");
    state = readiness.state;
    r = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 110);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, null, 111);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, true);
  });

  it("freezes phase progression while paused", () => {
    const config = buildValidConfig();
    const paused = openPause(outboundState(config), config, 150);
    const phaseWhilePaused = getElbowExtensionRuntimeSnapshot(paused).phase;
    const r = sendFrame(paused, config, wristOnly(config.fixedTarget.point), 500);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, phaseWhilePaused);
  });

  it("never auto-resumes when tracking is restored without an explicit resume command", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 500);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, true);
  });

  it("rejects resumeRequested when no pause is active", () => {
    const config = buildValidConfig();
    const r = applyElbowExtensionCommand(outboundState(config), {
      type: "resumeRequested",
      nowMs: 200,
      readinessConfirmedAt: "2026-07-31T09:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "no_active_pause_to_resume");
  });

  it("rejects resume without readiness confirmation", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyElbowExtensionCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: null,
      resumedBy: "clinician",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "resume_requires_readiness_confirmation");
  });

  it("rejects resume without a valid human actor", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyElbowExtensionCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: "2026-07-31T09:00:00.000Z",
      resumedBy: "system",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "resume_requires_valid_human_actor");
  });

  it("finalizes exactly one pause event on successful human resume", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyElbowExtensionCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: "2026-07-31T09:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.hasActivePause, false);
      assert.equal(r.protectivePauseEvent?.outcome, "resumed");
      assert.equal(r.state.protectivePauseEvents.length, 1);
    }
  });

  it("finalizes an active pause on clinical stop", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyElbowExtensionCommand(state, {
      type: "clinicalStopReceived",
      nowMs: 500,
      event: CLINICAL_STOP_EVENT,
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.attemptResult?.completionState, "stopped");
      assert.equal(r.state.protectivePauseEvents.length, 1);
    }
  });

  it("finalizes an active pause on runtime interruption", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyElbowExtensionCommand(state, {
      type: "runtimeInterruptionReceived",
      nowMs: 500,
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.attemptResult?.completionState, "interrupted");
      assert.equal(r.state.protectivePauseEvents.length, 1);
    }
  });

  it("produces not_assessable when attempt window ends during an active pause", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.attemptResult?.completionState, "not_assessable");
      assert.equal(r.state.protectivePauseEvents.length, 1);
    }
  });

  it("does not duplicate pause events when a duplicate terminal command is rejected", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const first = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    const second = applyElbowExtensionCommand(first.state, { type: "attemptWindowEnded", nowMs: 600 });
    assert.equal(second.status, "rejected");
    assert.equal(first.state.protectivePauseEvents.length, 1);
  });
});

describe("terminal outcomes", () => {
  it("produces completed when dwell and return are confirmed", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.completionState, "completed");
  });

  it("produces incomplete after movement onset without return", () => {
    const config = buildValidConfig();
    const r = applyElbowExtensionCommand(outboundState(config), { type: "attemptWindowEnded", nowMs: 300 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "incomplete");
  });

  it("produces interrupted on runtime interruption", () => {
    const config = buildValidConfig();
    const r = applyElbowExtensionCommand(outboundState(config), {
      type: "runtimeInterruptionReceived",
      nowMs: 200,
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "interrupted");
  });

  it("produces stopped on clinical stop", () => {
    const config = buildValidConfig();
    const r = applyElbowExtensionCommand(outboundState(config), {
      type: "clinicalStopReceived",
      nowMs: 200,
      event: CLINICAL_STOP_EVENT,
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "stopped");
  });

  it("produces not_assessable on markedNotAssessable", () => {
    const config = buildValidConfig();
    const r = applyElbowExtensionCommand(outboundState(config), {
      type: "markedNotAssessable",
      nowMs: 200,
      reason: "patient unable to follow instructions",
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_assessable");
  });

  it("produces not_started when window ends before movement onset", () => {
    const config = buildValidConfig();
    const r = applyElbowExtensionCommand(readyState(config), { type: "attemptWindowEnded", nowMs: 50 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_started");
  });

  it("produces stopped on clinical stop during completed_pending_finalization", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470 + config.timing.returnConfirmationMs);
    state = r.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "completed_pending_finalization");

    const stop = applyElbowExtensionCommand(state, {
      type: "clinicalStopReceived",
      nowMs: 800,
      event: CLINICAL_STOP_EVENT,
    });
    assert.equal(stop.status, "applied");
    if (stop.status === "applied") assert.equal(stop.attemptResult?.completionState, "stopped");
  });

  it("does not overwrite a terminal result with a later command", () => {
    const completed = completedSequence(buildValidConfig());
    assert.equal(completed.status, "applied");
    if (completed.status !== "applied") return;
    const firstResult = completed.attemptResult;
    const retry = applyElbowExtensionCommand(completed.state, {
      type: "markedNotAssessable",
      nowMs: 900,
      reason: "late override attempt",
    });
    assert.equal(retry.status, "rejected");
    assert.deepEqual(completed.state.finalResult, firstResult);
  });

  it("rejects frame commands after terminal finalization", () => {
    const completed = completedSequence(buildValidConfig());
    assert.equal(completed.status, "applied");
    if (completed.status !== "applied") return;
    const r = sendFrame(completed.state, buildValidConfig(), wristOnly(TARGET_POINT), 900);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "attempt_already_terminal");
  });

  it("cannot finalize twice — second attemptWindowEnded is rejected", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470 + config.timing.returnConfirmationMs);
    state = r.state;

    const first = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 800 });
    assert.equal(first.status, "applied");
    const second = applyElbowExtensionCommand(first.state, { type: "attemptWindowEnded", nowMs: 900 });
    assert.equal(second.status, "rejected");
    if (second.status === "rejected") assert.equal(second.reason, "attempt_already_terminal");
  });

  it("rejects additional frames in completed_pending_finalization before explicit finalization", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.startingZone.point), 470 + config.timing.returnConfirmationMs);
    state = r.state;
    const rejectedFrame = sendFrame(state, config, wristOnly(config.fixedTarget.point), 900);
    assert.equal(rejectedFrame.status, "rejected");
    if (rejectedFrame.status === "rejected") assert.equal(rejectedFrame.reason, "awaiting_explicit_finalization");
  });
});

describe("clock validation and command ordering", () => {
  it("rejects NaN timestamps", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, wristOnly(START_POINT), NaN);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "invalid_now_ms");
  });

  it("rejects Infinity timestamps", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, wristOnly(START_POINT), Infinity);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "invalid_now_ms");
  });

  it("rejects negative timestamps", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, wristOnly(START_POINT), -1);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "invalid_now_ms");
  });

  it("rejects stale non-frame commands without mutating state", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, wristOnly(START_POINT), 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const before = JSON.parse(JSON.stringify(state));
    const readiness = applyElbowExtensionCommand(state, {
      type: "readinessConfirmed",
      nowMs: 50,
      confirmedBy: "clinician",
    });
    assert.equal(readiness.status, "rejected");
    if (readiness.status === "rejected") assert.equal(readiness.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("accepts equal timestamps on non-frame commands while frame timestamps remain strict", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, wristOnly(START_POINT), 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const readiness = applyElbowExtensionCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    });
    assert.equal(readiness.status, "applied");
    if (readiness.status === "applied") assert.equal(readiness.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("does not advance the clock when a command is rejected", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, wristOnly(START_POINT), 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const bad = sendFrame(state, config, wristOnly(START_POINT), NaN);
    assert.equal(bad.status, "rejected");
    r = sendFrame(state, config, wristOnly(START_POINT), 150);
    assert.equal(r.status, "applied");
  });

  it("rejects duplicate frame timestamps without changing path samples", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const lastFrameMs = 20 + config.timing.onsetConfirmationMs;
    const samplesBefore = state.outboundSamples.length;
    const r = sendFrame(state, config, wristOnly({ x: 0.65, y: 0.6 }), lastFrameMs);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "frame_timestamp_not_strictly_increasing");
    assert.equal(state.outboundSamples.length, samplesBefore);
  });
});

describe("path metrics and result shape", () => {
  it("computes a positive normalizedPathLength on the happy path", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.notEqual(result.attemptResult?.normalizedPathLength, null);
      assert.ok((result.attemptResult?.normalizedPathLength as number) > 0.1);
    }
  });

  it("freezes outbound path samples at dwell confirmation — return frames do not extend the path", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    if (r.status !== "applied") return;
    const pathAtDwellConfirm = r.state.outboundSamples.length;
    r = sendFrame(r.state, config, wristOnly(config.startingZone.point), 470);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.state.outboundSamples.length, pathAtDwellConfirm);
  });

  it("nulls path metrics when outbound integrity is broken by a wrist gap", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    state = r.state;
    r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250 + config.timing.dwellDurationMs);
    state = r.state;
    const finalRes = applyElbowExtensionCommand(state, { type: "attemptWindowEnded", nowMs: 700 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(finalRes.attemptResult?.normalizedPathLength, null);
      assert.equal(finalRes.attemptResult?.pathEfficiency, null);
    }
  });

  it("nulls pathEfficiency for zero-length outbound path", () => {
    const config = buildValidConfig({
      timing: { onsetConfirmationMs: 0, dwellDurationMs: 0, returnConfirmationMs: 150 },
    });
    const state = readyState(config);
    const r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      const finalRes = applyElbowExtensionCommand(r.state, { type: "attemptWindowEnded", nowMs: 500 });
      assert.equal(finalRes.status, "applied");
      if (finalRes.status === "applied") assert.equal(finalRes.attemptResult?.pathEfficiency, null);
    }
  });

  it("nulls materially invalid pathEfficiency instead of silently clamping", () => {
    const config = buildValidConfig({
      fixedTarget: { point: { x: 0.9, y: 0.5 }, radius: 0.3 },
      timing: { onsetConfirmationMs: 0, dwellDurationMs: 0, returnConfirmationMs: 150 },
    });
    let state = readyState(config);
    let r = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 20);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).phase, "outbound");
    r = sendFrame(state, config, wristOnly({ x: 0.62, y: 0.5 }), 30);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "reach_confirmed");
    const finalRes = applyElbowExtensionCommand(r.state, { type: "attemptWindowEnded", nowMs: 100 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") assert.equal(finalRes.attemptResult?.pathEfficiency, null);
  });

  it("returned protectivePauseEvents cannot mutate internal state", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status !== "applied" || !result.attemptResult) return;
    const events = result.attemptResult.protectivePauseEvents;
    if (events.length === 0) {
      events.push({
        reason: { category: "tracking_or_environment", detail: "wrist_landmark_lost" },
        startedAtMs: 0,
        endedAtMs: 1,
        outcome: "resumed",
        readinessConfirmedAt: null,
        resumedBy: null,
      });
    } else {
      (events[0] as { endedAtMs: number | null }).endedAtMs = 999;
    }
    const retry = applyElbowExtensionCommand(result.state, { type: "attemptWindowEnded", nowMs: 900 });
    assert.equal(retry.status, "rejected");
    assert.notEqual(result.state.protectivePauseEvents[0]?.endedAtMs, 999);
  });

  it("does not expose raw trajectory arrays on the finalized result", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      const keys = Object.keys(result.attemptResult ?? {});
      for (const forbidden of ["outboundSamples", "pendingOnsetSamples", "trajectory"]) {
        assert.equal(keys.includes(forbidden), false, `unexpected raw field ${forbidden}`);
      }
    }
  });

  it("keeps targetReached always equal to dwellConfirmed across completed and incomplete outcomes", () => {
    const completed = completedSequence(buildValidConfig());
    assert.equal(completed.status, "applied");
    if (completed.status === "applied") {
      assert.equal(completed.attemptResult?.targetReached, completed.attemptResult?.dwellConfirmed);
    }

    const config = buildValidConfig();
    const incomplete = applyElbowExtensionCommand(outboundState(config), { type: "attemptWindowEnded", nowMs: 300 });
    assert.equal(incomplete.status, "applied");
    if (incomplete.status === "applied") {
      assert.equal(incomplete.attemptResult?.targetReached, incomplete.attemptResult?.dwellConfirmed);
    }
  });

  it("applying a command does not mutate the previous state object", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const before = JSON.parse(JSON.stringify(state));
    const r = sendFrame(state, config, wristOnly(config.fixedTarget.point), 250);
    assert.equal(r.status, "applied");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });
});

describe("observationUnavailable command", () => {
  it("accepts valid monotonic nowMs", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const result = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(result.status, "applied");
  });

  it("rejects decreasing nowMs", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    const result = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 99 });
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.match(result.reason, /monotonic/i);
    }
  });

  it("first unavailable observation establishes invalidTrackingSinceMs", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const result = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(result.state.invalidTrackingSinceMs, 100);
    }
  });

  it("short unavailable gap does not open protective pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 1000, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = mustCreateState(config, 0, 0);
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 200 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause, null);
  });

  it("threshold-reaching unavailable gap opens exactly one protective pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = mustCreateState(config, 0, 0);
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause, null);
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
    if (state.activePause) {
      assert.equal(state.activePause.reason.category, "tracking_or_environment");
      assert.equal(state.activePause.startedAtMs, 100);
    }
  });

  it("continued unavailable observations while paused do not create duplicate pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = mustCreateState(config, 0, 0);
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    const pauseStartedAt = state.activePause?.startedAtMs;
    assert.notEqual(pauseStartedAt, undefined);
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 400 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 500 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause?.startedAtMs, pauseStartedAt);
  });

  it("observationUnavailable creates no movement progress", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    assert.equal(state.phase, "ready_confirmed_awaiting_onset");
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 200 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 250 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.phase, "ready_confirmed_awaiting_onset");
    assert.equal(state.movementOnsetAtMs, null);
  });

  it("valid frame returning does NOT auto-resume active pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = readyState(config);
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 150 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 350 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
    r = sendFrame(state, config, wristOnly(START_POINT), 400);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
  });

  it("explicit resumeRequested is still required after pause opens", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = readyState(config);
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 150 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 350 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
    r = sendFrame(state, config, wristOnly(START_POINT), 400);
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyElbowExtensionCommand(state, {
      type: "resumeRequested",
      nowMs: 450,
      readinessConfirmedAt: "clinician",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause, null);
  });

  it("behavior before readiness matches invalid-frame semantics (can open pause during awaiting_readiness)", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let state = mustCreateState(config, 0, 0);
    assert.equal(state.phase, "idle");
    let r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.phase, "awaiting_readiness");
    r = applyElbowExtensionCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.phase, "awaiting_readiness");
    assert.notEqual(state.activePause, null);
  });

  it("observationUnavailable and invalid-wrist frame produce equivalent tracking-gap behavior", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5, minShoulderVisibility: 0.3, minElbowVisibility: 0.3 } });
    let stateA = mustCreateState(config, 0, 0);
    let rA = applyElbowExtensionCommand(stateA, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(rA.status, "applied");
    stateA = rA.state;
    rA = applyElbowExtensionCommand(stateA, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(rA.status, "applied");
    stateA = rA.state;
    let stateB = mustCreateState(config, 0, 0);
    let rB = sendFrame(stateB, config, null, 100);
    assert.equal(rB.status, "applied");
    stateB = rB.state;
    rB = sendFrame(stateB, config, null, 300);
    assert.equal(rB.status, "applied");
    stateB = rB.state;
    assert.equal(stateA.phase, stateB.phase);
    assert.equal(stateA.activePause !== null, stateB.activePause !== null);
    assert.equal(stateA.invalidTrackingSinceMs, stateB.invalidTrackingSinceMs);
  });

  it("terminal behavior remains consistent with current command rules", () => {
    const config = buildValidConfig();
    const completed = completedSequence(config);
    assert.equal(completed.status, "applied");
    if (completed.status === "applied") {
      const result = applyElbowExtensionCommand(completed.state, { type: "observationUnavailable", nowMs: 1000 });
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") {
        assert.equal(result.reason, "attempt_already_terminal");
      }
    }
  });

  it("frame and observationUnavailable both rejected in completed_pending_finalization with state preserved", () => {
    const config = buildValidConfig();
    // Drive to completed_pending_finalization without finalizing
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly({ x: 0.63, y: 0.5 }), 200);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(TARGET_POINT), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(TARGET_POINT), 460);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly({ x: 0.5, y: 0.5 }), 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(START_POINT), 600);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(START_POINT), 760); // return confirmed
    assert.equal(r.status, "applied");
    state = r.state;

    const completedState = state;
    assert.equal(completedState.phase, "completed_pending_finalization");
    assert.equal(completedState.terminal, false);

    // Capture state snapshot before sending commands
    const beforeSnapshot = {
      phase: completedState.phase,
      lastAcceptedNowMs: completedState.lastAcceptedNowMs,
      invalidTrackingSinceMs: completedState.invalidTrackingSinceMs,
      activePause: completedState.activePause,
      movementOnsetAtMs: completedState.movementOnsetAtMs,
      peakElbowExtensionDeg: completedState.peakElbowExtensionDeg,
    };

    // Send invalid frame - should be rejected without state mutation
    const invalidFrame = frame(config.testedSide, null, 1000);
    const frameResult = applyElbowExtensionCommand(completedState, { type: "frame", nowMs: 1000, frame: invalidFrame });
    assert.equal(frameResult.status, "rejected");
    if (frameResult.status === "rejected") {
      assert.equal(frameResult.reason, "awaiting_explicit_finalization");
      // Verify state immutability (including elbow-specific state)
      assert.equal(frameResult.state.phase, beforeSnapshot.phase);
      assert.equal(frameResult.state.lastAcceptedNowMs, beforeSnapshot.lastAcceptedNowMs);
      assert.equal(frameResult.state.invalidTrackingSinceMs, beforeSnapshot.invalidTrackingSinceMs);
      assert.equal(frameResult.state.activePause, beforeSnapshot.activePause);
      assert.equal(frameResult.state.movementOnsetAtMs, beforeSnapshot.movementOnsetAtMs);
      assert.equal(frameResult.state.peakElbowExtensionDeg, beforeSnapshot.peakElbowExtensionDeg);
    }

    // Send observationUnavailable - should be rejected with identical behavior
    const obsResult = applyElbowExtensionCommand(completedState, { type: "observationUnavailable", nowMs: 1000 });
    assert.equal(obsResult.status, "rejected");
    if (obsResult.status === "rejected") {
      assert.equal(obsResult.reason, "awaiting_explicit_finalization");
      // Verify state immutability (including elbow-specific state)
      assert.equal(obsResult.state.phase, beforeSnapshot.phase);
      assert.equal(obsResult.state.lastAcceptedNowMs, beforeSnapshot.lastAcceptedNowMs);
      assert.equal(obsResult.state.invalidTrackingSinceMs, beforeSnapshot.invalidTrackingSinceMs);
      assert.equal(obsResult.state.activePause, beforeSnapshot.activePause);
      assert.equal(obsResult.state.movementOnsetAtMs, beforeSnapshot.movementOnsetAtMs);
      assert.equal(obsResult.state.peakElbowExtensionDeg, beforeSnapshot.peakElbowExtensionDeg);
    }

    // Verify semantic equivalence
    assert.equal(frameResult.status, obsResult.status);
    if (frameResult.status === "rejected" && obsResult.status === "rejected") {
      assert.equal(frameResult.reason, obsResult.reason);
    }
  });

  it("observationUnavailable rejection precedence matches frame in completed_pending_finalization", () => {
    const config = buildValidConfig();
    // Drive to completed_pending_finalization without finalizing
    let state = outboundState(config);
    let r = sendFrame(state, config, wristOnly({ x: 0.63, y: 0.5 }), 200);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(TARGET_POINT), 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(TARGET_POINT), 460);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly({ x: 0.5, y: 0.5 }), 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(START_POINT), 600);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, wristOnly(START_POINT), 760); // return confirmed
    assert.equal(r.status, "applied");
    state = r.state;

    const completedState = state;
    assert.equal(completedState.phase, "completed_pending_finalization");

    // Test with decreasing nowMs - monotonic validation should take precedence
    const invalidFrame = frame(config.testedSide, null, completedState.lastAcceptedNowMs - 10);
    const frameResultDecreasing = applyElbowExtensionCommand(completedState, {
      type: "frame",
      nowMs: completedState.lastAcceptedNowMs - 10,
      frame: invalidFrame
    });
    assert.equal(frameResultDecreasing.status, "rejected");
    if (frameResultDecreasing.status === "rejected") {
      assert.match(frameResultDecreasing.reason, /monotonic/i);
    }

    const obsResultDecreasing = applyElbowExtensionCommand(completedState, {
      type: "observationUnavailable",
      nowMs: completedState.lastAcceptedNowMs - 10
    });
    assert.equal(obsResultDecreasing.status, "rejected");
    if (obsResultDecreasing.status === "rejected") {
      assert.match(obsResultDecreasing.reason, /monotonic/i);
    }

    // Test with valid increasing nowMs - finalization guard should reject
    const validFrame = frame(config.testedSide, null, completedState.lastAcceptedNowMs + 100);
    const frameResultIncreasing = applyElbowExtensionCommand(completedState, {
      type: "frame",
      nowMs: completedState.lastAcceptedNowMs + 100,
      frame: validFrame
    });
    assert.equal(frameResultIncreasing.status, "rejected");
    if (frameResultIncreasing.status === "rejected") {
      assert.equal(frameResultIncreasing.reason, "awaiting_explicit_finalization");
    }

    const obsResultIncreasing = applyElbowExtensionCommand(completedState, {
      type: "observationUnavailable",
      nowMs: completedState.lastAcceptedNowMs + 100
    });
    assert.equal(obsResultIncreasing.status, "rejected");
    if (obsResultIncreasing.status === "rejected") {
      assert.equal(obsResultIncreasing.reason, "awaiting_explicit_finalization");
    }
  });

  it("resume clears invalidTrackingSinceMs to prevent immediate re-pause on post-resume invalid frame", () => {
    const config = buildValidConfig();
    let state = outboundState(config);

    // Open protective pause via tracking gap
    state = openPause(state, config, 200);
    assert.equal(getElbowExtensionRuntimeSnapshot(state).hasActivePause, true);

    // Resume successfully
    const resumeResult = applyElbowExtensionCommand(state, {
      type: "resumeRequested",
      nowMs: 600,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });
    assert.equal(resumeResult.status, "applied");
    state = resumeResult.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).hasActivePause, false);
    assert.equal(resumeResult.protectivePauseEvent?.outcome, "resumed");

    // Immediately send observationUnavailable (within maxAllowedGapMs of resume)
    const postResumeInvalid1 = applyElbowExtensionCommand(state, {
      type: "observationUnavailable",
      nowMs: 650, // 50ms after resume, well within 300ms maxAllowedGapMs
    });
    assert.equal(postResumeInvalid1.status, "applied");
    state = postResumeInvalid1.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).hasActivePause, false, "No immediate re-pause on first post-resume invalid frame");

    // Continue invalid observations (still within maxAllowedGapMs from resume)
    const postResumeInvalid2 = applyElbowExtensionCommand(state, {
      type: "observationUnavailable",
      nowMs: 750, // 150ms after resume, still within 300ms
    });
    assert.equal(postResumeInvalid2.status, "applied");
    state = postResumeInvalid2.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).hasActivePause, false, "No re-pause while new gap under threshold");

    // Continue until NEW gap from post-resume tracking loss exceeds maxAllowedGapMs
    const postResumeInvalid3 = applyElbowExtensionCommand(state, {
      type: "observationUnavailable",
      nowMs: 650 + config.tracking.maxAllowedGapMs + 10, // 310ms after first post-resume invalid (650)
    });
    assert.equal(postResumeInvalid3.status, "applied");
    state = postResumeInvalid3.state;
    assert.equal(getElbowExtensionRuntimeSnapshot(state).hasActivePause, true, "New pause opens when NEW gap exceeds threshold");

    // Verify valid frame after resume still works normally
    state = outboundState(config);
    state = openPause(state, config, 200);
    const resumeResult2 = applyElbowExtensionCommand(state, {
      type: "resumeRequested",
      nowMs: 600,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });
    assert.equal(resumeResult2.status, "applied");
    state = resumeResult2.state;

    const validFrameResult = sendFrame(state, config, wristOnly(targetFacingExitPoint(config)), 610);
    assert.equal(validFrameResult.status, "applied");
    assert.equal(getElbowExtensionRuntimeSnapshot(validFrameResult.state).hasActivePause, false, "Valid frame after resume works normally");
  });
});
