import type {
  ShoulderAbductionReachPoseDetectorSnapshot,
  ShoulderAbductionReachTrackingQuality,
  ShoulderAbductionReachTrackingStatus,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { BodyFramingState } from "@/app/lib/cv/body-framing-evaluator";

/** UI/readiness commit cadence — live pose ref may update every camera frame. */
export const POSE_DETECTOR_UI_COMMIT_MIN_INTERVAL_MS = 66;

export type NormalizedPoseDetectorUiCommit = {
  trackingStatus: ShoulderAbductionReachTrackingStatus;
  trackingQuality: ShoulderAbductionReachTrackingQuality;
  bodyFramingState: BodyFramingState;
  previewActive: boolean;
  trackingError: string | null;
  wrist: { x: number; y: number } | null;
  shoulder: { x: number; y: number } | null;
  elbow: { x: number; y: number } | null;
  estimatedArmLengthNormalized: number | null;
};

function pointOrNull(
  p: { x: number; y: number } | null | undefined,
): { x: number; y: number } | null {
  if (!p) return null;
  return { x: p.x, y: p.y };
}

function pointsEqual(
  a: { x: number; y: number } | null,
  b: { x: number; y: number } | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

/**
 * Stable visible slice for React UI, capture readiness, and demo pose callbacks.
 * Excludes frame counters, init phase, rep FSM fields, and other high-churn internals.
 */
export function normalizePoseDetectorSnapshotForUiCommit(
  snap: ShoulderAbductionReachPoseDetectorSnapshot,
): NormalizedPoseDetectorUiCommit {
  return {
    trackingStatus: snap.trackingStatus,
    trackingQuality: snap.trackingQuality,
    bodyFramingState: snap.bodyFramingState,
    previewActive: snap.previewActive,
    trackingError: snap.trackingError,
    wrist: pointOrNull(snap.primaryWristNormalized),
    shoulder: pointOrNull(snap.primaryShoulderNormalized),
    elbow: pointOrNull(snap.primaryElbowNormalized),
    estimatedArmLengthNormalized: snap.estimatedArmLengthNormalized ?? null,
  };
}

export function normalizedPoseDetectorUiCommitEqual(
  a: NormalizedPoseDetectorUiCommit,
  b: NormalizedPoseDetectorUiCommit,
): boolean {
  return (
    a.trackingStatus === b.trackingStatus &&
    a.trackingQuality === b.trackingQuality &&
    a.bodyFramingState === b.bodyFramingState &&
    a.previewActive === b.previewActive &&
    a.trackingError === b.trackingError &&
    pointsEqual(a.wrist, b.wrist) &&
    pointsEqual(a.shoulder, b.shoulder) &&
    pointsEqual(a.elbow, b.elbow) &&
    a.estimatedArmLengthNormalized === b.estimatedArmLengthNormalized
  );
}

export type PoseDetectorUiCommitEvaluation =
  | { kind: "skip"; reason: "no-live" | "equal" | "throttled" }
  | {
      kind: "commit";
      normalized: NormalizedPoseDetectorUiCommit;
      live: ShoulderAbductionReachPoseDetectorSnapshot;
    };

export function evaluatePoseDetectorUiCommit(input: {
  live: ShoulderAbductionReachPoseDetectorSnapshot | null;
  committedNormalized: NormalizedPoseDetectorUiCommit | null;
  lastCommitAtMs: number;
  nowMs: number;
}): PoseDetectorUiCommitEvaluation {
  const { live, committedNormalized, lastCommitAtMs, nowMs } = input;
  if (!live) {
    return { kind: "skip", reason: "no-live" };
  }
  const normalized = normalizePoseDetectorSnapshotForUiCommit(live);
  if (committedNormalized && normalizedPoseDetectorUiCommitEqual(committedNormalized, normalized)) {
    return { kind: "skip", reason: "equal" };
  }
  if (
    committedNormalized !== null &&
    nowMs - lastCommitAtMs < POSE_DETECTOR_UI_COMMIT_MIN_INTERVAL_MS
  ) {
    return { kind: "skip", reason: "throttled" };
  }
  return { kind: "commit", normalized, live };
}

export function poseDetectorReactSnapshotUnchanged(
  current: ShoulderAbductionReachPoseDetectorSnapshot | null,
  normalized: NormalizedPoseDetectorUiCommit,
): boolean {
  if (!current) return false;
  return normalizedPoseDetectorUiCommitEqual(
    normalizePoseDetectorSnapshotForUiCommit(current),
    normalized,
  );
}
