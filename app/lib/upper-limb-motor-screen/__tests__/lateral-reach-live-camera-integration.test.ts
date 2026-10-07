/**
 * Lateral Reach Live-Camera Integration Tests
 *
 * Tests the NEW acquisition-to-engine boundary:
 *   MediaPipe-shaped PoseLandmark[]
 *   → existing BLAZEPOSE_ACQUISITION_ADAPTER.normalize()
 *   → NormalizedMotionFrame
 *   → existing Lateral Reach engine
 *
 * Does NOT mock the adapter or engine.
 * Does NOT test existing engine behavior (already covered in lateral-reach-engine.test.ts).
 * DOES test that real MediaPipe output integrates correctly with Motor Screen.
 *
 * LATERAL-SPECIFIC BEHAVIORS:
 * - Strictly increasing frame timestamps
 * - Directional onset (target-facing vs wrong-direction)
 * - Config validation (ambiguous target direction)
 * - completed_pending_finalization rejection for frame and observationUnavailable
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition/adapters/motion/blazepose-acquisition-adapter";
import type { InputAcquisitionContext } from "@/app/lib/input-acquisition/contract";
import {
  applyLateralReachCommand,
  createLateralReachAttemptState,
  validateLateralReachConfig,
  type LateralReachConfig,
  type LateralReachAttemptState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";

// ── Fixture helpers ────────────────────────────────────────────────────────

/**
 * Build MediaPipe-shaped PoseLandmark array (33 landmarks).
 * Populate specified indices, leave rest as invalid placeholders.
 */
function buildLandmarks(
  joints: Record<number, { x: number; y: number; visibility: number }>,
): PoseLandmark[] {
  const landmarks: PoseLandmark[] = [];
  for (let i = 0; i < 33; i++) {
    const joint = joints[i];
    if (joint) {
      landmarks[i] = { x: joint.x, y: joint.y, visibility: joint.visibility };
    } else {
      // Invalid placeholder (out of bounds)
      landmarks[i] = { x: -1, y: -1, visibility: 0 };
    }
  }
  return landmarks;
}

function buildConfig(overrides: Partial<LateralReachConfig> = {}): LateralReachConfig {
  // Default: target x=0.7, start x=0.3 → expectedHorizontalDirectionSign = +1 (rightward)
  const result = validateLateralReachConfig({
    testedSide: "right",
    fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
    startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
    tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
    ...overrides,
  });

  if (!result.ok) {
    throw new Error(`Invalid config: ${result.reason}`);
  }

  return result.config;
}

function initState(config: LateralReachConfig, armedAtMs = 0): LateralReachAttemptState {
  const result = createLateralReachAttemptState(config, 0, armedAtMs);
  if (!result.ok) {
    throw new Error(`Failed to init state: ${result.reason}`);
  }
  return result.state;
}

/**
 * Create minimal valid pose with tested wrist at specified position
 */
