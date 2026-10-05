import type { MotionPattern, MotionPatternWaypoint } from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-types";
import { D1_INSPIRED_DIAGONAL_REACH_PATTERN } from "@/app/lib/interactive-shoulder/motion-patterns/d1-inspired-diagonal-reach-pattern";

/** Reflect authored x in mirrored-preview space (screen right = patient right). */
function reflectPreviewX(waypoints: readonly MotionPatternWaypoint[]): MotionPatternWaypoint[] {
  return waypoints.map((waypoint) => ({
    ...waypoint,
    x: 1 - waypoint.x,
  }));
}

/**
 * Public /demo PNF block only — path aligned to approved seated illustration:
 * right arm low on screen right → across toward left shoulder on screen left.
 * Not used for patient rehab sessions.
 */
export const RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN: MotionPattern = {
  id: "rasq-demo-d1-diagonal-reach",
  nameEn: "PNF D1 demonstration path",
  nameAr: "مسار عرض PNF D1",
  feedbackProfileKey: "rasq-demo-d1-diagonal-reach",
  waypoints: reflectPreviewX(D1_INSPIRED_DIAGONAL_REACH_PATTERN.waypoints),
  progression: { ...D1_INSPIRED_DIAGONAL_REACH_PATTERN.progression },
  supportedSides: ["left", "right"],
};

export const RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE =
  RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN.feedbackProfileKey;
