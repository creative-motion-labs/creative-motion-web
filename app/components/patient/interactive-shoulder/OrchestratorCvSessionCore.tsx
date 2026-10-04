"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { getExerciseCvRegistryEntry } from "@/app/lib/cv/exercise-cv-registry";
import type {
  ShoulderAbductionReachMeasuredEvent,
  ShoulderAbductionReachPoseDetectorSnapshot,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import {
  createPatientCvCameraConsentRecord,
  readPatientCvCameraConsentFromSession,
  writePatientCvCameraConsentToSession,
} from "@/app/lib/cv/patient-cv-consent";
import {
  createInitialTargetLifecycle,
  type TargetLifecycleState,
} from "@/app/lib/interactive-shoulder/target-lifecycle";
import { createInitialInstructionalLifecycle } from "@/app/lib/interactive-shoulder/instructional-lifecycle";
import {
  createEmptyPatternInteractionMetrics,
  type PatternLifecycleState,
} from "@/app/lib/interactive-shoulder/motion-patterns/pattern-lifecycle";
import type { ResolvedMotionPattern } from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-types";
import {
  isDevMouseSimulationEnabled,
  normalizedPointFromMouseEvent,
} from "@/app/lib/interactive-shoulder/dev-mouse-simulation";
import {
  interactiveShoulderUi,
  resolveInteractiveShoulderRuntimeFaultMessage,
  resolveInteractiveShoulderStartError,
} from "@/app/lib/interactive-shoulder/interactive-shoulder-ui";
import {
  isDemoCameraPermissionDeniedError,
  queryDemoCameraPermissionState,
  type DemoCameraPermissionState,
} from "@/app/lib/rasq-demo/demo-camera-permission";
import { resolveHitExitTransitionMs } from "@/app/lib/interactive-shoulder/reach-the-light-motion";
import {
  MIRRORED_PREVIEW_TRANSFORM,
  toMirroredPreviewPoint,
} from "@/app/lib/interactive-shoulder/presentation-mirror";
import { registerAllBlockRunners } from "@/app/lib/interactive-shoulder/block-engine/register-all-block-runners";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "@/app/lib/interactive-shoulder/target-generator";
import type { ActiveBlockRunnerStates } from "@/app/lib/interactive-shoulder/block-engine/tick-active-block-runner";
import {
  dispatchOrchestratorCvBlock,
  resetRunnerStatesForBlockTransition,
  resolveOrchestratorBlockType,
  resolveOrchestratorHudFeedbackMode,
  type OrchestratorCvRuntimeFault,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-block-dispatch";
import {
  applyFaultPauseOnce,
  canResumeOrchestratorSession,
  shouldAdvanceOrchestratorTick,
  shouldDispatchBlockRunner,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-runtime-fault";
import { shouldFireSessionCompleteCallback } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-completion";
import {
  applyDispatchOutcomesToAdaptiveState,
  resolveAttemptCompensationObservation,
} from "@/app/lib/interactive-shoulder/adaptive/adaptive-attempt-runtime";
import { resolveAdaptiveTargetPlacement } from "@/app/lib/interactive-shoulder/adaptive/adaptive-target-placement";
import { resolveDifficultyConfigForSessionFromEnv } from "@/app/lib/interactive-shoulder/adaptive/difficulty-config-registry";
import { createAdaptiveDifficultyState } from "@/app/lib/interactive-shoulder/adaptive/adaptive-difficulty";
import type { AdaptiveDifficultyState } from "@/app/lib/interactive-shoulder/adaptive/adaptive-difficulty-types";
import type { TargetAttemptTickConfig } from "@/app/lib/interactive-shoulder/orchestrator-cv-block-dispatch";
import type { TherapeuticTarget } from "@/app/lib/interactive-shoulder/types";
import { INTERACTIVE_SHOULDER_CV_EXERCISE_ID } from "@/app/lib/interactive-shoulder/interactive-shoulder-exercise-ids";
import {
  disposeOrchestratorCvDetector,
  mountOrchestratorCvDetector,
  shouldStartOrchestratorCvCamera,
  type OrchestratorCvActiveDetectorHandle,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-detector-lifecycle";
import {
  resolveOrchestratorTherapeuticSide,
} from "@/app/lib/interactive-shoulder/resolve-interactive-shoulder-side";
import {
  resolveCaptureReadinessPayload,
  shouldDeliverCaptureReadiness,
  type CaptureReadinessPayload,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-capture-readiness";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { OrchestratorCvSessionCoreProps } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import {
  bumpOrchestratorCvInitCounter,
  traceOrchestratorCvInit,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-init-dev-trace";
import {
  shouldAdvanceOrchestratorCvOrchestratorTick,
  shouldRunOrchestratorCvRafOrchestration,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-raf-frame-policy";
import {
  logOrchestratorCvRafLoopDev,
  orchestratorHudSummaryMetricsEqual,
  patternLifecycleHudEquals,
  shouldCommitOrchestratorHudSnapshot,
  targetLifecycleHudEquals,
  type OrchestratorHudSummaryMetrics,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-raf-loop-guards";
import {
  createTargetContactConsumptionState,
  resetTargetContactConsumptionState,
  resolveTargetContactForTick,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-target-contact-handling";
import {
  evaluatePoseDetectorUiCommit,
  poseDetectorReactSnapshotUnchanged,
  type NormalizedPoseDetectorUiCommit,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-pose-detector-ui-commit";
import { logOrchestratorCvPoseSnapshotCommitDev } from "@/app/lib/interactive-shoulder/orchestrator-cv-pose-detector-snapshot-guards";
import {
  mapPatternCompletionToSessionInput,
  mapShoulderMeasuredEventToSessionInput,
  mapTargetHitToSessionInput,
} from "@/app/lib/session-orchestrator/adapters/shoulder-session-adapter";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import type { SessionOrchestratorSnapshot } from "@/app/lib/session-orchestrator/types";
import { ShoulderSessionHud } from "./ShoulderSessionHud";
import { InstructionalBlockLayer } from "./InstructionalBlockLayer";
import { CoolDownMotionGuide } from "./CoolDownMotionGuide";
import { isCoolDownBlock } from "@/app/lib/interactive-shoulder/resolve-block-display-copy";
import type { InteractiveShoulderSoundCue } from "@/app/lib/interactive-shoulder/interactive-shoulder-sounds";
import { ShoulderTargetLayer } from "./ShoulderTargetLayer";
import { TrackedHandCursor } from "./TrackedHandCursor";
import { TherapeuticPathLayer } from "./TherapeuticPathLayer";
import { ReachTheLightEnvironment } from "./ReachTheLightEnvironment";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { PatientCameraTrackingIndicator } from "./PatientCameraTrackingIndicator";
import { ReadyCountdownOverlay } from "./ReadyCountdownOverlay";
import { SessionCompleteOverlay } from "./SessionCompleteOverlay";
import { TargetSuccessPulse } from "./TargetSuccessPulse";
import { createInteractiveShoulderSoundPlayer } from "@/app/lib/interactive-shoulder/interactive-shoulder-sounds";
import { PATIENT_PRIMARY_TOUCH_MIN_CLASS } from "@/app/lib/patient-portal-touch-targets";

registerAllBlockRunners();

const PatientCameraVideoLayer = memo(function PatientCameraVideoLayer({
  videoRef,
  canvasRef,
  canvasWidth,
  canvasHeight,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasWidth: number;
  canvasHeight: number;
}) {
  return (
    <>
      {/*
        Mirrored (selfie) preview — issue #277. The patient sees themselves as in a
        mirror, which is the space every therapeutic-geometry module in this slice is
        authored in (see presentation-mirror.ts). The canvas carries the SAME transform
        because it is drawn with raw MediaPipe x and only stays registered to the video
        if both flip about the same centerline.
      */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="block h-full w-full object-cover opacity-95"
        style={{ transform: MIRRORED_PREVIEW_TRANSFORM }}
      />
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-60 mix-blend-screen"
        style={{ transform: MIRRORED_PREVIEW_TRANSFORM }}
      />
    </>
  );
});

function PreviewStack({
  videoRef,
  canvasRef,
  containerRef,
  canvasWidth,
  canvasHeight,
  overlay,
  onDevMouseMove,
  previewAriaLabel,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  overlay?: ReactNode;
  onDevMouseMove?: (event: React.MouseEvent) => void;
  previewAriaLabel: string;
}) {
  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-[12px] border border-[#1E2D42]/50 bg-[#0A0F1A] shadow-[0_8px_28px_rgba(10,15,26,0.18)]"
      style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      onMouseMove={onDevMouseMove}
      aria-label={previewAriaLabel}
    >
      <PatientCameraVideoLayer
        videoRef={videoRef}
        canvasRef={canvasRef}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
      />
      {overlay}
    </div>
  );
}

export function OrchestratorCvSessionCore({
  sessionDefinition,
  language,
  arClass = "",
  textDir = "ltr",
  prescribedSide,
  clinicalPrescribedSideRequired = false,
  onSkipped,
  onRegisterMetricsFlush,
  onRegisterCaptureConsent,
  onCaptureReadinessChange,
  onSessionComplete,
  orchestratorUiSoundEffectsEnabled = true,
  onReadyCountdownStarted,
  onMovementBlockActivated,
  onPoseDetectorSnapshot,
  leadingPreviewCompanion,
  previewMeasurementOverlay,
  onTargetAttemptStarted,
  onTargetReachConfirmed,
  onPatternReachConfirmed,
  publicDemoMovementTargetPacing,
  onDemoTargetPopAudioUnlock,
  publicDemoConsent,
  onPublicDemoCameraPathSelected,
}: OrchestratorCvSessionCoreProps) {
  const renderSeqRef = useRef(0);
  renderSeqRef.current += 1;

  const ui = useMemo(() => interactiveShoulderUi(language), [language]);
  const prefersReducedMotion = usePrefersReducedMotion();
  const hitExitTransitionMs = resolveHitExitTransitionMs(prefersReducedMotion);
  const entry = getExerciseCvRegistryEntry(INTERACTIVE_SHOULDER_CV_EXERCISE_ID);
  const profile = entry?.calibrationProfile;
  const interactiveBlock = sessionDefinition.blocks[0];
  /**
   * Memoised so the resolved side keeps a stable identity across renders. It feeds
   * the detector mount/dispose layout effect and the camera-start effect below, and
   * React compares effect dependencies with `Object.is`: a fresh object each render
   * re-ran both effects on every render, tearing down and rebuilding the pose
   * detector and re-invoking `startSession()` in a loop that never settled (#273).
   * `sessionDefinition` is referentially stable at both call sites.
   */
  const resolvedTherapeuticSide = useMemo(
    () =>
      resolveOrchestratorTherapeuticSide({
        prescribedSide,
        clinicalPrescribedSideRequired,
        blocks: sessionDefinition.blocks,
      }),
    [prescribedSide, clinicalPrescribedSideRequired, sessionDefinition.blocks],
  );
  const prescribedSideBlocked =
    clinicalPrescribedSideRequired && resolvedTherapeuticSide === null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const detectorRef = useRef<OrchestratorCvActiveDetectorHandle | null>(null);
  const orchestratorRef = useRef<SessionOrchestrator | null>(null);
  const runnerStatesRef = useRef<ActiveBlockRunnerStates>({
    instructional: createInitialInstructionalLifecycle(),
    target: createInitialTargetLifecycle(),
    pattern: null,
  });
  const targetStateRef = useRef<TargetLifecycleState>(createInitialTargetLifecycle());
  const patternStateRef = useRef<PatternLifecycleState | null>(null);
  const activeBlockIdRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const sessionStartedRef = useRef(false);
  /** Read at error time so `startSession` stays locale-independent (#286). */
  const languageRef = useRef(language);
  languageRef.current = language;
  const sessionCompleteFiredRef = useRef(false);
  const runtimeFaultRef = useRef<OrchestratorCvRuntimeFault | null>(null);
  const faultPauseAppliedRef = useRef(false);
  const devMouseRef = useRef<{ x: number; y: number } | null>(null);
  /** Latest pose sample from the detector — updated every frame, never passed to setState directly. */
  const snapshotRef = useRef<ShoulderAbductionReachPoseDetectorSnapshot | null>(null);
  const committedPoseDetectorUiRef = useRef<NormalizedPoseDetectorUiCommit | null>(null);
  const lastPoseDetectorUiCommitAtMsRef = useRef(0);
  /**
   * The last capture-readiness payload actually handed to the ancestor, and the
   * `performance.now()` at which it was handed over. Issue #276.
   *
   * Delivered from the RAF sampler when a visible pose snapshot commit occurs — not
   * from the detector callback. Together these two refs are the delivery record that
   * `shouldDeliverCaptureReadiness` reads to suppress unchanged payloads and to hold
   * the ancestor's re-render rate at the interval it had before #276. The decision
   * itself lives in orchestrator-cv-capture-readiness.ts, under test.
   */
  const lastReadinessPayloadRef = useRef<CaptureReadinessPayload | null>(null);
  const lastReadinessDeliveredAtRef = useRef(0);
  const therapeuticSideRef = useRef<ShoulderAbductionReachSide | null>(null);
  therapeuticSideRef.current = resolvedTherapeuticSide?.side ?? null;
  /**
   * SESSION-SCOPED adaptive state, or null when adaptive difficulty is not enabled for
   * this session. Held in a ref alongside the other runtime state this loop owns.
   *
   * It is deliberately NOT part of `runnerStatesRef`: that bag is rebuilt by
   * `resetRunnerStatesForBlockTransition` on every block change, and adaptation must
   * survive block transitions. It is created and reset only at the session boundary in
   * `startSession` below.
   */
  const adaptiveStateRef = useRef<AdaptiveDifficultyState | null>(null);

  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ShoulderAbductionReachPoseDetectorSnapshot | null>(null);
  const [orchestratorSnapshot, setOrchestratorSnapshot] = useState<SessionOrchestratorSnapshot | null>(null);
  const [targetState, setTargetState] = useState<TargetLifecycleState>(createInitialTargetLifecycle());
  const [patternState, setPatternState] = useState<PatternLifecycleState | null>(null);
  const [activeMotionPattern, setActiveMotionPattern] = useState<ResolvedMotionPattern | null>(null);
  const activeMotionPatternRef = useRef<ResolvedMotionPattern | null>(null);
  const [presentationProgress, setPresentationProgress] = useState<number | null>(null);
  const [runtimeFault, setRuntimeFault] = useState<OrchestratorCvRuntimeFault | null>(null);
  const [showBlockSummary, setShowBlockSummary] = useState(false);
  const [summaryMetrics, setSummaryMetrics] = useState<OrchestratorHudSummaryMetrics>({
    targets: 0,
    patterns: 0,
    reps: 0,
    durationSeconds: 0,
  });
  const [targetHitAnnouncement, setTargetHitAnnouncement] = useState<string | null>(null);
  const [hitBurstTarget, setHitBurstTarget] = useState<TherapeuticTarget | null>(null);
  const [hitBurstProgress, setHitBurstProgress] = useState<number | null>(null);
  const hitFeedbackTimeoutRef = useRef<number | null>(null);
  const soundPlayerRef = useRef(createInteractiveShoulderSoundPlayer(prefersReducedMotion));
  const previousBlockIdForSoundRef = useRef<string | null>(null);

  const [countdownActive, setCountdownActive] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => soundPlayerRef.current.isMuted());

  const orchestratorHudSnapshotRef = useRef<SessionOrchestratorSnapshot | null>(null);
  const summaryMetricsRef = useRef(summaryMetrics);
  const showBlockSummaryRef = useRef(false);
  const presentationProgressRef = useRef<number | null>(null);
  const onSessionCompleteRef = useRef(onSessionComplete);
  const onMovementBlockActivatedRef = useRef(onMovementBlockActivated);
  const onTargetAttemptStartedRef = useRef(onTargetAttemptStarted);
  const onTargetReachConfirmedRef = useRef(onTargetReachConfirmed);
  const onPatternReachConfirmedRef = useRef(onPatternReachConfirmed);
  const onPoseDetectorSnapshotRef = useRef(onPoseDetectorSnapshot);
  const onCaptureReadinessChangeRef = useRef(onCaptureReadinessChange);
  const uiRef = useRef(ui);
  onSessionCompleteRef.current = onSessionComplete;
  onMovementBlockActivatedRef.current = onMovementBlockActivated;
  onTargetAttemptStartedRef.current = onTargetAttemptStarted;
  onTargetReachConfirmedRef.current = onTargetReachConfirmed;
  onPatternReachConfirmedRef.current = onPatternReachConfirmed;
  onPoseDetectorSnapshotRef.current = onPoseDetectorSnapshot;
  onCaptureReadinessChangeRef.current = onCaptureReadinessChange;
  uiRef.current = ui;
  showBlockSummaryRef.current = showBlockSummary;
  summaryMetricsRef.current = summaryMetrics;
  presentationProgressRef.current = presentationProgress;
  const hitExitTransitionMsRef = useRef(hitExitTransitionMs);
  const publicDemoMovementTargetPacingRef = useRef(publicDemoMovementTargetPacing);
  const applyRuntimeFaultRef = useRef<
    (fault: OrchestratorCvRuntimeFault, orchestrator: SessionOrchestrator, now: number) => void
  >(() => {});
  const clearHitFeedbackRef = useRef<() => void>(() => {});
  const playOrchestratorUiSoundRef = useRef<(cue: InteractiveShoulderSoundCue) => void>(() => {});
  const startSessionRef = useRef<() => Promise<void>>(async () => {});
  const startSessionWithoutCameraRef = useRef<() => Promise<void>>(async () => {});
  const resolvedTherapeuticSideRef = useRef(resolvedTherapeuticSide);
  const rafLoopMountCountRef = useRef(0);
  const consentAcceptedForCameraRef = useRef(false);
  const skipCameraWithoutConsentRef = useRef(false);
  const lastCameraStartErrorRef = useRef<unknown>(null);
  const [demoCameraPermission, setDemoCameraPermission] = useState<DemoCameraPermissionState | null>(
    null,
  );
  const startSessionGenerationRef = useRef(0);
  const countdownActiveRef = useRef(false);
  const movementBlockActivatedRef = useRef<string | null>(null);
  const targetContactConsumptionRef = useRef(createTargetContactConsumptionState());
  const onReadyCountdownStartedRef = useRef(onReadyCountdownStarted);
  onReadyCountdownStartedRef.current = onReadyCountdownStarted;
  countdownActiveRef.current = countdownActive;
  hitExitTransitionMsRef.current = hitExitTransitionMs;
  publicDemoMovementTargetPacingRef.current = publicDemoMovementTargetPacing;
  resolvedTherapeuticSideRef.current = resolvedTherapeuticSide;

  useEffect(() => {
    const renderCount = bumpOrchestratorCvInitCounter("renders");
    if (renderCount <= 40) {
      traceOrchestratorCvInit("render", { renderCount, renderSeq: renderSeqRef.current });
    }
  });

  useEffect(() => {
    soundPlayerRef.current = createInteractiveShoulderSoundPlayer(prefersReducedMotion);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (!publicDemoConsent) return;
    void queryDemoCameraPermissionState().then(setDemoCameraPermission);
  }, [publicDemoConsent]);

  const handleSoundToggle = useCallback(() => {
    const muted = soundPlayerRef.current.toggleMuted();
    setSoundMuted(muted);
  }, []);

  const playOrchestratorUiSound = useCallback(
    (cue: InteractiveShoulderSoundCue) => {
      if (!orchestratorUiSoundEffectsEnabled) return;
      soundPlayerRef.current.play(cue);
    },
    [orchestratorUiSoundEffectsEnabled],
  );

  const handlePlaySound = useCallback(
    (cue: InteractiveShoulderSoundCue) => {
      playOrchestratorUiSound(cue);
    },
    [playOrchestratorUiSound],
  );

  const handleCountdownComplete = useCallback(() => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator) {
      orchestrator.resume(performance.now());
    }
    playOrchestratorUiSoundRef.current("sessionStart");
    setCountdownActive((active) => (active ? false : active));
  }, []);

  const handleCountdownTick = useCallback(() => {
    playOrchestratorUiSound("countdown");
  }, [playOrchestratorUiSound]);

  const clearHitFeedback = useCallback(() => {
    if (hitFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(hitFeedbackTimeoutRef.current);
      hitFeedbackTimeoutRef.current = null;
    }
    setHitBurstTarget((current) => (current === null ? current : null));
    setHitBurstProgress((current) => (current === null ? current : null));
    setTargetHitAnnouncement((current) => (current === null ? current : null));
  }, []);

  const applyRuntimeFault = useCallback(
    (fault: OrchestratorCvRuntimeFault, orchestrator: SessionOrchestrator, now: number) => {
      faultPauseAppliedRef.current = applyFaultPauseOnce(
        faultPauseAppliedRef.current,
        () => orchestrator.pause(now),
      );
      if (!runtimeFaultRef.current) {
        runtimeFaultRef.current = fault;
        setRuntimeFault(fault);
      }
    },
    [],
  );

  const handlePause = useCallback(() => {
    if (!shouldDispatchBlockRunner(runtimeFaultRef.current)) return;
    orchestratorRef.current?.pause(performance.now());
  }, []);

  const handleResume = useCallback(() => {
    if (!canResumeOrchestratorSession(runtimeFaultRef.current)) return;
    orchestratorRef.current?.resume(performance.now());
  }, []);

  useEffect(() => {
    return () => {
      if (hitFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(hitFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (readPatientCvCameraConsentFromSession()) {
      setConsentAccepted(true);
      setConsentChecked(true);
    }
  }, []);

  useEffect(() => {
    onRegisterMetricsFlush?.(() => {
      /* Shoulder interactive slice — metrics persistence deferred; flush is a no-op. */
    });
    onRegisterCaptureConsent?.(() =>
      consentAccepted && !skipCameraWithoutConsentRef.current
        ? createPatientCvCameraConsentRecord()
        : null,
    );
  }, [consentAccepted, onRegisterCaptureConsent, onRegisterMetricsFlush]);

  const reportReadiness = useCallback((snap: ShoulderAbductionReachPoseDetectorSnapshot | null) => {
    const onCaptureReadinessChange = onCaptureReadinessChangeRef.current;
    if (!onCaptureReadinessChange) return;
    const payload = resolveCaptureReadinessPayload(snap);
    const now = performance.now();
    if (
      !shouldDeliverCaptureReadiness({
        previous: lastReadinessPayloadRef.current,
        next: payload,
        nowMs: now,
        lastDeliveredAtMs: lastReadinessDeliveredAtRef.current,
      })
    ) {
      return;
    }
    lastReadinessPayloadRef.current = payload;
    lastReadinessDeliveredAtRef.current = now;
    onCaptureReadinessChange(payload);
  }, []);

  const handleOrchestratorEvent = useCallback((event: ShoulderAbductionReachMeasuredEvent) => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    orchestrator.reportInputEvent(mapShoulderMeasuredEventToSessionInput(event), event.capturedAtMs);
  }, []);
  const handleOrchestratorEventRef = useRef(handleOrchestratorEvent);
  handleOrchestratorEventRef.current = handleOrchestratorEvent;

  const ingestLiveDetectorSnapshotRef = useRef(
    (snap: ShoulderAbductionReachPoseDetectorSnapshot) => {
      bumpOrchestratorCvInitCounter("poseSnapshotLiveFrames");
      snapshotRef.current = snap;
    },
  );

  const commitPoseDetectorUiIfChangedRef = useRef((_nowMs: number) => {});
  commitPoseDetectorUiIfChangedRef.current = (nowMs: number) => {
    const evaluation = evaluatePoseDetectorUiCommit({
      live: snapshotRef.current,
      committedNormalized: committedPoseDetectorUiRef.current,
      lastCommitAtMs: lastPoseDetectorUiCommitAtMsRef.current,
      nowMs,
    });
    if (evaluation.kind === "skip") {
      if (evaluation.reason !== "no-live" && process.env.NODE_ENV !== "production") {
        logOrchestratorCvPoseSnapshotCommitDev("skip", {
          reason: evaluation.reason,
          renderSeq: renderSeqRef.current,
        });
      }
      return;
    }

    const { normalized, live } = evaluation;
    committedPoseDetectorUiRef.current = normalized;
    lastPoseDetectorUiCommitAtMsRef.current = nowMs;

    bumpOrchestratorCvInitCounter("poseSnapshotCommits");
    logOrchestratorCvPoseSnapshotCommitDev("commit", {
      renderSeq: renderSeqRef.current,
      trackingStatus: normalized.trackingStatus,
    });

    setSnapshot((current) =>
      poseDetectorReactSnapshotUnchanged(current, normalized) ? current : live,
    );
    reportReadiness(live);
    onPoseDetectorSnapshotRef.current?.(live);
  };

  const runSessionBootstrap = useCallback(
    async (withCamera: boolean) => {
      if (sessionStartedRef.current) return;
      const detector = detectorRef.current;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!profile || !video || !canvas || !detector) return;
      const generation = startSessionGenerationRef.current;
      const invokeCount = bumpOrchestratorCvInitCounter("startSessionCalls");
      traceOrchestratorCvInit("startSession-invoke", { invokeCount, generation, withCamera });
      setStarting(true);
      setStartError(null);
      lastCameraStartErrorRef.current = null;
      try {
        if (withCamera) {
          await detector.start(video, canvas);
          if (generation !== startSessionGenerationRef.current) {
            traceOrchestratorCvInit("startSession-stale-after-detector-start", { generation });
            return;
          }
        }
        if (!orchestratorRef.current) {
          orchestratorRef.current = new SessionOrchestrator(sessionDefinition);
        }
        const now = performance.now();
        const orchestrator = orchestratorRef.current;
        orchestrator.start(now);
        orchestrator.beginCalibration(now);
        orchestrator.completeCalibration(now);
        orchestrator.pause(now);
        if (generation !== startSessionGenerationRef.current) {
          traceOrchestratorCvInit("startSession-stale-after-orchestrator-pause", { generation });
          return;
        }
        setCountdownActive(true);
        onReadyCountdownStartedRef.current?.();
        previousBlockIdForSoundRef.current = null;
        movementBlockActivatedRef.current = null;
        sessionStartedRef.current = true;
        sessionCompleteFiredRef.current = false;
        const difficultyConfig = resolveDifficultyConfigForSessionFromEnv(sessionDefinition);
        adaptiveStateRef.current = difficultyConfig
          ? createAdaptiveDifficultyState(difficultyConfig)
          : null;
        runnerStatesRef.current = {
          instructional: createInitialInstructionalLifecycle(),
          target: createInitialTargetLifecycle(),
          pattern: null,
        };
        resetTargetContactConsumptionState(targetContactConsumptionRef.current);
        targetStateRef.current = createInitialTargetLifecycle();
        setTargetState(targetStateRef.current);
        patternStateRef.current = null;
        setPatternState(null);
        setActiveMotionPattern(null);
        setPresentationProgress(null);
        runtimeFaultRef.current = null;
        faultPauseAppliedRef.current = false;
        setRuntimeFault(null);
        activeBlockIdRef.current = null;
        showBlockSummaryRef.current = false;
        setShowBlockSummary(false);
        const initialSnap = orchestrator.getSnapshot(now);
        orchestratorHudSnapshotRef.current = initialSnap;
        setOrchestratorSnapshot(initialSnap);
        traceOrchestratorCvInit("startSession-complete", { generation });
      } catch (error) {
        lastCameraStartErrorRef.current = error;
        if (generation === startSessionGenerationRef.current) {
          setStartError(resolveInteractiveShoulderStartError(languageRef.current, error));
        }
      } finally {
        if (generation === startSessionGenerationRef.current) {
          setStarting(false);
        }
      }
    },
    [profile, sessionDefinition],
  );

  const startSession = useCallback(async () => {
    await runSessionBootstrap(true);
  }, [runSessionBootstrap]);

  const startSessionWithoutCamera = useCallback(async () => {
    await runSessionBootstrap(false);
  }, [runSessionBootstrap]);

  applyRuntimeFaultRef.current = applyRuntimeFault;
  clearHitFeedbackRef.current = clearHitFeedback;
  playOrchestratorUiSoundRef.current = playOrchestratorUiSound;
  startSessionRef.current = startSession;
  startSessionWithoutCameraRef.current = startSessionWithoutCamera;

  const therapeuticSideKey = resolvedTherapeuticSide?.side ?? null;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useLayoutEffect(() => {
    if (!profileRef.current) return;
    const layoutMount = bumpOrchestratorCvInitCounter("detectorLayoutMounts");
    traceOrchestratorCvInit("detector-layout-mount", { layoutMount, therapeuticSideKey });
    const sideForDetector = resolvedTherapeuticSideRef.current;
    const DetectorClass = entry!.detectorResolver();
    const detector = mountOrchestratorCvDetector<
      OrchestratorCvActiveDetectorHandle,
      ShoulderAbductionReachPoseDetectorSnapshot,
      ShoulderAbductionReachMeasuredEvent
    >(
      sideForDetector,
      (callbacks, side) => new DetectorClass(callbacks, side),
      {
        onSnapshot: (snap) => ingestLiveDetectorSnapshotRef.current(snap),
        onMeasuredEvent: (event) => handleOrchestratorEventRef.current(event),
      },
    );
    detectorRef.current = detector;
    return () => {
      const layoutCleanup = bumpOrchestratorCvInitCounter("detectorLayoutCleanups");
      traceOrchestratorCvInit("detector-layout-cleanup", { layoutCleanup });
      startSessionGenerationRef.current += 1;
      sessionStartedRef.current = false;
      snapshotRef.current = null;
      committedPoseDetectorUiRef.current = null;
      lastPoseDetectorUiCommitAtMsRef.current = 0;
      disposeOrchestratorCvDetector(detector);
      detectorRef.current = null;
      cancelAnimationFrame(rafRef.current);
    };
  }, [therapeuticSideKey]);

  useEffect(() => {
    const cameraEffectRun = bumpOrchestratorCvInitCounter("cameraStartEffectRuns");
    traceOrchestratorCvInit("camera-start-effect", { cameraEffectRun, consentAccepted });
    const shouldStart = shouldStartOrchestratorCvCamera({
      consentAccepted,
      profileAvailable: Boolean(profile),
      resolvedTherapeuticSide: resolvedTherapeuticSideRef.current,
    });
    if (!shouldStart) {
      if (!consentAccepted) {
        consentAcceptedForCameraRef.current = false;
      }
      return;
    }
    if (consentAcceptedForCameraRef.current) return;
    consentAcceptedForCameraRef.current = true;
    if (skipCameraWithoutConsentRef.current) {
      void startSessionWithoutCameraRef.current();
    } else {
      void startSessionRef.current();
    }
    return () => {
      consentAcceptedForCameraRef.current = false;
      traceOrchestratorCvInit("camera-start-effect-cleanup");
    };
  }, [consentAccepted, profile, therapeuticSideKey]);

  useEffect(() => {
    rafLoopMountCountRef.current += 1;
    logOrchestratorCvRafLoopDev("effect-mount", {
      mountCount: rafLoopMountCountRef.current,
    });
    if (rafLoopMountCountRef.current > 1 && process.env.NODE_ENV !== "production") {
      console.warn(
        "[orchestrator-cv-raf] RAF loop effect remounted — check unstable layout/camera deps",
        { mountCount: rafLoopMountCountRef.current },
      );
    }
    const loop = () => {
      const now = performance.now();
      commitPoseDetectorUiIfChangedRef.current(now);

      const orchestrator = orchestratorRef.current;
      if (orchestrator && sessionStartedRef.current) {
        const previewSnap = orchestrator.getSnapshot(now);
        const countdownActiveNow = countdownActiveRef.current;
        if (
          !shouldRunOrchestratorCvRafOrchestration({
            countdownActive: countdownActiveNow,
            snap: previewSnap,
          })
        ) {
          bumpOrchestratorCvInitCounter("rafFramesSkippedForPause");
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        const hasRuntimeFault = !shouldAdvanceOrchestratorTick(runtimeFaultRef.current);

        if (
          shouldAdvanceOrchestratorCvOrchestratorTick({
            runtimeFaultActive: hasRuntimeFault,
            countdownActive: countdownActiveNow,
            snap: previewSnap,
          })
        ) {
          orchestrator.tick(now);
        }
        const snap = orchestrator.getSnapshot(now);
        if (shouldCommitOrchestratorHudSnapshot(orchestratorHudSnapshotRef.current, snap)) {
          orchestratorHudSnapshotRef.current = snap;
          bumpOrchestratorCvInitCounter("rafHudCommits");
          setOrchestratorSnapshot(snap);
        }
        if (!hasRuntimeFault && snap.sessionState === "completed" && !showBlockSummaryRef.current) {
          const totalTargets = snap.accumulatedBlockResults.reduce(
            (sum, result) => sum + result.interaction.targetsContacted,
            0,
          );
          const totalPatterns = snap.accumulatedBlockResults.reduce(
            (sum, result) => sum + result.interaction.patternsCompleted,
            0,
          );
          const totalReps = snap.accumulatedBlockResults.reduce(
            (sum, result) => sum + result.measured.validRepetitions,
            0,
          );
          const nextSummary: OrchestratorHudSummaryMetrics = {
            targets: totalTargets || targetStateRef.current.interaction.targetsReached,
            patterns:
              totalPatterns || patternStateRef.current?.interaction.patternsCompleted || 0,
            reps: totalReps || snapshotRef.current?.primaryRepCount || 0,
            durationSeconds: Math.max(0, Math.round(snap.blockElapsedSeconds)),
          };
          if (!orchestratorHudSummaryMetricsEqual(summaryMetricsRef.current, nextSummary)) {
            summaryMetricsRef.current = nextSummary;
            setSummaryMetrics(nextSummary);
          }
          if (shouldFireSessionCompleteCallback(snap.sessionState, sessionCompleteFiredRef.current)) {
            sessionCompleteFiredRef.current = true;
            playOrchestratorUiSoundRef.current("sessionComplete");
            onSessionCompleteRef.current?.({
              sessionState: snap.sessionState,
              sessionElapsedSeconds: snap.sessionElapsedSeconds,
              accumulatedBlockResults: snap.accumulatedBlockResults,
            });
          }
          showBlockSummaryRef.current = true;
          setShowBlockSummary(true);
        }

        const currentBlock = snap.currentBlock;
        const currentBlockId = currentBlock?.blockId ?? null;
        const activeTherapeuticSide = therapeuticSideRef.current;

        if (
          activeTherapeuticSide &&
          !hasRuntimeFault &&
          currentBlockId &&
          activeBlockIdRef.current !== currentBlockId &&
          currentBlock
        ) {
          if (activeBlockIdRef.current !== null) {
            playOrchestratorUiSoundRef.current("blockComplete");
          }
          previousBlockIdForSoundRef.current = activeBlockIdRef.current;
          activeBlockIdRef.current = currentBlockId;
          if (
            (currentBlock.blockType === "movement-target" ||
              currentBlock.blockType === "movement-pattern") &&
            movementBlockActivatedRef.current !== currentBlockId
          ) {
            movementBlockActivatedRef.current = currentBlockId;
            onMovementBlockActivatedRef.current?.(currentBlockId);
          }
          clearHitFeedbackRef.current();
          if (presentationProgressRef.current !== null) {
            presentationProgressRef.current = null;
            setPresentationProgress(null);
          }
          const transition = resetRunnerStatesForBlockTransition({
            block: currentBlock,
            side: activeTherapeuticSide,
          });
          resetTargetContactConsumptionState(targetContactConsumptionRef.current);
          runnerStatesRef.current = transition.states;
          const nextTargetState = transition.states.target;
          if (!targetLifecycleHudEquals(targetStateRef.current, nextTargetState)) {
            setTargetState(nextTargetState);
          }
          targetStateRef.current = nextTargetState;
          const nextPatternState = transition.states.pattern;
          if (nextPatternState) {
            if (
              !patternStateRef.current ||
              !patternLifecycleHudEquals(patternStateRef.current, nextPatternState)
            ) {
              setPatternState(nextPatternState);
            }
          } else if (patternStateRef.current !== null) {
            setPatternState(null);
          }
          patternStateRef.current = nextPatternState;
          if (activeMotionPatternRef.current !== transition.activeMotionPattern) {
            activeMotionPatternRef.current = transition.activeMotionPattern;
            setActiveMotionPattern(transition.activeMotionPattern);
          }
          // adaptiveStateRef is intentionally NOT reset here. Adaptation is session-scoped:
          // a patient who has adapted through one block keeps that adaptation in the next.
          // Resetting it alongside the block-scoped runner states would silently discard
          // the session's adaptation at every block boundary.
          if (transition.fault) {
            applyRuntimeFaultRef.current(transition.fault, orchestrator, now);
          }
        }

        if (!activeTherapeuticSide) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        const poseSnap = snapshotRef.current;
        // Measured wrist reflected into mirrored preview space (#277) so the hit test
        // is evaluated in the SAME space the target and the marker are drawn in. The
        // dev-mouse fallback is already a preview-space point — it comes from the
        // container's own bounding rect — so it is deliberately not converted.
        const wrist =
          toMirroredPreviewPoint(poseSnap?.primaryWristNormalized) ??
          (isDevMouseSimulationEnabled() ? devMouseRef.current : null);

        if (shouldDispatchBlockRunner(runtimeFaultRef.current)) {
          // The attempt seam is supplied only while adaptive difficulty is enabled. When
          // it is not, `targetAttempt` stays undefined and dispatch behaves exactly as it
          // did before this stage — including the unconditional no-wrist skip.
          const adaptiveState = adaptiveStateRef.current;
          // CHANGE-007. Resolved every tick from the CURRENT adaptive level and the CURRENT
          // frame's geometry, and consumed by the lifecycle only at the moment it spawns.
          // With adaptive off this is `placed: false, reason: "adaptiveDisabled"` and no
          // placement key is ever added to the seam below.
          //
          // `DEFAULT_SAFE_TARGET_BOUNDS` is the same constant `dispatchOrchestratorCvBlock`
          // hands the target runner, so the position is resolved against the bounds the
          // generator will actually place within. Should those two ever diverge, the
          // generator's own clamp still owns the safety property — the placement would be
          // slightly off, never out of bounds.
          const adaptivePlacement = resolveAdaptiveTargetPlacement({
            adaptiveState,
            affectedSide: activeTherapeuticSide,
            // Same conversion as the wrist above: the placement geometry this feeds is
            // authored in mirrored preview space (#277). `reachRadiusNormalized` below
            // is a scalar distance and is mirror-invariant, so it is passed unchanged.
            shoulderAnchorNormalized: toMirroredPreviewPoint(
              poseSnap?.primaryShoulderNormalized,
            ),
            reachRadiusNormalized: poseSnap?.estimatedArmLengthNormalized ?? null,
            bounds: DEFAULT_SAFE_TARGET_BOUNDS,
          });
          const targetAttempt: TargetAttemptTickConfig | undefined = adaptiveState
            ? {
                // The engine's current window, fed back through the seam CHANGE-004 built.
                attemptTimeoutMs: adaptiveState.attemptTimeoutMs,
                // Latch true, never assert false — see resolveAttemptCompensationObservation.
                compensationObservedDuringAttempt: resolveAttemptCompensationObservation(
                  poseSnap?.compensationFlagged,
                ),
                // Position and level are supplied TOGETHER or not at all. Stamping a level
                // on a randomly placed target would claim the target sits at an angle it
                // does not; when the geometry is unavailable the honest report is that this
                // target has no placement level, and the legacy random path runs.
                ...(adaptivePlacement.placed
                  ? {
                      preferredTargetPosition: adaptivePlacement.position,
                      levelDegrees: adaptivePlacement.levelDegrees,
                    }
                  : {}),
              }
            : publicDemoMovementTargetPacingRef.current
              ? {
                  attemptTimeoutMs: publicDemoMovementTargetPacingRef.current.attemptTimeoutMs,
                }
              : undefined;

          const dispatch = dispatchOrchestratorCvBlock({
            snap,
            nowMs: now,
            wrist: wrist ?? null,
            side: activeTherapeuticSide,
            hitExitTransitionMs: hitExitTransitionMsRef.current,
            states: runnerStatesRef.current,
            activeMotionPattern: activeMotionPatternRef.current,
            ...(targetAttempt ? { targetAttempt } : {}),
          });

          if (dispatch.status === "fault") {
            applyRuntimeFaultRef.current(dispatch.fault, orchestrator, now);
          } else if (dispatch.status === "dispatched") {
            runnerStatesRef.current = dispatch.states;
            const nextTargetState = dispatch.states.target;
            if (!targetLifecycleHudEquals(targetStateRef.current, nextTargetState)) {
              setTargetState(nextTargetState);
            }
            targetStateRef.current = nextTargetState;
            if (dispatch.states.pattern) {
              const nextPatternState = dispatch.states.pattern;
              if (
                !patternStateRef.current ||
                !patternLifecycleHudEquals(patternStateRef.current, nextPatternState)
              ) {
                setPatternState(nextPatternState);
              }
              patternStateRef.current = nextPatternState;
            }
            if (dispatch.presentationProgress != null) {
              if (presentationProgressRef.current !== dispatch.presentationProgress) {
                presentationProgressRef.current = dispatch.presentationProgress;
                setPresentationProgress(dispatch.presentationProgress);
              }
            }
            for (const attemptStarted of dispatch.targetAttemptStarted) {
              onTargetAttemptStartedRef.current?.(attemptStarted);
              if (
                publicDemoMovementTargetPacingRef.current &&
                attemptStarted.sequence >
                  publicDemoMovementTargetPacingRef.current.maxTargetPresentations
              ) {
                orchestrator.reportInputEvent({ type: "movementInterrupted", capturedAtMs: now }, now);
              }
            }
            const targetContactOutcome = resolveTargetContactForTick(
              targetContactConsumptionRef.current,
              dispatch.targetContact,
              { renderSeq: renderSeqRef.current },
            );
            const processedTargetContact = targetContactOutcome.contactToProcess;
            if (processedTargetContact) {
              onTargetReachConfirmedRef.current?.(processedTargetContact);
              orchestrator.reportInputEvent(
                mapTargetHitToSessionInput(processedTargetContact),
                now,
              );
              if (
                publicDemoMovementTargetPacingRef.current &&
                (processedTargetContact.sequence ?? 0) >=
                  publicDemoMovementTargetPacingRef.current.maxTargetPresentations
              ) {
                orchestrator.reportInputEvent({ type: "movementInterrupted", capturedAtMs: now }, now);
              }
              const burstTarget = dispatch.states.target.exitingTarget;
              if (burstTarget) {
                setHitBurstTarget((current) =>
                  current?.id === burstTarget.id ? current : burstTarget,
                );
              }
              playOrchestratorUiSoundRef.current("targetHit");
              const reachAnnouncement = uiRef.current.goodReachFeedback;
              setTargetHitAnnouncement((current) =>
                current === reachAnnouncement ? current : reachAnnouncement,
              );
              if (hitFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(hitFeedbackTimeoutRef.current);
              }
              hitFeedbackTimeoutRef.current = window.setTimeout(() => {
                setHitBurstTarget(null);
                setTargetHitAnnouncement(null);
                hitFeedbackTimeoutRef.current = null;
              }, Math.max(hitExitTransitionMsRef.current, 480));
            }
            if (dispatch.patternCompleted) {
              onPatternReachConfirmedRef.current?.(dispatch.patternCompleted);
              orchestrator.reportInputEvent(
                mapPatternCompletionToSessionInput(dispatch.patternCompleted),
                now,
              );
              const nextBurstProgress = dispatch.states.pattern?.exitingProgress ?? null;
              setHitBurstProgress((current) =>
                current === nextBurstProgress ? current : nextBurstProgress,
              );
              playOrchestratorUiSoundRef.current("repetition");
              const patternAnnouncement = uiRef.current.patternPathComplete;
              setTargetHitAnnouncement((current) =>
                current === patternAnnouncement ? current : patternAnnouncement,
              );
              if (hitFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(hitFeedbackTimeoutRef.current);
              }
              hitFeedbackTimeoutRef.current = window.setTimeout(() => {
                setHitBurstProgress(null);
                setTargetHitAnnouncement(null);
                hitFeedbackTimeoutRef.current = null;
              }, Math.max(hitExitTransitionMsRef.current, 480));
            }
            // ADDITIVE adaptive consumption. Deliberately placed after every existing
            // handler above: the session-input path, the HUD and the burst feedback all
            // run exactly as before, and this reads the same facts a second time rather
            // than intercepting them. Nothing here reports to the orchestrator — there is
            // no session-input event for an expired attempt, and this stage does not
            // invent one. Runs only while adaptive difficulty is enabled.
            if (adaptiveState) {
              adaptiveStateRef.current = applyDispatchOutcomesToAdaptiveState(adaptiveState, {
                targetContact: processedTargetContact,
                targetAttemptTimeout: dispatch.targetAttemptTimeout,
              }).state;
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /**
   * The hand marker's position in mirrored preview space (#277).
   *
   * MEMOISED ON THE MEASURED REFERENCE, and that is load-bearing rather than
   * cosmetic. `TrackedHandCursor` compares `wrist` by IDENTITY in its effect
   * dependencies, and that effect is what advances the cursor's smoothing lerp and
   * pushes the motion trail. The rAF loop above calls `setOrchestratorSnapshot` with a
   * fresh object every tick, so this component re-renders at display rate (~60 Hz)
   * while the detector publishes at camera rate (~30 Hz). Mirroring inline in the JSX
   * would therefore hand the cursor a brand-new object on every render and step the
   * smoothing twice per camera frame — changing the cursor's feel and halving the
   * trail's time span, which is #276 behaviour this fix must not touch.
   *
   * `primaryWristNormalized` keeps a stable reference between publications, so this
   * memo changes identity exactly once per published measurement — the same cadence
   * the cursor saw before the mirror was introduced.
   */
  const mirroredCursorWrist = useMemo(
    () => toMirroredPreviewPoint(snapshot?.primaryWristNormalized),
    [snapshot?.primaryWristNormalized],
  );

  const acceptConsent = () => {
    if (!consentChecked) return;
    skipCameraWithoutConsentRef.current = false;
    writePatientCvCameraConsentToSession(createPatientCvCameraConsentRecord());
    setConsentAccepted(true);
    onDemoTargetPopAudioUnlock?.();
    onPublicDemoCameraPathSelected?.("camera");
  };

  const handleSkipCameraClick = () => {
    if (publicDemoConsent) {
      skipCameraWithoutConsentRef.current = true;
      setConsentAccepted(true);
      onPublicDemoCameraPathSelected?.("no_camera");
      return;
    }
    onSkipped?.();
  };

  const handleDemoRetryCamera = () => {
    setStartError(null);
    lastCameraStartErrorRef.current = null;
    consentAcceptedForCameraRef.current = false;
    skipCameraWithoutConsentRef.current = false;
    void queryDemoCameraPermissionState().then(setDemoCameraPermission);
    void startSessionRef.current();
  };

  const consentCopy = publicDemoConsent ?? {
    consentTitle: ui.consentTitle,
    consentDescription: ui.consentDescription,
    consentCheckbox: ui.consentCheckbox,
    continueCamera: ui.continueCamera,
    skipCamera: ui.skipCamera,
    browserNote: "",
    alreadyGrantedNote: "",
    deniedRecovery: ui.cameraAccessDenied,
    retryCamera: ui.continueCamera,
  };

  const showDemoPermissionDenied =
    Boolean(publicDemoConsent) &&
    (demoCameraPermission === "denied" ||
      isDemoCameraPermissionDeniedError(lastCameraStartErrorRef.current));

  const resolvedStartError =
    publicDemoConsent && startError && showDemoPermissionDenied
      ? publicDemoConsent.deniedRecovery
      : startError;

  const handleDevMouseMove = (event: React.MouseEvent) => {
    if (!isDevMouseSimulationEnabled() || snapshot?.primaryWristNormalized) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    devMouseRef.current = normalizedPointFromMouseEvent(event, rect);
  };

  if (!profile) return null;

  if (prescribedSideBlocked) {
    return (
      <div className="px-4 pb-4 pt-3" dir={textDir} lang={language}>
        <div
          className={`rounded-[10px] border border-rose-200 bg-rose-50 p-4 ${arClass}`}
          role="alert"
        >
          <p className="text-sm font-semibold text-rose-800">{ui.prescribedSideRequiredTitle}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-rose-700">
            {ui.prescribedSideRequiredMessage}
          </p>
        </div>
      </div>
    );
  }

  const canvasWidth = profile.canvasWidth;
  const canvasHeight = profile.canvasHeight;
  const hudSnapshot =
    orchestratorSnapshot ??
    ({
      sessionState: "preparing",
      blockProgress: 0,
      blockElapsedSeconds: 0,
      safetyStatus: "normal",
      isPaused: false,
      patientFeedbackState: { message: null, encouragement: null },
      currentBlock: interactiveBlock,
    } as SessionOrchestratorSnapshot);
  const currentBlockType = resolveOrchestratorBlockType(hudSnapshot.currentBlock);
  const resolvedHudFeedbackMode = resolveOrchestratorHudFeedbackMode(currentBlockType);
  const isInstructionalBlock = currentBlockType === "instructional" && !showBlockSummary;
  const isMovementPatternBlock = currentBlockType === "movement-pattern" && !showBlockSummary;
  const isMovementTargetBlock = currentBlockType === "movement-target" && !showBlockSummary;
  const runtimeFaultMessage = runtimeFault
    ? resolveInteractiveShoulderRuntimeFaultMessage(language, runtimeFault)
    : null;
  const controlsLocked = Boolean(runtimeFault);
  const showLiveStatusRail =
    !showBlockSummary &&
    !countdownActive &&
    (isInstructionalBlock || isMovementPatternBlock || isMovementTargetBlock);
  const isCoolDownInstructional =
    isInstructionalBlock && isCoolDownBlock(hudSnapshot.currentBlock?.blockId);

  return (
    <div className="px-4 pb-4 pt-3" dir={textDir} lang={language}>
      {!consentAccepted ? (
        <div className={`rounded-[10px] border border-[#E2E8E5] bg-white p-4 ${arClass}`}>
          <p className="text-sm font-semibold text-[#0A0F1A]">{consentCopy.consentTitle}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#6B7280]">{consentCopy.consentDescription}</p>
          {publicDemoConsent ? (
            <p className="mt-3 text-[12px] leading-relaxed text-[#64748B]">
              {demoCameraPermission === "granted"
                ? publicDemoConsent.alreadyGrantedNote
                : publicDemoConsent.browserNote}
            </p>
          ) : null}
          {showDemoPermissionDenied && !consentAccepted ? (
            <p className="mt-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-800" role="alert">
              {publicDemoConsent!.deniedRecovery}
            </p>
          ) : null}
          <label className={`mt-3 flex min-h-[48px] items-start gap-2 text-[12px] text-[#374151]`}>
            <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-1" />
            <span>{consentCopy.consentCheckbox}</span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-[8px] bg-[#1D9E75] px-4 text-sm font-semibold text-white disabled:opacity-50 ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
              disabled={!consentChecked}
              onClick={acceptConsent}
            >
              {consentCopy.continueCamera}
            </button>
            <button
              type="button"
              className={`rounded-[8px] border border-[#CBD5E1] bg-white px-4 text-sm font-medium text-[#374151] shadow-sm transition hover:border-[#94A3B8] hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
              onClick={handleSkipCameraClick}
            >
              {consentCopy.skipCamera}
            </button>
            {publicDemoConsent && showDemoPermissionDenied ? (
              <button
                type="button"
                className={`rounded-[8px] border border-[#CBD5E1] bg-white px-4 text-sm font-medium text-[#374151] ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
                onClick={() => void queryDemoCameraPermissionState().then(setDemoCameraPermission)}
              >
                {publicDemoConsent.retryCamera}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {resolvedTherapeuticSide?.usedFallback ? (
            <p className={`mb-2 rounded-[6px] border border-[#E2E8E5] bg-[#F9FAFB] px-2 py-1 text-[11px] text-[#6B7280] ${arClass}`}>
              {ui.therapeuticSideFallback}
            </p>
          ) : null}
          {isDevMouseSimulationEnabled() && !snapshot?.primaryWristNormalized && (
            <p className={`mb-2 rounded-[6px] border border-amber-300/40 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 ${arClass}`}>
              {ui.devMouseSimulation}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
            {leadingPreviewCompanion ? (
              <div className="w-full min-w-0 lg:w-[18%] lg:flex-none">
                {leadingPreviewCompanion}
              </div>
            ) : null}
            <div
              className={`w-full min-w-0 lg:flex-none ${leadingPreviewCompanion ? "lg:w-[60%]" : "lg:w-[78%]"}`}
            >
              <PreviewStack
                videoRef={videoRef}
                canvasRef={canvasRef}
                containerRef={containerRef}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
                previewAriaLabel={ui.cameraPreviewAriaLabel}
                onDevMouseMove={handleDevMouseMove}
                overlay={
                  <>
                    <ReachTheLightEnvironment reducedMotion={prefersReducedMotion} />
                    {!countdownActive && !showBlockSummary && isMovementTargetBlock
                      ? previewMeasurementOverlay
                      : null}
                    {!countdownActive && !showBlockSummary ? (
                      <PatientCameraTrackingIndicator
                        language={language}
                        arClass={arClass}
                        trackingStatus={snapshot?.trackingStatus}
                      />
                    ) : null}
                    {countdownActive ? (
                      <ReadyCountdownOverlay
                        language={language}
                        arClass={arClass}
                        reducedMotion={prefersReducedMotion}
                        onTick={handleCountdownTick}
                        onComplete={handleCountdownComplete}
                      />
                    ) : null}
                    {showBlockSummary ? (
                      <SessionCompleteOverlay
                        language={language}
                        arClass={arClass}
                        blocksCompleted={hudSnapshot.accumulatedBlockResults.length}
                        durationSeconds={summaryMetrics.durationSeconds}
                        targetsReached={summaryMetrics.targets}
                        patternsCompleted={summaryMetrics.patterns}
                      />
                    ) : isInstructionalBlock ? (
                      <>
                        {isCoolDownInstructional ? (
                          <CoolDownMotionGuide
                            reducedMotion={prefersReducedMotion}
                            elapsedSeconds={hudSnapshot.blockElapsedSeconds}
                          />
                        ) : null}
                        <InstructionalBlockLayer
                          language={language}
                          arClass={arClass}
                          snapshot={hudSnapshot}
                          presentationProgress={presentationProgress}
                          onPause={handlePause}
                          onResume={handleResume}
                          controlsLocked={controlsLocked}
                          soundMuted={soundMuted}
                          onSoundToggle={handleSoundToggle}
                          onPlaySound={handlePlaySound}
                          placement="strip"
                        />
                      </>
                    ) : (
                      <>
                        {isMovementPatternBlock && activeMotionPattern && patternState ? (
                          <TherapeuticPathLayer
                            pattern={activeMotionPattern}
                            lifecycle={patternState}
                            hitBurstProgress={hitBurstProgress}
                            reducedMotion={prefersReducedMotion}
                          />
                        ) : isMovementTargetBlock ? (
                          <ShoulderTargetLayer
                            target={targetState.currentTarget}
                            exitingTarget={targetState.exitingTarget}
                            hitBurstTarget={hitBurstTarget}
                            reducedMotion={prefersReducedMotion}
                          />
                        ) : null}
                        {(isMovementPatternBlock || isMovementTargetBlock) && (
                          <>
                            <TrackedHandCursor
                              wrist={
                                mirroredCursorWrist ??
                                (isDevMouseSimulationEnabled() ? devMouseRef.current : null)
                              }
                              visible={hudSnapshot.sessionState === "active" || hudSnapshot.sessionState === "safetyHold"}
                              reducedMotion={prefersReducedMotion}
                            />
                            <ShoulderSessionHud
                              language={language}
                              arClass={arClass}
                              snapshot={hudSnapshot}
                              feedbackMode={resolvedHudFeedbackMode}
                              targetInteraction={targetState.interaction}
                              patternInteraction={patternState?.interaction ?? createEmptyPatternInteractionMetrics()}
                              onPause={handlePause}
                              onResume={handleResume}
                              soundMuted={soundMuted}
                              onSoundToggle={handleSoundToggle}
                              targetHitAnnouncement={targetHitAnnouncement}
                              placement="strip"
                            />
                            {targetHitAnnouncement ? (
                              <TargetSuccessPulse message={targetHitAnnouncement} arClass={arClass} />
                            ) : null}
                          </>
                        )}
                        {runtimeFaultMessage ? (
                          <div
                            className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-[#0A0F1A]/60 p-4"
                            role="alert"
                            aria-live="assertive"
                          >
                            <p className={`max-w-md rounded-[10px] border border-rose-300/40 bg-[#0F1825]/95 px-4 py-3 text-center text-[12px] text-rose-100 ${arClass}`}>
                              <span className="font-semibold">{ui.runtimeFaultTitle}: </span>
                              {runtimeFaultMessage}
                            </p>
                          </div>
                        ) : null}
                      </>
                    )}
                  </>
                }
              />
            </div>
            {showLiveStatusRail ? (
              <div className="w-full lg:w-[22%] lg:flex-none">
                {isInstructionalBlock ? (
                  <InstructionalBlockLayer
                    language={language}
                    arClass={arClass}
                    snapshot={hudSnapshot}
                    presentationProgress={presentationProgress}
                    onPause={handlePause}
                    onResume={handleResume}
                    controlsLocked={controlsLocked}
                    soundMuted={soundMuted}
                    onSoundToggle={handleSoundToggle}
                    onPlaySound={handlePlaySound}
                    placement="rail"
                  />
                ) : (
                  <ShoulderSessionHud
                    language={language}
                    arClass={arClass}
                    snapshot={hudSnapshot}
                    feedbackMode={resolvedHudFeedbackMode}
                    targetInteraction={targetState.interaction}
                    patternInteraction={patternState?.interaction ?? createEmptyPatternInteractionMetrics()}
                    onPause={handlePause}
                    onResume={handleResume}
                    soundMuted={soundMuted}
                    onSoundToggle={handleSoundToggle}
                    targetHitAnnouncement={targetHitAnnouncement}
                    placement="rail"
                  />
                )}
              </div>
            ) : null}
          </div>
          {runtimeFaultMessage ? (
            <p
              className={`mt-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ${arClass}`}
              role="status"
              aria-live="polite"
            >
              <span className="font-semibold">{ui.runtimeFaultTitle}: </span>
              {runtimeFaultMessage}
            </p>
          ) : null}
          {starting ? (
            <p className={`mt-2 text-center text-[12px] text-[#6B7280] ${arClass}`}>{ui.startingCamera}</p>
          ) : null}
          {resolvedStartError ? (
            <div
              className={`mt-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ${arClass}`}
              role="status"
              aria-live="polite"
            >
              <p>{resolvedStartError}</p>
              {publicDemoConsent && showDemoPermissionDenied ? (
                <button
                  type="button"
                  className="mt-2 rounded-[6px] bg-[#1D9E75] px-3 py-1.5 text-[12px] font-semibold text-white"
                  onClick={handleDemoRetryCamera}
                >
                  {publicDemoConsent.retryCamera}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
