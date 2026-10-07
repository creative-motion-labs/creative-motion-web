import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import type { MovementBlockResult } from "@/app/lib/session-orchestrator/types";
import { RASQ_DEMO_MOVEMENT_DISCLAIMER } from "./demo-copy";
import {
  formatDemoTrackingQuality,
  type DemoPoseSampleSnapshot,
  createEmptyDemoPoseSample,
} from "./demo-pose-metrics";
import {
  hasDemoReachTrackingEvidence,
  type DemoReachTargetAggregateMetrics,
} from "./demo-reach-target-performance";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_DEMO_REACH_RIGHT_BLOCK_ID,
} from "./demo-session-definition";

export const RASQ_DEMO_METRIC_NOT_AVAILABLE = "Not available";

export type RasqDemoMetricValue =
  | { available: true; display: string }
  | { available: false; display: typeof RASQ_DEMO_METRIC_NOT_AVAILABLE };

export type RasqDemoMovementAnalysisSummary = {
  sessionDurationSeconds: number;
  targetsReached: RasqDemoMetricValue;
  reachTargetsCompleted: RasqDemoMetricValue;
  reachAverageTargetTime: RasqDemoMetricValue;
  reachTargetsPerMinute: RasqDemoMetricValue;
  reachTargetCompletionRate: RasqDemoMetricValue;
  pnfRepetitionsCompleted: RasqDemoMetricValue;
  trackingQuality: RasqDemoMetricValue;
  movementSmoothness: RasqDemoMetricValue;
  demonstrationDisclaimer: string;
};

function findBlockResult(
  blocks: readonly MovementBlockResult[],
  blockId: string,
): MovementBlockResult | null {
  return blocks.find((block) => block.blockId === blockId) ?? null;
}

function unavailableMetric(): RasqDemoMetricValue {
  return { available: false, display: RASQ_DEMO_METRIC_NOT_AVAILABLE };
}

function availableMetric(display: string): RasqDemoMetricValue {
  return { available: true, display };
}

function metricFromCount(count: number | null | undefined, unit: string): RasqDemoMetricValue {
  if (count === null || count === undefined || !Number.isFinite(count)) {
    return unavailableMetric();
  }
  return availableMetric(`${count} ${unit}`);
}

export function resolveDemoMovementSmoothness(
  blocks: readonly MovementBlockResult[],
): RasqDemoMetricValue {
  for (const block of blocks) {
    const speed = block.measured.movementSpeed;
    if (speed !== null && Number.isFinite(speed)) {
      return { available: true, display: `Movement speed index ${speed.toFixed(2)}` };
    }
  }
  for (const block of blocks) {
    const consistency = block.interaction.responseConsistency;
    if (consistency !== null && Number.isFinite(consistency)) {
      return {
        available: true,
        display: `Response consistency ${Math.round(consistency * 100)}%`,
      };
    }
  }
  return { available: false, display: RASQ_DEMO_METRIC_NOT_AVAILABLE };
}

function formatReachTargetMetrics(
  aggregate: DemoReachTargetAggregateMetrics | null,
  poseSample: DemoPoseSampleSnapshot,
): Pick<
  RasqDemoMovementAnalysisSummary,
  | "reachTargetsCompleted"
  | "reachAverageTargetTime"
  | "reachTargetsPerMinute"
  | "reachTargetCompletionRate"
> {
  if (!aggregate || !hasDemoReachTrackingEvidence(poseSample)) {
    const unavailable = unavailableMetric();
    return {
      reachTargetsCompleted: unavailable,
      reachAverageTargetTime: unavailable,
      reachTargetsPerMinute: unavailable,
      reachTargetCompletionRate: unavailable,
    };
  }

  const reachTargetsCompleted =
    aggregate.completedTargets > 0
      ? availableMetric(`${aggregate.completedTargets} targets completed`)
      : unavailableMetric();

  const reachAverageTargetTime =
    aggregate.averageTargetDurationSeconds !== null
      ? availableMetric(`${aggregate.averageTargetDurationSeconds.toFixed(1)} seconds average`)
      : unavailableMetric();

  const reachTargetsPerMinute =
    aggregate.targetsPerMinute !== null
      ? availableMetric(`${aggregate.targetsPerMinute.toFixed(1)} targets per minute`)
      : unavailableMetric();

  const reachTargetCompletionRate =
    aggregate.targetCompletionRate !== null
      ? availableMetric(`${Math.round(aggregate.targetCompletionRate * 100)}% completion rate`)
      : unavailableMetric();

  return {
    reachTargetsCompleted,
    reachAverageTargetTime,
    reachTargetsPerMinute,
    reachTargetCompletionRate,
  };
}

export function buildRasqDemoMovementAnalysisSummary(input: {
  snapshot: Pick<
    InteractiveShoulderSessionCompletionSnapshot,
    "sessionElapsedSeconds" | "accumulatedBlockResults"
  >;
  poseSample?: DemoPoseSampleSnapshot;
  reachTargetAggregate?: DemoReachTargetAggregateMetrics | null;
}): RasqDemoMovementAnalysisSummary {
  const { snapshot, poseSample = createEmptyDemoPoseSample(), reachTargetAggregate = null } = input;
  const reach = findBlockResult(snapshot.accumulatedBlockResults, RASQ_DEMO_REACH_RIGHT_BLOCK_ID);
  const d1 = findBlockResult(snapshot.accumulatedBlockResults, RASQ_DEMO_PNF_D1_BLOCK_ID);

  const trackingLabel = formatDemoTrackingQuality(poseSample);
  const trackingQuality: RasqDemoMetricValue = trackingLabel
    ? availableMetric(trackingLabel)
    : unavailableMetric();

  const reachFormatted = formatReachTargetMetrics(reachTargetAggregate, poseSample);

  return {
    sessionDurationSeconds: Math.max(0, Math.round(snapshot.sessionElapsedSeconds)),
    targetsReached: reach
      ? metricFromCount(reach.interaction.targetsContacted, "targets reached")
      : { available: false, display: RASQ_DEMO_METRIC_NOT_AVAILABLE },
    ...reachFormatted,
    pnfRepetitionsCompleted: d1
      ? metricFromCount(d1.interaction.patternsCompleted, "PNF repetitions completed")
      : { available: false, display: RASQ_DEMO_METRIC_NOT_AVAILABLE },
    trackingQuality,
    movementSmoothness: resolveDemoMovementSmoothness(snapshot.accumulatedBlockResults),
    demonstrationDisclaimer: RASQ_DEMO_MOVEMENT_DISCLAIMER,
  };
}

/** @deprecated Use buildRasqDemoMovementAnalysisSummary — kept for lead payload compatibility. */
export type RasqDemoMovementSummary = RasqDemoMovementAnalysisSummary;

export function buildRasqDemoMovementSummary(
  snapshot: Pick<
    InteractiveShoulderSessionCompletionSnapshot,
    "sessionElapsedSeconds" | "accumulatedBlockResults"
  >,
  poseSample?: DemoPoseSampleSnapshot,
): RasqDemoMovementAnalysisSummary {
  return buildRasqDemoMovementAnalysisSummary({ snapshot, poseSample });
}
