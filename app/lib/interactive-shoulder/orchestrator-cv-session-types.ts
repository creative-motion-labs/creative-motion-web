import type { CaptureSetupGuidance } from "@/app/lib/cv/patient-cv-capture-readiness";
import { createPatientCvCameraConsentRecord } from "@/app/lib/cv/patient-cv-consent";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { SessionDefinition, SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";

/**
 * The smallest slice of SessionOrchestratorSnapshot a completion
 * listener needs (O2) — deliberately narrower than the full snapshot,
 * which also carries UI-runtime fields (currentBlock,
 * patientFeedbackState, transitionState, ...) with no persistence
 * relevance. Narrowing here keeps the public onSessionComplete
 * contract from coupling to orchestrator internals it doesn't need.
 */
export type InteractiveShoulderSessionCompletionSnapshot = Pick<
  SessionOrchestratorSnapshot,
  "sessionState" | "sessionElapsedSeconds" | "accumulatedBlockResults"
>;

export type InteractiveShoulderSessionProps = {
  language: PatientExerciseLanguage;
  arClass?: string;
  textDir?: "rtl" | "ltr";
  /**
   * Therapist-authored treatment side from the authenticated patient-plan contract.
   * Patient portal call sites must pass `session.prescribedSide` only — never URL or form input.
   */
  prescribedSide?: string | null;
  /**
   * When true, runtime requires a valid server-authored prescribed side and blocks
   * before camera start. Volunteer/research and clinician lab flows omit this flag.
   */
  clinicalPrescribedSideRequired?: boolean;
  onSkipped?: () => void;
  onRegisterMetricsFlush?: (flush: () => void) => void;
  onRegisterCaptureConsent?: (
    getter: () => ReturnType<typeof createPatientCvCameraConsentRecord> | null,
  ) => void;
  onCaptureReadinessChange?: (payload: {
    primaryGuidance: CaptureSetupGuidance;
    canStartTracking: boolean;
    minimumMet: boolean;
    previewActive: boolean;
  }) => void;
  /**
   * Fires once when the orchestrator reaches full-session completion,
   * with the final completion snapshot. Existing zero-arg callers
   * remain valid (TypeScript allows a function with fewer declared
   * parameters wherever more are expected) — this is an additive,
   * backward-compatible widening, not a breaking change.
   */
  onSessionComplete?: (snapshot: InteractiveShoulderSessionCompletionSnapshot) => void;
};

export type OrchestratorCvSessionCoreProps = InteractiveShoulderSessionProps & {
  sessionDefinition: SessionDefinition;
};
