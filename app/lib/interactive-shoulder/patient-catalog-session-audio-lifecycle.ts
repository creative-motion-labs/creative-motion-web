/**
 * Catalog patient session audio scope — parent survives wrap-up; cancels on true navigation.
 */

import { cancelPatientBoothVoicePlayback } from "@/app/lib/interactive-shoulder/patient-booth-voice-runtime";

/** Register on CatalogPatientSessionPlayback mount; invoke cleanup on unmount or session identity change. */
export function createCatalogPatientSessionAudioCleanup(): () => void {
  return () => {
    cancelPatientBoothVoicePlayback();
  };
}
