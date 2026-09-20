/**
 * Deterministic Forward Reach demonstration fixtures.
 *
 * Pure TypeScript — no React, no DOM, no browser APIs, no network, no persistence.
 *
 * Each scenario is a sequence of commands with explicit monotonic timestamps
 * that drive the real Forward Reach engine to produce factual terminal results.
 */

import { MOTION_INTELLIGENCE_SCHEMA_VERSION, type JointId, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  applyForwardReachCommand,
  createForwardReachAttemptState,
  getForwardReachRuntimeSnapshot,
  validateForwardReachConfig,
  type ForwardReachAttemptState,
  type ForwardReachCommand,
  type ForwardReachConfig,
  type ForwardReachRuntimeSnapshot,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-engine";
import { evaluateClinicalStop } from "@/app/lib/upper-limb-motor-screen/clinical-stop-evaluator";
import type { UpperLimbMovementAttemptResult, UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

// ── Constants ──────────────────────────────────────────────────────────────

const START_POINT = { x: 0.3, y: 0.5 };
const TARGET_POINT = { x: 0.7, y: 0.5 };
const OPPOSITE_DIRECTION_POINT = { x: 0.15, y: 0.5 };

// ── Config builder ─────────────────────────────────────────────────────────

/**
 * Builds a validated Forward Reach demo config for the specified tested side.
 */
export function buildForwardReachDemoConfig(testedSide: UpperLimbSide): ForwardReachConfig {
  const result = validateForwardReachConfig({
    testedSide,
    fixedTarget: { point: TARGET_POINT, radius: 0.05 },
    startingZone: { point: START_POINT, radius: 0.05 },
    tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
  });

  if (!result.ok) {
    throw new Error(`Invalid Forward Reach demo config: ${result.reason}`);
  }

  return result.config;
}

// ── Frame construction ─────────────────────────────────────────────────────

function buildFrame(
  side: UpperLimbSide,
  point: { x: number; y: number } | null,
  atMs: number,
  visibility = 0.9,
  present = true,
): NormalizedMotionFrame {
  const jointId: JointId = side === "left" ? "left_wrist" : "right_wrist";
  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      kind: "web_camera_pose",
      capturedAtMs: atMs,
      frameIndex: 0,
      coordinateSpace: "normalized_2d",
    },
    joints: point
      ? { [jointId]: { landmark: { x: point.x, y: point.y }, confidence: { visibility, present } } }
      : {},
  };
}

// ── Scenario definitions ───────────────────────────────────────────────────

export interface DemoScenario {
  name: string;
  description: string;
  commands: ForwardReachCommand[];
}

export function buildHappyPathScenario(config: ForwardReachConfig): DemoScenario {
  return {
    name: "happyPath",
    description: "Successful complete movement: starting zone → onset → target → dwell → return",
    commands: [
      // Start in starting zone
      { type: "frame", nowMs: 0, frame: buildFrame(config.testedSide, START_POINT, 0) },
      // Clinician confirms readiness
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Exit starting zone (onset starts)
      { type: "frame", nowMs: 20, frame: buildFrame(config.testedSide, { x: 0.5, y: 0.5 }, 20) },
      // Onset confirmation (after onsetConfirmationMs = 100ms)
      { type: "frame", nowMs: 140, frame: buildFrame(config.testedSide, { x: 0.63, y: 0.5 }, 140) },
      // Enter target
      { type: "frame", nowMs: 250, frame: buildFrame(config.testedSide, TARGET_POINT, 250) },
      // Dwell in target (must stay >= dwellDurationMs = 200ms)
      { type: "frame", nowMs: 300, frame: buildFrame(config.testedSide, TARGET_POINT, 300) },
      { type: "frame", nowMs: 350, frame: buildFrame(config.testedSide, TARGET_POINT, 350) },
      { type: "frame", nowMs: 400, frame: buildFrame(config.testedSide, TARGET_POINT, 400) },
      { type: "frame", nowMs: 460, frame: buildFrame(config.testedSide, TARGET_POINT, 460) },
      // Exit target to start return
      { type: "frame", nowMs: 470, frame: buildFrame(config.testedSide, { x: 0.5, y: 0.5 }, 470) },
      // Return journey
      { type: "frame", nowMs: 500, frame: buildFrame(config.testedSide, { x: 0.4, y: 0.5 }, 500) },
      { type: "frame", nowMs: 550, frame: buildFrame(config.testedSide, { x: 0.35, y: 0.5 }, 550) },
      // Re-enter starting zone
      { type: "frame", nowMs: 600, frame: buildFrame(config.testedSide, START_POINT, 600) },
      // Stay in starting zone (must stay >= returnConfirmationMs = 150ms)
      { type: "frame", nowMs: 650, frame: buildFrame(config.testedSide, START_POINT, 650) },
      { type: "frame", nowMs: 700, frame: buildFrame(config.testedSide, START_POINT, 700) },
      // Return confirmation completes at ~750ms (600 + 150)
      // Attempt window ends
      { type: "attemptWindowEnded", nowMs: 800 },
    ],
  };
}

