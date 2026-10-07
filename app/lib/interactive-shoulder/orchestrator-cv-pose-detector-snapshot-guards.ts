import type { ShoulderAbductionReachPoseDetectorSnapshot } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";

function normalizedPointsEqual(
  a: { x: number; y: number } | null | undefined,
  b: { x: number; y: number } | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

/**
 * Fields that drive preview overlay, tracking rail, capture readiness, and CV dispatch.
 * Ignores object identity — the detector emits a fresh object every frame.
 */
export function poseDetectorSnapshotVisibleEqual(
  previous: ShoulderAbductionReachPoseDetectorSnapshot | null,
  next: ShoulderAbductionReachPoseDetectorSnapshot,
): boolean {
  if (!previous) return false;
  return (
    previous.trackingStatus === next.trackingStatus &&
    previous.trackingQuality === next.trackingQuality &&
    previous.bodyFramingState === next.bodyFramingState &&
    previous.primarySide === next.primarySide &&
    previous.primaryPhase === next.primaryPhase &&
    previous.primaryRepCount === next.primaryRepCount &&
    previous.primaryPeakAngleDegrees === next.primaryPeakAngleDegrees &&
    previous.bilateralAngleDifferenceDegrees === next.bilateralAngleDifferenceDegrees &&
    previous.compensationFlagged === next.compensationFlagged &&
    previous.framesWithPose === next.framesWithPose &&
    previous.framesTotal === next.framesTotal &&
    previous.initPhase === next.initPhase &&
    previous.previewActive === next.previewActive &&
    previous.trackingError === next.trackingError &&
    normalizedPointsEqual(previous.primaryWristNormalized, next.primaryWristNormalized) &&
    normalizedPointsEqual(previous.primaryShoulderNormalized, next.primaryShoulderNormalized) &&
    normalizedPointsEqual(previous.primaryElbowNormalized, next.primaryElbowNormalized) &&
    previous.estimatedArmLengthNormalized === next.estimatedArmLengthNormalized
  );
}

/** @deprecated Prefer evaluatePoseDetectorUiCommit for RAF UI commits. */
export function shouldCommitPoseDetectorSnapshot(
  committed: ShoulderAbductionReachPoseDetectorSnapshot | null,
  live: ShoulderAbductionReachPoseDetectorSnapshot | null,
): live is ShoulderAbductionReachPoseDetectorSnapshot {
  if (!live) return false;
  if (!committed) return true;
  return !poseDetectorSnapshotVisibleEqual(committed, live);
}

export function logOrchestratorCvPoseSnapshotCommitDev(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[orchestrator-cv-pose-snapshot:${tag}]`, payload);
}
