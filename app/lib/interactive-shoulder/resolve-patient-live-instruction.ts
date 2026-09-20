import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import {
  hasLocalizedBlockCopy,
  resolveBlockDisplayCopy,
} from "./resolve-block-display-copy";

export type PatientLiveInstructionInput = {
  language: PatientExerciseLanguage;
  blockId: string | undefined;
  fallbackTitle: string;
  fallbackInstructions: string;
  targetHitAnnouncement?: string | null;
  safetyLiveMessage?: string | null;
};

/**
 * Resolves the patient-facing live instruction strip. Prefers localized catalog
 * copy for known blocks — never raw English `block.instructions` when a
 * localized entry exists for the active block id.
 */
export function resolvePatientLiveInstructionStrip({
  language,
  blockId,
  fallbackTitle,
  fallbackInstructions,
  targetHitAnnouncement = null,
  safetyLiveMessage = null,
}: PatientLiveInstructionInput): string {
  const blockCopy = resolveBlockDisplayCopy(language, blockId, fallbackTitle, fallbackInstructions);
  if (targetHitAnnouncement) return targetHitAnnouncement;

  // Session orchestrator echoes English catalog block.instructions into
  // patientFeedbackState.message. Prefer localized block copy over that echo.
  if (
    safetyLiveMessage &&
    !(
      hasLocalizedBlockCopy(language, blockId) &&
      safetyLiveMessage === fallbackInstructions
    )
  ) {
    return safetyLiveMessage;
  }

  return blockCopy.instructions;
}
