/**
 * Deterministic Elbow Extension demonstration fixtures.
 *
 * Pure TypeScript — no React, no DOM, no browser APIs, no network, no persistence.
 *
 * Each scenario is a sequence of commands with explicit monotonic timestamps
 * that drive the real Elbow Extension engine to produce factual terminal results.
 *
 * Key distinctions from Forward/Lateral Reach:
 * - peakElbowExtensionDeg is an OPTIONAL 2D geometric observation
 * - The wrist target task is primary — angle observation does NOT gate completion
 * - Task can complete successfully with peakElbowExtensionDeg === null
 */

import { MOTION_INTELLIGENCE_SCHEMA_VERSION, type JointId, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  applyElbowExtensionCommand,
  createElbowExtensionAttemptState,
  getElbowExtensionRuntimeSnapshot,
  validateElbowExtensionConfig,
  type ElbowExtensionAttemptState,
  type ElbowExtensionCommand,
  type ElbowExtensionConfig,
  type ElbowExtensionRuntimeSnapshot,
} from "@/app/lib/upper-limb-motor-screen/elbow-extension-engine";
import { evaluateClinicalStop } from "@/app/lib/upper-limb-motor-screen/clinical-stop-evaluator";
import type { UpperLimbMovementAttemptResult, UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

// ── Constants ──────────────────────────────────────────────────────────────

const START_POINT = { x: 0.3, y: 0.6 };
const TARGET_POINT = { x: 0.7, y: 0.4 };
const WRONG_DIRECTION_POINT = { x: 0.15, y: 0.7 };

// ── Config builder ─────────────────────────────────────────────────────────

/**
 * Builds a validated Elbow Extension demo config for the specified tested side.
 */
export function buildElbowExtensionDemoConfig(testedSide: UpperLimbSide): ElbowExtensionConfig {
  const result = validateElbowExtensionConfig({
    testedSide,
    fixedTarget: { point: TARGET_POINT, radius: 0.05 },
    startingZone: { point: START_POINT, radius: 0.05 },
    tracking: {
      minWristVisibility: 0.3,
      maxAllowedGapMs: 300,
      minShoulderVisibility: 0.3,
      minElbowVisibility: 0.3,
    },
    timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
  });

  if (!result.ok) {
    throw new Error(`Invalid Elbow Extension demo config: ${result.reason}`);
  }

  return result.config;
}

// ── Frame construction ─────────────────────────────────────────────────────

type JointData = { x: number; y: number; visibility?: number; present?: boolean } | null;

/**
 * Builds a frame with optional shoulder, elbow, and wrist landmarks.
 * When shoulder/elbow are provided and visible, the engine can observe 2D elbow angle.
 * When only wrist is provided, the wrist task proceeds but angle remains null.
 */
function buildFrameWithArm(
  side: UpperLimbSide,
  wrist: JointData,
  elbow: JointData,
  shoulder: JointData,
  atMs: number,
): NormalizedMotionFrame {
  const wristId: JointId = side === "left" ? "left_wrist" : "right_wrist";
  const elbowId: JointId = side === "left" ? "left_elbow" : "right_elbow";
  const shoulderId: JointId = side === "left" ? "left_shoulder" : "right_shoulder";

  const joints: NormalizedMotionFrame["joints"] = {};

  if (wrist) {
    joints[wristId] = {
      landmark: { x: wrist.x, y: wrist.y },
      confidence: { visibility: wrist.visibility ?? 0.9, present: wrist.present ?? true },
    };
  }
  if (elbow) {
    joints[elbowId] = {
      landmark: { x: elbow.x, y: elbow.y },
      confidence: { visibility: elbow.visibility ?? 0.9, present: elbow.present ?? true },
    };
  }
  if (shoulder) {
    joints[shoulderId] = {
      landmark: { x: shoulder.x, y: shoulder.y },
      confidence: { visibility: shoulder.visibility ?? 0.9, present: shoulder.present ?? true },
    };
  }

  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      kind: "web_camera_pose",
      capturedAtMs: atMs,
      frameIndex: 0,
      coordinateSpace: "normalized_2d",
    },
    joints,
  };
}

// ── Scenario definitions ───────────────────────────────────────────────────

export interface DemoScenario {
  name: string;
  description: string;
  commands: ElbowExtensionCommand[];
}

/**
 * Happy path with full arm landmarks — demonstrates successful completion
 * with observed 2D elbow angle.
 */
