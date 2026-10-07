export const INTERACTIVE_SHOULDER_SECTION_DESCRIPTION =
  "Interactive Shoulder session movement outcomes. Derived observations only — not a diagnosis or clinical score.";

export const ADDITIONAL_CAMERA_OBSERVATIONS_TITLE = "Additional camera observations";
export const ADDITIONAL_CAMERA_OBSERVATIONS_DESCRIPTION =
  "Optional camera-assisted observations from other exercises. Therapist interpretation required.";

export const TRACKING_CAPTURE_NOTES_TITLE = "Tracking & capture notes";
export const TRACKING_CAPTURE_NOTES_DESCRIPTION =
  "Technical capture information for therapist review; not a clinical outcome.";

export const INTERACTIVE_SHOULDER_TRACKING_NOTES_FRAMING =
  "Technical capture information for therapist review; not a clinical outcome.";

export function shouldShowCameraObservationsSection(cvEvidenceCount: number): boolean {
  return cvEvidenceCount > 0;
}

export function shouldShowCaptureReliabilitySection(captureHistoryCount: number): boolean {
  return captureHistoryCount > 0;
}

export function filterOutcomesHubSectionNav<
  T extends { id: string },
>(items: readonly T[], cvEvidenceCount: number, captureHistoryCount: number): T[] {
  return items.filter((item) => {
    if (item.id === "camera-assisted-observation") {
      return shouldShowCameraObservationsSection(cvEvidenceCount);
    }
    if (item.id === "technical-capture-reliability") {
      return shouldShowCaptureReliabilitySection(captureHistoryCount);
    }
    return true;
  });
}

/** Empty only when there are no current-plan cards and no longitudinal chart rows. */
export function shouldShowInteractiveShoulderEmptyState(
  currentPlanOutcomeCount: number,
  chartOutcomeCount: number,
): boolean {
  return currentPlanOutcomeCount === 0 && chartOutcomeCount === 0;
}

export function shouldMountInteractiveShoulderOutcomesPanel(
  currentPlanOutcomeCount: number,
  chartOutcomeCount: number,
): boolean {
  return !shouldShowInteractiveShoulderEmptyState(currentPlanOutcomeCount, chartOutcomeCount);
}

/** Summary line: longitudinal recorded count when chart rows exist; current-plan label otherwise. */
export function formatInteractiveShoulderOutcomeSummary(
  currentPlanOutcomeCount: number,
  chartOutcomeCount: number,
): string {
  if (chartOutcomeCount > 0) {
    const recorded = `${chartOutcomeCount} recorded Interactive Shoulder outcome${chartOutcomeCount === 1 ? "" : "s"}`;
    if (currentPlanOutcomeCount > 0 && currentPlanOutcomeCount !== chartOutcomeCount) {
      return `${recorded} (${currentPlanOutcomeCount} on current plan)`;
    }
    return recorded;
  }

  return `${currentPlanOutcomeCount} Interactive Shoulder outcome${currentPlanOutcomeCount === 1 ? "" : "s"} (current plan)`;
}