function createMinimalValidPose(
  testedSide: "right" | "left",
  x: number,
  y: number,
  visibility: number,
): PoseLandmark[] {
  const wristIndex = testedSide === "right" ? 16 : 15;
  return buildLandmarks({
    [wristIndex]: { x, y, visibility },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Lateral Reach Live-Camera Integration", () => {
  test("right tested side consumes right_wrist from normalized frame", () => {
    const config = buildConfig({ testedSide: "right" });
    const state = initState(config);

    // Fixture: valid right_wrist (index 16), invalid left_wrist (index 15)
    const landmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 }, // right_wrist
      [15]: { x: -1, y: -1, visibility: 0.1 }, // left_wrist invalid
    });

    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame, "Adapter should return frame");
    assert.ok(frame.joints.right_wrist, "right_wrist should be present");
    assert.equal(frame.joints.left_wrist, undefined, "left_wrist should be omitted");

    const result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 0,
      frame,
    });

    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.phase, "awaiting_readiness"); // Engine advanced from idle
  });

  test("left tested side consumes left_wrist from normalized frame", () => {
    const config = buildConfig({ testedSide: "left" });
    const state = initState(config);

    // Fixture: valid left_wrist (index 15), invalid right_wrist (index 16)
    const landmarks = buildLandmarks({
      [15]: { x: 0.3, y: 0.5, visibility: 0.9 }, // left_wrist
      [16]: { x: -1, y: -1, visibility: 0.1 }, // right_wrist invalid
    });

    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame, "Adapter should return frame");
    assert.ok(frame.joints.left_wrist, "left_wrist should be present");
    assert.equal(frame.joints.right_wrist, undefined, "right_wrist should be omitted");

    const result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 0,
      frame,
    });

    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.phase, "awaiting_readiness"); // Engine advanced from idle
  });

  test("observationUnavailable accepted in valid state", () => {
    const config = buildConfig();
    let state = initState(config);

    // Advance to awaiting_readiness
    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 0 };
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame);

    const frameResult = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 0,
      frame,
    });
    assert.equal(frameResult.status, "applied");
    state = frameResult.state;

    // Send observationUnavailable
    const result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 100,
    });

    assert.equal(result.status, "applied");
  });

  test("tracking-gap behavior - protective pause opens after gap exceeds maxAllowedGapMs", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Drive to outbound phase
    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame1);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: frame1,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Confirm readiness
    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Move to target-facing exit (x=0.5 > startingZone.x + radius)
    const exitLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const exitContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 30 };
    const exitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(exitLandmarks, exitContext);
    assert.ok(exitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Confirm onset by continuing in target-facing direction
    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "outbound");

    // First observationUnavailable (no gap yet)
    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.hasActivePause, false);

    // Second observationUnavailable (gap now exceeds maxAllowedGapMs = 300)
    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200 + config.tracking.maxAllowedGapMs + 10,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.hasActivePause, true, "Protective pause should open");
  });

  test("unavailable observation creates no movement progress", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Advance to awaiting_readiness
    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Confirm readiness
    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "ready_confirmed_awaiting_onset");

    // Send observationUnavailable - should NOT advance to outbound
    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 30,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "ready_confirmed_awaiting_onset");
    assert.equal(result.snapshot.targetReached, false);
  });

  test("protective pause opens through actual engine behavior", () => {
    const config = buildConfig({ tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 } });
    let state = initState(config, 0);

    // Drive to outbound
    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame1);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: frame1,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;

    const exitLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const exitContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 30 };
    const exitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(exitLandmarks, exitContext);
    assert.ok(exitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "outbound");

    // Gap exceeds maxAllowedGapMs
    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200 + config.tracking.maxAllowedGapMs + 10,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.hasActivePause, true);
  });

  test("tracking recovery does not auto-resume", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Drive to outbound with pause
    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame1);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: frame1,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;

    const exitLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const exitContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 30 };
    const exitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(exitLandmarks, exitContext);
    assert.ok(exitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "outbound");

    // Open pause
    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200 + config.tracking.maxAllowedGapMs + 10,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.hasActivePause, true);

    // Tracking recovery - send valid frame
    const recoveryLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const recoveryContext: InputAcquisitionContext = { frameIndex: 2, capturedAtMs: 600 };
    const recoveryFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(recoveryLandmarks, recoveryContext);
    assert.ok(recoveryFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 600,
      frame: recoveryFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Pause should still be active (no auto-resume)
    assert.equal(result.snapshot.hasActivePause, true, "Pause should remain active after tracking recovery");
  });

  test("explicit valid resume works", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Drive to outbound with pause
    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame1);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: frame1,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;

    const exitLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const exitContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 30 };
    const exitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(exitLandmarks, exitContext);
    assert.ok(exitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "outbound");

    // Open pause
    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200 + config.tracking.maxAllowedGapMs + 10,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.hasActivePause, true);

    // Explicit resume
    result = applyLateralReachCommand(state, {
      type: "resumeRequested",
      nowMs: 600,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.hasActivePause, false, "Pause should be cleared after explicit resume");
  });

  test("readiness outside starting zone is rejected", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Advance to awaiting_readiness with wrist OUTSIDE starting zone
    const landmarks = createMinimalValidPose("right", 0.6, 0.5, 0.9); // Far from starting zone
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "awaiting_readiness");

    // Attempt readiness confirmation - should be rejected
    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "readiness_requires_wrist_in_starting_zone");
  });

  test("rejected readiness does not incorrectly advance state", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Advance to awaiting_readiness with wrist OUTSIDE starting zone
    const landmarks = createMinimalValidPose("right", 0.6, 0.5, 0.9);
    const context: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    assert.ok(frame);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    const phaseBefore = result.snapshot.phase;

    // Rejected readiness
    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "rejected");

    // Phase should not advance
    assert.equal(result.snapshot.phase, phaseBefore);
  });

  test("LATERAL-SPECIFIC: correct target-facing exit establishes onset", () => {
    const config = buildConfig(); // expectedHorizontalDirectionSign = +1 (rightward)
    let state = initState(config, 0);

    // Advance to ready_confirmed_awaiting_onset
    const startLandmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const startContext: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const startFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startLandmarks, startContext);
    assert.ok(startFrame);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "ready_confirmed_awaiting_onset");

    // Exit in target-facing direction (rightward, x=0.5 > startingZone.point.x + radius)
    const exitLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const exitContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 30 };
    const exitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(exitLandmarks, exitContext);
    assert.ok(exitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Continue in target-facing direction to confirm onset
    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Should advance to outbound
    assert.equal(result.snapshot.phase, "outbound", "Target-facing exit should establish onset");
  });

  test("LATERAL-SPECIFIC: wrong-direction exit does NOT establish valid onset and resets readiness", () => {
    const config = buildConfig(); // expectedHorizontalDirectionSign = +1 (rightward)
    let state = initState(config, 0);

    // Advance to ready_confirmed_awaiting_onset
    const startLandmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const startContext: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const startFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startLandmarks, startContext);
    assert.ok(startFrame);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "ready_confirmed_awaiting_onset");

    // Exit in WRONG direction (leftward, x=0.1 < startingZone.point.x - radius)
    const wrongExitLandmarks = createMinimalValidPose("right", 0.1, 0.5, 0.9);
    const wrongExitContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 30 };
    const wrongExitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(wrongExitLandmarks, wrongExitContext);
    assert.ok(wrongExitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: wrongExitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Should reset to awaiting_readiness (wrong-direction exit)
    assert.equal(result.snapshot.phase, "awaiting_readiness", "Wrong-direction exit should reset readiness");
  });

  test("LATERAL-SPECIFIC: ambiguous target direction is rejected by config validation", () => {
    // Config with same x-coordinate for target and starting zone
    const result = validateLateralReachConfig({
      testedSide: "right",
      fixedTarget: { point: { x: 0.5, y: 0.5 }, radius: 0.05 },
      startingZone: { point: { x: 0.5, y: 0.3 }, radius: 0.05 }, // Same x!
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
      timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "ambiguous_target_direction");
    }
  });

  test("LATERAL-SPECIFIC: completed_pending_finalization preserves rejection behavior for frame and observationUnavailable", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    // Drive to completed_pending_finalization
    const startLandmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const startContext: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const startFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startLandmarks, startContext);
    assert.ok(startFrame);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Move to target
    const targetLandmarks = createMinimalValidPose("right", 0.7, 0.5, 0.9);
    const targetContext: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 200 };
    const targetFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(targetLandmarks, targetContext);
    assert.ok(targetFrame);

    // Exit starting zone in target-facing direction
    const exitLandmarks = createMinimalValidPose("right", 0.5, 0.5, 0.9);
    const exitContext: InputAcquisitionContext = { frameIndex: 2, capturedAtMs: 30 };
    const exitFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(exitLandmarks, exitContext);
    assert.ok(exitFrame);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Reach target and dwell
    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 200,
      frame: targetFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 200 + config.timing.dwellDurationMs + 10,
      frame: targetFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Return to start
    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 500,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 500 + config.timing.returnConfirmationMs + 10,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    assert.equal(result.snapshot.phase, "completed_pending_finalization");

    // Attempt frame - should be rejected
    const laterFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startLandmarks, {
      frameIndex: 3,
      capturedAtMs: 700,
    });
    assert.ok(laterFrame);

    const frameResult = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 700,
      frame: laterFrame,
    });
    assert.equal(frameResult.status, "rejected");
    assert.equal(frameResult.reason, "awaiting_explicit_finalization");

    // Attempt observationUnavailable - should also be rejected
    const obsResult = applyLateralReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 800,
    });
    assert.equal(obsResult.status, "rejected");
    assert.equal(obsResult.reason, "awaiting_explicit_finalization");
  });

  test("LATERAL-SPECIFIC: integration fixture uses valid strictly increasing frame timestamps", () => {
    const config = buildConfig();
    let state = initState(config, 0);

    const landmarks = createMinimalValidPose("right", 0.3, 0.5, 0.9);
    const context1: InputAcquisitionContext = { frameIndex: 0, capturedAtMs: 10 };
    const frame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context1);
    assert.ok(frame1);

    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: frame1,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    // Second frame with strictly increasing timestamp
    const context2: InputAcquisitionContext = { frameIndex: 1, capturedAtMs: 20 };
    const frame2 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context2);
    assert.ok(frame2);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 20, // Strictly increasing
      frame: frame2,
    });
    assert.equal(result.status, "applied", "Strictly increasing timestamp should be accepted");
    state = result.state;

    // Attempt same timestamp - should be rejected by frame-specific strictly increasing check
    const context3: InputAcquisitionContext = { frameIndex: 2, capturedAtMs: 20 };
    const frame3 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context3);
    assert.ok(frame3);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 20, // Same as previous
      frame: frame3,
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "frame_timestamp_not_strictly_increasing");

    // Attempt decreasing timestamp - should be rejected by general monotonic check
    const context4: InputAcquisitionContext = { frameIndex: 3, capturedAtMs: 15 };
    const frame4 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context4);
    assert.ok(frame4);

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 15, // Less than previous
      frame: frame4,
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "now_ms_not_monotonic");
  });

  test("LATERAL-SPECIFIC: unified command clock normalization", async () => {
    // Import the actual production helper used by the detector
    const { normalizeCommandTimestampForTesting } = await import("@/app/lib/cv/lateral-reach-camera-detector");

    let lastCommandNowMs: number | null = null;
    let lastFrameNowMs: number | null = null;

    // SCENARIO A: frame raw 100 → sends 100, frame raw 100 → sends >100
    const frame1 = normalizeCommandTimestampForTesting(100, lastCommandNowMs, lastFrameNowMs, true);
    assert.equal(frame1, 100, "First frame uses raw timestamp");
    lastCommandNowMs = frame1;
    lastFrameNowMs = frame1;

    const frame2 = normalizeCommandTimestampForTesting(100, lastCommandNowMs, lastFrameNowMs, true);
    assert.ok(frame2 > frame1, "Equal raw timestamp normalized to strictly increasing");
    assert.equal(frame2, 101, "Second frame with same raw time becomes lastFrameNowMs + 1");
    lastCommandNowMs = frame2;
    lastFrameNowMs = frame2;

    // SCENARIO B: frame normalized forward → observationUnavailable must not move backward
    const frame3 = normalizeCommandTimestampForTesting(100, lastCommandNowMs, lastFrameNowMs, true);
    assert.equal(frame3, 102, "Third frame continues strictly increasing");
    lastCommandNowMs = frame3;
    lastFrameNowMs = frame3;

    const unavailable1 = normalizeCommandTimestampForTesting(100, lastCommandNowMs, lastFrameNowMs, false);
    assert.ok(unavailable1 >= lastCommandNowMs, "observationUnavailable respects general command clock");
    assert.equal(unavailable1, 103, "observationUnavailable with raw 100 normalized to lastCommandNowMs + 1");
    lastCommandNowMs = unavailable1;

    // SCENARIO C: frame normalized forward → readinessConfirmed in same cycle must not move backward
    const frame4 = normalizeCommandTimestampForTesting(105, lastCommandNowMs, lastFrameNowMs, true);
    assert.equal(frame4, 105, "Frame with higher raw timestamp uses raw");
    lastCommandNowMs = frame4;
    lastFrameNowMs = frame4;

    const readiness1 = normalizeCommandTimestampForTesting(105, lastCommandNowMs, lastFrameNowMs, false);
    assert.ok(readiness1 >= lastCommandNowMs, "readinessConfirmed respects general command clock");
    assert.equal(readiness1, 106, "readinessConfirmed in same cycle normalized forward");
    lastCommandNowMs = readiness1;

    // SCENARIO D: normalized command clock → later manual resume with raw time behind → must not move backward
    const resume1 = normalizeCommandTimestampForTesting(100, lastCommandNowMs, lastFrameNowMs, false);
    assert.ok(resume1 >= lastCommandNowMs, "Manual resume respects command clock even when raw behind");
    assert.equal(resume1, 107, "Manual resume with old raw timestamp normalized forward");
    lastCommandNowMs = resume1;

    // SCENARIO E: fresh session reset removes prior-session timestamp constraint
    lastCommandNowMs = null;
    lastFrameNowMs = null;

    const freshFrame = normalizeCommandTimestampForTesting(50, lastCommandNowMs, lastFrameNowMs, true);
    assert.equal(freshFrame, 50, "Fresh session can use lower raw timestamp");

    // Prove FRAME timestamps remain strictly increasing after fresh session
    lastCommandNowMs = freshFrame;
    lastFrameNowMs = freshFrame;

    const freshFrame2 = normalizeCommandTimestampForTesting(50, lastCommandNowMs, lastFrameNowMs, true);
    assert.ok(freshFrame2 > freshFrame, "Frame timestamps remain strictly increasing in fresh session");
    assert.equal(freshFrame2, 51, "Second frame in fresh session strictly increases");
  });
});
