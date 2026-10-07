import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";

export const TARGET_INTERACTIONS_LABEL = "Target interactions";
export const TARGET_INTERACTIONS_HELPER =
  "Successful wrist-target interactions during the block.";

export const DETECTED_REACH_RETURN_CYCLES_LABEL = "Detected reach-return cycles";
export const DETECTED_REACH_RETURN_CYCLES_HELPER =
  "Automated movement-cycle detection during this block; not prescribed repetitions.";

export const VALID_REPETITIONS_LABEL = "Valid repetitions";

export const COMPENSATION_SIGNAL_LABEL = "Compensation signal";
export const COMPENSATION_SIGNAL_CAVEAT =
  "Automated single-camera geometric proxy; not a validated clinical compensation measure. For therapist review.";

/**
 * A block is repetition-dosed only when persisted completion metadata proves
 * validRepetitions was the completion criterion — not when incidental arm-cycle
 * detections happened during target/pattern gameplay.
 */
export function isRepetitionDosedBlock(block: InteractiveShoulderOutcomeBlockReport): boolean {
  return block.completionReason === "validRepetitions";
}

export function shouldShowDetectedReachReturnCycles(
  block: InteractiveShoulderOutcomeBlockReport,
): boolean {
  if (block.displayCategory === "instructional") return false;
  if (isRepetitionDosedBlock(block)) return false;
  return block.measured.validRepetitions > 0;
}

export function peakRomDegrees(block: InteractiveShoulderOutcomeBlockReport): number | null {
  if (block.measured.rangeValuesDegrees.length === 0) return null;
  return Math.max(...block.measured.rangeValuesDegrees);
}
