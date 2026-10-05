import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { NormalizedPoint } from "../types";
import {
  bezierSegmentsFromWaypoints,
  buildSampledPath,
  type BezierSegment,
  type SampledPath,
} from "./bezier-path";

export type MotionPatternId =
  | "d1-inspired-diagonal-reach"
  | "rasq-demo-d1-diagonal-reach"
  | "reach-the-light-targets";

export type MotionPatternWaypoint = NormalizedPoint & {
  label?: string;
};

/** Configurable progression integrity thresholds — no unexplained magic numbers. */
export type PatternProgressionConfig = {
  startAcquisitionMaxProgress: number;
  maxForwardProgressWindow: number;
  reacquisitionProgressWindow: number;
  minimumAcceptedSamples: number;
  pathTolerance: number;
  completionProgress: number;
  minAdvanceDelta: number;
  reverseTolerance: number;
};

/** Clinical motion pattern — waypoint-driven therapeutic path definition. */
export type MotionPattern = {
  id: MotionPatternId;
  nameEn: string;
  nameAr: string;
  feedbackProfileKey: string;
  waypoints: readonly MotionPatternWaypoint[];
  segments?: readonly BezierSegment[];
  progression: PatternProgressionConfig;
  supportedSides: readonly ShoulderAbductionReachSide[];
};

export type ResolvedMotionPattern = MotionPattern & {
  sampledPath: SampledPath;
  side: ShoulderAbductionReachSide;
};

export function resolveMotionPatternPath(
  pattern: MotionPattern,
  side: ShoulderAbductionReachSide,
): SampledPath {
  const waypoints = mirrorWaypointsForSide(pattern.waypoints, side);
  const segments = pattern.segments?.length
    ? mirrorSegmentsForSide(pattern.segments, side)
    : bezierSegmentsFromWaypoints(waypoints);
  return buildSampledPath(segments);
}

export function resolveMotionPatternForSide(
  pattern: MotionPattern,
  side: ShoulderAbductionReachSide,
): ResolvedMotionPattern {
  return {
    ...pattern,
    side,
    sampledPath: resolveMotionPatternPath(pattern, side),
  };
}

function mirrorX(point: NormalizedPoint, side: ShoulderAbductionReachSide): NormalizedPoint {
  if (side === "right") return point;
  return { x: 1 - point.x, y: point.y };
}

function mirrorWaypointsForSide(
  waypoints: readonly MotionPatternWaypoint[],
  side: ShoulderAbductionReachSide,
): NormalizedPoint[] {
  return waypoints.map((waypoint) => mirrorX(waypoint, side));
}

function mirrorSegmentsForSide(
  segments: readonly BezierSegment[],
  side: ShoulderAbductionReachSide,
): BezierSegment[] {
  if (side === "right") return [...segments];
  return segments.map((segment) => ({
    start: mirrorX(segment.start, side),
    control1: mirrorX(segment.control1, side),
    control2: mirrorX(segment.control2, side),
    end: mirrorX(segment.end, side),
  }));
}
