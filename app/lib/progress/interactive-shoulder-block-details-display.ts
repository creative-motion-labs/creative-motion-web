import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import {
  COMPENSATION_SIGNAL_LABEL,
  DETECTED_REACH_RETURN_CYCLES_HELPER,
  DETECTED_REACH_RETURN_CYCLES_LABEL,
  TARGET_INTERACTIONS_HELPER,
  TARGET_INTERACTIONS_LABEL,
  VALID_REPETITIONS_LABEL,
  isRepetitionDosedBlock,
  peakRomDegrees,
  shouldShowDetectedReachReturnCycles,
} from "@/app/lib/progress/interactive-shoulder-outcome-clinician-display";
import {
  AVG_TARGET_RESPONSE_TIME_LABEL,
  D1_PATH_TRACES_COMPLETED_HELPER,
  D1_PATH_TRACES_COMPLETED_LABEL,
  PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
  averageTargetResponseTimeMs,
  formatMovementAngleDegrees,
  formatTargetResponseTimeSeconds,
} from "@/app/lib/progress/interactive-shoulder-motion-analysis";

export const RECORDED_BLOCK_DETAILS_TITLE = "Recorded block details";
export const RECORDED_BLOCK_DETAILS_SUBTITLE =
  "Measured and interaction data recorded during each session phase.";
export const RECORDED_BLOCK_DETAILS_CTA = "View recorded block details";
export const TECHNICAL_OBSERVATIONS_LABEL = "Technical observations";
export const RECORDED_BLOCK_DETAILS_COMPENSATION_FOOTNOTE =
  "Compensation signal is an automated single-camera geometric proxy, not a validated clinical compensation measure. For therapist review.";

export const DURATION_LABEL = "Duration";
export const COMPLETED_LABEL = "Completed";

export type BlockDetailMetric = {
  label: string;
  value: string;
  helper?: string;
};

/** Rounds to the nearest whole second, then formats as m:ss (no decimal leakage). */
export function formatRecordedBlockDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatIntegerCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return String(Math.round(value));
}

export function isInstructionalPhaseBlock(block: InteractiveShoulderOutcomeBlockReport): boolean {
  return block.displayCategory === "instructional";
}

export function shouldShowBlockDetailsCompensationFootnote(
  blocks: InteractiveShoulderOutcomeBlockReport[],
): boolean {
  return blocks.some((block) => !isInstructionalPhaseBlock(block));
}

