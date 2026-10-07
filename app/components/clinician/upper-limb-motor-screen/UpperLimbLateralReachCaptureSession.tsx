"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LateralReachCameraDetector,
  type LateralReachCameraAcquisitionObservation,
  type LateralReachCameraSnapshot,
} from "@/app/lib/cv/lateral-reach-camera-detector";
import { buildLateralReachEngineConfig } from "@/app/lib/interaction-calibration/lateral-reach/engine-config-adapter";
import type { UpperLimbMovementAttemptResult, UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";
import {
  cancelLateralReachCalibrationAttempt,
  getLateralReachCalibrationOutcome,
  startLateralReachCalibrationAttempt,
  type LateralReachCalibrationControllerInput,
  type LateralReachCalibrationControllerOutcome,
  type LateralReachCalibrationControllerState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import {
  createLateralReachDemoAttemptPlanLock,
  createLateralReachDemoTechnicalConfigLock,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-demo-preset";
import {
  checkCalibrationStartEligibility,
  consumeActiveCalibrationController,
  createActiveCalibrationControllerOwner,
  createCalibrationRuntimeGate,
  createConfiguredCalibrationController,
  executeCalibrationStartupTransaction,
  invalidateCalibrationRuntime,
  releaseCalibrationStartup,
  tryBeginCalibrationStartup,
  type ActiveCalibrationControllerOwner,
  type CalibrationLifecycle,
  type CalibrationRuntimeGate,
} from "@/app/clinician/lateral-reach-camera-lab/calibration-attempt-runtime";
import { submitLateralReachCalibrationObservation } from "@/app/clinician/lateral-reach-camera-lab/calibration-frame-bridge";
import {
  resolveLateralReachEngineHandoffInputs,
} from "@/app/clinician/lateral-reach-camera-lab/calibration-engine-handoff";
import {
  checkClinicianCalibrationRetryEligibility,
  getClinicianCalibrationFailureMessage,
  shouldStopDetectorAfterTerminalCalibrationObservation,
} from "@/app/lib/upper-limb-motor-screen/upper-limb-lateral-reach-capture-calibration-policy";
import {
  canClinicianFinishLateralReachAttempt,
  CLINICIAN_LATERAL_REACH_PREVIEW_MIRROR_TRANSFORM,
  getPatientCalibrationFailureMessage,
  isLateralReachPatientPositionReady,
  resolveLateralReachPatientMovementSpeechCue,
  resolveLateralReachPatientMovementStatus,
  resolveLateralReachPatientPositionStatus,
  resolveLateralReachPatientReachInstruction,
  resolveLateralReachTrackingGuidance,
  shouldAdvanceClinicianAttemptResult,
  shouldAutoFinalizeLateralReachPatientAttempt,
} from "@/app/lib/upper-limb-motor-screen/upper-limb-lateral-reach-capture-attempt-control";
import {
  resetLateralReachPatientSpeech,
  speakLateralReachPatientCue,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-patient-speech";

const CAPTURE_INSTRUCTIONS = [
  "Position the patient so the tested arm and upper body are visible.",
  "Phase 1 — hold still in the starting position while the starting point is captured.",
  "Phase 2 — when calibration continues, reach laterally to capture the endpoint.",
  "Select Begin movement, complete the reach and return, then select Finish attempt.",
] as const;

const PATIENT_COUNTDOWN_SECONDS = 3;

export type UpperLimbLateralReachCaptureVariant = "clinician" | "patient";

type UpperLimbLateralReachCaptureSessionProps = {
  testedSide: UpperLimbSide;
  disabled?: boolean;
  variant?: UpperLimbLateralReachCaptureVariant;
  onAttemptComplete: (attempt: UpperLimbMovementAttemptResult) => void;
};

export function UpperLimbLateralReachCaptureSession({
  testedSide,
  disabled = false,
  variant = "clinician",
  onAttemptComplete,
}: UpperLimbLateralReachCaptureSessionProps) {
  const isPatient = variant === "patient";
  const configLock = useMemo(() => createLateralReachDemoTechnicalConfigLock(), []);
  const attemptPlanLock = useMemo(() => createLateralReachDemoAttemptPlanLock(), []);

  const [snapshot, setSnapshot] = useState<LateralReachCameraSnapshot | null>(null);
  const [calibrationLifecycle, setCalibrationLifecycle] = useState<CalibrationLifecycle>("idle");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [engineHandoffError, setEngineHandoffError] = useState<string | null>(null);
  const [lastCalibrationOutcome, setLastCalibrationOutcome] =
    useState<LateralReachCalibrationControllerOutcome | null>(null);
  const [calibrationFailureMessage, setCalibrationFailureMessage] = useState<string | null>(null);
  const [activeController, setActiveController] =
    useState<LateralReachCalibrationControllerState | null>(null);
  const [finished, setFinished] = useState(false);
  const [patientTestStarted, setPatientTestStarted] = useState(false);
  const [patientCountdown, setPatientCountdown] = useState<number | null>(null);
  const [patientMovementActive, setPatientMovementActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const lastPatientSpeechCueRef = useRef<string | null>(null);

  const runtimeGateRef = useRef<CalibrationRuntimeGate>(createCalibrationRuntimeGate());
  const activeControllerRef = useRef<ActiveCalibrationControllerOwner>(
    createActiveCalibrationControllerOwner(),
  );
  const frozenMinWristVisibilityRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<LateralReachCameraDetector | null>(null);
  const startInProgressRef = useRef(false);
  const onAttemptCompleteRef = useRef(onAttemptComplete);

  useEffect(() => {
    onAttemptCompleteRef.current = onAttemptComplete;
  }, [onAttemptComplete]);

  const acquisitionOptions = useMemo(
    () => ({
      overlayTestedSide: testedSide,
      overlayDisplayMode: (isPatient ? "patient" : "clinical") as "patient" | "clinical",
    }),
    [isPatient, testedSide],
  );

  const handleAcquisitionObservation = useCallback(
    (observation: LateralReachCameraAcquisitionObservation) => {
      const controller = activeControllerRef.current.current;
      if (!controller) return;

      const minWristVisibility = frozenMinWristVisibilityRef.current;
      if (minWristVisibility === null) return;

      const { state, disposition } = submitLateralReachCalibrationObservation(
        controller,
        observation,
        minWristVisibility,
      );
      if (disposition === "ignored_terminal") return;

      activeControllerRef.current.current = state;
      setActiveController(state);

      if (state.phase === "terminal") {
        const outcome = getLateralReachCalibrationOutcome(state);
        activeControllerRef.current.current = null;
        frozenMinWristVisibilityRef.current = null;
        setActiveController(null);
        setLastCalibrationOutcome(outcome);
        setCalibrationLifecycle("idle");
        const failureMessage = isPatient
          ? getPatientCalibrationFailureMessage(outcome)
          : getClinicianCalibrationFailureMessage(outcome);
        setCalibrationFailureMessage(failureMessage);
        if (shouldStopDetectorAfterTerminalCalibrationObservation(outcome)) {
          detectorRef.current?.stop();
        }
      }
    },
    [isPatient],
  );

  useEffect(() => {
    const detector = new LateralReachCameraDetector({
      onSnapshot: (newSnapshot) => setSnapshot(newSnapshot),
      onAcquisitionObservation: handleAcquisitionObservation,
    });
    detectorRef.current = detector;

    const runtimeGate = runtimeGateRef.current;
    const activeControllerOwner = activeControllerRef.current;

    return () => {
      invalidateCalibrationRuntime(runtimeGate);
      consumeActiveCalibrationController(activeControllerOwner);
      frozenMinWristVisibilityRef.current = null;
      resetLateralReachPatientSpeech();
      detector.stop();
      detectorRef.current = null;
    };
  }, [handleAcquisitionObservation]);

  const handleCancelCalibration = useCallback(() => {
    const controller = consumeActiveCalibrationController(activeControllerRef.current);
    if (!controller) return;

    invalidateCalibrationRuntime(runtimeGateRef.current);
    const terminalController = cancelLateralReachCalibrationAttempt(controller);
    const outcome = getLateralReachCalibrationOutcome(terminalController);
    detectorRef.current?.stop();
    frozenMinWristVisibilityRef.current = null;
    setActiveController(null);
    setLastCalibrationOutcome(outcome);
    setCalibrationLifecycle("idle");
    setCalibrationFailureMessage(null);
    setPatientTestStarted(false);
    setPatientCountdown(null);
    setPatientMovementActive(false);
    lastPatientSpeechCueRef.current = null;
    resetLateralReachPatientSpeech();
  }, []);

  const handleStop = useCallback(() => {
    if (calibrationLifecycle === "starting") {
      invalidateCalibrationRuntime(runtimeGateRef.current);
      detectorRef.current?.stop();
      setCalibrationLifecycle("idle");
      setCameraStarting(false);
      return;
    }
    if (activeControllerRef.current.current !== null) {
      handleCancelCalibration();
      return;
    }
    detectorRef.current?.stop();
    setCalibrationFailureMessage(null);
    setPatientTestStarted(false);
    setPatientCountdown(null);
    setPatientMovementActive(false);
    lastPatientSpeechCueRef.current = null;
    resetLateralReachPatientSpeech();
    setCameraStarting(false);
  }, [calibrationLifecycle, handleCancelCalibration]);

  const handleStartCameraOnly = useCallback(async () => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!detector || !video || !canvas || disabled || finished) return;
    if (detector.getSnapshot().status !== "idle") return;

    setCameraStarting(true);
    setStartupError(null);
    setCalibrationFailureMessage(null);
    setEngineHandoffError(null);

    try {
      await detector.startAcquisition(video, canvas, acquisitionOptions);
    } catch (err) {
      setStartupError(err instanceof Error ? err.message : String(err));
    } finally {
      setCameraStarting(false);
    }
  }, [acquisitionOptions, disabled, finished]);

  const handleStartCalibration = useCallback(async () => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!detector || !video || !canvas || disabled || finished) return;

    const detectorSnapshot = detector.getSnapshot();
    const isRetryOnLiveAcquisition =
      detectorSnapshot.status === "acquiring" && detectorSnapshot.engineSnapshot === null;

    const eligibility = isRetryOnLiveAcquisition
      ? checkClinicianCalibrationRetryEligibility(
          detectorSnapshot.status,
          startInProgressRef.current,
          runtimeGateRef.current.startupOwner !== null,
          activeControllerRef.current.current !== null,
          true,
          true,
          detectorSnapshot.engineSnapshot !== null,
        )
      : checkCalibrationStartEligibility(
          detectorSnapshot.status,
          startInProgressRef.current,
          runtimeGateRef.current.startupOwner !== null,
          activeControllerRef.current.current !== null,
          true,
          true,
        );

    if (!eligibility.allowed) {
      setStartupError(eligibility.reason ?? "Camera is not ready to start calibration.");
      return;
    }

    const generation = tryBeginCalibrationStartup(runtimeGateRef.current);
    if (generation === null) return;

    try {
      const controllerInput: LateralReachCalibrationControllerInput = {
        testedSide,
        plan: attemptPlanLock.lockedPlan,
        startCaptureConfig: configLock.lockedConfig.startCaptureConfig,
        endpointCaptureConfig: configLock.lockedConfig.endpointCaptureConfig,
        zoneRadii: configLock.lockedConfig.zoneRadii,
        noiseFloor: configLock.lockedConfig.noiseFloor.minDirectionAlignedMagnitude,
      };

      const configuredController = createConfiguredCalibrationController(controllerInput);
      setCalibrationLifecycle("starting");
      setStartupError(null);
      setLastCalibrationOutcome(null);
      setCalibrationFailureMessage(null);
      setEngineHandoffError(null);

      const result = await executeCalibrationStartupTransaction(
        runtimeGateRef.current,
        generation,
        configuredController,
        {
          startAcquisition: isRetryOnLiveAcquisition
            ? async () => undefined
            : () => detector.startAcquisition(video, canvas, acquisitionOptions),
          stopDetector: () => detector.stop(),
          getDetectorStatus: () => detector.getSnapshot().status,
          now: () => performance.now(),
          startController: startLateralReachCalibrationAttempt,
        },
      );

      if (result.kind === "stale") return;

      if (result.kind === "failed") {
        setStartupError(result.error);
        setCalibrationLifecycle("idle");
        return;
      }

      frozenMinWristVisibilityRef.current = configLock.lockedConfig.tracking.minWristVisibility;
      activeControllerRef.current.current = result.capturingController;
      setActiveController(result.capturingController);
      setCalibrationLifecycle("active");
    } catch (err) {
      setStartupError(err instanceof Error ? err.message : String(err));
      setCalibrationLifecycle("idle");
    } finally {
      releaseCalibrationStartup(runtimeGateRef.current, generation);
    }
  }, [acquisitionOptions, attemptPlanLock, configLock, disabled, finished, testedSide]);

  const handleStartPatientTest = useCallback(() => {
    setPatientTestStarted(true);
    setPatientCountdown(PATIENT_COUNTDOWN_SECONDS);
    setPatientMovementActive(false);
    setCalibrationFailureMessage(null);
    lastPatientSpeechCueRef.current = null;
    resetLateralReachPatientSpeech();
    void handleStartCalibration();
  }, [handleStartCalibration]);

  const handleStartEngine = useCallback(() => {
    const detector = detectorRef.current;
    if (!detector || disabled || finished) return;

    const detectorSnapshot = detector.getSnapshot();
    const handoff = resolveLateralReachEngineHandoffInputs({
      calibrationOutcome: lastCalibrationOutcome,
      configLock,
      detectorStatus: detectorSnapshot.status,
      engineActive: detectorSnapshot.engineSnapshot !== null,
      calibrationLifecycle,
    });

    if (!handoff.ok) {
      setEngineHandoffError(handoff.reason);
      return;
    }

    const configResult = buildLateralReachEngineConfig(
      handoff.readyResult,
      handoff.tracking,
      handoff.timing,
    );

    if (!configResult.ok) {
      setEngineHandoffError(configResult.reason);
      return;
    }

    try {
      detector.startEngine(configResult.config);
      setEngineHandoffError(null);
    } catch (err) {
      setEngineHandoffError(err instanceof Error ? err.message : String(err));
    }
  }, [calibrationLifecycle, configLock, disabled, finished, lastCalibrationOutcome]);

  const handleArmReadiness = useCallback(() => {
    detectorRef.current?.armReadiness();
  }, []);

  const handleResume = useCallback(() => {
    detectorRef.current?.resumeAfterPause("clinician");
  }, []);

  const handleEndAttempt = useCallback(() => {
    const detector = detectorRef.current;
    if (!detector || finished) return;

    detector.endAttemptWindow();
    const result = detector.getSnapshot().finalResult;
    if (!shouldAdvanceClinicianAttemptResult(result)) {
      return;
    }
    setFinished(true);
    detector.stop();
    if (isPatient) {
      speakLateralReachPatientCue("test-completed", testedSide);
    }
    onAttemptCompleteRef.current(result);
  }, [finished, isPatient, testedSide]);

  const readyCalibrationResult =
    lastCalibrationOutcome?.kind === "result" &&
    lastCalibrationOutcome.result.geometryOutcome === "ready"
      ? lastCalibrationOutcome.result
      : null;

  const canStartEngine =
    calibrationLifecycle === "idle" &&
    readyCalibrationResult !== null &&
    snapshot?.status === "acquiring" &&
    !snapshot?.engineSnapshot;

  const showVideo =
    snapshot?.status === "running" ||
    snapshot?.status === "acquiring" ||
    snapshot?.initPhase === "camera";

  const canArmReadiness =
    snapshot?.status === "running" &&
    snapshot?.engineSnapshot &&
    (snapshot.engineSnapshot.phase === "idle" ||
      snapshot.engineSnapshot.phase === "awaiting_readiness") &&
    !snapshot.engineSnapshot.hasActivePause &&
    !snapshot.engineSnapshot.terminal &&
    !snapshot.readinessArmed;

  const canResume =
    snapshot?.status === "running" &&
    snapshot?.engineSnapshot?.hasActivePause &&
    !snapshot?.engineSnapshot?.terminal;

  const canEndAttempt = canClinicianFinishLateralReachAttempt(
    snapshot?.status ?? "idle",
    snapshot?.engineSnapshot ?? null,
  );

  const cameraBusy =
    calibrationLifecycle === "starting" ||
    calibrationLifecycle === "active" ||
    snapshot?.status === "initializing" ||
    cameraStarting;

  const canStartCalibration =
    calibrationLifecycle === "idle" && !snapshot?.engineSnapshot && !finished;

  const trackingGuidance = useMemo(
    () => resolveLateralReachTrackingGuidance(snapshot, testedSide),
    [snapshot, testedSide],
  );

  const patientPositionStatus = useMemo(
    () => resolveLateralReachPatientPositionStatus(snapshot, testedSide),
    [snapshot, testedSide],
  );

  const patientPositionReady = useMemo(
    () => isLateralReachPatientPositionReady(snapshot, testedSide),
    [snapshot, testedSide],
  );

  const patientTrackingInterrupted = useMemo(
    () => !patientPositionReady && (showVideo ?? false),
    [patientPositionReady, showVideo],
  );

  const patientCalibrationPhase =
    activeController?.phase === "capturing_start" || activeController?.phase === "capturing_endpoint"
      ? activeController.phase
      : null;

  const patientMovementStatus = useMemo(
    () =>
      resolveLateralReachPatientMovementStatus({
        snapshot,
        testedSide,
        calibrationPhase: patientCalibrationPhase,
        testStarted: patientTestStarted,
        movementActive: patientMovementActive,
      }),
    [patientCalibrationPhase, patientMovementActive, patientTestStarted, snapshot, testedSide],
  );

  const patientReachInstruction = useMemo(
    () => resolveLateralReachPatientReachInstruction(testedSide),
    [testedSide],
  );

  useEffect(() => {
    if (!isPatient || !patientTestStarted || finished || patientCountdown === null) return;
    if (patientTrackingInterrupted) return;

    const timer = window.setTimeout(() => {
      setPatientCountdown((current) => {
        if (current === null) return null;
        if (current <= 1) {
          setPatientMovementActive(true);
          speakLateralReachPatientCue("reach-out", testedSide);
          return null;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [
    finished,
    isPatient,
    patientCountdown,
    patientTestStarted,
    patientTrackingInterrupted,
    testedSide,
  ]);

  useEffect(() => {
    if (!isPatient || !patientTestStarted || finished || patientCountdown !== null) return;
    if (canStartEngine) {
      handleStartEngine();
    }
  }, [
    canStartEngine,
    finished,
    handleStartEngine,
    isPatient,
    patientCountdown,
    patientTestStarted,
  ]);

  useEffect(() => {
    if (!isPatient || !patientTestStarted || finished || patientCountdown !== null) return;
    if (canArmReadiness) {
      handleArmReadiness();
    }
  }, [
    canArmReadiness,
    finished,
    handleArmReadiness,
    isPatient,
    patientCountdown,
    patientTestStarted,
  ]);

  useEffect(() => {
    if (!isPatient || !patientTestStarted || finished || patientCountdown !== null) return;
    if (!shouldAutoFinalizeLateralReachPatientAttempt(snapshot?.engineSnapshot ?? null)) {
      return;
    }
    handleEndAttempt();
  }, [
    finished,
    handleEndAttempt,
    isPatient,
    patientCountdown,
    patientTestStarted,
    snapshot?.engineSnapshot,
  ]);

  useEffect(() => {
    if (!isPatient || !patientTestStarted || finished || patientCountdown !== null) return;
    if (!patientMovementActive || !patientMovementStatus) return;
    if (patientMovementStatus.startsWith("Tracking interrupted")) return;

    const speechCue = resolveLateralReachPatientMovementSpeechCue(
      patientMovementStatus,
      testedSide,
    );
    if (!speechCue || speechCue === "reach-out") return;

    const cueKey = `${speechCue}:${patientMovementStatus}`;
    if (lastPatientSpeechCueRef.current === cueKey) return;
    lastPatientSpeechCueRef.current = cueKey;
    speakLateralReachPatientCue(speechCue, testedSide);
  }, [
    finished,
    isPatient,
    patientCountdown,
    patientMovementActive,
    patientMovementStatus,
    patientTestStarted,
    testedSide,
  ]);

  const calibrationButtonLabel = calibrationFailureMessage
    ? "Retry calibration"
    : "Start camera and calibrate";

  const cameraIdle = snapshot?.status === "idle" || snapshot === null;

  const preview = (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[10px] border border-[#1E2D42] bg-[#0F1825]">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{
          display: showVideo ? "block" : "none",
          transform: CLINICIAN_LATERAL_REACH_PREVIEW_MIRROR_TRANSFORM,
        }}
      />
      {!showVideo ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-white/40">
            {isPatient
              ? "Your camera preview will appear here when you start."
              : "Camera preview will appear when capture starts."}
          </p>
        </div>
      ) : null}
    </div>
  );

  if (isPatient) {
    const showPatientCountdown = patientTestStarted && patientCountdown !== null && !finished;
    const showPatientMovement = patientTestStarted && patientCountdown === null && !finished;

    return (
      <section className="mt-6">
        {preview}

        {!showVideo ? (
          <div className="mt-5">
            <button
              type="button"
              disabled={disabled || cameraBusy}
              onClick={() => void handleStartCameraOnly()}
              className="w-full rounded-[7px] bg-[#1D9E75] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {cameraBusy ? "Starting camera…" : "Start Camera"}
            </button>
          </div>
        ) : null}

        {showVideo && !patientTestStarted ? (
          <p className="mt-4 text-sm text-white/70">{patientPositionStatus}</p>
        ) : null}

        {finished ? (
          <p className="mt-4 text-lg font-semibold text-[#5DCAA5]">Test completed</p>
        ) : null}

        {showPatientCountdown ? (
          <div className="mt-6 text-center">
            <p className="text-5xl font-bold text-white">{patientCountdown}</p>
            {patientTrackingInterrupted && patientMovementStatus ? (
              <p className="mt-3 text-sm text-amber-200">{patientMovementStatus}</p>
            ) : (
              <p className="mt-3 text-sm text-white/50">Get ready…</p>
            )}
          </div>
        ) : null}

        {showPatientMovement ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-white/70">{patientReachInstruction}</p>
            {patientMovementStatus ? (
              <p
                className={`text-sm font-medium ${
                  patientMovementStatus.startsWith("Tracking interrupted")
                    ? "text-amber-200"
                    : "text-[#5DCAA5]"
                }`}
              >
                {patientMovementStatus}
              </p>
            ) : null}
          </div>
        ) : null}

        {startupError ? <p className="mt-3 text-sm text-rose-300">{startupError}</p> : null}
        {!patientTestStarted && calibrationFailureMessage ? (
          <p className="mt-3 text-sm text-amber-200">{calibrationFailureMessage}</p>
        ) : null}
        {engineHandoffError ? (
          <p className="mt-3 text-sm text-rose-300">
            The test could not continue. Please try again.
          </p>
        ) : null}
        {snapshot?.error ? <p className="mt-3 text-sm text-rose-300">{snapshot.error}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {showVideo && !patientTestStarted && canStartCalibration ? (
            <button
              type="button"
              disabled={disabled || cameraBusy || !patientPositionReady}
              onClick={handleStartPatientTest}
              className="w-full rounded-[7px] bg-[#1D9E75] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {calibrationFailureMessage ? "Try Again" : "Start Test"}
            </button>
          ) : null}

          {(showVideo || calibrationLifecycle !== "idle") && !finished ? (
            <button
              type="button"
              disabled={disabled}
              onClick={handleStop}
              className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-xs font-semibold text-white/60 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop camera
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-white">Live lateral reach capture</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/40">
        Camera-assisted movement observation for therapist review. Tested side: {testedSide}.
      </p>

      <ul className="mt-4 list-inside list-disc space-y-1.5 text-sm text-white/45">
        {CAPTURE_INSTRUCTIONS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="mt-5">{preview}</div>

      {showVideo && trackingGuidance ? (
        <p className="mt-3 text-sm text-amber-200">{trackingGuidance}</p>
      ) : null}

      {startupError ? <p className="mt-3 text-sm text-rose-300">{startupError}</p> : null}
      {calibrationFailureMessage ? (
        <p className="mt-3 text-sm text-amber-200">{calibrationFailureMessage}</p>
      ) : null}
      {engineHandoffError ? (
        <p className="mt-3 text-sm text-rose-300">
          Movement could not start: {engineHandoffError.replaceAll("_", " ")}
        </p>
      ) : null}
      {snapshot?.error ? <p className="mt-3 text-sm text-rose-300">{snapshot.error}</p> : null}

      {snapshot?.engineSnapshot ? (
        <p className="mt-3 text-xs text-white/40">
          Phase: {snapshot.engineSnapshot.phase}
          {snapshot.engineSnapshot.hasActivePause ? " · Protective pause active" : ""}
        </p>
      ) : null}

      {activeController ? (
        <p className="mt-2 text-xs text-white/40">
          {activeController.phase === "capturing_endpoint"
            ? "Calibration phase 2 — reach laterally to capture the endpoint."
            : "Calibration phase 1 — hold the starting position steady."}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {canStartCalibration && cameraIdle ? (
          <button
            type="button"
            disabled={disabled || cameraBusy}
            onClick={() => void handleStartCalibration()}
            className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {calibrationButtonLabel}
          </button>
        ) : null}

        {canStartCalibration && !cameraIdle && calibrationFailureMessage ? (
          <button
            type="button"
            disabled={disabled || cameraBusy}
            onClick={() => void handleStartCalibration()}
            className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry calibration
          </button>
        ) : null}

        {canStartEngine ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleStartEngine}
            className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Begin movement
          </button>
        ) : null}

        {canArmReadiness ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleArmReadiness}
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirm readiness
          </button>
        ) : null}

        {canResume ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleResume}
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Resume after pause
          </button>
        ) : null}

        {canEndAttempt ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleEndAttempt}
            className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Finish attempt
          </button>
        ) : null}

        {(showVideo || calibrationLifecycle !== "idle") && !finished ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleStop}
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-4 py-2.5 text-xs font-semibold text-white/60 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop camera
          </button>
        ) : null}
      </div>
    </section>
  );
}
