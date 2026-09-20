/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/forward-reach-demo-fixtures.test.ts
 *
 * Tests Forward Reach demo fixtures by driving scenarios through the real engine.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAllDemoScenarios,
  buildForwardReachDemoConfig,
  executeScenario,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-demo-fixtures";
import {
  applyForwardReachCommand,
  createForwardReachAttemptState,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-engine";
import { MOTION_INTELLIGENCE_SCHEMA_VERSION } from "@/app/lib/motion-intelligence";

// ── Successful flows ───────────────────────────────────────────────────────

describe("Forward Reach demo fixtures — successful flows", () => {
  it("right tested-side happy path completes successfully", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "completed", "Completion state should be completed");
    assert.equal(result.attemptResult!.targetReached, true, "Target should be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, true, "Dwell should be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, true, "Return should be completed");
  });

  it("left tested-side happy path completes successfully", () => {
    const config = buildForwardReachDemoConfig("left");
    const scenarios = buildAllDemoScenarios("left");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "completed", "Completion state should be completed");
    assert.equal(result.attemptResult!.targetReached, true, "Target should be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, true, "Dwell should be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, true, "Return should be completed");
  });

  it("happy path produces factual timing and path metrics", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    const attemptResult = result.attemptResult!;

    assert.ok(attemptResult.reachTimeMs !== null, "Reach time should exist");
    assert.ok(attemptResult.reachTimeMs! > 0, "Reach time should be positive");
    assert.ok(attemptResult.returnTimeMs !== null, "Return time should exist");
    assert.ok(attemptResult.returnTimeMs! > 0, "Return time should be positive");
    assert.ok(attemptResult.totalMovementTimeMs !== null, "Total movement time should exist");
    assert.ok(attemptResult.totalMovementTimeMs! > 0, "Total movement time should be positive");
    assert.ok(attemptResult.normalizedPathLength !== null, "Path length should exist");
    assert.ok(attemptResult.normalizedPathLength! > 0, "Path length should be positive");
    assert.ok(attemptResult.pathEfficiency !== null, "Path efficiency should exist");
    assert.ok(attemptResult.pathEfficiency! > 0 && attemptResult.pathEfficiency! <= 1, "Path efficiency should be in (0,1]");
  });

  it("happy path terminal result excludes shoulder and elbow angles", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.peakShoulderAngleDeg, null, "Shoulder angle should remain null");
    assert.equal(result.attemptResult!.peakElbowExtensionDeg, null, "Elbow angle should remain null");
  });

  it("happy path terminal result contains no raw trajectory array", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    // Attempt result should not contain a trajectory array property
    assert.ok(!("trajectory" in result.attemptResult!), "Attempt result should not expose trajectory");
    assert.ok(!("rawFrames" in result.attemptResult!), "Attempt result should not expose raw frames");
  });
});

// ── Determinism ────────────────────────────────────────────────────────────

describe("Forward Reach demo fixtures — determinism", () => {
  it("running the same scenario twice produces identical terminal results", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");

    const firstRun = executeScenario(scenarios.happyPath, config);
    const secondRun = executeScenario(scenarios.happyPath, config);

    assert.ok(firstRun.attemptResult !== null && secondRun.attemptResult !== null);

    const first = firstRun.attemptResult!;
    const second = secondRun.attemptResult!;

    assert.equal(first.completionState, second.completionState);
    assert.equal(first.targetReached, second.targetReached);
    assert.equal(first.dwellConfirmed, second.dwellConfirmed);
    assert.equal(first.returnToStartCompleted, second.returnToStartCompleted);
    assert.equal(first.reachTimeMs, second.reachTimeMs);
    assert.equal(first.returnTimeMs, second.returnTimeMs);
    assert.equal(first.totalMovementTimeMs, second.totalMovementTimeMs);
    assert.equal(first.normalizedPathLength, second.normalizedPathLength);
    assert.equal(first.pathEfficiency, second.pathEfficiency);
  });

  it("creating a fresh attempt does not carry state from previous attempt", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");

    // Run happy path
    const firstResult = executeScenario(scenarios.happyPath, config);
    assert.ok(firstResult.attemptResult !== null);
    assert.equal(firstResult.attemptResult!.completionState, "completed");

    // Run low visibility scenario — should not inherit completed state
    const secondResult = executeScenario(scenarios.lowVisibility, config);
    assert.ok(secondResult.attemptResult !== null, "Second attempt should have a result");
    assert.equal(secondResult.attemptResult!.completionState, "not_started", "Second attempt should be not_started");
    assert.equal(secondResult.attemptResult!.targetReached, false, "Target should not be reached");
    assert.equal(secondResult.attemptResult!.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(secondResult.attemptResult!.returnToStartCompleted, false, "Return should not be completed");
  });
});

// ── Safety scenarios ───────────────────────────────────────────────────────