export function buildInstructionalBlockDetails(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockDetailMetric[] {
  return [
    { label: COMPLETED_LABEL, value: "Yes" },
    { label: DURATION_LABEL, value: formatRecordedBlockDuration(block.durationSeconds) },
  ];
}

export function buildTargetBlockDetails(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockDetailMetric[] {
  const metrics: BlockDetailMetric[] = [];
  const avgResponseMs = averageTargetResponseTimeMs(block.interaction.timingSamplesMs);
  const peakAngle = peakRomDegrees(block);

  metrics.push({
    label: TARGET_INTERACTIONS_LABEL,
    value: formatIntegerCount(block.interaction.targetsContacted),
    helper: block.interaction.targetsContacted > 0 ? TARGET_INTERACTIONS_HELPER : undefined,
  });

  if (avgResponseMs != null) {
    metrics.push({
      label: AVG_TARGET_RESPONSE_TIME_LABEL,
      value: formatTargetResponseTimeSeconds(avgResponseMs),
    });
  }

  if (peakAngle != null) {
    metrics.push({
      label: PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
      value: formatMovementAngleDegrees(peakAngle),
    });
  }

  metrics.push({
    label: COMPENSATION_SIGNAL_LABEL,
    value: formatIntegerCount(block.interpreted.compensationEvents),
  });

  metrics.push({
    label: DURATION_LABEL,
    value: formatRecordedBlockDuration(block.durationSeconds),
  });

  if (isRepetitionDosedBlock(block)) {
    metrics.push({
      label: VALID_REPETITIONS_LABEL,
      value: formatIntegerCount(
        block.measured.validRepetitions > 0 ? block.measured.validRepetitions : null,
      ),
    });
  }

  return metrics;
}

export function buildPatternBlockDetails(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockDetailMetric[] {
  const metrics: BlockDetailMetric[] = [];
  const peakAngle = peakRomDegrees(block);

  metrics.push({
    label: D1_PATH_TRACES_COMPLETED_LABEL,
    value: formatIntegerCount(block.interaction.patternsCompleted),
    helper: block.interaction.patternsCompleted > 0 ? D1_PATH_TRACES_COMPLETED_HELPER : undefined,
  });

  if (peakAngle != null) {
    metrics.push({
      label: PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
      value: formatMovementAngleDegrees(peakAngle),
    });
  }

  metrics.push({
    label: COMPENSATION_SIGNAL_LABEL,
    value: formatIntegerCount(block.interpreted.compensationEvents),
  });

  metrics.push({
    label: DURATION_LABEL,
    value: formatRecordedBlockDuration(block.durationSeconds),
  });

  if (isRepetitionDosedBlock(block)) {
    metrics.push({
      label: VALID_REPETITIONS_LABEL,
      value: formatIntegerCount(
        block.measured.validRepetitions > 0 ? block.measured.validRepetitions : null,
      ),
    });
  }

  return metrics;
}

export function buildUnknownBlockDetails(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockDetailMetric[] {
  if (block.interaction.patternsCompleted > 0) {
    return buildPatternBlockDetails(block);
  }
  if (block.interaction.targetsContacted > 0 || block.displayCategory === "target") {
    return buildTargetBlockDetails(block);
  }

  const metrics: BlockDetailMetric[] = [];
  const avgResponseMs = averageTargetResponseTimeMs(block.interaction.timingSamplesMs);
  const peakAngle = peakRomDegrees(block);

  if (block.interaction.targetsContacted > 0) {
    metrics.push({
      label: TARGET_INTERACTIONS_LABEL,
      value: formatIntegerCount(block.interaction.targetsContacted),
      helper: TARGET_INTERACTIONS_HELPER,
    });
  }

  if (block.interaction.patternsCompleted > 0) {
    metrics.push({
      label: D1_PATH_TRACES_COMPLETED_LABEL,
      value: formatIntegerCount(block.interaction.patternsCompleted),
      helper: D1_PATH_TRACES_COMPLETED_HELPER,
    });
  }

  if (avgResponseMs != null) {
    metrics.push({
      label: AVG_TARGET_RESPONSE_TIME_LABEL,
      value: formatTargetResponseTimeSeconds(avgResponseMs),
    });
  }

  if (peakAngle != null) {
    metrics.push({
      label: PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
      value: formatMovementAngleDegrees(peakAngle),
    });
  }

  if (metrics.length > 0) {
    metrics.push({
      label: COMPENSATION_SIGNAL_LABEL,
      value: formatIntegerCount(block.interpreted.compensationEvents),
    });
  }

  metrics.push({
    label: DURATION_LABEL,
    value: formatRecordedBlockDuration(block.durationSeconds),
  });

  if (isRepetitionDosedBlock(block)) {
    metrics.push({
      label: VALID_REPETITIONS_LABEL,
      value: formatIntegerCount(
        block.measured.validRepetitions > 0 ? block.measured.validRepetitions : null,
      ),
    });
  }

  return metrics;
}

export function buildBlockDetailsMetrics(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockDetailMetric[] {
  if (isInstructionalPhaseBlock(block)) {
    return buildInstructionalBlockDetails(block);
  }
  if (block.displayCategory === "pattern") {
    return buildPatternBlockDetails(block);
  }
  if (block.displayCategory === "target") {
    return buildTargetBlockDetails(block);
  }
  return buildUnknownBlockDetails(block);
}

export function buildTechnicalObservationMetrics(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockDetailMetric[] {
  if (!shouldShowDetectedReachReturnCycles(block)) return [];

  return [
    {
      label: DETECTED_REACH_RETURN_CYCLES_LABEL,
      value: formatIntegerCount(block.measured.validRepetitions),
      helper: DETECTED_REACH_RETURN_CYCLES_HELPER,
    },
  ];
}

export function hasTechnicalObservationsForBlock(
  block: InteractiveShoulderOutcomeBlockReport,
): boolean {
  return buildTechnicalObservationMetrics(block).length > 0;
}
