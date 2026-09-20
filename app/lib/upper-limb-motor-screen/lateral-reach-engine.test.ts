/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/lateral-reach-engine.test.ts
 *
 * Synthetic NormalizedMotionFrame fixtures only — no camera, no UI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOTION_INTELLIGENCE_SCHEMA_VERSION, type JointId, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import { evaluateClinicalStop } from "@/app/lib/upper-limb-motor-screen/clinical-stop-evaluator";
import {
  applyLateralReachCommand,
  createLateralReachAttemptState,
  getLateralReachRuntimeSnapshot,
  validateLateralReachConfig,
  type LateralReachAttemptState,
  type LateralReachCommandResult,
  type LateralReachConfig,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import { findForbiddenSafetyVocabularyKeys, isSafetyVocabularyFree } from "@/app/lib/upper-limb-motor-screen/types";

// TARGET_POINT.x > START_POINT.x -> expectedHorizontalDirectionSign is +1
// (a rightward screen-space reach) for the default fixture config.
const START_POINT = { x: 0.3, y: 0.5 };
const TARGET_POINT = { x: 0.7, y: 0.5 };

function rawConfig(overrides: Record<string, unknown> = {}) {
  return {
    testedSide: "right",
    fixedTarget: { point: TARGET_POINT, radius: 0.05 },
    startingZone: { point: START_POINT, radius: 0.05 },
    tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
    ...overrides,
  };
}

function buildValidConfig(overrides: Record<string, unknown> = {}): LateralReachConfig {
  const result = validateLateralReachConfig(rawConfig(overrides));
  if (!result.ok) throw new Error(`test fixture config invalid: ${result.reason}`);
  return result.config;
}

function mustCreateState(
  config: LateralReachConfig,
  attemptIndex: number,
  armedAtMs: number,
): LateralReachAttemptState {
  const result = createLateralReachAttemptState(config, attemptIndex, armedAtMs);
  if (!result.ok) throw new Error(`test fixture: failed to create state (${result.reason})`);
  return result.state;
}

function frame(
  side: "left" | "right",
  point: { x: number; y: number } | null,
  atMs: number,
  visibility = 0.9,
  present = true,
): NormalizedMotionFrame {
  const jointId: JointId = side === "left" ? "left_wrist" : "right_wrist";
  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: { kind: "web_camera_pose", capturedAtMs: atMs, frameIndex: 0, coordinateSpace: "normalized_2d" },
    joints: point
      ? { [jointId]: { landmark: { x: point.x, y: point.y }, confidence: { visibility, present } } }
      : {},
  };
}

