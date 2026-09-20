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
}: OrchestratorCvSessionCoreProps) {
  const ui = interactiveShoulderUi(language);
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
  const snapshotRef = useRef<ShoulderAbductionReachPoseDetectorSnapshot | null>(null);
  /**
   * The last capture-readiness payload actually handed to the ancestor, and the
   * `performance.now()` at which it was handed over. Issue #276.
   *
   * `reportReadiness` runs once per published snapshot, and #276 raised that from one
   * publication per 15 camera frames to one per frame — so this seam, the only
   * per-snapshot callback that escapes this component, had its fan-out rate multiplied
   * by fifteen as a side effect. Together these two refs are the delivery record that
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
  const [summaryMetrics, setSummaryMetrics] = useState({ targets: 0, patterns: 0, reps: 0, durationSeconds: 0 });
  const [targetHitAnnouncement, setTargetHitAnnouncement] = useState<string | null>(null);
  const [hitBurstTarget, setHitBurstTarget] = useState<TherapeuticTarget | null>(null);
  const [hitBurstProgress, setHitBurstProgress] = useState<number | null>(null);
  const hitFeedbackTimeoutRef = useRef<number | null>(null);
  const soundPlayerRef = useRef(createInteractiveShoulderSoundPlayer(prefersReducedMotion));
  const previousBlockIdForSoundRef = useRef<string | null>(null);

  const [countdownActive, setCountdownActive] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => soundPlayerRef.current.isMuted());

  useEffect(() => {
    soundPlayerRef.current = createInteractiveShoulderSoundPlayer(prefersReducedMotion);
  }, [prefersReducedMotion]);

  const handleSoundToggle = useCallback(() => {
    const muted = soundPlayerRef.current.toggleMuted();
    setSoundMuted(muted);
  }, []);

  const handlePlaySound = useCallback((cue: InteractiveShoulderSoundCue) => {
    soundPlayerRef.current.play(cue);
  }, []);

  const handleCountdownComplete = useCallback(() => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator) {
      orchestrator.resume(performance.now());
    }
    soundPlayerRef.current.play("sessionStart");
    setCountdownActive(false);
  }, []);

  const handleCountdownTick = useCallback(() => {
    soundPlayerRef.current.play("countdown");
  }, []);

  const clearHitFeedback = useCallback(() => {
    if (hitFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(hitFeedbackTimeoutRef.current);
      hitFeedbackTimeoutRef.current = null;
    }
    setHitBurstTarget(null);
    setHitBurstProgress(null);
    setTargetHitAnnouncement(null);
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
    snapshotRef.current = snapshot;
  }, [snapshot]);

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
      consentAccepted ? createPatientCvCameraConsentRecord() : null,
    );
  }, [consentAccepted, onRegisterCaptureConsent, onRegisterMetricsFlush]);

  const reportReadiness = useCallback(
    (snap: ShoulderAbductionReachPoseDetectorSnapshot | null) => {
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
        // Deliberately records nothing on a skip. Leaving the last DELIVERED payload in
        // place is what makes the next publication re-offer the current state instead of
        // treating this skipped one as already sent — a skip delays, never drops.
        return;
      }
      lastReadinessPayloadRef.current = payload;
      lastReadinessDeliveredAtRef.current = now;
      onCaptureReadinessChange(payload);
    },
    [onCaptureReadinessChange],
  );

  const handleOrchestratorEvent = useCallback((event: ShoulderAbductionReachMeasuredEvent) => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    orchestrator.reportInputEvent(mapShoulderMeasuredEventToSessionInput(event), event.capturedAtMs);
  }, []);

  const startSession = useCallback(async () => {
    if (sessionStartedRef.current) return;
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!profile || !video || !canvas || !detector) return;
    setStarting(true);
    setStartError(null);
    try {
      await detector.start(video, canvas);
      if (!orchestratorRef.current) {
        orchestratorRef.current = new SessionOrchestrator(sessionDefinition);
      }
      const now = performance.now();
      const orchestrator = orchestratorRef.current;
      orchestrator.start(now);
      orchestrator.beginCalibration(now);
      orchestrator.completeCalibration(now);
      orchestrator.pause(now);
      setCountdownActive(true);
      previousBlockIdForSoundRef.current = null;
      sessionStartedRef.current = true;
      sessionCompleteFiredRef.current = false;
      // SESSION BOUNDARY for adaptation. `startSession` is the only place a session
      // begins or begins again, so it is the only place adaptive state is built. A null
      // config — the production default — leaves adaptive behaviour off entirely.
      const difficultyConfig = resolveDifficultyConfigForSessionFromEnv(sessionDefinition);
      adaptiveStateRef.current = difficultyConfig
        ? createAdaptiveDifficultyState(difficultyConfig)
        : null;
      runnerStatesRef.current = {
        instructional: createInitialInstructionalLifecycle(),
        target: createInitialTargetLifecycle(),
        pattern: null,
      };
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
      setOrchestratorSnapshot(orchestrator.getSnapshot(now));
    } catch (error) {
      setStartError(resolveInteractiveShoulderStartError(languageRef.current, error));
    } finally {
      setStarting(false);
    }
  }, [profile, sessionDefinition]);

  const therapeuticSideKey = resolvedTherapeuticSide?.side ?? null;

  useLayoutEffect(() => {
    if (!profile) return;
    const DetectorClass = entry!.detectorResolver();
    const detector = mountOrchestratorCvDetector<
      OrchestratorCvActiveDetectorHandle,
      ShoulderAbductionReachPoseDetectorSnapshot,
      ShoulderAbductionReachMeasuredEvent
    >(
      resolvedTherapeuticSide,
      (callbacks, side) => new DetectorClass(callbacks, side),
      {
        onSnapshot: (snap) => {
          setSnapshot(snap);
          reportReadiness(snap);
        },
        onMeasuredEvent: handleOrchestratorEvent,
      },
    );
    detectorRef.current = detector;
    return () => {
      sessionStartedRef.current = false;
      disposeOrchestratorCvDetector(detector);
      detectorRef.current = null;
      cancelAnimationFrame(rafRef.current);
    };
  }, [entry, handleOrchestratorEvent, profile, reportReadiness, resolvedTherapeuticSide, therapeuticSideKey]);

  useEffect(() => {
    if (
      !shouldStartOrchestratorCvCamera({
        consentAccepted,
        profileAvailable: Boolean(profile),
        resolvedTherapeuticSide,
      })
    ) {
      return;
    }
    void startSession();
  }, [consentAccepted, profile, resolvedTherapeuticSide, startSession]);

  useEffect(() => {
    const loop = () => {
      const orchestrator = orchestratorRef.current;
      const now = performance.now();
      if (orchestrator && sessionStartedRef.current) {
        const hasRuntimeFault = !shouldAdvanceOrchestratorTick(runtimeFaultRef.current);

        if (!hasRuntimeFault) {
          orchestrator.tick(now);
        }
        const snap = orchestrator.getSnapshot(now);
        setOrchestratorSnapshot(snap);
        if (!hasRuntimeFault && snap.sessionState === "completed" && !showBlockSummary) {
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
          setSummaryMetrics({
            targets: totalTargets || targetStateRef.current.interaction.targetsReached,
            patterns:
              totalPatterns || patternStateRef.current?.interaction.patternsCompleted || 0,
            reps: totalReps || snapshotRef.current?.primaryRepCount || 0,
            durationSeconds: Math.max(0, Math.round(snap.blockElapsedSeconds)),
          });
          if (shouldFireSessionCompleteCallback(snap.sessionState, sessionCompleteFiredRef.current)) {
            sessionCompleteFiredRef.current = true;
            soundPlayerRef.current.play("sessionComplete");
            // Forwards the same local `snap` this tick already computed — no
            // new state, no new effect dependency, no change to camera-start
            // or detector mount/dispose lifecycle. See orchestrator-cv-session-types.ts.
            onSessionComplete?.({
              sessionState: snap.sessionState,
              sessionElapsedSeconds: snap.sessionElapsedSeconds,
              accumulatedBlockResults: snap.accumulatedBlockResults,
            });
          }
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
            soundPlayerRef.current.play("blockComplete");
          }
          previousBlockIdForSoundRef.current = activeBlockIdRef.current;
          activeBlockIdRef.current = currentBlockId;
          clearHitFeedback();
          setPresentationProgress(null);
          const transition = resetRunnerStatesForBlockTransition({
            block: currentBlock,
            side: activeTherapeuticSide,
          });
          runnerStatesRef.current = transition.states;
          targetStateRef.current = transition.states.target;
          setTargetState(transition.states.target);
          patternStateRef.current = transition.states.pattern;
          setPatternState(transition.states.pattern);
          setActiveMotionPattern(transition.activeMotionPattern);
          activeMotionPatternRef.current = transition.activeMotionPattern;
          // adaptiveStateRef is intentionally NOT reset here. Adaptation is session-scoped:
          // a patient who has adapted through one block keeps that adaptation in the next.
          // Resetting it alongside the block-scoped runner states would silently discard
          // the session's adaptation at every block boundary.
          if (transition.fault) {
            applyRuntimeFault(transition.fault, orchestrator, now);
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
            : undefined;

          const dispatch = dispatchOrchestratorCvBlock({
            snap,
            nowMs: now,
            wrist: wrist ?? null,
            side: activeTherapeuticSide,
            hitExitTransitionMs,
            states: runnerStatesRef.current,
            activeMotionPattern: activeMotionPatternRef.current,
            ...(targetAttempt ? { targetAttempt } : {}),
          });

          if (dispatch.status === "fault") {
            applyRuntimeFault(dispatch.fault, orchestrator, now);
          } else if (dispatch.status === "dispatched") {
            runnerStatesRef.current = dispatch.states;
            targetStateRef.current = dispatch.states.target;
            setTargetState(dispatch.states.target);
            if (dispatch.states.pattern) {
              patternStateRef.current = dispatch.states.pattern;
              setPatternState(dispatch.states.pattern);
            }
            if (dispatch.presentationProgress != null) {
              setPresentationProgress(dispatch.presentationProgress);
            }
            if (dispatch.targetContact) {
              orchestrator.reportInputEvent(
                mapTargetHitToSessionInput(dispatch.targetContact),
                now,
              );
              const burstTarget = dispatch.states.target.exitingTarget;
              if (burstTarget) {
                setHitBurstTarget(burstTarget);
              }
              soundPlayerRef.current.play("targetHit");
              setTargetHitAnnouncement(ui.goodReachFeedback);
              if (hitFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(hitFeedbackTimeoutRef.current);
              }
              hitFeedbackTimeoutRef.current = window.setTimeout(() => {
                setHitBurstTarget(null);
                setTargetHitAnnouncement(null);
                hitFeedbackTimeoutRef.current = null;
              }, Math.max(hitExitTransitionMs, 480));
            }
            if (dispatch.patternCompleted) {
              orchestrator.reportInputEvent(
                mapPatternCompletionToSessionInput(dispatch.patternCompleted),
                now,
              );
              setHitBurstProgress(dispatch.states.pattern?.exitingProgress ?? null);
              soundPlayerRef.current.play("repetition");
              setTargetHitAnnouncement(ui.patternPathComplete);
              if (hitFeedbackTimeoutRef.current !== null) {
                window.clearTimeout(hitFeedbackTimeoutRef.current);
              }
              hitFeedbackTimeoutRef.current = window.setTimeout(() => {
                setHitBurstProgress(null);
                setTargetHitAnnouncement(null);
                hitFeedbackTimeoutRef.current = null;
              }, Math.max(hitExitTransitionMs, 480));
            }
            // ADDITIVE adaptive consumption. Deliberately placed after every existing
            // handler above: the session-input path, the HUD and the burst feedback all
            // run exactly as before, and this reads the same facts a second time rather
            // than intercepting them. Nothing here reports to the orchestrator — there is
            // no session-input event for an expired attempt, and this stage does not
            // invent one. Runs only while adaptive difficulty is enabled.
            if (adaptiveState) {
              adaptiveStateRef.current = applyDispatchOutcomesToAdaptiveState(adaptiveState, {
                targetContact: dispatch.targetContact,
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
  }, [
    applyRuntimeFault,
    clearHitFeedback,
    hitExitTransitionMs,
    showBlockSummary,
    onSessionComplete,
    ui.patternPathComplete,
    ui.targetReached,
  ]);

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
    writePatientCvCameraConsentToSession(createPatientCvCameraConsentRecord());
    setConsentAccepted(true);
  };

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
          <p className="text-sm font-semibold text-[#0A0F1A]">{ui.consentTitle}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#6B7280]">{ui.consentDescription}</p>
          <label className={`mt-3 flex min-h-[48px] items-start gap-2 text-[12px] text-[#374151]`}>
            <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-1" />
            <span>{ui.consentCheckbox}</span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-[8px] bg-[#1D9E75] px-4 text-sm font-semibold text-white disabled:opacity-50 ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
              disabled={!consentChecked}
              onClick={acceptConsent}
            >
              {ui.continueCamera}
            </button>
            <button
              type="button"
              className={`rounded-[8px] border border-[#CBD5E1] bg-white px-4 text-sm font-medium text-[#374151] shadow-sm transition hover:border-[#94A3B8] hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75] ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
              onClick={onSkipped}
            >
              {ui.skipCamera}
            </button>
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
            <div className="w-full min-w-0 lg:w-[78%] lg:flex-none">
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
          {startError ? (
            <p
              className={`mt-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ${arClass}`}
              role="status"
              aria-live="polite"
            >
              {startError}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
