import type { SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";

/**
 * While the orchestrator is paused for the ready countdown (or countdown UI is still
 * mounted), the RAF loop must not tick, commit HUD snapshots, run block transitions,
 * or dispatch runners — otherwise target lifecycle updates fire every frame during init.
 */
export function isOrchestratorCvSessionPausedForCountdown(input: {
  countdownActive: boolean;
  snap: SessionOrchestratorSnapshot | null;
}): boolean {
  if (input.countdownActive) return true;
  return input.snap?.isPaused === true || input.snap?.sessionState === "paused";
}

export function shouldRunOrchestratorCvRafOrchestration(input: {
  countdownActive: boolean;
  snap: SessionOrchestratorSnapshot;
}): boolean {
  return !isOrchestratorCvSessionPausedForCountdown({
    countdownActive: input.countdownActive,
    snap: input.snap,
  });
}

export function shouldAdvanceOrchestratorCvOrchestratorTick(input: {
  runtimeFaultActive: boolean;
  countdownActive: boolean;
  snap: SessionOrchestratorSnapshot | null;
}): boolean {
  if (input.runtimeFaultActive) return false;
  if (
    isOrchestratorCvSessionPausedForCountdown({
      countdownActive: input.countdownActive,
      snap: input.snap,
    })
  ) {
    return false;
  }
  return true;
}
