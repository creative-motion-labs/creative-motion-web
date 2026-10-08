import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";

/**
 * Session-complete booth voice must never block clinical completion (outcome save + wrap-up).
 * Voice runs first so detached completion audio can start before the parent UI transitions;
 * synchronous voice failures are isolated so the clinical callback still runs exactly once.
 */
export function invokePatientBoothSessionCompleteHandoff(
  snapshot: InteractiveShoulderSessionCompletionSnapshot,
  playSessionCompleteVoice: () => void,
  onClinicalSessionComplete?: (snapshot: InteractiveShoulderSessionCompletionSnapshot) => void,
): void {
  try {
    playSessionCompleteVoice();
  } catch {
    /* Booth voice is non-clinical; do not suppress errors from onClinicalSessionComplete. */
  }
  onClinicalSessionComplete?.(snapshot);
}