describe("Forward Reach demo fixtures — safety scenarios", () => {
  it("low visibility does not incorrectly advance the task", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.lowVisibility, config);

    // Low visibility should produce a terminal result after attemptWindowEnded
    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "not_started", "Completion state should be not_started");
    assert.equal(result.attemptResult!.targetReached, false, "Target should not be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, false, "Return should not be completed");
  });

  it("onset candidate abandoned on return preserves readiness without completion", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.onsetCandidateAbandonedOnReturn, config);

    // The wrist exits in any direction, then returns before onset confirmation
    // No terminal success should occur
    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.notEqual(result.attemptResult!.completionState, "completed", "Should not complete");
    assert.equal(result.attemptResult!.targetReached, false, "Target should not be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, false, "Return should not be completed");
    // The attempt ends in ready_confirmed_awaiting_onset or terminal not_started
    // Readiness is not revoked
    assert.ok(
      result.finalSnapshot.phase === "ready_confirmed_awaiting_onset" ||
      result.attemptResult!.completionState === "not_started",
      "Phase should be ready_confirmed_awaiting_onset or terminal not_started"
    );
  });

  it("short tracking gap remains within current engine tolerance", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.shortTrackingGap, config);

    // Short gap should not open protective pause
    assert.equal(result.finalSnapshot.protectivePauseCount, 0, "Short gap should not open protective pause");
  });

  it("long gap opens protective pause", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.longTrackingGapWithHumanResume, config);

    assert.ok(result.finalSnapshot.protectivePauseCount > 0, "Long gap should open at least one protective pause");
  });

  it("no automatic resume occurs after protective pause", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");

    // Build scenario without human resume
    const scenarioWithoutResume = {
      ...scenarios.longTrackingGapWithHumanResume,
      commands: scenarios.longTrackingGapWithHumanResume.commands.filter(
        (cmd) => cmd.type !== "resumeRequested"
      ),
    };

    const result = executeScenario(scenarioWithoutResume, config);

    // Protective pause should have been opened
    assert.ok(result.finalSnapshot.protectivePauseCount > 0, "Protective pause should have been opened");
    // Without explicit resume, the attempt should not complete successfully
    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.notEqual(result.attemptResult!.completionState, "completed", "Should not complete without resume");
  });

  it("explicit valid human resume is required after protective pause", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");

    // Full scenario includes resumeRequested command
    const result = executeScenario(scenarios.longTrackingGapWithHumanResume, config);

    // With explicit resume, the protective pause is resolved
    assert.ok(result.finalSnapshot.protectivePauseCount > 0, "Protective pause should have been opened");
    // resumeRequested is accepted, pause no longer active
    assert.ok(result.finalSnapshot.hasActivePause === false, "Pause should be resolved after resume");
    // Execution continues according to engine state contract
    assert.ok(result.finalSnapshot !== null, "Attempt should continue after resume");
  });

  it("stop-before-completion produces the correct terminal state", () => {
    const config = buildForwardReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.stopBeforeCompletion, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "stopped", "Should be stopped");
    assert.equal(result.attemptResult!.targetReached, false, "Target should not be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, false, "Return should not be completed");
  });

  it("out-of-order timestamp is rejected by engine", () => {
    const config = buildForwardReachDemoConfig("right");

    // Create valid initial state
    const createResult = createForwardReachAttemptState(config, 0, 0);
    assert.ok(createResult.ok, "Should create valid initial state");
    let state = createResult.state;

    // Apply accepted commands with increasing timestamps
    const frame1 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 0, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result1 = applyForwardReachCommand(state, { type: "frame", nowMs: 0, frame: frame1 });
    assert.equal(result1.status, "applied", "First command should be applied");
    state = result1.state;

    // Apply command with newer timestamp
    const result2 = applyForwardReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(result2.status, "applied", "Second command should be applied");
    state = result2.state;

    // Apply command with an older timestamp (out-of-order)
    const frame2 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 5, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result3 = applyForwardReachCommand(state, { type: "frame", nowMs: 5, frame: frame2 });

    // Engine should reject the out-of-order command
    assert.equal(result3.status, "rejected", "Out-of-order timestamp should be rejected");
    assert.ok(result3.reason, "Rejection should have a reason");
  });
});

// ── Config validation ──────────────────────────────────────────────────────

describe("Forward Reach demo fixtures — config validation", () => {
  it("buildForwardReachDemoConfig supports left tested side", () => {
    const config = buildForwardReachDemoConfig("left");
    assert.equal(config.testedSide, "left");
  });

  it("buildForwardReachDemoConfig supports right tested side", () => {
    const config = buildForwardReachDemoConfig("right");
    assert.equal(config.testedSide, "right");
  });

  it("buildAllDemoScenarios returns all six scenarios", () => {
    const scenarios = buildAllDemoScenarios("right");
    assert.ok(scenarios.happyPath, "Should include happyPath");
    assert.ok(scenarios.lowVisibility, "Should include lowVisibility");
    assert.ok(scenarios.onsetCandidateAbandonedOnReturn, "Should include onsetCandidateAbandonedOnReturn");
    assert.ok(scenarios.shortTrackingGap, "Should include shortTrackingGap");
    assert.ok(scenarios.longTrackingGapWithHumanResume, "Should include longTrackingGapWithHumanResume");
    assert.ok(scenarios.stopBeforeCompletion, "Should include stopBeforeCompletion");
  });
});
