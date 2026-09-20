import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import { aggregateInteractiveShoulderSessionMetrics } from "@/app/lib/progress/aggregate-interactive-shoulder-session-metrics";
import {
  COMPENSATION_SIGNAL_CAVEAT,
  COMPENSATION_SIGNAL_LABEL,
  DETECTED_REACH_RETURN_CYCLES_LABEL,
  TARGET_INTERACTIONS_LABEL,
  shouldShowDetectedReachReturnCycles,
} from "@/app/lib/progress/interactive-shoulder-outcome-clinician-display";

export const PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL =
  "Peak recorded hip–shoulder–elbow angle (2D camera)";
export const PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER =
  "Interior angle at the shoulder between hip–shoulder and shoulder–elbow landmarks in normalized image space; not clinical shoulder ROM. For therapist review.";

/** Shorter session-snapshot label; full geometric qualification lives in the helper. */
export const PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL = "Peak 2D camera angle";

export const AVG_TARGET_RESPONSE_TIME_LABEL = "Avg target response time";
export const AVG_TARGET_RESPONSE_TIME_HELPER =
  "Average time from target appearance to successful interaction.";

export const D1_PATH_TRACES_COMPLETED_LABEL = "D1 path traces completed";
export const D1_PATH_TRACES_COMPLETED_HELPER =
  "Automated completions of the configured D1-inspired path; not prescribed repetition dose.";

export const RECORDED_SESSION_OBSERVATION_HEADING = "Recorded session observation";
export const RECORDED_SESSION_OBSERVATION_FOOTER = "For therapist review only.";

export const MOTION_PROFILE_HEADING = "Movement profiles";

/** Terms that must never appear in deterministic session observation copy. */
export const FORBIDDEN_OBSERVATION_TERMS = [
  "good",
  "poor",
  "improved",
  "declined",
  "normal",
  "abnormal",
  "diagnosis",
  "diagnose",
  "recommend",
  "recovery",
  "recovered",
] as const;

export type BlockMotionProfileLine = {
  label: string;
  value: string;
  secondary?: boolean;
};

export type SessionMotionSnapshotMetric = {
  label: string;
  value: string;
  helper?: string;
};

export function averageTargetResponseTimeMs(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.round(total / samples.length);
}

export function formatTargetResponseTimeSeconds(ms: number): string {
  const seconds = ms / 1000;
  const formatted = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${formatted} s`;
}

function formatTargetResponseTimeSecondsForObservation(ms: number): string {
  const seconds = ms / 1000;
  const formatted = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${formatted} second${seconds === 1 ? "" : "s"}`;
}

export function formatMovementAngleDegrees(degrees: number): string {
  const formatted = Number.isInteger(degrees) ? String(degrees) : degrees.toFixed(1);
  return `${formatted}°`;
}

export function peakMovementAngleDegrees(
  block: InteractiveShoulderOutcomeBlockReport,
): number | null {
  if (block.measured.rangeValuesDegrees.length === 0) return null;
  return Math.max(...block.measured.rangeValuesDegrees);
}

export function sessionPeakMovementAngleDegrees(
  entry: InteractiveShoulderOutcomeReportEntry,
): number | null {
  const peaks = entry.blocks
    .map(peakMovementAngleDegrees)
    .filter((value): value is number => value != null);
  if (peaks.length === 0) return null;
  return Math.max(...peaks);
}

export function isActiveExerciseBlock(block: InteractiveShoulderOutcomeBlockReport): boolean {
  return block.displayCategory !== "instructional";
}

function blockDisplayTitle(block: InteractiveShoulderOutcomeBlockReport): string {
  if (block.title) return block.title;
  if (block.displayCategory === "target") return "Target reach block";
  if (block.displayCategory === "pattern") return "Movement pattern block";
  return "Exercise block";
}

export function buildBlockMotionProfile(
  block: InteractiveShoulderOutcomeBlockReport,
): BlockMotionProfileLine[] {
  if (!isActiveExerciseBlock(block)) return [];

  const lines: BlockMotionProfileLine[] = [];
  const peakAngle = peakMovementAngleDegrees(block);
  const avgResponseMs = averageTargetResponseTimeMs(block.interaction.timingSamplesMs);

  if (peakAngle != null) {
    lines.push({
      label: PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL,
      value: formatMovementAngleDegrees(peakAngle),
    });
  }

  if (avgResponseMs != null) {
    lines.push({
      label: AVG_TARGET_RESPONSE_TIME_LABEL,
      value: formatTargetResponseTimeSeconds(avgResponseMs),
    });
  }

  if (block.displayCategory === "pattern" && block.interaction.patternsCompleted > 0) {
    lines.push({
      label: D1_PATH_TRACES_COMPLETED_LABEL,
      value: String(block.interaction.patternsCompleted),
    });
  } else if (
    (block.displayCategory === "target" || block.displayCategory === "unknown") &&
    block.interaction.targetsContacted > 0
  ) {
    lines.push({
      label: TARGET_INTERACTIONS_LABEL,
      value: String(block.interaction.targetsContacted),
    });
  }

  if (shouldShowDetectedReachReturnCycles(block)) {
    lines.push({
      label: DETECTED_REACH_RETURN_CYCLES_LABEL,
      value: String(block.measured.validRepetitions),
      secondary: true,
    });
  }

  return lines;
}