export function buildHappyPathWithArmLandmarksScenario(config: ElbowExtensionConfig): DemoScenario {
  return {
    name: "happyPathWithArmLandmarks",
    description: "Successful complete movement with observed 2D elbow angle from shoulder-elbow-wrist landmarks",
    commands: [
      // Start in starting zone with full arm visible
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, { x: 0.25, y: 0.55 }, { x: 0.2, y: 0.5 }, 0) },
      // Clinician confirms readiness
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Exit starting zone toward target (onset starts)
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, { x: 0.3, y: 0.52 }, { x: 0.2, y: 0.5 }, 20) },
      // Continue toward target
      { type: "frame", nowMs: 60, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, { x: 0.35, y: 0.48 }, { x: 0.2, y: 0.5 }, 60) },
      // Onset confirmation (after onsetConfirmationMs = 100ms)
      { type: "frame", nowMs: 140, frame: buildFrameWithArm(config.testedSide, { x: 0.63, y: 0.43 }, { x: 0.45, y: 0.44 }, { x: 0.2, y: 0.5 }, 140) },
      // Enter target - full extension
      { type: "frame", nowMs: 250, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, { x: 0.55, y: 0.4 }, { x: 0.2, y: 0.5 }, 250) },
      // Dwell in target (must stay >= dwellDurationMs = 200ms)
      { type: "frame", nowMs: 300, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, { x: 0.55, y: 0.4 }, { x: 0.2, y: 0.5 }, 300) },
      { type: "frame", nowMs: 350, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, { x: 0.55, y: 0.4 }, { x: 0.2, y: 0.5 }, 350) },
      { type: "frame", nowMs: 400, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, { x: 0.55, y: 0.4 }, { x: 0.2, y: 0.5 }, 400) },
      { type: "frame", nowMs: 460, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, { x: 0.55, y: 0.4 }, { x: 0.2, y: 0.5 }, 460) },
      // Exit target to start return
      { type: "frame", nowMs: 470, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, { x: 0.35, y: 0.52 }, { x: 0.2, y: 0.5 }, 470) },
      // Return journey
      { type: "frame", nowMs: 500, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, { x: 0.3, y: 0.55 }, { x: 0.2, y: 0.5 }, 500) },
      { type: "frame", nowMs: 550, frame: buildFrameWithArm(config.testedSide, { x: 0.35, y: 0.58 }, { x: 0.27, y: 0.57 }, { x: 0.2, y: 0.5 }, 550) },
      // Re-enter starting zone
      { type: "frame", nowMs: 600, frame: buildFrameWithArm(config.testedSide, START_POINT, { x: 0.25, y: 0.55 }, { x: 0.2, y: 0.5 }, 600) },
      // Stay in starting zone (must stay >= returnConfirmationMs = 150ms)
      { type: "frame", nowMs: 650, frame: buildFrameWithArm(config.testedSide, START_POINT, { x: 0.25, y: 0.55 }, { x: 0.2, y: 0.5 }, 650) },
      { type: "frame", nowMs: 700, frame: buildFrameWithArm(config.testedSide, START_POINT, { x: 0.25, y: 0.55 }, { x: 0.2, y: 0.5 }, 700) },
      // Return confirmation completes at ~750ms (600 + 150)
      { type: "frame", nowMs: 760, frame: buildFrameWithArm(config.testedSide, START_POINT, { x: 0.25, y: 0.55 }, { x: 0.2, y: 0.5 }, 760) },
      // Attempt window ends
      { type: "attemptWindowEnded", nowMs: 800 },
    ],
  };
}

/**
 * Happy path with wrist-only tracking — demonstrates that task completion
 * does NOT require elbow angle observation. peakElbowExtensionDeg will be null.
 */
export function buildHappyPathWristOnlyScenario(config: ElbowExtensionConfig): DemoScenario {
  return {
    name: "happyPathWristOnly",
    description: "Successful complete movement with wrist-only tracking — no elbow angle observed",
    commands: [
      // Start in starting zone with wrist only
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 0) },
      // Clinician confirms readiness
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Exit starting zone toward target (onset starts)
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, null, null, 20) },
      // Continue toward target
      { type: "frame", nowMs: 60, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, null, null, 60) },
      // Onset confirmation (after onsetConfirmationMs = 100ms)
      { type: "frame", nowMs: 140, frame: buildFrameWithArm(config.testedSide, { x: 0.63, y: 0.43 }, null, null, 140) },
      // Enter target
      { type: "frame", nowMs: 250, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, null, null, 250) },
      // Dwell in target (must stay >= dwellDurationMs = 200ms)
      { type: "frame", nowMs: 300, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, null, null, 300) },
      { type: "frame", nowMs: 350, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, null, null, 350) },
      { type: "frame", nowMs: 400, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, null, null, 400) },
      { type: "frame", nowMs: 460, frame: buildFrameWithArm(config.testedSide, TARGET_POINT, null, null, 460) },
      // Exit target to start return
      { type: "frame", nowMs: 470, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, null, null, 470) },
      // Return journey
      { type: "frame", nowMs: 500, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, null, null, 500) },
      { type: "frame", nowMs: 550, frame: buildFrameWithArm(config.testedSide, { x: 0.35, y: 0.58 }, null, null, 550) },
      // Re-enter starting zone
      { type: "frame", nowMs: 600, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 600) },
      // Stay in starting zone (must stay >= returnConfirmationMs = 150ms)
      { type: "frame", nowMs: 650, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 650) },
      { type: "frame", nowMs: 700, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 700) },
      // Return confirmation completes at ~750ms (600 + 150)
      { type: "frame", nowMs: 760, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 760) },
      // Attempt window ends
      { type: "attemptWindowEnded", nowMs: 800 },
    ],
  };
}

