/** Public /demo Reach to Right pacing — not clinical configuration. */

export const RASQ_DEMO_REACH_TARGET_DURATION_SECONDS = 100;

/** Comfortable sequential targets within ~90–105s (see attempt timeout). */
export const RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP = 8;

/** ~12.5s per target × 8 ≈ 100s when attempts use the full window. */
export const RASQ_DEMO_REACH_TARGET_ATTEMPT_TIMEOUT_MS = 12_500;

export const RASQ_DEMO_PUBLIC_MOVEMENT_TARGET_PACING = {
  attemptTimeoutMs: RASQ_DEMO_REACH_TARGET_ATTEMPT_TIMEOUT_MS,
  maxTargetPresentations: RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP,
} as const;

export function shouldPlayDemoReachMidInstruction(params: {
  targetSequence: number;
  midInstructionAlreadyPlayed: boolean;
  reachBlockStartedAtMs: number | null;
  nowMs: number;
  reachBlockDurationSeconds: number;
}): boolean {
  if (params.midInstructionAlreadyPlayed) return false;
  const halfSequence = Math.ceil(RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP / 2);
  if (params.targetSequence >= halfSequence) return true;
  if (params.reachBlockStartedAtMs === null) return false;
  const halfBlockMs = (params.reachBlockDurationSeconds * 1000) / 2;
  return params.nowMs - params.reachBlockStartedAtMs >= halfBlockMs;
}

export function shouldCompleteDemoReachAfterTargetHit(
  targetSequence: number,
  cap: number = RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP,
): boolean {
  return targetSequence >= cap;
}

export function shouldCompleteDemoReachAfterExtraPresentation(
  targetSequence: number,
  cap: number = RASQ_DEMO_REACH_TARGET_PRESENTATION_CAP,
): boolean {
  return targetSequence > cap;
}
