"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BatteryCameraSession, type BatteryCameraSnapshot } from "@/app/lib/remote-upper-limb-battery/battery-camera-session";
import {
  getBatteryTestOrientation,
} from "@/app/lib/remote-upper-limb-battery/battery-orientation";
import {
  shouldSpeakSideViewSetupInPositioning,
  sideViewSetupSpeechScope,
} from "@/app/lib/remote-upper-limb-battery/battery-setup-voice-flow";
import {
  createBatteryTestProcessor,
  createPreviewPositionProcessor,
  type BatteryTestProcessor,
} from "@/app/lib/remote-upper-limb-battery/battery-frame-processors";
import {
  beginBatteryCountdown,
  buildBatteryPayload,
  buildFunctionalReachTestResult,
  buildRepTestResult,
  cancelBatteryAssessment,
  completeBatteryTest,
  completeSideReposition,
  createBatteryOrchestratorState,
  getActiveBatteryTestId,
  getActiveBatteryTestRequiredReps,
  markBatterySubmitFailed,
  markBatterySubmitting,
  recordBatteryRepCompleted,
  retryCurrentBatteryTest,
  setBatteryTrackingReady,
  startBatteryAssessment,
  tickBatteryCountdown,
  type BatteryOrchestratorState,
} from "@/app/lib/remote-upper-limb-battery/battery-orchestrator";
import {
  getBatteryOverviewLines,
  getHoldStillStatus,
  getInitialPositionInstruction,
  getMovementInstruction,
  getPositioningStatus,
  getRepositionInstruction,
  getRepositionProgressLabel,
  getBatteryFinalTestSavingStatus,
  getBatterySubmitFailedStatus,
  getTestProgressLabel,
  getTestSetupInstruction,
  getTrackingLostStatus,
} from "@/app/lib/remote-upper-limb-battery/battery-patient-copy";
import {
  getBatterySpeechLang,
  cancelBatterySpeech,
  resetBatterySpeech,
  resetBatterySpeechForTest,
  resolveBatteryRepCountSpeechCue,
  resolveBatteryTestStartBoothVoiceCue,
  resolveBatteryTestStartSpeechCue,
  speakBatteryCue,
  speakBatteryTestCompleted,
} from "@/app/lib/remote-upper-limb-battery/battery-speech";
import { boothVoicePublicSrc } from "@/app/lib/booth/booth-voice-manifest";
import {
  preloadBatteryBoothVoiceAssets,
  resetBoothVoiceGuidance,
} from "@/app/lib/booth/booth-voice-guidance";
import { MovementFocusAnatomyCard } from "@/app/components/patient/remote-upper-limb-battery/MovementFocusAnatomyCard";
import {
  formatResolvedPrescribedSideDevLabel,
  resolveBatteryPrescribedSideForPatientDisplay,
} from "@/app/lib/remote-upper-limb-battery/battery-prescribed-side";
import type { BatteryPrescribedSide } from "@/app/lib/remote-upper-limb-battery/battery-prescribed-side";
import type { RemoteUpperLimbBatteryPayload } from "@/app/lib/remote-upper-limb-battery/types";
import {
  isBatteryProcessorTrackingUsable,
  resolveBatteryTrackingRejection,
} from "@/app/lib/remote-upper-limb-battery/battery-tracking";

const POSITION_STABLE_MS = 1000;
const COUNTDOWN_INTERVAL_MS = 1000;
const IS_DEV = process.env.NODE_ENV === "development";

type RemoteUpperLimbBatterySessionProps = {
  prescribedSide: BatteryPrescribedSide;
  disabled?: boolean;
  onBatteryComplete: (payload: RemoteUpperLimbBatteryPayload) => void;
  onCancel?: () => void;
  /** Set when parent submit fails so the session can show a recovery state. */
  batterySubmitError?: string | null;
};

function isTrackingUsable(snapshot: BatteryCameraSnapshot | null): boolean {
  return isBatteryProcessorTrackingUsable(snapshot?.processor);
}