/**
 * Low wrist visibility — wrist tracking insufficient to advance.
 */
export function buildLowVisibilityScenario(config: ElbowExtensionConfig): DemoScenario {
  return {
    name: "lowVisibility",
    description: "Wrist visibility below threshold — does not advance",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Low visibility wrist movement
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55, visibility: 0.1 }, null, null, 20) },
      { type: "frame", nowMs: 50, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5, visibility: 0.15 }, null, null, 50) },
      { type: "frame", nowMs: 80, frame: buildFrameWithArm(config.testedSide, { x: 0.6, y: 0.45, visibility: 0.2 }, null, null, 80) },
      { type: "frame", nowMs: 110, frame: buildFrameWithArm(config.testedSide, { ...TARGET_POINT, visibility: 0.1 }, null, null, 110) },
      { type: "attemptWindowEnded", nowMs: 200 },
    ],
  };
}

/**
 * Wrong-direction exit — wrist exits opposite to target direction, re-arms readiness.
 */
export function buildWrongDirectionExitScenario(config: ElbowExtensionConfig): DemoScenario {
  return {
    name: "wrongDirectionExit",
    description: "Wrist exits non-target-facing side, re-arms readiness. Explicit new readiness confirmation is required.",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Exit in wrong direction (away from target)
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, WRONG_DIRECTION_POINT, null, null, 20) },
      // Return to starting zone
      { type: "frame", nowMs: 50, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 50) },
      // Phase is now awaiting_readiness - new confirmation required
      { type: "readinessConfirmed", nowMs: 70, confirmedBy: "clinician" },
      // Now can proceed with valid onset toward target
      { type: "frame", nowMs: 90, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, null, null, 90) },
      { type: "attemptWindowEnded", nowMs: 200 },
    ],
  };
}

/**
 * Short tracking gap — brief occlusion below maxAllowedGapMs does not trigger protective pause.
 */
export function buildShortTrackingGapScenario(config: ElbowExtensionConfig): DemoScenario {
  return {
    name: "shortTrackingGap",
    description: "Brief wrist occlusion below maxAllowedGapMs — no protective pause",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, null, null, 20) },
      // Short gap (< 300ms)
      { type: "frame", nowMs: 150, frame: buildFrameWithArm(config.testedSide, null, null, null, 150) },
      { type: "frame", nowMs: 200, frame: buildFrameWithArm(config.testedSide, null, null, null, 200) },
      // Resume tracking
      { type: "frame", nowMs: 300, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, null, null, 300) },
      { type: "attemptWindowEnded", nowMs: 400 },
    ],
  };
}

/**
 * Long tracking gap with explicit human resume — demonstrates protective pause behavior.
 */
export function buildLongTrackingGapWithHumanResumeScenario(config: ElbowExtensionConfig): DemoScenario {
  return {
    name: "longTrackingGapWithHumanResume",
    description: "Long occlusion opens protective pause — requires explicit human resume",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, null, null, 20) },
      // Long gap (>= 300ms)
      { type: "frame", nowMs: 150, frame: buildFrameWithArm(config.testedSide, null, null, null, 150) },
      { type: "frame", nowMs: 200, frame: buildFrameWithArm(config.testedSide, null, null, null, 200) },
      { type: "frame", nowMs: 300, frame: buildFrameWithArm(config.testedSide, null, null, null, 300) },
      // Protective pause opens at 450ms
      { type: "frame", nowMs: 450, frame: buildFrameWithArm(config.testedSide, null, null, null, 450) },
      // Tracking restored but no auto-resume
      { type: "frame", nowMs: 500, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, null, null, 500) },
      // Explicit human resume required
      {
        type: "resumeRequested",
        nowMs: 550,
        readinessConfirmedAt: "2026-08-07T00:00:00.000Z",
        resumedBy: "clinician",
      },
      { type: "frame", nowMs: 600, frame: buildFrameWithArm(config.testedSide, { x: 0.6, y: 0.45 }, null, null, 600) },
      { type: "attemptWindowEnded", nowMs: 700 },
    ],
  };
}

