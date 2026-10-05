import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import { D1_INSPIRED_DIAGONAL_REACH_PATTERN } from "./d1-inspired-diagonal-reach-pattern";
import type { MotionPattern, ResolvedMotionPattern } from "./motion-pattern-types";
import { resolveMotionPatternForSide } from "./motion-pattern-types";

export const REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE = "shoulder-therapeutic-target";

export type FeedbackInteractionMode = "motion-pattern" | "reach-the-light-targets";

const MOTION_PATTERN_REGISTRY: Record<string, MotionPattern> = {
  [D1_INSPIRED_DIAGONAL_REACH_PATTERN.feedbackProfileKey]: D1_INSPIRED_DIAGONAL_REACH_PATTERN,
};

export function getRegisteredMotionPattern(feedbackProfileKey: string): MotionPattern | null {
  return MOTION_PATTERN_REGISTRY[feedbackProfileKey] ?? null;
}

export function listRegisteredMotionPatterns(): MotionPattern[] {
  return Object.values(MOTION_PATTERN_REGISTRY);
}

export function resolveFeedbackInteractionMode(
  feedbackProfileKey: string | undefined | null,
): FeedbackInteractionMode {
  if (!feedbackProfileKey) return "reach-the-light-targets";
  if (feedbackProfileKey === REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE) {
    return "reach-the-light-targets";
  }
  if (MOTION_PATTERN_REGISTRY[feedbackProfileKey]) {
    return "motion-pattern";
  }
  return "reach-the-light-targets";
}

export function resolveActiveMotionPattern(
  feedbackProfileKey: string | undefined | null,
  side: ShoulderAbductionReachSide,
): ResolvedMotionPattern | null {
  const pattern = feedbackProfileKey ? getRegisteredMotionPattern(feedbackProfileKey) : null;
  if (!pattern) return null;
  return resolveMotionPatternForSide(pattern, side);
}

export function resolveMotionPatternSequenceForSession(
  feedbackProfileKeys: readonly string[],
  side: ShoulderAbductionReachSide,
): ResolvedMotionPattern[] {
  return feedbackProfileKeys
    .map((key) => resolveActiveMotionPattern(key, side))
    .filter((pattern): pattern is ResolvedMotionPattern => Boolean(pattern));
}