export function buildLowVisibilityScenario(config: ForwardReachConfig): DemoScenario {
  return {
    name: "lowVisibility",
    description: "Wrist visibility below threshold — does not advance",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrame(config.testedSide, START_POINT, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Low visibility wrist movement
      { type: "frame", nowMs: 20, frame: buildFrame(config.testedSide, { x: 0.4, y: 0.5 }, 20, 0.1) },
      { type: "frame", nowMs: 50, frame: buildFrame(config.testedSide, { x: 0.5, y: 0.5 }, 50, 0.15) },
      { type: "frame", nowMs: 80, frame: buildFrame(config.testedSide, { x: 0.6, y: 0.5 }, 80, 0.2) },
      { type: "frame", nowMs: 110, frame: buildFrame(config.testedSide, TARGET_POINT, 110, 0.1) },
      { type: "attemptWindowEnded", nowMs: 200 },
    ],
  };
}

export function buildOnsetCandidateAbandonedOnReturnScenario(config: ForwardReachConfig): DemoScenario {
  return {
    name: "onsetCandidateAbandonedOnReturn",
    description: "The wrist exits the starting zone in any direction, then returns before the onset-confirmation window completes. The current onset candidate is discarded, while readiness remains confirmed.",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrame(config.testedSide, START_POINT, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Exit starting zone in any direction
      { type: "frame", nowMs: 20, frame: buildFrame(config.testedSide, OPPOSITE_DIRECTION_POINT, 20) },
      { type: "frame", nowMs: 50, frame: buildFrame(config.testedSide, OPPOSITE_DIRECTION_POINT, 50) },
      // Return to starting zone before onset confirmation completes
      { type: "frame", nowMs: 80, frame: buildFrame(config.testedSide, START_POINT, 80) },
      { type: "attemptWindowEnded", nowMs: 150 },
    ],
  };
}

export function buildShortTrackingGapScenario(config: ForwardReachConfig): DemoScenario {
  return {
    name: "shortTrackingGap",
    description: "Brief wrist occlusion below maxAllowedGapMs — no protective pause",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrame(config.testedSide, START_POINT, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      { type: "frame", nowMs: 20, frame: buildFrame(config.testedSide, { x: 0.4, y: 0.5 }, 20) },
      // Short gap (< 300ms)
      { type: "frame", nowMs: 150, frame: buildFrame(config.testedSide, null, 150) },
      { type: "frame", nowMs: 200, frame: buildFrame(config.testedSide, null, 200) },
      // Resume tracking
      { type: "frame", nowMs: 300, frame: buildFrame(config.testedSide, { x: 0.5, y: 0.5 }, 300) },
      { type: "attemptWindowEnded", nowMs: 400 },
    ],
  };
}

