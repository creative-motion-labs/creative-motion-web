import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";

export type InteractiveShoulderSessionAggregateMetrics = {
  targetsContacted: number;
  patternsCompleted: number;
  validRepetitions: number;
  averageReactionMs: number | null;
  compensationEvents: number;
  trackingLimitations: string[];
};

function averageTimingSampleMs(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.round(total / samples.length);
}

/**
 * Session-level facts with deterministic aggregation only. Per-block metrics such as
 * movementSpeed, trackingConfidence, and responseConsistency are intentionally
 * omitted — they must not be shown as session aggregates.
 */
export function aggregateInteractiveShoulderSessionMetrics(
  entry: InteractiveShoulderOutcomeReportEntry,
): InteractiveShoulderSessionAggregateMetrics {
  let targetsContacted = 0;
  let patternsCompleted = 0;
  let validRepetitions = 0;
  let timingSamples: number[] = [];
  let compensationEvents = 0;
  const trackingLimitations: string[] = [];

  for (const block of entry.blocks) {
    targetsContacted += block.interaction.targetsContacted;
    patternsCompleted += block.interaction.patternsCompleted;
    validRepetitions += block.measured.validRepetitions;
    timingSamples = timingSamples.concat(block.interaction.timingSamplesMs);
    compensationEvents += block.interpreted.compensationEvents;
    for (const limitation of block.interpreted.trackingLimitations) {
      if (!trackingLimitations.includes(limitation)) trackingLimitations.push(limitation);
    }
  }

  return {
    targetsContacted,
    patternsCompleted,
    validRepetitions,
    averageReactionMs: averageTimingSampleMs(timingSamples),
    compensationEvents,
    trackingLimitations,
  };
}
