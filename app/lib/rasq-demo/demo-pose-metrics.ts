import type { ShoulderAbductionReachTrackingQuality } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";

export type DemoPoseSampleSnapshot = {
  framesWithPose: number;
  framesTotal: number;
  lastTrackingQuality: ShoulderAbductionReachTrackingQuality;
};

export const DEMO_POSE_TRACKING_MIN_FRAMES = 15;

export function createEmptyDemoPoseSample(): DemoPoseSampleSnapshot {
  return {
    framesWithPose: 0,
    framesTotal: 0,
    lastTrackingQuality: "unknown",
  };
}

export function ingestDemoPoseSample(
  current: DemoPoseSampleSnapshot,
  input: {
    framesWithPose: number;
    framesTotal: number;
    trackingQuality: ShoulderAbductionReachTrackingQuality;
  },
): DemoPoseSampleSnapshot {
  return {
    framesWithPose: Math.max(current.framesWithPose, input.framesWithPose),
    framesTotal: Math.max(current.framesTotal, input.framesTotal),
    lastTrackingQuality: input.trackingQuality,
  };
}

export function formatDemoTrackingQuality(sample: DemoPoseSampleSnapshot): string | null {
  if (sample.framesTotal < DEMO_POSE_TRACKING_MIN_FRAMES) {
    return null;
  }
  const ratio = sample.framesWithPose / sample.framesTotal;
  if (!Number.isFinite(ratio)) return null;
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return `${percent}% of sampled frames had upper-body pose tracking`;
}
