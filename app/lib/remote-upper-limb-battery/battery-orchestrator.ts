/**
 * Remote Upper-Limb Battery — pure orchestrator state machine.
 */

import {
  getBatteryTestDefinition,
  REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER,
  type RemoteUpperLimbBatterySide,
  type RemoteUpperLimbBatteryTestId,
  type RemoteUpperLimbBatteryTestResult,
} from "./types";
import { requiresSideRepositionAfterTestIndex } from "./battery-orientation";

export type BatteryOrchestratorPhase =
  | "idle"
  | "positioning"
  | "reposition_side"
  | "countdown"
  | "test_active"
  | "test_completed"
  | "assessment_completed"
  | "submitting"
  | "submit_failed";

export type BatteryOrchestratorState = {
  phase: BatteryOrchestratorPhase;
  testIndex: number;
  repsCompleted: number;
  countdown: number | null;
  trackingReady: boolean;
  results: RemoteUpperLimbBatteryTestResult[];
  submitAttempted: boolean;
};

export function createBatteryOrchestratorState(): BatteryOrchestratorState {
  return {
    phase: "idle",
    testIndex: 0,
    repsCompleted: 0,
    countdown: null,
    trackingReady: false,
    results: [],
    submitAttempted: false,
  };
}

export function getActiveBatteryTestId(state: BatteryOrchestratorState): RemoteUpperLimbBatteryTestId {
  return REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER[state.testIndex];
}

export function getActiveBatteryTestRequiredReps(state: BatteryOrchestratorState): number {
  return getBatteryTestDefinition(getActiveBatteryTestId(state)).requiredReps;
}

export function startBatteryAssessment(state: BatteryOrchestratorState): BatteryOrchestratorState {
  return {
    ...state,
    phase: "positioning",
    testIndex: 0,
    repsCompleted: 0,
    countdown: null,
    trackingReady: false,
    results: [],
    submitAttempted: false,
  };
}

export function setBatteryTrackingReady(
  state: BatteryOrchestratorState,
  ready: boolean,
): BatteryOrchestratorState {
  return { ...state, trackingReady: ready };
}

export function beginBatteryCountdown(
  state: BatteryOrchestratorState,
  seconds = 3,
): BatteryOrchestratorState {
  if (state.phase !== "positioning") return state;
  return {
    ...state,
    phase: "countdown",
    countdown: seconds,
    trackingReady: true,
  };
}

export function tickBatteryCountdown(state: BatteryOrchestratorState): BatteryOrchestratorState {
  if (state.phase !== "countdown" || state.countdown === null) return state;
  if (state.countdown <= 1) {
    return { ...state, phase: "test_active", countdown: null };
  }
  return { ...state, countdown: state.countdown - 1 };
}

export function recordBatteryRepCompleted(
  state: BatteryOrchestratorState,
  peakAngleDeg: number | null,
): BatteryOrchestratorState {
  if (state.phase !== "test_active") return state;
  const required = getActiveBatteryTestRequiredReps(state);
  const nextReps = Math.min(state.repsCompleted + 1, required);
  const next = { ...state, repsCompleted: nextReps };
  if (nextReps >= required) {
    return { ...next, phase: "test_completed" };
  }
  return next;
}

export function completeBatteryTest(
  state: BatteryOrchestratorState,
  result: RemoteUpperLimbBatteryTestResult,
): BatteryOrchestratorState {
  const nextResults = [...state.results, result];
  const nextTestIndex = state.testIndex + 1;
  if (nextTestIndex >= REMOTE_UPPER_LIMB_BATTERY_TEST_ORDER.length) {
    return {
      ...state,
      phase: "assessment_completed",
      results: nextResults,
      repsCompleted: 0,
      countdown: null,
    };
  }
  const needsReposition = requiresSideRepositionAfterTestIndex(state.testIndex);
  return {
    ...state,
    phase: needsReposition ? "reposition_side" : "positioning",
    testIndex: nextTestIndex,
    repsCompleted: 0,
    countdown: null,
    trackingReady: false,
    results: nextResults,
  };
}

export function completeSideReposition(state: BatteryOrchestratorState): BatteryOrchestratorState {
  if (state.phase !== "reposition_side") return state;
  return {
    ...state,
    phase: "positioning",
    trackingReady: false,
  };
}

export function canBeginBatteryTest(state: BatteryOrchestratorState): boolean {
  return state.phase === "positioning" || state.phase === "countdown" || state.phase === "test_active";
}

export function retryCurrentBatteryTest(state: BatteryOrchestratorState): BatteryOrchestratorState {
  if (state.phase === "reposition_side") {
    return { ...state, trackingReady: false };
  }
  return {
    ...state,
    phase: "positioning",
    repsCompleted: 0,
    countdown: null,
    trackingReady: false,
  };
}

export function cancelBatteryAssessment(state: BatteryOrchestratorState): BatteryOrchestratorState {
  return createBatteryOrchestratorState();
}

export function markBatterySubmitting(state: BatteryOrchestratorState): BatteryOrchestratorState {
  return { ...state, phase: "submitting", submitAttempted: true };
}

export function markBatterySubmitFailed(state: BatteryOrchestratorState): BatteryOrchestratorState {
  return { ...state, phase: "submit_failed" };
}

export function buildRepTestResult(input: {
  testId: "shoulderAbduction" | "shoulderFlexion" | "elbowFlexion";
  repsCompleted: number;
  repsRequired: number;
  peakAnglesDeg: number[];
  trackingQuality: "good" | "fair" | "poor" | "unknown";
}): RemoteUpperLimbBatteryTestResult {
  return {
    testId: input.testId,
    repsCompleted: input.repsCompleted,
    repsRequired: input.repsRequired,
    peakAnglesDeg: input.peakAnglesDeg,
    trackingQuality: input.trackingQuality,
  };
}

export function buildFunctionalReachTestResult(input: {
  peakReachExtent: number | null;
  trackingQuality: "good" | "fair" | "poor" | "unknown";
}): RemoteUpperLimbBatteryTestResult {
  return {
    testId: "functionalReach",
    attemptsCompleted: 1,
    attemptsRequired: 1,
    peakReachExtent: input.peakReachExtent,
    trackingQuality: input.trackingQuality,
    steppingMeasured: false,
    therapistReviewNote:
      "Patient was instructed to keep feet still. Stepping was not automatically measured in this release.",
  };
}

export function buildBatteryPayload(input: {
  testedSide: RemoteUpperLimbBatterySide;
  results: RemoteUpperLimbBatteryTestResult[];
}) {
  return {
    schemaVersion: 1 as const,
    testedSide: input.testedSide,
    completedAt: new Date().toISOString(),
    reviewRequired: true as const,
    tests: input.results,
  };
}
