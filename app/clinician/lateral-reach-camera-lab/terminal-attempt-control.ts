/**
 * Lateral Reach Camera Lab — Terminal Result UI: End Attempt eligibility.
 *
 * Pure decision helper gating the lab-only "End Attempt" control, which
 * calls detector.endAttemptWindow(). Available only while the engine is
 * running and has not already produced a terminal result.
 */

export type LateralReachCameraStatus =
  | "idle"
  | "initializing"
  | "acquiring"
  | "running"
  | "error";

/**
 * @param detectorStatus current LateralReachCameraDetector status.
 * @param engineTerminal snapshot.engineSnapshot?.terminal, or null when no
 *   engine state exists yet (e.g. acquisition-only mode before startEngine).
 */
export function canEndAttemptWindow(
  detectorStatus: LateralReachCameraStatus,
  engineTerminal: boolean | null,
): boolean {
  if (detectorStatus !== "running") return false;
  if (engineTerminal === null) return false;
  return !engineTerminal;
}