export function buildSessionMotionSnapshot(
  entry: InteractiveShoulderOutcomeReportEntry,
): SessionMotionSnapshotMetric[] {
  const metrics = aggregateInteractiveShoulderSessionMetrics(entry);
  const snapshot: SessionMotionSnapshotMetric[] = [];

  const sessionPeak = sessionPeakMovementAngleDegrees(entry);
  if (sessionPeak != null) {
    snapshot.push({
      label: PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
      value: formatMovementAngleDegrees(sessionPeak),
      helper: PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER,
    });
  }

  if (metrics.averageReactionMs != null) {
    snapshot.push({
      label: AVG_TARGET_RESPONSE_TIME_LABEL,
      value: formatTargetResponseTimeSeconds(metrics.averageReactionMs),
      helper: AVG_TARGET_RESPONSE_TIME_HELPER,
    });
  }

  if (metrics.patternsCompleted > 0) {
    snapshot.push({
      label: D1_PATH_TRACES_COMPLETED_LABEL,
      value: String(metrics.patternsCompleted),
      helper: D1_PATH_TRACES_COMPLETED_HELPER,
    });
  }

  if (metrics.compensationEvents > 0) {
    snapshot.push({
      label: COMPENSATION_SIGNAL_LABEL,
      value: String(metrics.compensationEvents),
      helper: COMPENSATION_SIGNAL_CAVEAT,
    });
  }

  return snapshot;
}

export function buildRecordedSessionObservation(
  entry: InteractiveShoulderOutcomeReportEntry,
): string | null {
  const activeBlocks = entry.blocks.filter(isActiveExerciseBlock);
  if (activeBlocks.length === 0) return null;

  const fragments: string[] = [];
  const blockWord = activeBlocks.length === 1 ? "block" : "blocks";
  fragments.push(
    `Recorded movement data were available across ${activeBlocks.length} active exercise ${blockWord}.`,
  );

  for (const block of activeBlocks) {
    const title = blockDisplayTitle(block);

    if (
      (block.displayCategory === "target" ||
        (block.displayCategory === "unknown" && block.interaction.targetsContacted > 0)) &&
      block.interaction.targetsContacted > 0
    ) {
      const interactions = block.interaction.targetsContacted;
      const avgMs = averageTargetResponseTimeMs(block.interaction.timingSamplesMs);
      let sentence = `The ${title} block recorded ${interactions} successful target interaction${
        interactions === 1 ? "" : "s"
      }`;
      if (avgMs != null) {
        sentence += ` with an average response time of ${formatTargetResponseTimeSecondsForObservation(avgMs)}`;
      }
      sentence += ".";
      fragments.push(sentence);
    }

    if (
      (block.displayCategory === "pattern" ||
        (block.displayCategory === "unknown" && block.interaction.patternsCompleted > 0)) &&
      block.interaction.patternsCompleted > 0
    ) {
      const traces = block.interaction.patternsCompleted;
      fragments.push(
        `The ${title} block recorded ${traces} automated path trace completion${traces === 1 ? "" : "s"}.`,
      );
    }
  }

  const sessionPeak = sessionPeakMovementAngleDegrees(entry);
  if (sessionPeak != null) {
    fragments.push(
      `The highest recorded 2D hip–shoulder–elbow angle was ${formatMovementAngleDegrees(sessionPeak)}.`,
    );
  }

  const sessionMetrics = aggregateInteractiveShoulderSessionMetrics(entry);
  if (sessionMetrics.compensationEvents > 0) {
    const count = sessionMetrics.compensationEvents;
    fragments.push(
      `Automated compensation signals were flagged ${count} time${count === 1 ? "" : "s"}.`,
    );
  }

  return `${fragments.join(" ")} ${RECORDED_SESSION_OBSERVATION_FOOTER}`;
}

export function hasMotionAnalysisContent(entry: InteractiveShoulderOutcomeReportEntry): boolean {
  if (buildSessionMotionSnapshot(entry).length > 0) return true;
  if (buildRecordedSessionObservation(entry) != null) return true;
  return entry.blocks.some((block) => buildBlockMotionProfile(block).length > 0);
}
