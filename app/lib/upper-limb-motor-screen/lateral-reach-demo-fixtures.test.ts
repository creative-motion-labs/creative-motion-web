/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/lateral-reach-demo-fixtures.test.ts
 *
 * Tests Lateral Reach demo fixtures by driving scenarios through the real engine.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAllDemoScenarios,
  buildLateralReachDemoConfig,
  executeScenario,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-demo-fixtures";
import {
  applyLateralReachCommand,
  createLateralReachAttemptState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import { MOTION_INTELLIGENCE_SCHEMA_VERSION } from "@/app/lib/motion-intelligence";

// ── Successful flows ───────────────────────────────────────────────────────

describe("Lateral Reach demo fixtures — successful flows", () => {
  it("right tested-side happy path completes successfully", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "completed", "Completion state should be completed");
    assert.equal(result.attemptResult!.targetReached, true, "Target should be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, true, "Dwell should be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, true, "Return should be completed");
  });

  it("left tested-side happy path completes successfully", () => {
    const config = buildLateralReachDemoConfig("left");
    const scenarios = buildAllDemoScenarios("left");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "completed", "Completion state should be completed");
    assert.equal(result.attemptResult!.targetReached, true, "Target should be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, true, "Dwell should be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, true, "Return should be completed");
  });

  it("happy path produces factual timing and path metrics", () => {
    const config = buildLateralReachDemoConfig("right");
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

  it("happy path result has correct task ID", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.taskId, "lateralReach", "Task ID should be lateralReach");
  });

  it("happy path terminal result excludes shoulder and elbow angles", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.peakShoulderAngleDeg, null, "Shoulder angle should remain null");
    assert.equal(result.attemptResult!.peakElbowExtensionDeg, null, "Elbow angle should remain null");
  });

  it("happy path terminal result contains no raw trajectory array", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.happyPath, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    // Attempt result should not contain a trajectory array property
    assert.ok(!("trajectory" in result.attemptResult!), "Attempt result should not expose trajectory");
    assert.ok(!("rawFrames" in result.attemptResult!), "Attempt result should not expose raw frames");
  });
});

// ── Determinism ────────────────────────────────────────────────────────────

