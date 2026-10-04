import type { ShoulderAbductionReachPoseDetectorSnapshot } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { CaptureSetupGuidance } from "@/app/lib/cv/patient-cv-capture-readiness";
import type { PatternCompletionEvent } from "@/app/lib/interactive-shoulder/motion-patterns/pattern-lifecycle";
import type { TargetAttemptStartEvent, TargetHitEvent } from "@/app/lib/interactive-shoulder/types";
import type { ReactNode } from "react";
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
  /**
   * When false, suppresses built-in Interactive Shoulder UI sounds (countdown, block complete, etc.).
   * Public `/demo` sets this so prerecorded demo voice cues stay isolated from booth/battery audio.
   */
  orchestratorUiSoundEffectsEnabled?: boolean;
  /** Demo-only: fires once when the ready countdown overlay begins. */
  onReadyCountdownStarted?: () => void;
  /** Demo-only: fires when a movement block becomes active (after transitions). */
  onMovementBlockActivated?: (blockId: string) => void;
  /** Demo-only: throttled pose snapshots for tracking guidance (not persisted). */
  onPoseDetectorSnapshot?: (snapshot: ShoulderAbductionReachPoseDetectorSnapshot) => void;
  /** Optional panel rendered beside the live preview on large screens (public demo anatomy guide). */
  leadingPreviewCompanion?: ReactNode;
  /** Optional overlay on the camera preview (public demo reach timing HUD). */
  previewMeasurementOverlay?: ReactNode;
  /** Fires when a therapeutic target attempt begins (pose-driven target lifecycle). */
  onTargetAttemptStarted?: (event: TargetAttemptStartEvent) => void;
  /** Fires once when pose tracking confirms a target reach (same path as orchestrator targetContact). */
  onTargetReachConfirmed?: (event: TargetHitEvent) => void;
  /** Fires once when the wrist completes a motion-pattern pass (same path as patternCompleted dispatch). */
  onPatternReachConfirmed?: (event: PatternCompletionEvent) => void;
  /**
   * Public `/demo` only: fixed attempt timeout and presentation cap for Reach pacing.
   * When set, supplies the target attempt seam without enabling adaptive difficulty.
   */
  publicDemoMovementTargetPacing?: {
    attemptTimeoutMs: number;
    maxTargetPresentations: number;
  };
  /** Public `/demo` only: user-gesture hook to unlock target-pop HTMLAudio after camera consent. */
  onDemoTargetPopAudioUnlock?: () => void;
  /** Public `/demo` only: replaces Interactive Shoulder consent copy and skip-camera behavior. */
  publicDemoConsent?: {
    consentTitle: string;
    consentDescription: string;
    consentCheckbox: string;
    continueCamera: string;
    skipCamera: string;
    browserNote: string;
    alreadyGrantedNote: string;
    deniedRecovery: string;
    retryCamera: string;
  };
};

export type OrchestratorCvSessionCoreProps = InteractiveShoulderSessionProps & {
  sessionDefinition: SessionDefinition;
};
