import { aggregateInteractiveShoulderSessionMetrics } from "@/app/lib/progress/aggregate-interactive-shoulder-session-metrics";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";

export const INTERACTIVE_SHOULDER_TRACKING_NOTES_TITLE = "Tracking & capture notes";

export function hasInteractiveShoulderTrackingNotes(
  entry: InteractiveShoulderOutcomeReportEntry,
): boolean {
  return aggregateInteractiveShoulderSessionMetrics(entry).trackingLimitations.length > 0;
}

export function getInteractiveShoulderTrackingNotes(
  entry: InteractiveShoulderOutcomeReportEntry,
): string[] {
  return aggregateInteractiveShoulderSessionMetrics(entry).trackingLimitations;
}
