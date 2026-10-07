import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { FeedbackInteractionMode } from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-registry";
import type { PatternInteractionMetrics } from "@/app/lib/interactive-shoulder/motion-patterns/pattern-lifecycle";
import { interactiveShoulderUi } from "@/app/lib/interactive-shoulder/interactive-shoulder-ui";
import type { ShoulderInteractionMetrics } from "@/app/lib/interactive-shoulder/types";

export type ShoulderLiveHudMetric = {
  label: string;
  value: string;
};

/**
 * Patient-facing live HUD metrics for Reach the Light and D1 blocks.
 * Movement-cycle detections are intentionally excluded — they are not prescribed reps.
 */
export function resolveShoulderLiveHudMetrics(input: {
  language: PatientExerciseLanguage;
  feedbackMode: FeedbackInteractionMode;
  targetInteraction: ShoulderInteractionMetrics;
  patternInteraction: PatternInteractionMetrics;
}): ShoulderLiveHudMetric[] {
  const { language, feedbackMode, targetInteraction, patternInteraction } = input;
  const ui = interactiveShoulderUi(language);
  const isPatternMode = feedbackMode === "motion-pattern";
  const interactionCompleted = isPatternMode
    ? patternInteraction.patternsCompleted
    : targetInteraction.targetsReached;
  const interactionTotal = isPatternMode
    ? patternInteraction.patternsShown
    : targetInteraction.targetsShown;
  const interactionLabel = isPatternMode
    ? ui.interactionPatternsLabel(0, 0).split(":")[0]
    : ui.interactionTargetsLabel(0, 0).split(":")[0];

  return [
    {
      label: interactionLabel,
      value: `${interactionCompleted}/${interactionTotal || "—"}`,
    },
  ];
}
