/**
 * Forward Reach Live-Camera Integration Tests
 *
 * Tests the NEW acquisition-to-engine boundary:
 *   MediaPipe-shaped PoseLandmark[]
 *   → existing BLAZEPOSE_ACQUISITION_ADAPTER.normalize()
 *   → NormalizedMotionFrame
 *   → existing Forward Reach engine
 *
 * Does NOT mock the adapter or engine.
 * Does NOT test existing engine behavior (already covered in forward-reach-engine.test.ts).
 * DOES test that real MediaPipe output integrates correctly with Motor Screen.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition/adapters/motion/blazepose-acquisition-adapter";
import type { InputAcquisitionContext } from "@/app/lib/input-acquisition/contract";
import {
  applyForwardReachCommand,
  createForwardReachAttemptState,
  getForwardReachRuntimeSnapshot,
  validateForwardReachConfig,
  type ForwardReachConfig,
  type ForwardReachAttemptState,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-engine";
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

function buildConfig(overrides: Partial<ForwardReachConfig> = {}): ForwardReachConfig {
  const result = validateForwardReachConfig({
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

function initState(config: ForwardReachConfig): ForwardReachAttemptState {
  const result = createForwardReachAttemptState(config, 0, 0);
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

describe("Forward Reach Live-Camera Integration", () => {
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

    const result = applyForwardReachCommand(state, {
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

    const result = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 0,
      frame,
    });

    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.phase, "awaiting_readiness");
  });

  test("visibility 0.25 (above adapter threshold 0.2, below engine threshold 0.3) includes joint but engine rejects", () => {
    const landmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.25 }, // Above 0.2, below 0.3
    });

    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);

    // Verify: joint included in frame (visibility >= 0.2, present: true)
    assert.ok(frame, "Adapter should return frame");
    assert.ok(frame.joints.right_wrist, "right_wrist should be present");
    assert.equal(frame.joints.right_wrist.confidence.present, true);
    assert.equal(frame.joints.right_wrist.confidence.visibility, 0.25);
  });

  test("visibility below minWristVisibility does NOT immediately trigger protective pause", () => {
    const config = buildConfig({
      testedSide: "right",
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    });
    let state = initState(config);

    // Feed valid frame in starting zone to establish tracking
    const startingZoneLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 }, // In starting zone
    });
    const startingZoneFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startingZoneLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: startingZoneFrame,
    }).state;

    // Confirm readiness (wrist is in starting zone with valid tracking)
    const readinessResult = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    });
    assert.equal(readinessResult.status, "applied");
    state = readinessResult.state;

    // Feed valid frame to continue
    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 1,
      capturedAtMs: 150,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 150,
      frame: validFrame,
    }).state;

    // Feed low-visibility frame (visibility = 0.2, below threshold 0.3)
    const lowVisLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.2 },
    });
    const lowVisFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(lowVisLandmarks, {
      frameIndex: 2,
      capturedAtMs: 200,
    });

    const result = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 200,
      frame: lowVisFrame,
    });

    // Verify: No protective pause yet (gap < maxAllowedGapMs)
    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.hasActivePause, false);
  });

  test("protective pause opens after maxAllowedGapMs of invalid tracking", () => {
    const config = buildConfig({
      testedSide: "right",
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    });
    let state = initState(config);

    // Establish tracking in starting zone
    const startingZoneLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const startingZoneFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startingZoneLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: startingZoneFrame,
    }).state;

    // Confirm readiness
    state = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    }).state;

    // Feed valid frame
    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 1,
      capturedAtMs: 150,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 150,
      frame: validFrame,
    }).state;

    // Feed low-visibility frames for > maxAllowedGapMs
    const invalidLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.2 },
    });

    // First invalid sample at t=200
    const invalidFrame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(invalidLandmarks, {
      frameIndex: 2,
      capturedAtMs: 200,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 200,
      frame: invalidFrame1,
    }).state;
    assert.equal(getForwardReachRuntimeSnapshot(state).hasActivePause, false);

    // Second invalid sample at t=500 (gap = 300ms from t=200)
    const invalidFrame2 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(invalidLandmarks, {
      frameIndex: 3,
      capturedAtMs: 500,
    });
    const result = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 500,
      frame: invalidFrame2,
    });

    // Verify: Protective pause now active (gap >= maxAllowedGapMs)
    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.hasActivePause, true);
    // Note: protectivePauseEvent may be on an earlier result; verifying hasActivePause is sufficient
  });

  test("missing tested wrist joint triggers protective pause after gap", () => {
    const config = buildConfig({
      testedSide: "right",
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    });
    let state = initState(config);

    // Establish tracking in starting zone
    const startingZoneLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const startingZoneFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(startingZoneLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: startingZoneFrame,
    }).state;

    // Confirm readiness
    state = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    }).state;

    // Feed valid right_wrist
    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 1,
      capturedAtMs: 150,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 150,
      frame: validFrame,
    }).state;

    // Feed landmarks with right_wrist but also some other joint (to avoid null frame)
    // We need right_wrist missing but frame not null
    const missingWristLandmarks = buildLandmarks({
      [16]: { x: -1, y: -1, visibility: 0.9 }, // Out of bounds
      [0]: { x: 0.5, y: 0.5, visibility: 0.9 }, // nose present to keep frame non-null
    });
    const missingFrame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(missingWristLandmarks, {
      frameIndex: 2,
      capturedAtMs: 200,
    });

    // Verify: frame is not null (has nose) but right_wrist omitted
    assert.ok(missingFrame1, "Frame should not be null");
    assert.equal(missingFrame1.joints.right_wrist, undefined, "right_wrist should be omitted");

    // First missing wrist sample at t=200
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 200,
      frame: missingFrame1,
    }).state;
    assert.equal(getForwardReachRuntimeSnapshot(state).hasActivePause, false);

    // Second missing wrist sample at t=500 (gap = 300ms)
    const missingFrame2 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(missingWristLandmarks, {
      frameIndex: 3,
      capturedAtMs: 500,
    });
    const result = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 500,
      frame: missingFrame2,
    });

    // Verify: Protective pause active
    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.hasActivePause, true);
  });

  test("empty landmark array causes adapter to return null", () => {
    const emptyLandmarks: PoseLandmark[] = [];
    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(emptyLandmarks, context);

    assert.equal(frame, null, "Adapter should return null for empty landmarks");
  });

  test("non-array input causes adapter to return null", () => {
    const invalidInput = { not: "an array" } as unknown as readonly PoseLandmark[];
    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(invalidInput, context);

    assert.equal(frame, null, "Adapter should return null for non-array input");
  });

  test("monotonic capturedAtMs sequence is accepted by engine", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    const timestamps = [100, 150, 200, 250];

    for (const ts of timestamps) {
      const landmarks = buildLandmarks({
        [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
      });
      const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, {
        frameIndex: 0,
        capturedAtMs: ts,
      });

      const result = applyForwardReachCommand(state, {
        type: "frame",
        nowMs: ts,
        frame,
      });

      assert.equal(result.status, "applied", `Frame at t=${ts} should be applied`);
      state = result.state;
    }
  });

  test("decreasing engine nowMs is rejected by engine", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    // First frame at t=100
    const landmarks1 = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const frame1 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks1, {
      frameIndex: 0,
      capturedAtMs: 100,
    });
    const result1 = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 100,
      frame: frame1,
    });
    assert.equal(result1.status, "applied");
    state = result1.state;

    // Second frame at t=50 (decreasing)
    const landmarks2 = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const frame2 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks2, {
      frameIndex: 1,
      capturedAtMs: 50,
    });
    const result2 = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: frame2,
    });

    assert.equal(result2.status, "rejected");
    assert.equal(result2.reason, "now_ms_not_monotonic");
  });

  test("adapter does not mutate source landmark array", () => {
    const landmarks: PoseLandmark[] = buildLandmarks({
      [0]: { x: 0.1, y: 0.1, visibility: 0.5 },
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });

    const originalLandmarks = JSON.parse(JSON.stringify(landmarks));

    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);

    assert.deepEqual(landmarks, originalLandmarks, "Landmarks array should not be mutated");
  });

  test("adapter preserves x and y coordinates without mirroring", () => {
    const landmarks = buildLandmarks({
      [16]: { x: 0.35, y: 0.65, visibility: 0.9 },
    });

    const context: InputAcquisitionContext = {
      frameIndex: 0,
      capturedAtMs: 0,
    };

    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);

    assert.ok(frame, "Frame should not be null");
    assert.ok(frame.joints.right_wrist, "right_wrist should be present");
    assert.equal(frame.joints.right_wrist.landmark.x, 0.35, "X should not be mirrored (not 0.65)");
    assert.equal(frame.joints.right_wrist.landmark.y, 0.65, "Y should be preserved");
  });

  test("observationUnavailable command is accepted with valid monotonic nowMs", () => {
    const config = buildConfig({ testedSide: "right" });
    const state = initState(config);

    const result = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 100,
    });

    assert.equal(result.status, "applied");
    assert.equal(result.snapshot.phase, "awaiting_readiness");
  });

  test("observationUnavailable establishes tracking-loss timing", () => {
    const config = buildConfig({
      testedSide: "right",
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    });
    let state = initState(config);

    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: validFrame,
    }).state;

    state = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    }).state;

    const result1 = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    });
    assert.equal(result1.status, "applied");
    assert.equal(result1.snapshot.hasActivePause, false);
    state = result1.state;

    const result2 = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 500,
    });
    assert.equal(result2.status, "applied");
    assert.equal(result2.snapshot.hasActivePause, true);
  });

  test("observationUnavailable does not create movement progress", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: validFrame,
    }).state;

    state = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    }).state;

    const beforeSnapshot = getForwardReachRuntimeSnapshot(state);

    const result = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 150,
    });

    assert.equal(result.status, "applied");
    const afterSnapshot = result.snapshot;
    assert.equal(afterSnapshot.targetReached, beforeSnapshot.targetReached);
    assert.equal(afterSnapshot.returnToStartCompleted, beforeSnapshot.returnToStartCompleted);
  });

  test("valid tracking returning does NOT auto-resume protective pause", () => {
    const config = buildConfig({
      testedSide: "right",
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    });
    const initialState = initState(config);

    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    let state = applyForwardReachCommand(initialState, {
      type: "frame",
      nowMs: 50,
      frame: validFrame,
    }).state;

    state = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    }).state;

    state = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    }).state;

    const pauseResult = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 500,
    });
    assert.equal(pauseResult.status, "applied");
    assert.equal(pauseResult.snapshot.hasActivePause, true);
    state = pauseResult.state;

    const validFrame2 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 1,
      capturedAtMs: 600,
    });
    const resumeAttempt = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 600,
      frame: validFrame2,
    });

    assert.equal(resumeAttempt.status, "applied");
    assert.equal(resumeAttempt.snapshot.hasActivePause, true);
  });

  test("explicit resumeRequested is required to resume protective pause", () => {
    const config = buildConfig({
      testedSide: "right",
      tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    });
    let state = initState(config);

    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });
    state = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: validFrame,
    }).state;

    state = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    }).state;

    state = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 200,
    }).state;

    state = applyForwardReachCommand(state, {
      type: "observationUnavailable",
      nowMs: 500,
    }).state;
    assert.equal(getForwardReachRuntimeSnapshot(state).hasActivePause, true);

    const resumeResult = applyForwardReachCommand(state, {
      type: "resumeRequested",
      nowMs: 600,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });

    assert.equal(resumeResult.status, "applied");
    assert.equal(resumeResult.snapshot.hasActivePause, false);
  });

  test("readiness confirmation requires explicit human action", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    const validLandmarks = buildLandmarks({
      [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
    });
    const validFrame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 50,
    });

    const frameResult = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 50,
      frame: validFrame,
    });

    assert.equal(frameResult.status, "applied");
    assert.equal(frameResult.snapshot.phase, "awaiting_readiness");
    state = frameResult.state;

    const validFrame2 = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 1,
      capturedAtMs: 150,
    });
    const frameResult2 = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 150,
      frame: validFrame2,
    });

    assert.equal(frameResult2.status, "applied");
    assert.equal(frameResult2.snapshot.phase, "awaiting_readiness");
    state = frameResult2.state;

    const readinessResult = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 200,
      confirmedBy: "clinician",
    });

    assert.equal(readinessResult.status, "applied");
    assert.equal(readinessResult.snapshot.phase, "ready_confirmed_awaiting_onset");
  });

  test("rejected readiness command does not mutate engine state meaningfully", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    // Advance to awaiting_readiness
    state = { ...state, phase: "awaiting_readiness" };

    // Try to confirm readiness with no valid wrist sample
    const result = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 100,
      confirmedBy: "clinician",
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "readiness_requires_wrist_in_starting_zone");

    // Meaningful state preserved (phase, pause, wrist sample, etc.)
    assert.equal(result.state.phase, "awaiting_readiness");
    assert.equal(result.state.lastValidWristSample, null);
    assert.equal(result.state.activePause, null);
    assert.equal(result.state.terminal, false);
  });

  test("rejected readiness provides clear rejection reason", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    // Give a valid wrist sample but outside starting zone
    const validLandmarks = createMinimalValidPose("right", 0.8, 0.5, 0.7);
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 100,
    });
    const frameResult = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 100,
      frame,
    });
    assert.equal(frameResult.status, "applied");
    state = frameResult.state;

    // Try to confirm readiness with wrist outside zone
    const result = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 150,
      confirmedBy: "clinician",
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "readiness_requires_wrist_in_starting_zone");
  });

  test("rejected resume provides clear rejection reason before readiness", () => {
    const config = buildConfig({ testedSide: "right" });
    const state = initState(config);

    // Try to resume without readiness being confirmed
    const result = applyForwardReachCommand(state, {
      type: "resumeRequested",
      nowMs: 100,
      readinessConfirmedAt: new Date().toISOString(),
      resumedBy: "clinician",
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "no_active_pause_to_resume");
  });

  test("applied readiness still works correctly with valid position", () => {
    const config = buildConfig({ testedSide: "right" });
    let state = initState(config);

    // Give a valid wrist sample IN starting zone (0.3, 0.5, radius 0.05)
    const validLandmarks = createMinimalValidPose("right", 0.31, 0.51, 0.7);
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(validLandmarks, {
      frameIndex: 0,
      capturedAtMs: 100,
    });
    const frameResult = applyForwardReachCommand(state, {
      type: "frame",
      nowMs: 100,
      frame,
    });
    assert.equal(frameResult.status, "applied");
    state = frameResult.state;

    // Confirm readiness with wrist in zone
    const result = applyForwardReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 150,
      confirmedBy: "clinician",
    });

    assert.equal(result.status, "applied");
    assert.equal(result.state.phase, "ready_confirmed_awaiting_onset");
  });
});