/**
 * Stop before completion — clinician stops the attempt before wrist task completes.
 */
export function buildStopBeforeCompletionScenario(config: ElbowExtensionConfig): DemoScenario {
  const stopEval = evaluateClinicalStop({ reason: "clinician_or_caregiver_safety_concern", recordedBy: "clinician" });
  if (!stopEval.ok) {
    throw new Error("Failed to create clinical stop event");
  }

  return {
    name: "stopBeforeCompletion",
    description: "Clinician stops the attempt before completion",
    commands: [
      { type: "frame", nowMs: 0, frame: buildFrameWithArm(config.testedSide, START_POINT, null, null, 0) },
      { type: "readinessConfirmed", nowMs: 10, confirmedBy: "clinician" },
      // Exit starting zone toward target
      { type: "frame", nowMs: 20, frame: buildFrameWithArm(config.testedSide, { x: 0.4, y: 0.55 }, null, null, 20) },
      { type: "frame", nowMs: 60, frame: buildFrameWithArm(config.testedSide, { x: 0.5, y: 0.5 }, null, null, 60) },
      // Clinician stops before onset confirmation
      {
        type: "clinicalStopReceived",
        nowMs: 100,
        event: stopEval.event,
      },
    ],
  };
}

// ── Scenario map ───────────────────────────────────────────────────────────

export type ScenarioKey =
  | "happyPathWithArmLandmarks"
  | "happyPathWristOnly"
  | "lowVisibility"
  | "wrongDirectionExit"
  | "shortTrackingGap"
  | "longTrackingGapWithHumanResume"
  | "stopBeforeCompletion";

export type DemoScenarioMap = Record<ScenarioKey, DemoScenario>;

/**
 * Returns all available demo scenarios for the specified tested side.
 */
export function buildAllElbowExtensionScenarios(testedSide: UpperLimbSide): DemoScenarioMap {
  const config = buildElbowExtensionDemoConfig(testedSide);
  return {
    happyPathWithArmLandmarks: buildHappyPathWithArmLandmarksScenario(config),
    happyPathWristOnly: buildHappyPathWristOnlyScenario(config),
    lowVisibility: buildLowVisibilityScenario(config),
    wrongDirectionExit: buildWrongDirectionExitScenario(config),
    shortTrackingGap: buildShortTrackingGapScenario(config),
    longTrackingGapWithHumanResume: buildLongTrackingGapWithHumanResumeScenario(config),
    stopBeforeCompletion: buildStopBeforeCompletionScenario(config),
  };
}

// ── Scenario execution ─────────────────────────────────────────────────────

export type ScenarioExecutionSuccess = {
  ok: true;
  finalState: ElbowExtensionAttemptState;
  finalSnapshot: ElbowExtensionRuntimeSnapshot;
  result: UpperLimbMovementAttemptResult | null;
  commandCount: number;
};

export type ScenarioExecutionFailure = {
  ok: false;
  reason: string;
  commandIndex: number;
};

export type ScenarioExecutionResult = ScenarioExecutionSuccess | ScenarioExecutionFailure;

/**
 * Executes a demo scenario by applying each command sequentially.
 * Returns the final state and result, or an error if any command is rejected.
 */
export function executeScenario(scenario: DemoScenario, config: ElbowExtensionConfig): ScenarioExecutionResult {
  const initResult = createElbowExtensionAttemptState(config, 0, 0);
  if (!initResult.ok) {
    return { ok: false, reason: `Initialization failed: ${initResult.reason}`, commandIndex: -1 };
  }

  let state = initResult.state;
  let commandIndex = 0;

  for (const command of scenario.commands) {
    const result = applyElbowExtensionCommand(state, command);
    if (result.status === "rejected") {
      return {
        ok: false,
        reason: `Command rejected: ${result.reason} at command ${commandIndex}`,
        commandIndex,
      };
    }
    state = result.state;
    commandIndex += 1;
  }

  return {
    ok: true,
    finalState: state,
    finalSnapshot: getElbowExtensionRuntimeSnapshot(state),
    result: state.finalResult,
    commandCount: scenario.commands.length,
  };
}
