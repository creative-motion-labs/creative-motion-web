import type { PatternLifecycleState } from "./motion-patterns/pattern-lifecycle";
import type { TargetLifecycleState } from "./target-lifecycle";
import type { SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";

export type OrchestratorHudSummaryMetrics = {
  targets: number;
  patterns: number;
  reps: number;
  durationSeconds: number;
};

function hudElapsedSecondsEqual(a: number, b: number): boolean {
  return Math.floor(a) === Math.floor(b);
}

function hudProgressPercentEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export function shouldCommitOrchestratorHudSnapshot(
  previous: SessionOrchestratorSnapshot | null,
  next: SessionOrchestratorSnapshot,
): boolean {
  if (!previous) return true;
  return (
    previous.sessionState !== next.sessionState ||
    previous.currentBlockIndex !== next.currentBlockIndex ||
    previous.currentBlock?.blockId !== next.currentBlock?.blockId ||
    !hudElapsedSecondsEqual(previous.blockElapsedSeconds, next.blockElapsedSeconds) ||
    !hudElapsedSecondsEqual(previous.sessionElapsedSeconds, next.sessionElapsedSeconds) ||
    !hudProgressPercentEqual(previous.blockProgress, next.blockProgress) ||
    !hudProgressPercentEqual(previous.sessionProgress, next.sessionProgress) ||
    previous.restRemainingSeconds !== next.restRemainingSeconds ||
    previous.transitionState !== next.transitionState ||
    previous.isPaused !== next.isPaused ||
    previous.safetyStatus !== next.safetyStatus ||
    previous.safetyHoldReason !== next.safetyHoldReason ||
    previous.currentInstruction !== next.currentInstruction ||
    previous.patientFeedbackState.message !== next.patientFeedbackState.message ||
    previous.patientFeedbackState.encouragement !== next.patientFeedbackState.encouragement ||
    previous.accumulatedBlockResults.length !== next.accumulatedBlockResults.length
  );
}

export function orchestratorHudSummaryMetricsEqual(
  a: OrchestratorHudSummaryMetrics,
  b: OrchestratorHudSummaryMetrics,
): boolean {
  return (
    a.targets === b.targets &&
    a.patterns === b.patterns &&
    a.reps === b.reps &&
    a.durationSeconds === b.durationSeconds
  );
}

export function targetLifecycleHudEquals(
  previous: TargetLifecycleState,
  next: TargetLifecycleState,
): boolean {
  return (
    previous.currentTarget?.id === next.currentTarget?.id &&
    previous.exitingTarget?.id === next.exitingTarget?.id &&
    previous.spawnLockedUntilMs === next.spawnLockedUntilMs &&
    previous.interaction.targetsShown === next.interaction.targetsShown &&
    previous.interaction.targetsReached === next.interaction.targetsReached
  );
}

export function logOrchestratorCvRafLoopDev(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[orchestrator-cv-raf:${tag}]`, payload);
}

export function patternLifecycleHudEquals(
  previous: PatternLifecycleState,
  next: PatternLifecycleState,
): boolean {
  return (
    previous.patternId === next.patternId &&
    previous.pathProgress === next.pathProgress &&
    previous.furthestProgress === next.furthestProgress &&
    previous.exitingProgress === next.exitingProgress &&
    previous.wristNearPath === next.wristNearPath &&
    previous.hasAcquiredStart === next.hasAcquiredStart &&
    previous.awaitingReacquisition === next.awaitingReacquisition &&
    previous.spawnLockedUntilMs === next.spawnLockedUntilMs &&
    previous.sequence === next.sequence &&
    previous.interaction.patternsShown === next.interaction.patternsShown &&
    previous.interaction.patternsCompleted === next.interaction.patternsCompleted
  );
}