describe("Lateral Reach demo fixtures — determinism", () => {
  it("running the same scenario twice produces identical terminal results", () => {
    const config = buildLateralReachDemoConfig("right");
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
    const config = buildLateralReachDemoConfig("right");
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

describe("Lateral Reach demo fixtures — safety scenarios", () => {
  it("low visibility does not incorrectly advance the task", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.lowVisibility, config);

    // Low visibility should produce a terminal result after attemptWindowEnded
    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "not_started", "Completion state should be not_started");
    assert.equal(result.attemptResult!.targetReached, false, "Target should not be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, false, "Return should not be completed");
  });

  it("non-target-facing exit re-arms readiness incrementally", () => {
    const config = buildLateralReachDemoConfig("right");

    // Create initial state and confirm readiness
    const createResult = createLateralReachAttemptState(config, 0, 0);
    assert.ok(createResult.ok, "Should create valid initial state");
    let state = createResult.state;

    // Frame in starting zone
    const frame1 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 0, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result1 = applyLateralReachCommand(state, { type: "frame", nowMs: 0, frame: frame1 });
    assert.equal(result1.status, "applied", "First frame should be applied");
    state = result1.state;

    // Readiness confirmation
    const result2 = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(result2.status, "applied", "Readiness confirmation should be applied");
    state = result2.state;
    assert.equal(result2.snapshot.phase, "ready_confirmed_awaiting_onset", "Phase before exit should be ready_confirmed_awaiting_onset");

    // Non-target-facing exit (x: 0.15 is away from target at x: 0.7)
    const frame2 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 20, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.15, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result3 = applyLateralReachCommand(state, { type: "frame", nowMs: 20, frame: frame2 });

    // Immediately after non-target-facing exit
    assert.equal(result3.status, "applied", "Non-target-facing exit frame should be applied");
    assert.equal(result3.snapshot.phase, "awaiting_readiness", "Phase immediately after exit should be awaiting_readiness");
    assert.equal(result3.snapshot.targetReached, false, "Target should not be reached after exit");
    assert.equal(result3.snapshot.dwellConfirmed, false, "Dwell should not be confirmed after exit");
    assert.equal(result3.snapshot.returnToStartCompleted, false, "Return should not be completed after exit");
    state = result3.state;

    // Return to starting zone
    const frame3 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 50, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result4 = applyLateralReachCommand(state, { type: "frame", nowMs: 50, frame: frame3 });
    assert.equal(result4.status, "applied", "Return to starting zone should be applied");
    assert.equal(result4.snapshot.phase, "awaiting_readiness", "Phase should remain awaiting_readiness after returning to zone");
    state = result4.state;

    // Try target-facing movement without new readiness confirmation
    const frame4 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 60, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.5, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result5 = applyLateralReachCommand(state, { type: "frame", nowMs: 60, frame: frame4 });
    assert.equal(result5.status, "applied", "Target-facing exit should be applied");
    assert.equal(result5.snapshot.phase, "awaiting_readiness", "Phase should remain awaiting_readiness without new confirmation");
    assert.equal(result5.snapshot.targetReached, false, "Target should not be reached");
    state = result5.state;

    // Return to starting zone before second readiness confirmation
    const frame5 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 65, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result6 = applyLateralReachCommand(state, { type: "frame", nowMs: 65, frame: frame5 });
    assert.equal(result6.status, "applied", "Return to zone should be applied");
    state = result6.state;

    // Second explicit readiness confirmation (wrist is in zone)
    const result7 = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 70, confirmedBy: "clinician" });
    assert.equal(result7.status, "applied", "Second readiness confirmation should be applied");
    assert.equal(result7.snapshot.phase, "ready_confirmed_awaiting_onset", "Phase after second confirmation should be ready_confirmed_awaiting_onset");

    // Finalize and verify factual note
    const finalResult = applyLateralReachCommand(result7.state, { type: "attemptWindowEnded", nowMs: 100 });
    assert.equal(finalResult.status, "applied", "Finalization should be applied");
    assert.ok(finalResult.attemptResult !== null, "Should have an attempt result");
    assert.ok(
      finalResult.attemptResult!.factualNotes.includes("non_target_facing_exit_observed_before_valid_onset"),
      "Should record non-target-facing exit factual note"
    );
  });

  it("short tracking gap remains within current engine tolerance", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.shortTrackingGap, config);

    // Short gap should not open protective pause
    assert.equal(result.finalSnapshot.protectivePauseCount, 0, "Short gap should not open protective pause");
  });

  it("long gap opens protective pause", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.longTrackingGapWithHumanResume, config);

    assert.ok(result.finalSnapshot.protectivePauseCount > 0, "Long gap should open at least one protective pause");
  });

  it("no automatic resume occurs after protective pause", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const scenario = scenarios.longTrackingGapWithHumanResume;

    // Create initial state
    const createResult = createLateralReachAttemptState(config, 0, 0);
    assert.ok(createResult.ok);
    let state = createResult.state;

    // Apply commands incrementally until pause opens and tracking restores
    let result: ReturnType<typeof applyLateralReachCommand>;
    let pauseOpened = false;
    let trackingRestored = false;

    for (let i = 0; i < scenario.commands.length; i++) {
      const cmd = scenario.commands[i];

      // Stop before resumeRequested
      if (cmd.type === "resumeRequested") break;

      result = applyLateralReachCommand(state, cmd);
      assert.equal(result.status, "applied", `Command ${i} (${cmd.type}) should be applied`);

      // Check if pause opened on this command
      if (!pauseOpened && result.snapshot.hasActivePause) {
        pauseOpened = true;
      }

      // Check if tracking restored after pause opened
      if (pauseOpened && !trackingRestored && cmd.type === "frame") {
        const frameCmd = cmd as { type: "frame"; frame: NormalizedMotionFrame };
        const jointId: "left_wrist" | "right_wrist" = config.testedSide === "left" ? "left_wrist" : "right_wrist";
        const joint = frameCmd.frame.joints[jointId];
        const hasWrist = joint !== undefined && joint.landmark !== undefined;
        if (hasWrist) {
          trackingRestored = true;

          // Key assertions immediately after tracking restoration
          assert.equal(result.snapshot.hasActivePause, true, "Pause should remain active after tracking restoration");
          assert.equal(result.attemptResult, null, "No terminal result should be produced yet");
        }
      }

      state = result.state;
    }

    // Verify we reached the expected intermediate state
    assert.equal(pauseOpened, true, "Protective pause should have opened");
    assert.equal(trackingRestored, true, "Tracking should have been restored");
    assert.equal(result!.snapshot.hasActivePause, true, "Pause should remain active");
    assert.equal(result!.attemptResult, null, "No terminal result yet");

    // Finalization without resume
    const finalResult = applyLateralReachCommand(state, { type: "attemptWindowEnded", nowMs: 800 });
    assert.equal(finalResult.status, "applied", "Finalization should be applied");
    assert.ok(finalResult.attemptResult !== null, "Should have terminal result after finalization");
    assert.ok(finalResult.attemptResult!.protectivePauseCount > 0, "Finalized result should have pause count > 0");
    assert.notEqual(finalResult.attemptResult!.completionState, "completed", "Should not complete without resume");
  });

  it("explicit valid human resume resolves protective pause and allows continuation", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const scenario = scenarios.longTrackingGapWithHumanResume;

    // Create initial state
    const createResult = createLateralReachAttemptState(config, 0, 0);
    assert.ok(createResult.ok);
    let state = createResult.state;

    // Apply commands incrementally until just before resumeRequested
    let result: ReturnType<typeof applyLateralReachCommand>;
    let resumeCommandIndex = -1;

    for (let i = 0; i < scenario.commands.length; i++) {
      const cmd = scenario.commands[i];

      if (cmd.type === "resumeRequested") {
        resumeCommandIndex = i;
        break;
      }

      result = applyLateralReachCommand(state, cmd);
      assert.equal(result.status, "applied", `Command ${i} (${cmd.type}) should be applied`);
      state = result.state;
    }

    // Immediately before resumeRequested
    assert.equal(result!.snapshot.hasActivePause, true, "Pause should be active before resume");
    const lastAcceptedBeforeResume = state.lastAcceptedNowMs;

    // Apply explicit human resume
    const resumeCmd = scenario.commands[resumeCommandIndex] as { type: "resumeRequested"; nowMs: number; readinessConfirmedAt: string; resumedBy: string };
    const resumeResult = applyLateralReachCommand(state, resumeCmd);

    // Resume command assertions
    assert.equal(resumeResult.status, "applied", "Resume command should be applied");
    assert.equal(resumeResult.snapshot.hasActivePause, false, "Pause should be resolved after resume");
    assert.equal(resumeResult.state.lastAcceptedNowMs, resumeCmd.nowMs, "lastAcceptedNowMs should advance to resume timestamp");
    assert.ok(resumeResult.state.lastAcceptedNowMs > lastAcceptedBeforeResume, "Clock should advance");
    state = resumeResult.state;

    // Apply next valid frame directly
    const nextCmd = scenario.commands[resumeCommandIndex + 1] as { type: "frame"; nowMs: number; frame: NormalizedMotionFrame };
    const frameResult = applyLateralReachCommand(state, nextCmd);

    // Post-resume frame assertions
    assert.equal(frameResult.status, "applied", "Frame after resume should be applied");
    assert.equal(frameResult.state.lastAcceptedNowMs, nextCmd.nowMs, "Clock should advance to frame timestamp");
    assert.equal(frameResult.snapshot.hasActivePause, false, "Pause should remain resolved");
  });

  it("stop-before-completion produces the correct terminal state", () => {
    const config = buildLateralReachDemoConfig("right");
    const scenarios = buildAllDemoScenarios("right");
    const result = executeScenario(scenarios.stopBeforeCompletion, config);

    assert.ok(result.attemptResult !== null, "Should have an attempt result");
    assert.equal(result.attemptResult!.completionState, "stopped", "Should be stopped");
    assert.equal(result.attemptResult!.targetReached, false, "Target should not be reached");
    assert.equal(result.attemptResult!.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(result.attemptResult!.returnToStartCompleted, false, "Return should not be completed");
  });

  it("out-of-order timestamp is rejected and state remains unchanged", () => {
    const config = buildLateralReachDemoConfig("right");

    // Create valid initial state
    const createResult = createLateralReachAttemptState(config, 0, 0);
    assert.ok(createResult.ok, "Should create valid initial state");
    let state = createResult.state;

    // Apply accepted commands with increasing timestamps
    const frame1 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 0, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result1 = applyLateralReachCommand(state, { type: "frame", nowMs: 0, frame: frame1 });
    assert.equal(result1.status, "applied", "First command should be applied");
    state = result1.state;

    // Apply command with newer timestamp
    const result2 = applyLateralReachCommand(state, { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" });
    assert.equal(result2.status, "applied", "Second command should be applied");
    state = result2.state;

    // Store state before rejected command
    const stateBeforeRejection = state;
    const lastAcceptedNowMsBefore = state.lastAcceptedNowMs;
    const snapshotBeforeRejection = result2.snapshot;
    const phaseBeforeRejection = snapshotBeforeRejection.phase;

    // Apply command with an older timestamp (out-of-order)
    const frame2 = {
      schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
      source: { kind: "web_camera_pose" as const, capturedAtMs: 5, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
      joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
    };
    const result3 = applyLateralReachCommand(state, { type: "frame", nowMs: 5, frame: frame2 });

    // Engine should reject the out-of-order command
    assert.equal(result3.status, "rejected", "Out-of-order timestamp should be rejected");
    assert.equal(result3.reason, "now_ms_not_monotonic", "Rejection reason should be now_ms_not_monotonic");

    // State immutability assertions
    assert.equal(result3.state, stateBeforeRejection, "Rejected command should not mutate state reference");
    assert.equal(result3.state.lastAcceptedNowMs, lastAcceptedNowMsBefore, "lastAcceptedNowMs should remain unchanged");
    assert.equal(result3.state.lastAcceptedNowMs, 10, "lastAcceptedNowMs should still be 10");

    // Snapshot immutability assertions
    assert.equal(result3.snapshot.phase, phaseBeforeRejection, "Phase should remain unchanged after rejection");
    assert.equal(result3.snapshot.targetReached, false, "Target should not be reached");
    assert.equal(result3.snapshot.dwellConfirmed, false, "Dwell should not be confirmed");
    assert.equal(result3.snapshot.returnToStartCompleted, false, "Return should not be completed");
  });

  it("executeScenario throws when a built-in scenario command is unexpectedly rejected", () => {
    const config = buildLateralReachDemoConfig("right");

    // Create a deliberately broken scenario with out-of-order timestamps
    const brokenScenario = {
      name: "broken",
      description: "Test scenario with out-of-order timestamps",
      commands: [
        { type: "frame" as const, nowMs: 0, frame: {
          schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
          source: { kind: "web_camera_pose" as const, capturedAtMs: 0, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
          joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
        }},
        { type: "readinessConfirmed" as const, nowMs: 10, confirmedBy: "clinician" as const },
        // Out-of-order timestamp
        { type: "frame" as const, nowMs: 5, frame: {
          schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
          source: { kind: "web_camera_pose" as const, capturedAtMs: 5, frameIndex: 0, coordinateSpace: "normalized_2d" as const },
          joints: { right_wrist: { landmark: { x: 0.3, y: 0.5 }, confidence: { visibility: 0.9, present: true } } },
        }},
      ],
    };

    assert.throws(
      () => executeScenario(brokenScenario, config),
      (error: Error) => {
        return (
          error.message.includes("broken") &&
          error.message.includes("command 2") &&
          error.message.includes("frame") &&
          error.message.includes("rejected by engine")
        );
      },
      "Should throw with useful error message"
    );
  });
});

// ── Config validation ──────────────────────────────────────────────────────

describe("Lateral Reach demo fixtures — config validation", () => {
  it("buildLateralReachDemoConfig supports left tested side", () => {
    const config = buildLateralReachDemoConfig("left");
    assert.equal(config.testedSide, "left");
  });

  it("buildLateralReachDemoConfig supports right tested side", () => {
    const config = buildLateralReachDemoConfig("right");
    assert.equal(config.testedSide, "right");
  });

  it("buildAllDemoScenarios returns all six scenarios", () => {
    const scenarios = buildAllDemoScenarios("right");
    assert.ok(scenarios.happyPath, "Should include happyPath");
    assert.ok(scenarios.lowVisibility, "Should include lowVisibility");
    assert.ok(scenarios.wrongDirectionExitRearmsReadiness, "Should include wrongDirectionExitRearmsReadiness");
    assert.ok(scenarios.shortTrackingGap, "Should include shortTrackingGap");
    assert.ok(scenarios.longTrackingGapWithHumanResume, "Should include longTrackingGapWithHumanResume");
    assert.ok(scenarios.stopBeforeCompletion, "Should include stopBeforeCompletion");
  });
});