export function RemoteUpperLimbBatterySession({
  prescribedSide,
  disabled = false,
  onBatteryComplete,
  onCancel,
  batterySubmitError = null,
}: RemoteUpperLimbBatterySessionProps) {
  const resolvedPrescribedSide = resolveBatteryPrescribedSideForPatientDisplay(prescribedSide, false);
  const [orchestrator, setOrchestrator] = useState<BatteryOrchestratorState>(
    createBatteryOrchestratorState,
  );
  const [cameraSnapshot, setCameraSnapshot] = useState<BatteryCameraSnapshot | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [assessmentStarted, setAssessmentStarted] = useState(false);
  const [holdStillVisible, setHoldStillVisible] = useState(false);
  const [repositionReady, setRepositionReady] = useState(false);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<BatteryCameraSession | null>(null);
  const processorRef = useRef<BatteryTestProcessor>(createPreviewPositionProcessor(resolvedPrescribedSide));
  const stableSinceRef = useRef<number | null>(null);
  const lastProcessorRepRef = useRef(0);
  const finalizedTestIndexRef = useRef(-1);
  const testProcessorArmedRef = useRef(false);
  const testStartCueSpokenRef = useRef(false);
  const repositionCueSpokenRef = useRef(false);
  const sideViewSetupCueSpokenRef = useRef(false);
  const finalTestSavingCueSpokenRef = useRef(false);
  const onBatteryCompleteRef = useRef(onBatteryComplete);

  const speakGuidedBatteryCue = useCallback(
    (
      cue: Parameters<typeof speakBatteryCue>[0],
      scope?: string,
      options?: { allowRepeat?: boolean; skipCooldown?: boolean },
    ) => {
      if (!voiceGuidanceEnabled) return false;
      return speakBatteryCue(cue, resolvedPrescribedSide, scope, {
        ...options,
        muted: !voiceGuidanceEnabled,
      });
    },
    [resolvedPrescribedSide, voiceGuidanceEnabled],
  );

  useEffect(() => {
    onBatteryCompleteRef.current = onBatteryComplete;
  }, [onBatteryComplete]);

  const activeTestId = getActiveBatteryTestId(orchestrator);
  const requiredReps = getActiveBatteryTestRequiredReps(orchestrator);
  const activeOrientation = getBatteryTestOrientation(activeTestId);
  const previewActive = cameraSnapshot?.previewActive ?? false;
  const positionReady = previewActive && isTrackingUsable(cameraSnapshot);
  const trackingLost =
    assessmentStarted &&
    orchestrator.phase !== "idle" &&
    orchestrator.phase !== "assessment_completed" &&
    orchestrator.phase !== "submitting" &&
    orchestrator.phase !== "submit_failed" &&
    !isTrackingUsable(cameraSnapshot);

  const processorSnapshot = cameraSnapshot?.processor;
  const trackingRejection = resolveBatteryTrackingRejection(processorSnapshot);
  const landmarkDebug = processorSnapshot?.landmarkVisibility;

  const overviewLines = useMemo(() => getBatteryOverviewLines(resolvedPrescribedSide), [resolvedPrescribedSide]);

  const bindProcessor = useCallback((processor: BatteryTestProcessor) => {
    processorRef.current = processor;
    cameraRef.current?.setFrameProcessor((landmarks, context) =>
      processorRef.current.processFrame(landmarks, context),
    );
  }, []);

  const bindPreviewProcessor = useCallback(() => {
    bindProcessor(createPreviewPositionProcessor(resolvedPrescribedSide));
  }, [bindProcessor, resolvedPrescribedSide]);

  useEffect(() => {
    const camera = new BatteryCameraSession({
      onSnapshot: (snapshot) => setCameraSnapshot(snapshot),
    });
    cameraRef.current = camera;
    camera.setMotionGuidanceSide(resolvedPrescribedSide);
    bindPreviewProcessor();
    preloadBatteryBoothVoiceAssets();

    return () => {
      resetBatterySpeech();
      resetBoothVoiceGuidance();
      camera.stop();
      cameraRef.current = null;
    };
  }, [bindPreviewProcessor, resolvedPrescribedSide]);

  const armActiveTestProcessor = useCallback(
    (testId: ReturnType<typeof getActiveBatteryTestId>) => {
      if (!testProcessorArmedRef.current) {
        const processor = createBatteryTestProcessor(testId, resolvedPrescribedSide);
        processor.reset();
        bindProcessor(processor);
        processor.beginMovementTracking();
        lastProcessorRepRef.current = 0;
        testProcessorArmedRef.current = true;
      }
      if (!testStartCueSpokenRef.current) {
        const startCue = resolveBatteryTestStartSpeechCue(testId);
        const boothCueId = resolveBatteryTestStartBoothVoiceCue(
          testId,
          resolvedPrescribedSide,
          getBatterySpeechLang(),
        );
        const audioUrl = boothCueId ? boothVoicePublicSrc(boothCueId) : null;
        const played = speakGuidedBatteryCue(startCue, `${testId}-start`);
        if (IS_DEV) {
          console.info("[battery-test-start-voice]", {
            testId,
            phase: "test_active",
            speechCue: startCue,
            boothCueId,
            lang: getBatterySpeechLang(),
            audioUrl,
            played,
          });
        }
        if (played) {
          testStartCueSpokenRef.current = true;
        }
      }
    },
    [bindProcessor, resolvedPrescribedSide, speakGuidedBatteryCue],
  );

  const handleStartCamera = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || cameraStarting || previewActive) return;
    setCameraStarting(true);
    setCameraError(null);
    try {
      await cameraRef.current?.start(videoRef.current, canvasRef.current);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Could not start the camera.");
    } finally {
      setCameraStarting(false);
    }
  }, [cameraStarting, previewActive]);

  const handleStartAssessment = useCallback(() => {
    if (!positionReady || disabled || assessmentStarted) return;
    resetBatterySpeech();
    setAssessmentStarted(true);
    stableSinceRef.current = null;
    finalizedTestIndexRef.current = -1;
    testProcessorArmedRef.current = false;
    testStartCueSpokenRef.current = false;
    repositionCueSpokenRef.current = false;
    sideViewSetupCueSpokenRef.current = false;
    finalTestSavingCueSpokenRef.current = false;
    setRepositionReady(false);
    setOrchestrator(startBatteryAssessment(createBatteryOrchestratorState()));
    bindPreviewProcessor();
    if (voiceGuidanceEnabled) {
      speakGuidedBatteryCue("face-camera-setup", "assessment");
    }
  }, [
    assessmentStarted,
    bindPreviewProcessor,
    disabled,
    positionReady,
    speakGuidedBatteryCue,
    resolvedPrescribedSide,
    voiceGuidanceEnabled,
  ]);

  const handleRetryCurrentTest = useCallback(() => {
    resetBatterySpeechForTest();
    stableSinceRef.current = null;
    setHoldStillVisible(false);
    setRepositionReady(false);
    repositionCueSpokenRef.current = false;
    lastProcessorRepRef.current = 0;
    testProcessorArmedRef.current = false;
    testStartCueSpokenRef.current = false;
    sideViewSetupCueSpokenRef.current = false;
    if (orchestrator.phase === "reposition_side") {
      finalizedTestIndexRef.current = 0;
    } else {
      finalizedTestIndexRef.current = orchestrator.testIndex - 1;
    }
    bindPreviewProcessor();
    setOrchestrator((current) => retryCurrentBatteryTest(current));
  }, [bindPreviewProcessor, orchestrator.phase, orchestrator.testIndex]);

  const handleCancelAssessment = useCallback(() => {
    resetBatterySpeech();
    resetBoothVoiceGuidance();
    setAssessmentStarted(false);
    setHoldStillVisible(false);
    setRepositionReady(false);
    repositionCueSpokenRef.current = false;
    stableSinceRef.current = null;
    finalizedTestIndexRef.current = -1;
    testProcessorArmedRef.current = false;
    testStartCueSpokenRef.current = false;
    sideViewSetupCueSpokenRef.current = false;
    setOrchestrator(cancelBatteryAssessment(createBatteryOrchestratorState()));
    bindPreviewProcessor();
    onCancel?.();
  }, [bindPreviewProcessor, onCancel]);

  useEffect(() => {
    if (!assessmentStarted) return;
    const processor = cameraSnapshot?.processor;
    if (!processor) return;

    setOrchestrator((current) => setBatteryTrackingReady(current, processor.trackingReady));

    if (trackingLost) {
      stableSinceRef.current = null;
      setHoldStillVisible(false);
      setRepositionReady(false);
      return;
    }

    if (orchestrator.phase === "reposition_side") {
      if (!repositionCueSpokenRef.current) {
        repositionCueSpokenRef.current = true;
        speakGuidedBatteryCue("rest-before-next", "reposition-rest");
        speakGuidedBatteryCue("reposition-side", "reposition");
      }

      const now = performance.now();
      if (stableSinceRef.current === null) {
        stableSinceRef.current = now;
      } else if (now - stableSinceRef.current >= POSITION_STABLE_MS) {
        if (!repositionReady) {
          setRepositionReady(true);
          stableSinceRef.current = now;
        } else if (now - stableSinceRef.current >= 600) {
          setOrchestrator((current) => {
            if (current.phase !== "reposition_side") return current;
            const next = completeSideReposition(current);
            bindPreviewProcessor();
            testProcessorArmedRef.current = false;
            resetBatterySpeechForTest(false);
            stableSinceRef.current = null;
            setHoldStillVisible(false);
            setRepositionReady(false);
            return next;
          });
        }
      }
      return;
    }

    if (orchestrator.phase === "positioning") {
      if (
        shouldSpeakSideViewSetupInPositioning(
          orchestrator.phase,
          activeTestId,
          sideViewSetupCueSpokenRef.current,
        )
      ) {
        sideViewSetupCueSpokenRef.current = true;
        speakGuidedBatteryCue("side-view-setup", sideViewSetupSpeechScope(activeTestId));
      }

      const now = performance.now();
      if (stableSinceRef.current === null) {
        stableSinceRef.current = now;
        setHoldStillVisible(true);
        if (activeTestId !== "functionalReach" && activeTestId !== "shoulderAbduction") {
          speakGuidedBatteryCue("stand-still", `position-${activeTestId}`);
        }
      } else if (now - stableSinceRef.current >= POSITION_STABLE_MS) {
        setHoldStillVisible(true);
        setOrchestrator((current) => beginBatteryCountdown(current, 3));
        speakGuidedBatteryCue("countdown-three", `countdown-${activeTestId}`);
      }
    }
  }, [
    activeTestId,
    assessmentStarted,
    bindPreviewProcessor,
    cameraSnapshot,
    orchestrator.phase,
    resolvedPrescribedSide,
    trackingLost,
  ]);

  useEffect(() => {
    if (orchestrator.phase !== "countdown" || trackingLost) return;
    const timer = window.setTimeout(() => {
      setOrchestrator((current) => {
        if (current.phase !== "countdown" || current.countdown === null) return current;
        if (current.countdown === 3) {
          speakGuidedBatteryCue("countdown-two", `countdown-${activeTestId}`);
        } else if (current.countdown === 2) {
          speakGuidedBatteryCue("countdown-one", `countdown-${activeTestId}`);
        }
        return tickBatteryCountdown(current);
      });
    }, COUNTDOWN_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeTestId, orchestrator.countdown, orchestrator.phase, resolvedPrescribedSide, trackingLost]);

  useEffect(() => {
    if (!assessmentStarted) return;
    if (orchestrator.phase !== "test_active") return;
    if (testProcessorArmedRef.current && testStartCueSpokenRef.current) return;
    armActiveTestProcessor(activeTestId);
  }, [activeTestId, armActiveTestProcessor, assessmentStarted, orchestrator.phase, voiceGuidanceEnabled]);

  useEffect(() => {
    if (!assessmentStarted || !voiceGuidanceEnabled || !trackingLost) return;
    speakGuidedBatteryCue("tracking-lost", "tracking", { allowRepeat: true });
  }, [assessmentStarted, speakGuidedBatteryCue, trackingLost, voiceGuidanceEnabled]);

  useEffect(() => {
    if (orchestrator.phase !== "test_active" || trackingLost) return;
    const processor = cameraSnapshot?.processor;
    if (!processor?.movementTrackingEnabled) return;

    if (processor.repCount > lastProcessorRepRef.current) {
      const completed = processor.repCount;
      lastProcessorRepRef.current = completed;
      if (IS_DEV) {
        console.info("[battery-rep]", {
          testId: activeTestId,
          orchestratorPhase: orchestrator.phase,
          processorPhase: processor.movementPhase,
          currentAngleDeg: processor.currentAngleDeg,
          repCount: completed,
          reason: processor.lastRepAcceptReason,
          trackingEnabled: processor.movementTrackingEnabled,
        });
      }
      const cue = resolveBatteryRepCountSpeechCue(completed, requiredReps, activeTestId);
      if (cue) {
        if (cue === "test-completed") {
          if (finalTestSavingCueSpokenRef.current) {
            setOrchestrator((current) => recordBatteryRepCompleted(current, processor.lastRepPeak));
            return;
          }
          cancelBatterySpeech();
          finalTestSavingCueSpokenRef.current = true;
          speakGuidedBatteryCue(cue, "functionalReach-final-saving", { skipCooldown: true });
        } else {
          speakGuidedBatteryCue(cue, `${activeTestId}-rep-${completed}`);
        }
      }
      setOrchestrator((current) => recordBatteryRepCompleted(current, processor.lastRepPeak));
    }
  }, [
    activeTestId,
    cameraSnapshot?.processor,
    orchestrator.phase,
    requiredReps,
    resolvedPrescribedSide,
    trackingLost,
  ]);

  useEffect(() => {
    if (orchestrator.phase !== "test_completed") return;
    if (finalizedTestIndexRef.current === orchestrator.testIndex) return;

    const processor = cameraSnapshot?.processor;
    if (!processor) return;

    finalizedTestIndexRef.current = orchestrator.testIndex;
    const trackingQuality = processor.trackingQuality;

    const result =
      activeTestId === "functionalReach"
        ? buildFunctionalReachTestResult({
            peakReachExtent: processor.peakReachExtent,
            trackingQuality,
          })
        : buildRepTestResult({
            testId: activeTestId as "shoulderAbduction" | "shoulderFlexion" | "elbowFlexion",
            repsCompleted: Math.max(orchestrator.repsCompleted, processor.repCount),
            repsRequired: requiredReps,
            peakAnglesDeg: processor.completedPeaksDeg,
            trackingQuality,
          });

    speakBatteryTestCompleted(activeTestId, resolvedPrescribedSide);

    setOrchestrator((current) => {
      const next = completeBatteryTest(current, result);
      if (next.phase === "reposition_side" || next.phase === "positioning") {
        bindPreviewProcessor();
        testProcessorArmedRef.current = false;
        testStartCueSpokenRef.current = false;
        repositionCueSpokenRef.current = false;
        sideViewSetupCueSpokenRef.current = false;
        setRepositionReady(false);
        resetBatterySpeechForTest(false);
        stableSinceRef.current = null;
        setHoldStillVisible(false);
      }
      return next;
    });
  }, [
    activeTestId,
    bindPreviewProcessor,
    cameraSnapshot?.processor,
    orchestrator.phase,
    orchestrator.repsCompleted,
    orchestrator.testIndex,
    requiredReps,
    resolvedPrescribedSide,
  ]);

  useEffect(() => {
    if (!batterySubmitError) return;
    setOrchestrator((current) =>
      current.phase === "submitting" || current.phase === "assessment_completed"
        ? markBatterySubmitFailed(current)
        : current,
    );
  }, [batterySubmitError]);

  useEffect(() => {
    if (orchestrator.phase !== "assessment_completed" || orchestrator.submitAttempted) return;
    const payload = buildBatteryPayload({
      testedSide: resolvedPrescribedSide,
      results: orchestrator.results,
    });
    if (voiceGuidanceEnabled && !finalTestSavingCueSpokenRef.current) {
      speakGuidedBatteryCue("assessment-completed", "assessment-done");
    }
    setOrchestrator((current) => markBatterySubmitting(current));
    onBatteryCompleteRef.current(payload);
  }, [
    orchestrator.phase,
    orchestrator.results,
    orchestrator.submitAttempted,
    speakGuidedBatteryCue,
    resolvedPrescribedSide,
    voiceGuidanceEnabled,
  ]);

  const speechLang = getBatterySpeechLang();
  const finalTestSavingActive =
    orchestrator.testIndex === 3 &&
    (orchestrator.phase === "test_completed" ||
      orchestrator.phase === "assessment_completed" ||
      orchestrator.phase === "submitting");

  const statusLine = useMemo(() => {
    if (!assessmentStarted) {
      return getInitialPositionInstruction(resolvedPrescribedSide);
    }
    if (orchestrator.phase === "submit_failed") {
      return getBatterySubmitFailedStatus(speechLang);
    }
    if (finalTestSavingActive) {
      return getBatteryFinalTestSavingStatus(speechLang);
    }
    if (trackingLost) {
      return getTrackingLostStatus(resolvedPrescribedSide);
    }
    if (orchestrator.phase === "reposition_side") {
      if (repositionReady) return "Position detected";
      return getRepositionInstruction(resolvedPrescribedSide);
    }
    if (orchestrator.phase === "positioning") {
      const setup = getTestSetupInstruction(activeTestId, resolvedPrescribedSide);
      if (setup) return setup;
    }
    if (holdStillVisible && orchestrator.phase === "positioning") {
      return getHoldStillStatus();
    }
    if (orchestrator.phase === "countdown" && orchestrator.countdown !== null) {
      return String(orchestrator.countdown);
    }
    if (
      orchestrator.phase === "test_active" ||
      orchestrator.phase === "test_completed" ||
      orchestrator.phase === "positioning"
    ) {
      return getMovementInstruction(activeTestId, resolvedPrescribedSide);
    }
    return getPositioningStatus(resolvedPrescribedSide, positionReady);
  }, [
    activeOrientation,
    activeTestId,
    assessmentStarted,
    finalTestSavingActive,
    holdStillVisible,
    orchestrator.countdown,
    orchestrator.phase,
    positionReady,
    repositionReady,
    resolvedPrescribedSide,
    speechLang,
    trackingLost,
  ]);

  const progressLabel = useMemo(() => {
    if (!assessmentStarted) return null;
    if (orchestrator.phase === "submit_failed") {
      return getBatterySubmitFailedStatus(speechLang);
    }
    if (finalTestSavingActive) {
      return getBatteryFinalTestSavingStatus(speechLang);
    }
    if (orchestrator.phase === "reposition_side") {
      return getRepositionProgressLabel();
    }
    const repsForLabel =
      orchestrator.phase === "test_completed"
        ? requiredReps
        : Math.max(orchestrator.repsCompleted, 0);
    return getTestProgressLabel(
      orchestrator.testIndex,
      activeTestId,
      repsForLabel,
      requiredReps,
      resolvedPrescribedSide,
    );
  }, [
    activeTestId,
    assessmentStarted,
    orchestrator.phase,
    orchestrator.repsCompleted,
    orchestrator.testIndex,
    repositionReady,
    requiredReps,
    resolvedPrescribedSide,
    finalTestSavingActive,
    speechLang,
  ]);

  const showRecoveryControls =
    assessmentStarted &&
    orchestrator.phase !== "assessment_completed" &&
    orchestrator.phase !== "submitting" &&
    orchestrator.phase !== "submit_failed" &&
    !finalTestSavingActive;

  return (
    <section className="mt-6">
      {IS_DEV ? (
        <p className="mb-3 text-xs font-medium text-white/40">
          Resolved prescribed side: {formatResolvedPrescribedSideDevLabel(resolvedPrescribedSide)}
        </p>
      ) : null}
      {!assessmentStarted ? (
        <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
          <h2 className="text-lg font-bold text-white">Remote Upper-Limb Assessment</h2>
          <p className="mt-2 text-sm text-white/55">Tests:</p>
          <ul className="mt-2 space-y-1 text-sm text-white/70">
            {overviewLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="overflow-hidden rounded-[10px] border border-[#1E2D42] bg-black">
          <div className="relative mx-auto aspect-[4/3] w-full max-w-xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
              aria-hidden
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {previewActive &&
            assessmentStarted &&
            !trackingLost &&
            isTrackingUsable(cameraSnapshot) ? (
              <span
                className="absolute left-3 top-3 rounded-[5px] bg-black/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5DCAA5]"
              >
                Motion guidance active
              </span>
            ) : null}
          </div>
        </div>
        <MovementFocusAnatomyCard
          activeTestId={assessmentStarted ? activeTestId : null}
          prescribedSide={resolvedPrescribedSide}
        />
      </div>

      {cameraError ? (
        <p className="mt-3 text-sm text-rose-200">{cameraError}</p>
      ) : null}

      <div
        className={`mt-4 rounded-[10px] border p-4 ${
          finalTestSavingActive
            ? "border-[#1D9E75]/40 bg-[#1D9E75]/10"
            : orchestrator.phase === "submit_failed"
              ? "border-rose-400/30 bg-rose-400/5"
              : "border-[#1E2D42] bg-[#0F1825]"
        }`}
      >
        {progressLabel ? (
          <p className="whitespace-pre-line text-sm font-semibold text-[#1D9E75]">{progressLabel}</p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed text-white/70">{statusLine}</p>
        {batterySubmitError && orchestrator.phase === "submit_failed" ? (
          <p className="mt-3 text-sm text-rose-200">{batterySubmitError}</p>
        ) : null}
        {assessmentStarted && activeTestId === "functionalReach" ? (
          <p className="mt-2 text-xs leading-relaxed text-white/45">
            Keep your feet still. Stepping is not automatically measured in this release.
          </p>
        ) : null}
      </div>

      {IS_DEV && assessmentStarted && processorSnapshot ? (
        <div className="mt-3 rounded-[7px] border border-dashed border-white/15 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-white/45">
          <p>dev tracking — not shown to patients in production</p>
          <p>resolvedPrescribedSide: {resolvedPrescribedSide}</p>
          <p>orchestrator phase: {orchestrator.phase}</p>
          <p>processor phase: {processorSnapshot.movementPhase}</p>
          <p>
            current angle:{" "}
            {processorSnapshot.currentAngleDeg === null
              ? "n/a"
              : `${processorSnapshot.currentAngleDeg.toFixed(1)}°`}
          </p>
          <p>repCount: {processorSnapshot.repCount}</p>
          <p>tracking armed: {String(processorSnapshot.movementTrackingEnabled)}</p>
          <p>rep accept reason: {processorSnapshot.lastRepAcceptReason ?? "none yet"}</p>
          <p>trackingReady: {String(processorSnapshot.trackingReady)}</p>
          <p>trackingQuality: {processorSnapshot.trackingQuality}</p>
          <p>rejection: {trackingRejection}</p>
          {landmarkDebug ? (
            <>
              <p>
                right shoulder/elbow/wrist:{" "}
                {landmarkDebug.right.shoulder.toFixed(2)} / {landmarkDebug.right.elbow.toFixed(2)} /{" "}
                {landmarkDebug.right.wrist.toFixed(2)}
              </p>
              <p>
                left shoulder/elbow/wrist:{" "}
                {landmarkDebug.left.shoulder.toFixed(2)} / {landmarkDebug.left.elbow.toFixed(2)} /{" "}
                {landmarkDebug.left.wrist.toFixed(2)}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[#1E2D42] bg-[#0B1220] accent-[#1D9E75]"
            checked={voiceGuidanceEnabled}
            onChange={(event) => setVoiceGuidanceEnabled(event.target.checked)}
          />
          Voice guidance
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!previewActive ? (
          <button
            type="button"
            disabled={disabled || cameraStarting}
            onClick={() => void handleStartCamera()}
            className="rounded-[7px] bg-[#1D9E75] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cameraStarting ? "Starting camera…" : "Start Camera"}
          </button>
        ) : null}

        {previewActive && !assessmentStarted ? (
          <button
            type="button"
            disabled={disabled || !positionReady}
            onClick={handleStartAssessment}
            className="rounded-[7px] bg-[#1D9E75] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {positionReady ? "Start Assessment" : "Waiting for position…"}
          </button>
        ) : null}

        {previewActive && !assessmentStarted && positionReady ? (
          <span className="self-center text-sm text-[#1D9E75]">Position detected</span>
        ) : null}

        {showRecoveryControls ? (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={handleRetryCurrentTest}
              className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3 text-sm font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retry Current Test
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={handleCancelAssessment}
              className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3 text-sm font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel Assessment
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