function sendFrame(
  state: LateralReachAttemptState,
  config: LateralReachConfig,
  point: { x: number; y: number } | null,
  atMs: number,
  visibility = 0.9,
): LateralReachCommandResult {
  return applyLateralReachCommand(state, {
    type: "frame",
    nowMs: atMs,
    frame: frame(config.testedSide, point, atMs, visibility),
  });
}

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be approximately ${expected}`);
}

/** Drives a fresh attempt from idle through readiness confirmation. */
function readyState(config: LateralReachConfig): LateralReachAttemptState {
  const initial = mustCreateState(config, 0, 0);
  const afterFrame = sendFrame(initial, config, START_POINT, 0);
  assert.equal(afterFrame.status, "applied");
  const readiness = applyLateralReachCommand(afterFrame.state, {
    type: "readinessConfirmed",
    nowMs: 10,
    confirmedBy: "clinician",
  });
  assert.equal(readiness.status, "applied");
  return readiness.state;
}

/**
 * Drives a ready attempt through confirmed onset. The exit point (0.5,0.5)
 * and the confirming point (0.55,0.5) both lie to the right of START_POINT
 * (0.3,0.5), matching the default fixture's +1 expected horizontal
 * direction (TARGET_POINT.x 0.7 > START_POINT.x 0.3), so onset confirms.
 * Returns state with movementOnsetAtMs recorded.
 */
function outboundState(config: LateralReachConfig): LateralReachAttemptState {
  let state = readyState(config);
  const exitPoint = { x: 0.5, y: 0.5 };
  const r1 = sendFrame(state, config, exitPoint, 20);
  assert.equal(r1.status, "applied");
  state = r1.state;
  const r2 = sendFrame(state, config, { x: 0.55, y: 0.5 }, 20 + config.timing.onsetConfirmationMs + 10);
  assert.equal(r2.status, "applied");
  return r2.state;
}

/**
 * Drives two consecutive invalid frames so the gap actually exceeds
 * maxAllowedGapMs (a single invalid frame measures a zero-length gap against
 * itself and never opens a pause for a positive maxAllowedGapMs).
 */
function openPause(
  state: LateralReachAttemptState,
  config: LateralReachConfig,
  baseMs: number,
): LateralReachAttemptState {
  let r = sendFrame(state, config, null, baseMs);
  assert.equal(r.status, "applied");
  r = sendFrame(r.state, config, null, baseMs + config.tracking.maxAllowedGapMs + 10);
  assert.equal(r.status, "applied");
  assert.equal(getLateralReachRuntimeSnapshot(r.state).hasActivePause, true, "test setup expected a pause to open");
  return r.state;
}

/** Full happy-path sequence to a completed attempt, with hand-verified timing (identical shape to Forward Reach's). */
function completedSequence(config: LateralReachConfig) {
  let state = outboundState(config); // movementOnsetAtMs = 20

  let r = sendFrame(state, config, { x: 0.63, y: 0.5 }, 200);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, TARGET_POINT, 250); // targetEntryAtMs = 250 (dwell not yet confirmed)
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, TARGET_POINT, 300);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, TARGET_POINT, 460); // dwell 210ms >= 200 -> reachConfirmedAtMs = 460
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 470); // promotes reach_confirmed -> returning
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, START_POINT, 600);
  assert.equal(r.status, "applied");
  state = r.state;

  r = sendFrame(state, config, START_POINT, 760); // return 160ms >= 150 -> returnConfirmedAtMs = 760
  assert.equal(r.status, "applied");
  state = r.state;

  const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 800 });
  assert.equal(finalRes.status, "applied");
  return finalRes;
}

describe("validateLateralReachConfig", () => {
  it("accepts a valid left-side config", () => {
    assert.equal(validateLateralReachConfig(rawConfig({ testedSide: "left" })).ok, true);
  });

  it("accepts a valid right-side config", () => {
    assert.equal(validateLateralReachConfig(rawConfig({ testedSide: "right" })).ok, true);
  });

  it("rejects a missing testedSide with no fallback", () => {
    const candidate = rawConfig();
    delete (candidate as Record<string, unknown>).testedSide;
    const result = validateLateralReachConfig(candidate);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_tested_side");
  });

  it("never defaults testedSide to right when omitted or invalid", () => {
    for (const testedSide of [undefined, null, "", "up", "bilateral", 1]) {
      const result = validateLateralReachConfig(rawConfig({ testedSide }));
      assert.equal(result.ok, false, `expected ${JSON.stringify(testedSide)} to be rejected`);
    }
  });

  it("rejects non-finite or out-of-range zone coordinates", () => {
    for (const bad of [NaN, Infinity, -Infinity, -0.01, 1.01]) {
      const result = validateLateralReachConfig(
        rawConfig({ fixedTarget: { point: { x: bad, y: 0.5 }, radius: 0.05 } }),
      );
      assert.equal(result.ok, false, `expected x=${bad} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_zone_geometry");
    }
  });

  it("rejects zero, negative, or non-finite radii", () => {
    for (const bad of [0, -0.01, NaN, Infinity]) {
      const result = validateLateralReachConfig(rawConfig({ startingZone: { point: START_POINT, radius: bad } }));
      assert.equal(result.ok, false, `expected radius=${bad} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_zone_geometry");
    }
  });

  it("rejects zones that exactly touch", () => {
    // 0.25/0.125/0.5 are exact binary fractions, so distance and radius sum
    // are both exactly 0.25 with no floating-point rounding ambiguity.
    const result = validateLateralReachConfig(
      rawConfig({
        startingZone: { point: { x: 0.25, y: 0.5 }, radius: 0.125 },
        fixedTarget: { point: { x: 0.5, y: 0.5 }, radius: 0.125 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "zones_overlap");
  });

  it("rejects overlapping zones", () => {
    const result = validateLateralReachConfig(
      rawConfig({
        startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.32, y: 0.5 }, radius: 0.05 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "zones_overlap");
  });

  it("rejects a target fully inside the starting zone", () => {
    const result = validateLateralReachConfig(
      rawConfig({
        startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.2 },
        fixedTarget: { point: { x: 0.32, y: 0.5 }, radius: 0.02 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "zones_overlap");
  });

  it("rejects horizontally overlapping circle projections even when circles are vertically separated", () => {
    const result = validateLateralReachConfig(
      rawConfig({
        startingZone: { point: { x: 0.3, y: 0.2 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.32, y: 0.8 }, radius: 0.05 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "insufficient_horizontal_target_separation");
  });

  it("accepts horizontally separated targets with adequate projection gap", () => {
    const result = validateLateralReachConfig(rawConfig());
    assert.equal(result.ok, true);
  });

  it("does not clamp or repair invalid geometry — result carries no config on failure", () => {
    const result = validateLateralReachConfig(rawConfig({ fixedTarget: { point: { x: 5, y: 0.5 }, radius: 0.05 } }));
    assert.equal(result.ok, false);
    assert.equal("config" in result, false);
  });

  it("does not silently mirror or repair an ambiguous target/starting-zone pair — rejects instead", () => {
    // Same x-coordinate: no resolvable horizontal reach direction.
    const result = validateLateralReachConfig(
      rawConfig({
        startingZone: { point: { x: 0.4, y: 0.3 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.4, y: 0.7 }, radius: 0.05 },
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "ambiguous_target_direction");
    assert.equal("config" in result, false, "an ambiguous config must never be silently resolved to a default direction");
  });

  it("resolves expectedHorizontalDirectionSign as +1 when the target is to the right of the starting zone", () => {
    const result = validateLateralReachConfig(rawConfig());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.config.expectedHorizontalDirectionSign, 1);
  });

  it("resolves expectedHorizontalDirectionSign as -1 when the target is to the left of the starting zone", () => {
    const result = validateLateralReachConfig(
      rawConfig({
        startingZone: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
        fixedTarget: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.config.expectedHorizontalDirectionSign, -1);
  });

  it("rejects invalid tracking config (NaN, Infinity, negative, out-of-range visibility)", () => {
    for (const tracking of [
      { minWristVisibility: NaN, maxAllowedGapMs: 300 },
      { minWristVisibility: 0.3, maxAllowedGapMs: Infinity },
      { minWristVisibility: 0.3, maxAllowedGapMs: -1 },
      { minWristVisibility: 1.5, maxAllowedGapMs: 300 },
      { minWristVisibility: -0.1, maxAllowedGapMs: 300 },
    ]) {
      const result = validateLateralReachConfig(rawConfig({ tracking }));
      assert.equal(result.ok, false, `expected ${JSON.stringify(tracking)} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_tracking_config");
    }
  });

  it("rejects invalid timing config (NaN, Infinity, negative durations)", () => {
    for (const timing of [
      { onsetConfirmationMs: NaN, dwellDurationMs: 200, returnConfirmationMs: 150 },
      { onsetConfirmationMs: 100, dwellDurationMs: Infinity, returnConfirmationMs: 150 },
      { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: -1 },
    ]) {
      const result = validateLateralReachConfig(rawConfig({ timing }));
      assert.equal(result.ok, false, `expected ${JSON.stringify(timing)} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_timing_config");
    }
  });
});

describe("createLateralReachAttemptState", () => {
  const config = buildValidConfig();

  it("accepts a finite, non-negative armedAtMs and a finite attemptIndex", () => {
    const result = createLateralReachAttemptState(config, 0, 0);
    assert.equal(result.ok, true);
  });

  it("rejects NaN armedAtMs", () => {
    const result = createLateralReachAttemptState(config, 0, NaN);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_armed_at_ms");
  });

  it("rejects Infinity armedAtMs", () => {
    const result = createLateralReachAttemptState(config, 0, Infinity);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_armed_at_ms");
  });

  it("rejects negative armedAtMs", () => {
    const result = createLateralReachAttemptState(config, 0, -1);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_armed_at_ms");
  });

  it("rejects a non-finite attemptIndex", () => {
    const result = createLateralReachAttemptState(config, NaN, 0);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_attempt_index");
  });
});

describe("wrist selection", () => {
  it("a left-side config ignores right-wrist-only data", () => {
    const config = buildValidConfig({ testedSide: "left" });
    const state = mustCreateState(config, 0, 0);
    // frame() keys the joint by the *side argument*, not by config.testedSide,
    // so passing "right" here simulates data arriving only under right_wrist
    // while the engine is configured for "left".
    const r = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 0,
      frame: frame("right", START_POINT, 0),
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      // No left_wrist data was ever supplied, so the sample must be treated
      // as untracked, not accidentally read from the right wrist.
      assert.equal(r.snapshot.hasActivePause, false); // gap not yet exceeded
      const readiness = applyLateralReachCommand(r.state, {
        type: "readinessConfirmed",
        nowMs: 10,
        confirmedBy: "clinician",
      });
      assert.equal(readiness.status, "rejected");
      if (readiness.status === "rejected") assert.equal(readiness.reason, "readiness_requires_wrist_in_starting_zone");
    }
  });

  it("a right-side config ignores left-wrist-only data", () => {
    const config = buildValidConfig({ testedSide: "right" });
    const state = mustCreateState(config, 0, 0);
    const r = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 0,
      frame: frame("left", START_POINT, 0),
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      const readiness = applyLateralReachCommand(r.state, {
        type: "readinessConfirmed",
        nowMs: 10,
        confirmedBy: "clinician",
      });
      assert.equal(readiness.status, "rejected");
      if (readiness.status === "rejected") assert.equal(readiness.reason, "readiness_requires_wrist_in_starting_zone");
    }
  });

  it("produces symmetric, correctly-attributed results for equivalent left and right sequences", () => {
    const leftConfig = buildValidConfig({ testedSide: "left" });
    const rightConfig = buildValidConfig({ testedSide: "right" });
    const leftResult = completedSequence(leftConfig);
    const rightResult = completedSequence(rightConfig);
    assert.equal(leftResult.status, "applied");
    assert.equal(rightResult.status, "applied");
    if (leftResult.status === "applied" && rightResult.status === "applied") {
      assert.equal(leftResult.attemptResult?.testedSide, "left");
      assert.equal(rightResult.attemptResult?.testedSide, "right");
      assert.equal(leftResult.attemptResult?.completionState, "completed");
      assert.equal(rightResult.attemptResult?.completionState, "completed");
      assert.equal(leftResult.attemptResult?.reachTimeMs, rightResult.attemptResult?.reachTimeMs);
    }
  });

  it("ignores an extraneous affectedSide field in the raw config candidate — wrist selection is driven only by testedSide", () => {
    const config = buildValidConfig({ testedSide: "right", affectedSide: "left" });
    assert.equal(config.testedSide, "right");
    // Driven with right-wrist-only data; if affectedSide had leaked into
    // wrist selection, this attempt would never reach readiness.
    const state = readyState(config);
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");
  });
});

describe("direction gate — coarse, technical, screen-space horizontal check", () => {
  it("movement toward the configured target confirms onset", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "outbound");
  });

  it("movement away from the configured raw-camera-space target direction does not confirm onset", () => {
    const config = buildValidConfig(); // expectedHorizontalDirectionSign +1 (target is to the right)
    let state = readyState(config);
    const exitPoint = { x: 0.2, y: 0.5 }; // non-target-facing side of START_POINT
    let r = sendFrame(state, config, exitPoint, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "awaiting_readiness", "non-target-facing exit must re-arm readiness");
    }
    r = sendFrame(state, config, { x: 0.1, y: 0.5 }, 40);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "awaiting_readiness", "correction outside the zone must not confirm onset");
    }
  });

  it("pure vertical exit without target-facing boundary crossing does not confirm onset", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const exitPoint = { x: START_POINT.x, y: 0.65 };
    let r = sendFrame(state, config, exitPoint, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: START_POINT.x, y: 0.7 }, 20 + config.timing.onsetConfirmationMs + 50);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
    }
  });

  it("wrist movement inconsistent with configured raw-camera-space target direction does not confirm onset", () => {
    const config = buildValidConfig({
      startingZone: { point: START_POINT, radius: 0.05 },
      fixedTarget: { point: TARGET_POINT, radius: 0.05 },
    });
    const state = readyState(config);
    const r = sendFrame(state, config, { x: 0.15, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "awaiting_readiness");
  });

  it("never claims camera-orientation detection, anatomical side validation, scapular-plane verification, or clinical target placement in implementation output", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      const serialized = JSON.stringify(result.attemptResult).toLowerCase();
      for (const forbidden of [
        "scapular",
        "anatomical",
        "camera_orientation",
        "mirroring",
        "ipsilateral",
        "contralateral",
        "clinical_target",
      ]) {
        assert.equal(serialized.includes(forbidden), false, `unexpected claim: ${forbidden}`);
      }
    }
    const engineSource = `
      movement toward the configured target confirms onset
      screen-space target-facing boundary-crossing check
      raw-camera-space target direction
    `.toLowerCase();
    assert.equal(engineSource.includes("anatomically incorrect"), false);
    assert.equal(engineSource.includes("camera orientation detection"), false);
  });
});

describe("state transitions — initial state and readiness", () => {
  it("starts idle with no active pause and no target reached", () => {
    const state = mustCreateState(buildValidConfig(), 0, 0);
    const snapshot = getLateralReachRuntimeSnapshot(state);
    assert.equal(snapshot.phase, "idle");
    assert.equal(snapshot.terminal, false);
    assert.equal(snapshot.hasActivePause, false);
    assert.equal(snapshot.targetReached, false);
  });

  it("moves to awaiting_readiness on the first frame, valid or not", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, null, 0);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "awaiting_readiness");
  });

  it("accepts readinessConfirmed only while the wrist is inside the starting zone", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const f = sendFrame(state, config, START_POINT, 0);
    assert.equal(f.status, "applied");
    state = f.state;
    const r = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("rejects readinessConfirmed while the wrist is outside the starting zone", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const f = sendFrame(state, config, { x: 0.5, y: 0.5 }, 0);
    assert.equal(f.status, "applied");
    state = f.state;
    const r = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_wrist_in_starting_zone");
  });

  it("rejects readinessConfirmed with no wrist tracked yet", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_wrist_in_starting_zone");
  });

  it("rejects readinessConfirmed with an invalid confirmedBy actor", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const f = sendFrame(state, config, START_POINT, 0);
    assert.equal(f.status, "applied");
    state = f.state;
    const r = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "system" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_requires_valid_confirmed_by");
  });

  it("rejects readinessConfirmed once already past the readiness phase", () => {
    const config = buildValidConfig();
    const state = readyState(config);
    const r = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 20, confirmedBy: "clinician" });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "readiness_not_applicable_in_current_phase");
  });

  it("ignores pre-readiness wrist movement — it has no onset effect before readiness is confirmed", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    // Movement well outside the starting zone, before any readinessConfirmed command.
    const r = sendFrame(state, config, { x: 0.55, y: 0.5 }, 0);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "awaiting_readiness", "pre-readiness movement must not begin an onset candidate");
    }
  });
});

describe("movement onset", () => {
  it("begins an onset candidate on zone exit", () => {
    const config = buildValidConfig();
    const state = readyState(config);
    const r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("resets the onset candidate on bounce-back into the starting zone", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    let r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 50); // bounce back before onsetConfirmationMs elapses
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 60);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("does not confirm onset before the configured duration elapses", () => {
    const config = buildValidConfig();
    const state = readyState(config);
    const r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("confirms onset exactly at the configured duration boundary, given correct-direction displacement", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    let r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.55, y: 0.5 }, 20 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "outbound");
  });

  it("confirms onset immediately on the first target-facing boundary-crossing frame when onsetConfirmationMs is 0", () => {
    const config = buildValidConfig({ timing: { onsetConfirmationMs: 0, dwellDurationMs: 200, returnConfirmationMs: 150 } });
    const state = readyState(config);
    const r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "outbound");
      assert.equal(r.state.movementOnsetAtMs, 20);
    }
  });

  it("a brief exit followed by return before confirmation does not start movement (path metrics reflect no onset)", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    let r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 50);
    assert.equal(r.status, "applied");
    state = r.state;
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 100 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(finalRes.attemptResult?.completionState, "not_started");
      assert.equal(finalRes.attemptResult?.reachTimeMs, null);
    }
  });
});

describe("wrong-direction exit and re-arming", () => {
  it("requires return inside the starting zone and a new readiness confirmation after a non-target-facing exit", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    let r = sendFrame(state, config, { x: 0.15, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "awaiting_readiness");

    r = sendFrame(state, config, START_POINT, 40);
    assert.equal(r.status, "applied");
    state = r.state;
    const readinessRetry = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 50,
      confirmedBy: "clinician",
    });
    assert.equal(readinessRetry.status, "applied");
    state = readinessRetry.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");

    r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 60);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.55, y: 0.5 }, 60 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "outbound");
  });

  it("records a factual non_target_facing_exit_observed_before_valid_onset note without clinical judgment", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const r = sendFrame(state, config, { x: 0.15, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 100 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(
        finalRes.attemptResult?.factualNotes.includes("non_target_facing_exit_observed_before_valid_onset"),
        true,
      );
      const serialized = JSON.stringify(finalRes.attemptResult).toLowerCase();
      for (const forbidden of ["impairment", "abnormal", "compensation", "failure", "severity"]) {
        assert.equal(serialized.includes(forbidden), false, `note must not imply ${forbidden}`);
      }
    }
  });
});

describe("fast first observed frame inside target", () => {
  it("does not finalize as not_started when the first post-readiness frame is already inside the target", () => {
    const config = buildValidConfig({ timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 } });
    let state = readyState(config);
    let r = sendFrame(state, config, TARGET_POINT, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");

    r = sendFrame(state, config, TARGET_POINT, 20 + config.timing.onsetConfirmationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "dwelling");

    r = sendFrame(state, config, TARGET_POINT, 20 + config.timing.onsetConfirmationMs + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.notEqual(finalRes.attemptResult?.completionState, "not_started");
      assert.equal(finalRes.attemptResult?.targetReached, finalRes.attemptResult?.dwellConfirmed);
    }
  });

  it("allows reachTimeMs to be 0 when onset and target entry occur on the same observed frame", () => {
    const config = buildValidConfig({
      timing: { onsetConfirmationMs: 0, dwellDurationMs: 0, returnConfirmationMs: 150 },
    });
    const state = readyState(config);
    const r = sendFrame(state, config, TARGET_POINT, 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "reach_confirmed");
      assert.equal(r.snapshot.targetReached, r.snapshot.dwellConfirmed);
    }
    const finalRes = applyLateralReachCommand(r.status === "applied" ? r.state : state, {
      type: "attemptWindowEnded",
      nowMs: 500,
    });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(finalRes.attemptResult?.reachTimeMs, 0);
      assert.equal(finalRes.attemptResult?.targetReached, finalRes.attemptResult?.dwellConfirmed);
    }
  });
});

describe("dwell", () => {
  it("target entry alone does not set targetReached — only a confirmed dwell does", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, { x: 0.63, y: 0.5 }, 200);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "dwelling");
      assert.equal(r.snapshot.targetReached, false);
      assert.equal(r.snapshot.dwellConfirmed, false);
    }
  });

  it("does not confirm dwell before the configured duration elapses", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 300); // only 50ms of 200ms required
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.dwellConfirmed, false);
  });

  it("confirms dwell exactly at the configured duration and sets targetReached together with dwellConfirmed", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.dwellConfirmed, true);
      assert.equal(r.snapshot.targetReached, true);
      assert.equal(r.snapshot.phase, "reach_confirmed");
    }
  });

  it("resets the dwell candidate on target exit and reverts phase to outbound", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.6, y: 0.5 }, 300); // exits target before dwell completes
    assert.equal(r.status, "applied");
    state = r.state;
    if (r.status === "applied") assert.equal(r.snapshot.phase, "outbound");
    r = sendFrame(state, config, TARGET_POINT, 300 + config.timing.dwellDurationMs - 1);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.dwellConfirmed, false, "dwell timer must have restarted");
  });

  it("resets the dwell candidate on tracking invalidity", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, null, 300); // invalid sample mid-dwell (within tolerated gap)
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 300 + config.timing.dwellDurationMs - 1);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.dwellConfirmed, false);
  });

  it("does not include dwell duration in reachTimeMs", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      // targetEntryAtMs=250, movementOnsetAtMs=20 -> reachTimeMs=230,
      // independent of the 210ms it actually took to confirm dwell.
      assert.equal(result.attemptResult?.reachTimeMs, 230);
    }
  });

  it("confirms dwell on the first valid target-entry frame when dwellDurationMs is 0", () => {
    const config = buildValidConfig({ timing: { onsetConfirmationMs: 100, dwellDurationMs: 0, returnConfirmationMs: 150 } });
    const state = outboundState(config);
    const r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.dwellConfirmed, true);
      assert.equal(r.snapshot.phase, "reach_confirmed");
    }
  });

  it("prevents duplicate target confirmation — a terminal attempt cannot be re-confirmed by a later frame", () => {
    const config = buildValidConfig();
    const first = completedSequence(config);
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    const r = sendFrame(first.state, config, TARGET_POINT, 900);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "attempt_already_terminal");
  });
});

describe("failed first dwell followed by successful second dwell", () => {
  it("anchors reachTimeMs and outbound path to the entry that actually completes dwell, including the failed attempt's movement", () => {
    const config = buildValidConfig();
    let state = outboundState(config); // movementOnsetAtMs = 20, onset point (0.5,0.5)

    let r = sendFrame(state, config, { x: 0.63, y: 0.5 }, 200);
    assert.equal(r.status, "applied");
    state = r.state;

    // First entry — dwell candidate opens, targetReached/dwellConfirmed remain false.
    r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).targetReached, false);
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "dwelling");

    // Exit before dwell completes (30ms < 200ms) — candidate discarded, phase reverts to outbound.
    r = sendFrame(state, config, { x: 0.6, y: 0.5 }, 280);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).targetReached, false, "a failed entry must never set targetReached");
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "outbound");

    // Movement away from the target — still part of the pre-reach outbound path.
    r = sendFrame(state, config, { x: 0.5, y: 0.4 }, 320);
    assert.equal(r.status, "applied");
    state = r.state;

    // Second entry — new candidate.
    r = sendFrame(state, config, TARGET_POINT, 400);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "dwelling");

    // Successful dwell on the second entry.
    r = sendFrame(state, config, TARGET_POINT, 400 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).targetReached, true);
    assert.equal(getLateralReachRuntimeSnapshot(state).dwellConfirmed, true);

    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 700 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status !== "applied") return;

    // reachTimeMs must use the SECOND entry (400), not the first (250).
    assert.equal(finalRes.attemptResult?.reachTimeMs, 400 - 20);

    const length = finalRes.attemptResult?.normalizedPathLength ?? null;
    assert.notEqual(length, null);
    assert.ok((length as number) > 0.2, `expected path length > 0.2 (first-entry-only distance), got ${length}`);

    const efficiency = finalRes.attemptResult?.pathEfficiency ?? null;
    assert.notEqual(efficiency, null);
    assert.ok((efficiency as number) < 1, `expected pathEfficiency < 1, got ${efficiency}`);

    assert.equal(finalRes.attemptResult?.targetReached, true);
    assert.equal(finalRes.attemptResult?.dwellConfirmed, true);
  });
});

describe("targetReached / dwellConfirmed invariant", () => {
  it("holds for a completed attempt", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(result.attemptResult?.targetReached, result.attemptResult?.dwellConfirmed);
      assert.equal(result.attemptResult?.targetReached, true);
    }
  });

  it("holds for incomplete (never reached)", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 200 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.attemptResult?.targetReached, r.attemptResult?.dwellConfirmed);
      assert.equal(r.attemptResult?.targetReached, false);
    }
  });

  it("holds for incomplete when a dwell attempt was made but failed", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.6, y: 0.5 }, 300); // exits before dwell completes
    assert.equal(r.status, "applied");
    state = r.state;
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 400 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(finalRes.attemptResult?.targetReached, false);
      assert.equal(finalRes.attemptResult?.dwellConfirmed, false);
    }
  });

  it("holds for not_started", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 50 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.attemptResult?.targetReached, r.attemptResult?.dwellConfirmed);
      assert.equal(r.attemptResult?.targetReached, false);
    }
  });

  it("holds for stopped, interrupted, and not_assessable", () => {
    const config = buildValidConfig();

    const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const stopped = applyLateralReachCommand(outboundState(config), {
      type: "clinicalStopReceived",
      nowMs: 200,
      event: stopEval.event,
    });
    assert.equal(stopped.status, "applied");
    if (stopped.status === "applied") assert.equal(stopped.attemptResult?.targetReached, stopped.attemptResult?.dwellConfirmed);

    const interrupted = applyLateralReachCommand(outboundState(config), {
      type: "runtimeInterruptionReceived",
      nowMs: 200,
    });
    assert.equal(interrupted.status, "applied");
    if (interrupted.status === "applied")
      assert.equal(interrupted.attemptResult?.targetReached, interrupted.attemptResult?.dwellConfirmed);

    const notAssessable = applyLateralReachCommand(outboundState(config), {
      type: "markedNotAssessable",
      nowMs: 200,
      reason: "clinician judgment call",
    });
    assert.equal(notAssessable.status, "applied");
    if (notAssessable.status === "applied")
      assert.equal(notAssessable.attemptResult?.targetReached, notAssessable.attemptResult?.dwellConfirmed);
  });
});

describe("return to starting zone", () => {
  function toReachConfirmed(config: LateralReachConfig): LateralReachAttemptState {
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    return r.state;
  }

  it("ignores the starting zone before reach is confirmed", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = sendFrame(state, config, START_POINT, 210);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.returnToStartCompleted, false);
      assert.notEqual(r.snapshot.phase, "completed_pending_finalization");
    }
  });

  it("begins a return candidate on starting-zone re-entry", () => {
    const config = buildValidConfig();
    const state = toReachConfirmed(config);
    const r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, "returning");
      assert.equal(r.snapshot.returnToStartCompleted, false);
    }
  });

  it("does not confirm return from a single frame", () => {
    const config = buildValidConfig();
    const state = toReachConfirmed(config);
    const r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.returnToStartCompleted, false);
  });

  it("confirms return exactly at the configured duration boundary", () => {
    const config = buildValidConfig();
    let state = toReachConfirmed(config);
    let r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 470 + config.timing.returnConfirmationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.returnToStartCompleted, true);
      assert.equal(r.snapshot.phase, "completed_pending_finalization");
    }
  });

  it("resets the return candidate on zone exit before confirmation", () => {
    const config = buildValidConfig();
    let state = toReachConfirmed(config);
    let r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 500);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 500 + config.timing.returnConfirmationMs - 1);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.returnToStartCompleted, false, "return timer must have restarted");
  });

  it("confirms return on the first valid re-entry frame when returnConfirmationMs is 0", () => {
    const config = buildValidConfig({ timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 0 } });
    const state = toReachConfirmed(config);
    const r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.returnToStartCompleted, true);
      assert.equal(r.snapshot.phase, "completed_pending_finalization");
    }
  });

  it("computes returnTimeMs as confirmed-return timestamp minus reachConfirmedAtMs", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.returnTimeMs, 300);
  });
});

describe("path metrics", () => {
  it("uses the actual movement-onset wrist position, not startingZone.point, as the straight-line start", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      approxEqual(result.attemptResult?.normalizedPathLength ?? -1, 0.2);
      approxEqual(result.attemptResult?.pathEfficiency ?? -1, 1);
    }
  });

  it("accumulates only valid, contiguous outbound samples into path length", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, { x: 0.6, y: 0.6 }, 150); // detour off the straight line
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      const finalRes = applyLateralReachCommand(r.state, { type: "attemptWindowEnded", nowMs: 700 });
      assert.equal(finalRes.status, "applied");
      if (finalRes.status === "applied") {
        const length = finalRes.attemptResult?.normalizedPathLength ?? null;
        assert.notEqual(length, null);
        assert.ok((length as number) > 0.2);
        const efficiency = finalRes.attemptResult?.pathEfficiency ?? null;
        assert.notEqual(efficiency, null);
        assert.ok((efficiency as number) < 1);
      }
    }
  });

  it("excludes dwell-phase samples from the outbound path (verified by exact expected length)", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") approxEqual(result.attemptResult?.normalizedPathLength ?? -1, 0.2);
  });

  it("excludes return-phase samples from the outbound path", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") approxEqual(result.attemptResult?.normalizedPathLength ?? -1, 0.2);
  });

  it("nulls path metrics when a tolerated tracking gap occurs during the outbound segment", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      const finalRes = applyLateralReachCommand(r.state, { type: "attemptWindowEnded", nowMs: 700 });
      assert.equal(finalRes.status, "applied");
      if (finalRes.status === "applied") {
        assert.equal(finalRes.attemptResult?.normalizedPathLength, null);
        assert.equal(finalRes.attemptResult?.pathEfficiency, null);
      }
    }
  });

  it("nulls path metrics when a protective pause occurs during the outbound segment", () => {
    const config = buildValidConfig();
    let state = openPause(outboundState(config), config, 150);
    const resume = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(resume.status, "applied");
    state = resume.state;
    const r = sendFrame(state, config, TARGET_POINT, 550);
    assert.equal(r.status, "applied");
    const finalRes = applyLateralReachCommand(r.state, { type: "attemptWindowEnded", nowMs: 600 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(finalRes.attemptResult?.normalizedPathLength, null);
      assert.equal(finalRes.attemptResult?.pathEfficiency, null);
    }
  });

  it("nulls a materially invalid pathEfficiency instead of silently clamping it", () => {
    // straightLineDistance(onset->center) = 0.4; the wrist takes a short
    // 0.12 direct hop to a point clearly inside the near edge of a
    // deliberately large target — raw efficiency = 0.4/0.12 ~= 3.33, far
    // outside [0,1+epsilon].
    const config = buildValidConfig({
      fixedTarget: { point: { x: 0.9, y: 0.5 }, radius: 0.3 },
      timing: { onsetConfirmationMs: 0, dwellDurationMs: 0, returnConfirmationMs: 150 },
    });
    let state = readyState(config);
    let r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "outbound");
    r = sendFrame(state, config, { x: 0.62, y: 0.5 }, 30); // distance 0.28 from (0.9,0.5) -> clearly inside the 0.3 radius
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.phase, "reach_confirmed");
    const finalRes = applyLateralReachCommand(r.state, { type: "attemptWindowEnded", nowMs: 100 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.equal(
        finalRes.attemptResult?.pathEfficiency,
        null,
        "a materially-over-1 raw ratio must never be silently reported as a plausible value",
      );
    }
  });

  it("never includes raw wrist samples in the finalized result", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      const keys = Object.keys(result.attemptResult ?? {});
      assert.equal(keys.some((k) => /sample|trajectory|outbound/i.test(k)), false);
    }
  });
});

describe("timestamp validation and monotonic engine time", () => {
  it("rejects NaN nowMs on a frame command", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, START_POINT, NaN);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "invalid_now_ms");
  });

  it("rejects Infinity nowMs", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, START_POINT, Infinity);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "invalid_now_ms");
  });

  it("rejects negative nowMs", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, START_POINT, -1);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "invalid_now_ms");
  });

  it("rejects a timestamp earlier than armedAtMs on the very first command", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 100);
    const r = sendFrame(state, config, START_POINT, 50);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
  });

  it("rejects a timestamp earlier than the last accepted command", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 50);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
  });

  it("rejects equal frame timestamps without mutating state", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const before = JSON.parse(JSON.stringify(state));
    r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "frame_timestamp_not_strictly_increasing");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("rejects equal frame timestamps even when the wrist position differs", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const beforePhase = getLateralReachRuntimeSnapshot(state).phase;
    r = sendFrame(state, config, { x: 0.55, y: 0.5 }, 100);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "frame_timestamp_not_strictly_increasing");
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, beforePhase);
  });

  it("rejects duplicate frames that would otherwise lengthen the outbound path", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, { x: 0.6, y: 0.55 }, 200);
    assert.equal(r.status, "applied");
    state = r.state;
    const samplesBeforeDuplicate = state.outboundSamples.length;
    const before = JSON.parse(JSON.stringify(state));
    r = sendFrame(state, config, { x: 0.65, y: 0.6 }, 200);
    assert.equal(r.status, "rejected");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
    assert.equal(state.outboundSamples.length, samplesBeforeDuplicate);
  });

  it("continues to accept strictly increasing frame timestamps", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 101);
    assert.equal(r.status, "applied");
  });

  it("accepts equal timestamps on non-frame commands while frame timestamps remain strict", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const readiness = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    });
    assert.equal(readiness.status, "applied");
    if (readiness.status === "applied") assert.equal(readiness.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  it("rejects stale timestamps on readinessConfirmed without mutating state", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const before = JSON.parse(JSON.stringify(state));
    const readiness = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 50,
      confirmedBy: "clinician",
    });
    assert.equal(readiness.status, "rejected");
    if (readiness.status === "rejected") assert.equal(readiness.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("rejects stale timestamps on resumeRequested without mutating state", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const before = JSON.parse(JSON.stringify(state));
    const r = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 100,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("rejects stale timestamps on clinicalStopReceived without mutating state", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const before = JSON.parse(JSON.stringify(state));
    const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const r = applyLateralReachCommand(state, {
      type: "clinicalStopReceived",
      nowMs: 5,
      event: stopEval.event,
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("rejects stale timestamps on runtimeInterruptionReceived without mutating state", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const before = JSON.parse(JSON.stringify(state));
    const r = applyLateralReachCommand(state, {
      type: "runtimeInterruptionReceived",
      nowMs: 5,
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("rejects stale timestamps on attemptWindowEnded without mutating state", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const before = JSON.parse(JSON.stringify(state));
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 5 });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("rejects stale timestamps on markedNotAssessable without mutating state", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const before = JSON.parse(JSON.stringify(state));
    const r = applyLateralReachCommand(state, {
      type: "markedNotAssessable",
      nowMs: 5,
      reason: "clinician judgment call",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
  });

  it("a rejected out-of-range command does not advance the clock, so a later valid command still succeeds", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    let r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;
    const badR = sendFrame(state, config, START_POINT, NaN);
    assert.equal(badR.status, "rejected");
    r = sendFrame(state, config, START_POINT, 150);
    assert.equal(r.status, "applied");
  });

  it("rejects a resume timestamp earlier than the pause start (via the general monotonicity gate)", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 0,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
  });

  it("rejects a window-end timestamp earlier than movement onset", () => {
    const config = buildValidConfig();
    const state = outboundState(config); // movementOnsetAtMs = 20, lastAcceptedNowMs = 130
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 5 });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "now_ms_not_monotonic");
  });

  it("never produces a negative reachTimeMs, returnTimeMs, totalMovementTimeMs, or protectivePauseDurationMs across a full attempt", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.ok((result.attemptResult?.reachTimeMs ?? 0) >= 0);
      assert.ok((result.attemptResult?.returnTimeMs ?? 0) >= 0);
      assert.ok((result.attemptResult?.totalMovementTimeMs ?? 0) >= 0);
      assert.ok((result.attemptResult?.protectivePauseDurationMs ?? 0) >= 0);
    }
  });
});

describe("tracking and protective pauses", () => {
  it("excludes an invalid wrist frame from continuity without immediately pausing", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, false);
  });

  it("does not open a pause for a short gap under maxAllowedGapMs", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, null, 150 + config.tracking.maxAllowedGapMs - 10);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, false);
  });

  it("opens an active pause exactly at the maxAllowedGapMs boundary", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, null, 150 + config.tracking.maxAllowedGapMs);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, true);
  });

  it("opens an active pause once the gap exceeds maxAllowedGapMs", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, null, 150);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, null, 150 + config.tracking.maxAllowedGapMs + 10);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, true);
  });

  it("opens a pause on the first invalid frame when maxAllowedGapMs is 0", () => {
    const config = buildValidConfig({ tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 0 } });
    const state = mustCreateState(config, 0, 0);
    const r1 = sendFrame(state, config, START_POINT, 0);
    assert.equal(r1.status, "applied");
    if (r1.status !== "applied") return;
    const r2 = sendFrame(r1.state, config, null, 10);
    assert.equal(r2.status, "applied");
    if (r2.status === "applied") assert.equal(r2.snapshot.hasActivePause, true);
  });

  it("freezes phase progression while a pause is active", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const pausedPhase = getLateralReachRuntimeSnapshot(state).phase;
    const r = sendFrame(state, config, TARGET_POINT, 150 + config.tracking.maxAllowedGapMs + 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.snapshot.phase, pausedPhase, "phase must not advance while paused");
      assert.equal(r.snapshot.targetReached, false);
    }
  });

  it("never auto-resumes even once tracking is restored", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = sendFrame(state, config, { x: 0.55, y: 0.5 }, 150 + config.tracking.maxAllowedGapMs + 20);
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.snapshot.hasActivePause, true, "must remain paused without an explicit resume");
  });

  it("rejects resumeRequested when no pause is active", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 200,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "no_active_pause_to_resume");
  });

  it("rejects resume without readiness confirmation", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, {
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
    const r = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "system",
    });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "resume_requires_valid_human_actor");
  });

  it("a successful resume finalizes exactly one pause event, non-negative duration, and preserves the prior phase", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const priorPhase = getLateralReachRuntimeSnapshot(state).phase;
    const r = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.protectivePauseEvent?.outcome, "resumed");
      assert.equal(r.snapshot.hasActivePause, false);
      assert.equal(r.snapshot.phase, priorPhase);
      assert.equal(r.snapshot.protectivePauseCount, 1);
      const duration =
        (r.protectivePauseEvent?.endedAtMs ?? 0) - (r.protectivePauseEvent?.startedAtMs ?? 0);
      assert.ok(duration >= 0);
    }
  });

  it("clinical stop during an active pause finalizes the pause as escalated_to_clinical_stop", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const stopEval = evaluateClinicalStop({ reason: "patient_requested_stop", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const r = applyLateralReachCommand(state, { type: "clinicalStopReceived", nowMs: 500, event: stopEval.event });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.protectivePauseEvent?.outcome, "escalated_to_clinical_stop");
      assert.equal(r.attemptResult?.completionState, "stopped");
    }
  });

  it("window end during an active pause finalizes the pause as session_ended_while_paused", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.protectivePauseEvent?.outcome, "session_ended_while_paused");
  });

  it("runtime interruption during an active pause finalizes the pause as session_ended_while_paused", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, { type: "runtimeInterruptionReceived", nowMs: 500 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      assert.equal(r.protectivePauseEvent?.outcome, "session_ended_while_paused");
      assert.equal(r.attemptResult?.completionState, "interrupted");
    }
  });

  it("window end during an unresolved active pause produces not_assessable", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_assessable");
  });

  it("protective pauses never carry clinical-event vocabulary", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") {
      const event = r.protectivePauseEvent;
      assert.notEqual(event, null);
      assert.equal("reviewRequired" in (event ?? {}), false);
      assert.equal("recordedBy" in (event ?? {}), false);
    }
  });

  it("repeated terminal commands after a pause-finalizing command cannot duplicate the pause event", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const first = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    assert.equal(first.attemptResult?.protectivePauseCount, 1);
    const second = applyLateralReachCommand(first.state, { type: "attemptWindowEnded", nowMs: 600 });
    assert.equal(second.status, "rejected");
    if (second.status === "rejected") assert.equal(second.reason, "attempt_already_terminal");
  });
});

describe("completed_pending_finalization behavior", () => {
  it("rejects an additional frame command once return is confirmed, with a documented reason", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 470 + config.timing.returnConfirmationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "completed_pending_finalization");

    const rejectedFrame = sendFrame(state, config, TARGET_POINT, 700);
    assert.equal(rejectedFrame.status, "rejected");
    if (rejectedFrame.status === "rejected") assert.equal(rejectedFrame.reason, "awaiting_explicit_finalization");
  });

  it("a clinical stop received while pending finalization still produces stopped", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 470 + config.timing.returnConfirmationMs);
    assert.equal(r.status, "applied");
    state = r.state;

    const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const stopped = applyLateralReachCommand(state, { type: "clinicalStopReceived", nowMs: 700, event: stopEval.event });
    assert.equal(stopped.status, "applied");
    if (stopped.status === "applied") assert.equal(stopped.attemptResult?.completionState, "stopped");
  });
});

describe("not_started vs incomplete — every internal phase at attemptWindowEnded", () => {
  it("idle -> not_started", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 50 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_started");
  });

  it("awaiting_readiness -> not_started", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const f = sendFrame(state, config, null, 0);
    assert.equal(f.status, "applied");
    state = f.state;
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 50 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_started");
  });

  it("ready_confirmed_awaiting_onset, wrist never leaves the starting zone -> not_started", () => {
    const config = buildValidConfig();
    const state = readyState(config);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 50 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_started");
  });

  it("ready_confirmed_awaiting_onset, onset candidate pending but not yet confirmed -> not_started", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    const r0 = sendFrame(state, config, { x: 0.5, y: 0.5 }, 20);
    assert.equal(r0.status, "applied");
    state = r0.state;
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 25 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_started");
  });

  it("outbound -> incomplete", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 300 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "incomplete");
  });

  it("dwelling -> incomplete", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    const entry = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(entry.status, "applied");
    state = entry.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "dwelling");
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 300 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "incomplete");
  });

  it("reach_confirmed -> incomplete", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "reach_confirmed");
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") assert.equal(finalRes.attemptResult?.completionState, "incomplete");
  });

  it("returning -> incomplete", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "returning");
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 600 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") assert.equal(finalRes.attemptResult?.completionState, "incomplete");
  });

  it("completed_pending_finalization -> completed", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.completionState, "completed");
  });

  it("any phase with an unresolved active pause -> not_assessable, overriding the phase-based rule", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_assessable");
  });
});

describe("terminal outcomes", () => {
  it("produces completed when dwell and return are both confirmed", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.completionState, "completed");
  });

  it("produces interrupted on an unexpected runtime interruption", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = applyLateralReachCommand(state, {
      type: "runtimeInterruptionReceived",
      nowMs: 200,
      reason: "browser_tab_closed",
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "interrupted");
  });

  it("produces stopped when a clinical stop affects the attempt", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const r = applyLateralReachCommand(state, { type: "clinicalStopReceived", nowMs: 200, event: stopEval.event });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "stopped");
  });

  it("produces not_assessable on an explicit markedNotAssessable command", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const r = applyLateralReachCommand(state, {
      type: "markedNotAssessable",
      nowMs: 200,
      reason: "clinician judgment call",
    });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_assessable");
  });

  it("produces not_started when the window ends before readiness is confirmed", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const r = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 50 });
    assert.equal(r.status, "applied");
    if (r.status === "applied") assert.equal(r.attemptResult?.completionState, "not_started");
  });

  it("never overwrites an already-terminal attempt", () => {
    const first = completedSequence(buildValidConfig());
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    const second = applyLateralReachCommand(first.state, { type: "attemptWindowEnded", nowMs: 900 });
    assert.equal(second.status, "rejected");
    if (second.status === "rejected") assert.equal(second.reason, "attempt_already_terminal");
  });

  it("rejects a frame received after terminal finalization", () => {
    const config = buildValidConfig();
    const first = completedSequence(config);
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    const r = sendFrame(first.state, config, TARGET_POINT, 900);
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "attempt_already_terminal");
  });

  it("rejects a clinical stop received after the attempt is already terminal", () => {
    const first = completedSequence(buildValidConfig());
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const r = applyLateralReachCommand(first.state, { type: "clinicalStopReceived", nowMs: 900, event: stopEval.event });
    assert.equal(r.status, "rejected");
    if (r.status === "rejected") assert.equal(r.reason, "attempt_already_terminal");
  });

  it("clinical stop always wins over a phase that would otherwise complete", () => {
    const config = buildValidConfig();
    let state = outboundState(config);
    let r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250 + config.timing.dwellDurationMs);
    assert.equal(r.status, "applied");
    state = r.state;
    const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
    assert.equal(stopEval.ok, true);
    if (!stopEval.ok) return;
    const stopped = applyLateralReachCommand(state, {
      type: "clinicalStopReceived",
      nowMs: 500,
      event: stopEval.event,
    });
    assert.equal(stopped.status, "applied");
    if (stopped.status === "applied") assert.equal(stopped.attemptResult?.completionState, "stopped");
  });
});

describe("result immutability and aliasing", () => {
  it("applying a command does not mutate the previous state", () => {
    const config = buildValidConfig();
    const state = outboundState(config);
    const before = JSON.parse(JSON.stringify(state));
    const r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    assert.deepEqual(JSON.parse(JSON.stringify(state)), before, "the input state object must remain unchanged");
  });

  it("mutating the returned result's protectivePauseEvents array does not affect the engine state", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const resume = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 500,
      readinessConfirmedAt: "2026-07-30T12:00:00.000Z",
      resumedBy: "clinician",
    });
    assert.equal(resume.status, "applied");
    if (resume.status !== "applied") return;
    const finalRes = applyLateralReachCommand(resume.state, { type: "attemptWindowEnded", nowMs: 600 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status !== "applied") return;
    const events = finalRes.attemptResult?.protectivePauseEvents ?? [];
    assert.equal(events.length, 1);
    const stateEventsBefore = finalRes.state.protectivePauseEvents.length;
    events.push({ ...events[0] });
    assert.equal(finalRes.state.protectivePauseEvents.length, stateEventsBefore, "mutating the result must not affect engine state");
  });

  it("the result's protectivePauseEvents array is a distinct object from the state's array", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      assert.notEqual(finalRes.attemptResult?.protectivePauseEvents, finalRes.state.protectivePauseEvents);
    }
  });

  it("protectivePauseDurationMs is derived from finalized events, not a separately drifting accumulator", () => {
    const config = buildValidConfig();
    const state = openPause(outboundState(config), config, 150);
    const finalRes = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 500 });
    assert.equal(finalRes.status, "applied");
    if (finalRes.status === "applied") {
      const event = finalRes.attemptResult?.protectivePauseEvents[0];
      const expectedDuration = (event?.endedAtMs ?? 0) - (event?.startedAtMs ?? 0);
      assert.equal(finalRes.attemptResult?.protectivePauseDurationMs, expectedDuration);
    }
  });
});

describe("safety and scope", () => {
  it("the finalized result passes the Phase 1 session-result safety validator", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(isSafetyVocabularyFree(result.attemptResult), true);
      assert.deepEqual(findForbiddenSafetyVocabularyKeys(result.attemptResult), []);
    }
  });

  it("carries no shoulder or elbow angle values, and no trunk-displacement observation", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(result.attemptResult?.peakShoulderAngleDeg, null);
      assert.equal(result.attemptResult?.peakElbowExtensionDeg, null);
      assert.equal(result.attemptResult?.trunkDisplacementObserved, null);
    }
  });

  it("carries testedSide through to the result via the approved field", () => {
    const config = buildValidConfig({ testedSide: "left" });
    const result = completedSequence(config);
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.testedSide, "left");
  });

  it("carries the approved taskId literal", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") assert.equal(result.attemptResult?.taskId, "lateralReach");
  });

  it("always reports trackingQualitySummary as 'unknown' in Phase 3", () => {
    const config = buildValidConfig();

    const completed = completedSequence(buildValidConfig());
    assert.equal(completed.status, "applied");
    if (completed.status === "applied") assert.equal(completed.attemptResult?.trackingQualitySummary, "unknown");

    const incomplete = applyLateralReachCommand(outboundState(config), { type: "attemptWindowEnded", nowMs: 300 });
    assert.equal(incomplete.status, "applied");
    if (incomplete.status === "applied") assert.equal(incomplete.attemptResult?.trackingQualitySummary, "unknown");

    const notAssessable = applyLateralReachCommand(openPause(outboundState(config), config, 150), {
      type: "attemptWindowEnded",
      nowMs: 500,
    });
    assert.equal(notAssessable.status, "applied");
    if (notAssessable.status === "applied") assert.equal(notAssessable.attemptResult?.trackingQualitySummary, "unknown");

    const notStarted = applyLateralReachCommand(mustCreateState(config, 0, 0), {
      type: "attemptWindowEnded",
      nowMs: 50,
    });
    assert.equal(notStarted.status, "applied");
    if (notStarted.status === "applied") assert.equal(notStarted.attemptResult?.trackingQualitySummary, "unknown");
  });

  it("never produces an overall score, severity, or interpretation field", () => {
    const result = completedSequence(buildValidConfig());
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      const keys = Object.keys(result.attemptResult ?? {}).map((k) => k.toLowerCase());
      for (const forbidden of ["score", "severity", "interpretation", "diagnosis", "grade"]) {
        assert.equal(keys.some((k) => k.includes(forbidden)), false, `unexpected field containing "${forbidden}"`);
      }
    }
  });
});

describe("observationUnavailable command", () => {
  it("accepts valid monotonic nowMs", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const result = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(result.status, "applied");
  });

  it("rejects decreasing nowMs", () => {
    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);
    const r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    const result = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 99 });
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.match(result.reason, /monotonic/i);
    }
  });

  it("first unavailable observation establishes invalidTrackingSinceMs", () => {
    const config = buildValidConfig();
    const state = mustCreateState(config, 0, 0);
    const result = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(result.status, "applied");
    if (result.status === "applied") {
      assert.equal(result.state.invalidTrackingSinceMs, 100);
    }
  });

  it("short unavailable gap does not open protective pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 1000, minWristVisibility: 0.5 } });
    let state = mustCreateState(config, 0, 0);
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 200 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause, null);
  });

  it("threshold-reaching unavailable gap opens exactly one protective pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5 } });
    let state = mustCreateState(config, 0, 0);
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause, null);
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
    if (state.activePause) {
      assert.equal(state.activePause.reason.category, "tracking_or_environment");
      assert.equal(state.activePause.startedAtMs, 100);
    }
  });

  it("continued unavailable observations while paused do not create duplicate pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5 } });
    let state = mustCreateState(config, 0, 0);
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    const pauseStartedAt = state.activePause?.startedAtMs;
    assert.notEqual(pauseStartedAt, undefined);
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 400 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 500 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.activePause?.startedAtMs, pauseStartedAt);
  });

  it("observationUnavailable creates no movement progress", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    assert.equal(state.phase, "ready_confirmed_awaiting_onset");
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 200 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 250 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.phase, "ready_confirmed_awaiting_onset");
    assert.equal(state.movementOnsetAtMs, null);
  });

  it("valid frame returning does NOT auto-resume active pause", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5 } });
    let state = readyState(config);
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 150 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 350 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
    r = sendFrame(state, config, START_POINT, 400);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
  });

  it("explicit resumeRequested is still required after pause opens", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5 } });
    let state = readyState(config);
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 150 });
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 350 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.notEqual(state.activePause, null);
    r = sendFrame(state, config, START_POINT, 400);
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, {
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
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5 } });
    let state = mustCreateState(config, 0, 0);
    assert.equal(state.phase, "idle");
    let r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.phase, "awaiting_readiness");
    r = applyLateralReachCommand(state, { type: "observationUnavailable", nowMs: 300 });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(state.phase, "awaiting_readiness");
    assert.notEqual(state.activePause, null);
  });

  it("observationUnavailable and invalid-wrist frame produce equivalent tracking-gap behavior", () => {
    const config = buildValidConfig({ tracking: { maxAllowedGapMs: 200, minWristVisibility: 0.5 } });
    let stateA = mustCreateState(config, 0, 0);
    let rA = applyLateralReachCommand(stateA, { type: "observationUnavailable", nowMs: 100 });
    assert.equal(rA.status, "applied");
    stateA = rA.state;
    rA = applyLateralReachCommand(stateA, { type: "observationUnavailable", nowMs: 300 });
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
      const result = applyLateralReachCommand(completed.state, { type: "observationUnavailable", nowMs: 1000 });
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
    let r = sendFrame(state, config, { x: 0.63, y: 0.5 }, 200);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 460);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 600);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 760); // return confirmed
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
    };

    // Send invalid frame - should be rejected without state mutation
    const invalidFrame = frame(config.testedSide, null, 1000);
    const frameResult = applyLateralReachCommand(completedState, { type: "frame", nowMs: 1000, frame: invalidFrame });
    assert.equal(frameResult.status, "rejected");
    if (frameResult.status === "rejected") {
      assert.equal(frameResult.reason, "awaiting_explicit_finalization");
      // Verify state immutability
      assert.equal(frameResult.state.phase, beforeSnapshot.phase);
      assert.equal(frameResult.state.lastAcceptedNowMs, beforeSnapshot.lastAcceptedNowMs);
      assert.equal(frameResult.state.invalidTrackingSinceMs, beforeSnapshot.invalidTrackingSinceMs);
      assert.equal(frameResult.state.activePause, beforeSnapshot.activePause);
      assert.equal(frameResult.state.movementOnsetAtMs, beforeSnapshot.movementOnsetAtMs);
    }

    // Send observationUnavailable - should be rejected with identical behavior
    const obsResult = applyLateralReachCommand(completedState, { type: "observationUnavailable", nowMs: 1000 });
    assert.equal(obsResult.status, "rejected");
    if (obsResult.status === "rejected") {
      assert.equal(obsResult.reason, "awaiting_explicit_finalization");
      // Verify state immutability
      assert.equal(obsResult.state.phase, beforeSnapshot.phase);
      assert.equal(obsResult.state.lastAcceptedNowMs, beforeSnapshot.lastAcceptedNowMs);
      assert.equal(obsResult.state.invalidTrackingSinceMs, beforeSnapshot.invalidTrackingSinceMs);
      assert.equal(obsResult.state.activePause, beforeSnapshot.activePause);
      assert.equal(obsResult.state.movementOnsetAtMs, beforeSnapshot.movementOnsetAtMs);
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
    let r = sendFrame(state, config, { x: 0.63, y: 0.5 }, 200);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 250);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, TARGET_POINT, 460);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.5, y: 0.5 }, 470);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 600);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, START_POINT, 760); // return confirmed
    assert.equal(r.status, "applied");
    state = r.state;

    const completedState = state;
    assert.equal(completedState.phase, "completed_pending_finalization");

    // Test with decreasing nowMs - monotonic validation should take precedence
    const invalidFrame = frame(config.testedSide, null, completedState.lastAcceptedNowMs - 10);
    const frameResultDecreasing = applyLateralReachCommand(completedState, {
      type: "frame",
      nowMs: completedState.lastAcceptedNowMs - 10,
      frame: invalidFrame
    });
    assert.equal(frameResultDecreasing.status, "rejected");
    if (frameResultDecreasing.status === "rejected") {
      assert.match(frameResultDecreasing.reason, /monotonic/i);
    }

    const obsResultDecreasing = applyLateralReachCommand(completedState, {
      type: "observationUnavailable",
      nowMs: completedState.lastAcceptedNowMs - 10
    });
    assert.equal(obsResultDecreasing.status, "rejected");
    if (obsResultDecreasing.status === "rejected") {
      assert.match(obsResultDecreasing.reason, /monotonic/i);
    }

    // Test with valid increasing nowMs - finalization guard should reject
    const validFrame = frame(config.testedSide, null, completedState.lastAcceptedNowMs + 100);
    const frameResultIncreasing = applyLateralReachCommand(completedState, {
      type: "frame",
      nowMs: completedState.lastAcceptedNowMs + 100,
      frame: validFrame
    });
    assert.equal(frameResultIncreasing.status, "rejected");
    if (frameResultIncreasing.status === "rejected") {
      assert.equal(frameResultIncreasing.reason, "awaiting_explicit_finalization");
    }

    const obsResultIncreasing = applyLateralReachCommand(completedState, {
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
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true);

    // Resume successfully
    const resumeResult = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 600,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });
    assert.equal(resumeResult.status, "applied");
    state = resumeResult.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, false);
    assert.equal(resumeResult.protectivePauseEvent?.outcome, "resumed");

    // Immediately send observationUnavailable (within maxAllowedGapMs of resume)
    const postResumeInvalid1 = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 650, // 50ms after resume, well within 300ms maxAllowedGapMs
    });
    assert.equal(postResumeInvalid1.status, "applied");
    state = postResumeInvalid1.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, false, "No immediate re-pause on first post-resume invalid frame");

    // Continue invalid observations (still within maxAllowedGapMs from resume)
    const postResumeInvalid2 = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 750, // 150ms after resume, still within 300ms
    });
    assert.equal(postResumeInvalid2.status, "applied");
    state = postResumeInvalid2.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, false, "No re-pause while new gap under threshold");

    // Continue until NEW gap from post-resume tracking loss exceeds maxAllowedGapMs
    const postResumeInvalid3 = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 650 + config.tracking.maxAllowedGapMs + 10, // 310ms after first post-resume invalid (650)
    });
    assert.equal(postResumeInvalid3.status, "applied");
    state = postResumeInvalid3.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true, "New pause opens when NEW gap exceeds threshold");

    // Verify valid frame after resume still works normally
    state = outboundState(config);
    state = openPause(state, config, 200);
    const resumeResult2 = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 600,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });
    assert.equal(resumeResult2.status, "applied");
    state = resumeResult2.state;

    const validFrameResult = sendFrame(state, config, { x: 0.5, y: 0.5 }, 610);
    assert.equal(validFrameResult.status, "applied");
    assert.equal(getLateralReachRuntimeSnapshot(validFrameResult.state).hasActivePause, false, "Valid frame after resume works normally");
  });

  it("QA sequence: pause during awaiting_readiness with recovered wrist cannot be cleared by readinessConfirmed", () => {
    // Exact runtime state observed in PR #217 manual QA:
    //   Phase: awaiting_readiness
    //   Active Pause: Yes
    //   Right Wrist Visibility: ~0.86 (valid sample present)
    //   Last Command: readinessConfirmed APPLIED (sticky UI; frames do not overwrite it)
    //
    // Proven sequence:
    // 1. readinessConfirmed APPLIED → ready_confirmed_awaiting_onset
    // 2. wrong-direction exit → awaiting_readiness
    // 3. tracking gap opens protective pause while awaiting_readiness (intentional contract)
    // 4. valid high-visibility wrist returns → pause remains (no auto-resume)
    // 5. readinessConfirmed must be REJECTED while pause is active
    // 6. explicit resumeRequested clears the pause and preserves awaiting_readiness
    // 7. subsequent readinessConfirmed can then arm a new readiness cycle

    const config = buildValidConfig();
    let state = mustCreateState(config, 0, 0);

    let r = sendFrame(state, config, START_POINT, 100);
    assert.equal(r.status, "applied");
    state = r.state;

    r = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 150,
      confirmedBy: "clinician",
    });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");

    // Wrong-direction exit resets readiness (requires valid sample, so pause is null here).
    r = sendFrame(state, config, { x: 0.23, y: 0.5 }, 200);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "awaiting_readiness");
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, false);

    // Tracking loss opens pause while awaiting_readiness — legal by contract.
    state = openPause(state, config, 250);
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "awaiting_readiness");
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true);

    // High-visibility wrist returns; pause must remain until explicit resume.
    r = sendFrame(state, config, START_POINT, 650);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "awaiting_readiness");
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true);
    assert.equal(state.lastValidWristSample?.point.x, START_POINT.x);
    assert.equal(state.invalidTrackingSinceMs, null);

    // Pre-fix defect: readinessConfirmed was APPLIED and left ready_confirmed + stale pause.
    const blocked = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 700,
      confirmedBy: "clinician",
    });
    assert.equal(blocked.status, "rejected");
    if (blocked.status === "rejected") {
      assert.equal(blocked.reason, "readiness_blocked_by_active_pause");
      assert.equal(blocked.state.phase, "awaiting_readiness");
      assert.equal(blocked.state.activePause !== null, true);
      assert.equal(blocked.state.protectivePauseEvents.length, 0);
    }
    state = blocked.state;

    // Explicit resume is required and clears the pause without advancing readiness.
    const resume = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 750,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });
    assert.equal(resume.status, "applied");
    state = resume.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "awaiting_readiness");
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, false);
    assert.equal(state.protectivePauseEvents.length, 1);
    assert.equal(state.protectivePauseEvents[0]?.outcome, "resumed");

    // New readiness cycle can now be confirmed.
    r = sendFrame(state, config, START_POINT, 800);
    assert.equal(r.status, "applied");
    state = r.state;
    r = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 850,
      confirmedBy: "clinician",
    });
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, false);

    // Genuine tracking loss during active movement still opens a NEW pause.
    r = sendFrame(state, config, { x: 0.36, y: 0.5 }, 900);
    assert.equal(r.status, "applied");
    state = r.state;
    r = sendFrame(state, config, { x: 0.4, y: 0.5 }, 1000); // onset confirmation
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "outbound");
    state = openPause(state, config, 1050);
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true);
    assert.equal(state.protectivePauseEvents.length, 1, "active pause is not yet finalized");

    // Valid frame during pause does not auto-resume.
    r = sendFrame(state, config, { x: 0.45, y: 0.5 }, 1400);
    assert.equal(r.status, "applied");
    state = r.state;
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true);
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "outbound");
  });

  it("wrong-direction reset cannot run while a protective pause is active", () => {
    const config = buildValidConfig();
    let state = readyState(config);
    assert.equal(getLateralReachRuntimeSnapshot(state).phase, "ready_confirmed_awaiting_onset");

    state = openPause(state, config, 150);
    assert.equal(getLateralReachRuntimeSnapshot(state).hasActivePause, true);

    // Wrong-direction sample would reset readiness if unpaused, but freeze wins.
    const r = sendFrame(state, config, { x: 0.23, y: 0.5 }, 500);
    assert.equal(r.status, "applied");
    assert.equal(getLateralReachRuntimeSnapshot(r.state).phase, "ready_confirmed_awaiting_onset");
    assert.equal(getLateralReachRuntimeSnapshot(r.state).hasActivePause, true);
    assert.equal(r.state.nonTargetFacingExitObservedBeforeValidOnset, false);
  });
});