export function buildLongTrackingGapWithHumanResumeScenario(config: ForwardReachConfig): DemoScenario {
  return {
    name: "longTrackingGapWithHumanResume",
    description: "Long occlusion opens protective pause — requires explicit human resume",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrame(config.testedSide, START_POINT, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      { type: "frame", nowMs: 20, frame: buildFrame(config.testedSide, { x: 0.4, y: 0.5 }, 20) },
      // Long gap (>= 300ms)
      { type: "frame", nowMs: 150, frame: buildFrame(config.testedSide, null, 150) },
      { type: "frame", nowMs: 200, frame: buildFrame(config.testedSide, null, 200) },
      { type: "frame", nowMs: 300, frame: buildFrame(config.testedSide, null, 300) },
      // Protective pause opens at 450ms
      { type: "frame", nowMs: 450, frame: buildFrame(config.testedSide, null, 450) },
      // Tracking restored but no auto-resume
      { type: "frame", nowMs: 500, frame: buildFrame(config.testedSide, { x: 0.5, y: 0.5 }, 500) },
      // Explicit human resume required
      {
        type: "resumeRequested",
        nowMs: 550,
        readinessConfirmedAt: "2026-08-06T00:00:00.000Z",
        resumedBy: "clinician",
      },
      { type: "frame", nowMs: 600, frame: buildFrame(config.testedSide, { x: 0.6, y: 0.5 }, 600) },
      { type: "attemptWindowEnded", nowMs: 700 },
    ],
  };
}

export function buildStopBeforeCompletionScenario(config: ForwardReachConfig): DemoScenario {
  const stopEval = evaluateClinicalStop({ reason: "chest_pain", recordedBy: "clinician" });
  if (!stopEval.ok) {
    throw new Error("Failed to create clinical stop event");
  }

  return {
    name: "stopBeforeCompletion",
    description: "Clinician stops the attempt before completion",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrame(config.testedSide, START_POINT, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      { type: "frame", nowMs: 20, frame: buildFrame(config.testedSide, { x: 0.4, y: 0.5 }, 20) },
      { type: "frame", nowMs: 50, frame: buildFrame(config.testedSide, { x: 0.5, y: 0.5 }, 50) },
      // Clinician stops
      { type: "clinicalStopReceived", nowMs: 100, event: stopEval.event },
    ],
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface DemoScenarioMap {
  happyPath: DemoScenario;
  lowVisibility: DemoScenario;
  onsetCandidateAbandonedOnReturn: DemoScenario;
  shortTrackingGap: DemoScenario;
  longTrackingGapWithHumanResume: DemoScenario;
  stopBeforeCompletion: DemoScenario;
}

/**
 * Builds all demo scenarios for the specified tested side.
 */
export function buildAllDemoScenarios(testedSide: UpperLimbSide): DemoScenarioMap {
  const config = buildForwardReachDemoConfig(testedSide);
  return {
    happyPath: buildHappyPathScenario(config),
    lowVisibility: buildLowVisibilityScenario(config),
    onsetCandidateAbandonedOnReturn: buildOnsetCandidateAbandonedOnReturnScenario(config),
    shortTrackingGap: buildShortTrackingGapScenario(config),
    longTrackingGapWithHumanResume: buildLongTrackingGapWithHumanResumeScenario(config),
    stopBeforeCompletion: buildStopBeforeCompletionScenario(config),
  };
}

/**
 * Executes a complete scenario through the real engine and returns the final command result.
 * The attempt result (when terminal) contains the terminal state and metrics.
 * Does not expose raw trajectory data.
 *
 * Throws if any command in the scenario is rejected by the engine.
 */
export function executeScenario(
  scenario: DemoScenario,
  config: ForwardReachConfig,
): {
  finalState: ForwardReachAttemptState;
  finalSnapshot: ForwardReachRuntimeSnapshot;
  attemptResult: UpperLimbMovementAttemptResult | null;
} {
  const createResult = createForwardReachAttemptState(config, 0, 0);
  if (!createResult.ok) {
    throw new Error(`Failed to create initial state: ${createResult.reason}`);
  }

  let state = createResult.state;
  let attemptResult: UpperLimbMovementAttemptResult | null = null;

  for (let i = 0; i < scenario.commands.length; i++) {
    const command = scenario.commands[i];
    const result = applyForwardReachCommand(state, command);
    if (result.status === "applied") {
      state = result.state;
      // Capture the attempt result if this command produced one
      if (result.attemptResult) {
        attemptResult = result.attemptResult;
      }
    } else {
      // Built-in demo scenarios are expected to contain only valid commands
      throw new Error(
        `Scenario "${scenario.name}" command ${i} (type: ${command.type}) was rejected by engine: ${result.reason}`
      );
    }
  }

  return {
    finalState: state,
    finalSnapshot: getForwardReachRuntimeSnapshot(state),
    attemptResult,
  };
}
