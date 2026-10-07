/**
 * Determines when clinician-authored prescribedSide is required for a plan session.
 * Uses canonical Interactive Shoulder exercise/movement identifiers only.
 */
import type { StoredExercise } from "@/app/lib/exercise-prescription";
import { isPrescribedExerciseV1 } from "@/app/lib/exercise-prescription";
import { isInteractiveShoulderSessionWired } from "@/app/lib/interactive-shoulder/interactive-shoulder-exercise-ids";

export function exerciseIdentifierRequiresPrescribedSide(
  identifier: string | null | undefined,
): boolean {
  return isInteractiveShoulderSessionWired(identifier);
}

/** True when any structured library exercise in the session uses Interactive Shoulder. */
export function guidedSessionRequiresPrescribedSide(
  exercises: readonly StoredExercise[],
): boolean {
  for (const exercise of exercises) {
    if (
      isPrescribedExerciseV1(exercise) &&
      exerciseIdentifierRequiresPrescribedSide(exercise.exerciseId)
    ) {
      return true;
    }
  }
  return false;
}

/** True when any catalog block movement uses Interactive Shoulder. */
export function catalogSessionRequiresPrescribedSide(
  blocks: readonly { movementId: string | null }[],
): boolean {
  return blocks.some((block) => exerciseIdentifierRequiresPrescribedSide(block.movementId));
}
