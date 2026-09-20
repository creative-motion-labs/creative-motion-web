"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LateralReachCameraDetector,
  type LateralReachCameraAcquisitionObservation,
  type LateralReachCameraSnapshot,
} from "@/app/lib/cv/lateral-reach-camera-detector";
import { validateLateralReachConfig } from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import { buildLateralReachEngineConfig } from "@/app/lib/interaction-calibration/lateral-reach/engine-config-adapter";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";
import {
  canLockLateralReachLabAttemptPlan,
  tryLockLateralReachLabAttemptPlan,
  type LabAttemptPlanLock,
  type LabScreenHorizontalDirectionSelection,
} from "@/app/clinician/lateral-reach-camera-lab/attempt-plan-intake";
import {
  canLockLateralReachLabTechnicalConfig,
  tryLockLateralReachLabTechnicalConfig,
  type LabTechnicalConfigLock,
} from "@/app/clinician/lateral-reach-camera-lab/technical-config-intake";
// Slice 18 — calibration attempt runtime
import {
  cancelLateralReachCalibrationAttempt,
  getLateralReachCalibrationOutcome,
  startLateralReachCalibrationAttempt,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import type {
  LateralReachCalibrationControllerInput,
  LateralReachCalibrationControllerState,
  LateralReachCalibrationControllerOutcome,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";
import {
  checkCalibrationStartEligibility,
  checkLegacyStartEligibility,
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
} from "./calibration-attempt-runtime";
// Slice 19 — camera observation → calibration frame bridge
import { submitLateralReachCalibrationObservation } from "./calibration-frame-bridge";
// Slice 20 — calibration → engine handoff eligibility
import {
  resolveLateralReachEngineHandoffInputs,
  shouldRetainDetectorAcquisitionForTerminalCalibration,
} from "./calibration-engine-handoff";
// Runtime QA — error provenance helpers
import {
  isLegacyRetryEligible,
  isLegacyStartSessionEligible,
} from "./error-provenance";
import {
  resolveCalibrationAcquisitionDiagnostics,
  type CalibrationAcquisitionDiagnostic,
} from "./calibration-acquisition-diagnostics";
import {
  resolveCalibrationEndpointDiagnosticsAfterObservation,
  type CalibrationEndpointDiagnostic,
} from "./calibration-endpoint-diagnostics";
import { resolveCvQualityDiagnostic } from "./cv-quality-diagnostics";
import { canEndAttemptWindow } from "./terminal-attempt-control";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

export default function LateralReachCameraLabPage() {
  const [snapshot, setSnapshot] = useState<LateralReachCameraSnapshot | null>(null);
  const [testedSide, setTestedSide] = useState<UpperLimbSide>("right");
  const [screenHorizontalDirection, setScreenHorizontalDirection] =
    useState<LabScreenHorizontalDirectionSelection>(null);
  const [attemptPlanLock, setAttemptPlanLock] = useState<LabAttemptPlanLock | null>(
    null,
  );
  const [attemptPlanLockError, setAttemptPlanLockError] = useState<string | null>(
    null,
  );

  // Slice 17 — technical-config intake state
  const [configInput, setConfigInput] = useState<string>("");
  const [configLock, setConfigLock] = useState<LabTechnicalConfigLock | null>(null);
  const [configLockError, setConfigLockError] = useState<string | null>(null);

  // Slice 18 — calibration attempt runtime state
  const runtimeGateRef = useRef<CalibrationRuntimeGate>(createCalibrationRuntimeGate());
  const activeControllerRef = useRef<ActiveCalibrationControllerOwner>(
    createActiveCalibrationControllerOwner(),
  );
  const [activeController, setActiveController] =
    useState<LateralReachCalibrationControllerState | null>(null);
  const [calibrationLifecycle, setCalibrationLifecycle] =
    useState<CalibrationLifecycle>("idle");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [lastCalibrationOutcome, setLastCalibrationOutcome] =
    useState<LateralReachCalibrationControllerOutcome | null>(null);
  const [lastCalibrationAcquisitionDiagnostic, setLastCalibrationAcquisitionDiagnostic] =
    useState<CalibrationAcquisitionDiagnostic | null>(null);
  const [lastCalibrationEndpointDiagnostic, setLastCalibrationEndpointDiagnostic] =
    useState<CalibrationEndpointDiagnostic | null>(null);
  // Slice 19 — frozen once per active attempt from configLock; no defaults.
  const frozenMinWristVisibilityRef = useRef<number | null>(null);

  // Slice 20 — explicit calibration → engine handoff state (lab only)
  const [engineHandoffError, setEngineHandoffError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<LateralReachCameraDetector | null>(null);
  const startInProgressRef = useRef(false);

  // Runtime QA fix — explicit error provenance for safe Retry ownership.
  // Tracks which start flow (if any) most recently attempted camera acquisition.
  // Used to gate the legacy Retry button: only show when provenance is explicitly
  // "legacy", never when "calibration" (even if lifecycle returned to idle on failure).
  const lastStartIntentionRef = useRef<"legacy" | "calibration" | null>(null);

  // Slice 19 — bridge one acquisition observation into the active
  // controller. Reads ONLY refs (never React state) so this stays correct
  // across the lifetime of the detector instance it is attached to.
  const handleAcquisitionObservation = useCallback(
    (observation: LateralReachCameraAcquisitionObservation) => {
      const controller = activeControllerRef.current.current;
      if (!controller) return; // No active attempt, or already terminal — no-op.

      const minWristVisibility = frozenMinWristVisibilityRef.current;
      if (minWristVisibility === null) return; // Defensive: not yet frozen.

      const detectorSnapshot = detectorRef.current?.getSnapshot();
      if (detectorSnapshot) {
        setLastCalibrationAcquisitionDiagnostic(
          resolveCalibrationAcquisitionDiagnostics({
            observation,
            testedSide: controller.testedSide,
            minWristVisibility,
            detectorSnapshot: {
              status: detectorSnapshot.status,
              rightWristVisibility: detectorSnapshot.rightWristVisibility,
              leftWristVisibility: detectorSnapshot.leftWristVisibility,
              rightWristCoords: detectorSnapshot.rightWristCoords,
              leftWristCoords: detectorSnapshot.leftWristCoords,
            },
          }),
        );
      }

      const { state, disposition } = submitLateralReachCalibrationObservation(
        controller,
        observation,
        minWristVisibility,
      );
      if (disposition === "ignored_terminal") return;

      const endpointDiagnostic = resolveCalibrationEndpointDiagnosticsAfterObservation({
        controllerBeforeSubmit: controller,
        controllerAfterSubmit: state,
        capturedAtMs: observation.capturedAtMs,
      });
      if (endpointDiagnostic !== null) {
        setLastCalibrationEndpointDiagnostic(endpointDiagnostic);
      }

      activeControllerRef.current.current = state;
      setActiveController(state);

      if (state.phase === "terminal") {
        const outcome = getLateralReachCalibrationOutcome(state);
        activeControllerRef.current.current = null;
        frozenMinWristVisibilityRef.current = null;
        setActiveController(null);
        setLastCalibrationOutcome(outcome);
        setCalibrationLifecycle("idle");
        if (!shouldRetainDetectorAcquisitionForTerminalCalibration(outcome)) {
          detectorRef.current?.stop();
        }
      }
    },
    [],
  );

  // Initialize detector instance
  useEffect(() => {
    const detector = new LateralReachCameraDetector({
      onSnapshot: (newSnapshot) => setSnapshot(newSnapshot),
      onAcquisitionObservation: handleAcquisitionObservation,
    });
    detectorRef.current = detector;

    const runtimeGate = runtimeGateRef.current;
    const activeControllerOwner = activeControllerRef.current;

    return () => {
      // Slice 18 — unmount cleanup (no stale async activation)
      invalidateCalibrationRuntime(runtimeGate);
      consumeActiveCalibrationController(activeControllerOwner);

      // Slice 19 — clear frozen attempt-specific config
      frozenMinWristVisibilityRef.current = null;

      // Runtime QA fix — clear error provenance on unmount
      lastStartIntentionRef.current = null;

      detector.stop();
      detectorRef.current = null;
    };
  }, [handleAcquisitionObservation]);

  const handleStart = useCallback(async () => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!detector || !video || !canvas) {
      return;
    }

    // Slice 18 — legacy/calibration mutual exclusion
    const eligibility = checkLegacyStartEligibility(
      detector.getSnapshot().status,
      startInProgressRef.current,
      runtimeGateRef.current.startupOwner !== null,
      activeControllerRef.current.current !== null,
    );

    if (!eligibility.allowed) {
      console.warn(`Legacy start blocked: ${eligibility.reason}`);
      return;
    }

    // Runtime QA fix — mark legacy start provenance before attempting acquisition
    lastStartIntentionRef.current = "legacy";

    startInProgressRef.current = true;

    try {
      // Build Lateral Reach config
      // Target at x=0.7, Start at x=0.3 → expectedHorizontalDirectionSign = +1 (rightward)
      const configResult = validateLateralReachConfig({
        testedSide,
        fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
        startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
        tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
        timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
      });

      if (!configResult.ok) {
        throw new Error(`Invalid config: ${configResult.reason}`);
      }

      await detector.start(video, canvas, configResult.config);
      // Runtime QA fix — clear provenance on successful legacy start
      lastStartIntentionRef.current = null;
    } catch (err) {
      console.error("Failed to start camera:", err);
    } finally {
      startInProgressRef.current = false;
    }
  }, [testedSide]);

  // Slice 18 — stop during starting (invalidate + stop + idle, no controller)
  const handleStopDuringStarting = useCallback(() => {
    invalidateCalibrationRuntime(runtimeGateRef.current);
    detectorRef.current?.stop();
    setCalibrationLifecycle("idle");
  }, []);

  // Slice 18 — cancel active calibration (consume + cancel + stop + outcome)
  const handleCancelCalibration = useCallback(() => {
    const controller = consumeActiveCalibrationController(activeControllerRef.current);
    if (!controller) return; // Already cancelled

    invalidateCalibrationRuntime(runtimeGateRef.current);

    const terminalController = cancelLateralReachCalibrationAttempt(controller);
    const outcome = getLateralReachCalibrationOutcome(terminalController);

    detectorRef.current?.stop();

    frozenMinWristVisibilityRef.current = null;
    setActiveController(null);
    setLastCalibrationOutcome(outcome);
    setCalibrationLifecycle("idle");
  }, []);

  const handleStop = useCallback(() => {
    // Runtime QA fix — clear error provenance on explicit stop
    lastStartIntentionRef.current = null;

    // Slice 18 — lifecycle-aware stop
    if (calibrationLifecycle === "starting") {
      handleStopDuringStarting();
    } else if (activeControllerRef.current.current !== null) {
      handleCancelCalibration();
    } else {
      // Legacy detector stop
      detectorRef.current?.stop();
    }
  }, [calibrationLifecycle, handleStopDuringStarting, handleCancelCalibration]);

  // Slice 18 — explicit calibration startup
  const handleStartCalibration = useCallback(async () => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!detector || !video || !canvas) {
      return;
    }

    // Check eligibility
    const eligibility = checkCalibrationStartEligibility(
      detector.getSnapshot().status,
      startInProgressRef.current,
      runtimeGateRef.current.startupOwner !== null,
      activeControllerRef.current.current !== null,
      attemptPlanLock !== null,
      configLock !== null,
    );

    if (!eligibility.allowed) {
      console.warn(`Calibration start blocked: ${eligibility.reason}`);
      setStartupError(eligibility.reason ?? "start_blocked");
      return;
    }

    // Runtime QA fix — mark calibration start provenance before attempting acquisition
    lastStartIntentionRef.current = "calibration";

    // Try to begin startup
    const generation = tryBeginCalibrationStartup(runtimeGateRef.current);
    if (generation === null) {
      console.warn("Calibration startup already owned");
      return;
    }

    try {
      // Snapshot locked inputs
      const controllerInput: LateralReachCalibrationControllerInput = {
        testedSide,
        plan: attemptPlanLock!.lockedPlan,
        startCaptureConfig: configLock!.lockedConfig.startCaptureConfig,
        endpointCaptureConfig: configLock!.lockedConfig.endpointCaptureConfig,
        zoneRadii: configLock!.lockedConfig.zoneRadii,
        noiseFloor: configLock!.lockedConfig.noiseFloor.minDirectionAlignedMagnitude,
      };

      // Create configured controller (local, throws on invalid config)
      const configuredController = createConfiguredCalibrationController(controllerInput);

      // Only after configuration succeeds: publish starting state
      setCalibrationLifecycle("starting");
      setStartupError(null);
      setLastCalibrationOutcome(null);
      setLastCalibrationAcquisitionDiagnostic(null);
      setLastCalibrationEndpointDiagnostic(null);
      setEngineHandoffError(null);

      // Execute async startup transaction
      const result = await executeCalibrationStartupTransaction(
        runtimeGateRef.current,
        generation,
        configuredController,
        {
          startAcquisition: () => detector.startAcquisition(video, canvas),
          stopDetector: () => detector.stop(),
          getDetectorStatus: () => detector.getSnapshot().status,
          now: () => performance.now(),
          startController: startLateralReachCalibrationAttempt,
        },
      );

      if (result.kind === "stale") {
        // Stale: no mutation, return silently
        return;
      }

      if (result.kind === "failed") {
        setStartupError(result.error);
        setCalibrationLifecycle("idle");
        return;
      }

      // Active: freeze minWristVisibility for this attempt, then publish controller.
      // Slice 19 — frozen once here; never re-read from configLock per frame.
      frozenMinWristVisibilityRef.current = configLock!.lockedConfig.tracking.minWristVisibility;
      activeControllerRef.current.current = result.capturingController;
      setActiveController(result.capturingController);
      setCalibrationLifecycle("active");
      // Runtime QA fix — clear provenance on successful calibration activation
      lastStartIntentionRef.current = null;
    } catch (err) {
      // Configuration or unexpected error before acquisition
      console.error("Calibration startup error:", err);
      setStartupError(err instanceof Error ? err.message : String(err));
      setCalibrationLifecycle("idle");
    } finally {
      releaseCalibrationStartup(runtimeGateRef.current, generation);
    }
  }, [attemptPlanLock, configLock, testedSide]);

  // Slice 20 — explicit calibration → engine handoff (lab only).
  // Fully synchronous: reads a fresh detector snapshot once, resolves
  // eligibility from that snapshot plus current locked state, then either
  // fails closed with a typed reason or calls detector.startEngine(...)
  // once. No React state is used for the eligibility decision itself, so a
  // same-tick re-entry cannot observe stale detector state; detector.
  // startEngine(...) remains the final authoritative guard.
  const handleStartEngine = useCallback(() => {
    const detector = detectorRef.current;
    if (!detector) return;

    const detectorSnapshot = detector.getSnapshot();

    const handoff = resolveLateralReachEngineHandoffInputs({
      calibrationOutcome: lastCalibrationOutcome,
      configLock,
      detectorStatus: detectorSnapshot.status,
      engineActive: detectorSnapshot.engineSnapshot !== null,
      calibrationLifecycle,
    });

    if (!handoff.ok) {
      console.warn(`Engine handoff blocked: ${handoff.reason}`);
      setEngineHandoffError(handoff.reason);
      return;
    }

    const configResult = buildLateralReachEngineConfig(
      handoff.readyResult,
      handoff.tracking,
      handoff.timing,
    );

    if (!configResult.ok) {
      console.warn(`Engine config invalid: ${configResult.reason}`);
      setEngineHandoffError(configResult.reason);
      return;
    }

    try {
      detector.startEngine(configResult.config);
      setEngineHandoffError(null);
    } catch (err) {
      console.error("Engine start failed:", err);
      setEngineHandoffError(err instanceof Error ? err.message : String(err));
    }
  }, [lastCalibrationOutcome, configLock, calibrationLifecycle]);

  const handleArmReadiness = useCallback(() => {
    detectorRef.current?.armReadiness();
  }, []);

  const handleDisarmReadiness = useCallback(() => {
    detectorRef.current?.disarmReadiness();
  }, []);

  const handleResume = useCallback(() => {
    detectorRef.current?.resumeAfterPause("clinician");
  }, []);

  // Terminal Result UI — explicit lab-only "End Attempt" bridge.
  const handleEndAttemptWindow = useCallback(() => {
    detectorRef.current?.endAttemptWindow();
  }, []);

  const handleLockAttemptPlan = useCallback(() => {
    const result = tryLockLateralReachLabAttemptPlan(
      screenHorizontalDirection,
      attemptPlanLock,
    );
    if (!result.ok) {
      setAttemptPlanLockError(result.error);
      // previousLock retained — do not clear a valid prior lock
      return;
    }
    setAttemptPlanLock(result.lock);
    setAttemptPlanLockError(null);
  }, [screenHorizontalDirection, attemptPlanLock]);

  // Slice 17 — technical-config lock handler
  const handleLockTechnicalConfig = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configInput);
    } catch (err) {
      setConfigLockError(
        `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const result = tryLockLateralReachLabTechnicalConfig(parsed, configLock);
    if (!result.ok) {
      setConfigLockError(result.error);
      // previousLock retained — do not clear a valid prior lock
      return;
    }
    setConfigLock(result.lock);
    setConfigLockError(null);
  }, [configInput, configLock]);

  // Slice 20 — engine handoff UI gating. Diagnostic only; the handler
  // re-resolves eligibility from a fresh detector snapshot at click time.
  const readyCalibrationResult =
    lastCalibrationOutcome?.kind === "result" &&
    lastCalibrationOutcome.result.geometryOutcome === "ready"
      ? lastCalibrationOutcome.result
      : null;
  const canStartEngine =
    calibrationLifecycle === "idle" &&
    readyCalibrationResult !== null &&
    configLock !== null &&
    snapshot?.status === "acquiring" &&
    !snapshot?.engineSnapshot;

  const showVideo = snapshot?.status === "running" || snapshot?.status === "acquiring" || snapshot?.initPhase === "camera";
  const canArmReadiness =
    snapshot?.status === "running" &&
    snapshot?.engineSnapshot &&
    (snapshot.engineSnapshot.phase === "idle" || snapshot.engineSnapshot.phase === "awaiting_readiness") &&
    !snapshot.engineSnapshot.hasActivePause &&
    !snapshot.engineSnapshot.terminal &&
    !snapshot.readinessArmed;
  // Resume must remain available whenever a protective pause is active, including
  // awaiting_readiness. The engine intentionally allows tracking-gap pauses in
  // that phase; hiding Resume there leaves clinicians stuck with Active Pause Yes
  // and high wrist visibility (no auto-resume).
  const canResume =
    snapshot?.status === "running" &&
    snapshot?.engineSnapshot?.hasActivePause &&
    !snapshot?.engineSnapshot?.terminal;

  // Terminal Result UI — explicit lab-only "End Attempt" bridge (no auto-finalization).
  const canEndAttempt = canEndAttemptWindow(
    snapshot?.status ?? "idle",
    snapshot?.engineSnapshot?.terminal ?? null,
  );

  const cvQualityDiagnostic =
    snapshot === null
      ? null
      : resolveCvQualityDiagnostic(
          snapshot,
          videoRef.current?.videoWidth ?? 0,
          videoRef.current?.videoHeight ?? 0,
        );

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-[#F9FAFB]">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#1D9E75]">
          Creative Motion Lab · RASQ
        </p>
        <h1 className="mt-2 text-xl font-medium text-[#F9FAFB]">
          Lateral Reach Live Camera Spike
        </h1>
        <p className="mt-1 text-xs text-[#EF9F27]">
          Unlinked Experimental Clinician Lab
        </p>

        {/* Safety Disclaimer */}
        <div
          className="mt-5 rounded-[10px] border border-[#EF9F27] p-4"
          style={{ background: "rgba(239,159,39,0.08)", borderWidth: "0.5px" }}
        >
          <p className="text-xs leading-[1.8] text-[#FCD34D]">
            ⚠ Internal Development Environment
            <br />
            <br />
            This is an experimental integration spike for therapist and engineering review.
            <br />
            <br />
            <strong>Phase boundaries:</strong>
            <br />
            • Live camera input via MediaPipe Pose
            <br />
            • No patient data persistence
            <br />
            • No clinical assessment workflow
            <br />
            • No API integration
            <br />
            • No Supabase storage
            <br />
            <br />
            This lab validates software integration only. It does not constitute clinical
            measurement, patient assessment, or diagnostic evaluation. All observations require
            therapist review.
            <br />
            <br />
            <strong>Laterality experiment:</strong> This spike verifies whether MediaPipe
            anatomical joint identity (left_wrist/right_wrist) corresponds correctly to the
            selected tested side for front-facing camera input.
            <br />
            <br />
            <strong>Directional semantics:</strong> Lateral Reach tracks screen-space horizontal
            direction. Wrong-direction exit resets readiness. This is not anatomical scapular-plane
            verification or range-of-motion assessment.
          </p>
        </div>

        {/* Error Display */}
        {snapshot?.error && (
          <div className="mt-4 rounded-[8px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
            <p>{snapshot.error}</p>
            {isLegacyRetryEligible(snapshot.status, lastStartIntentionRef.current) && (
              <button
                type="button"
                onClick={handleStart}
                disabled={startInProgressRef.current}
                className="mt-3 rounded-[7px] border border-rose-400/30 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/10 disabled:opacity-50"
              >
                Retry
              </button>
            )}
            {snapshot.status === "error" && lastStartIntentionRef.current === "calibration" && (
              <p className="mt-3 text-[10px] text-[#9CA3AF]">
                Camera error during calibration startup. Click Reset Camera Error below, verify
                camera permissions, then try Start Calibration again.
              </p>
            )}
            {snapshot.status === "error" && lastStartIntentionRef.current === null && (
              <p className="mt-3 text-[10px] text-[#9CA3AF]">
                Camera error from unknown source. Click Reset Camera Error below to clear.
              </p>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="mt-6 space-y-4">
          {/* Tested Side Selection */}
          {snapshot?.status !== "running" &&
            calibrationLifecycle !== "starting" &&
            calibrationLifecycle !== "active" && (
              <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
                <p className="text-sm font-medium text-[#F9FAFB]">Tested Side</p>
                <p className="mt-1 text-xs text-[#6B7280]">
                  Select which anatomical side to track
                </p>
                <div className="mt-3 flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="testedSide"
                      value="right"
                      checked={testedSide === "right"}
                      onChange={() => setTestedSide("right")}
                      className="h-4 w-4 text-[#1D9E75]"
                    />
                    <span className="text-sm text-[#F9FAFB]">Right</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="testedSide"
                      value="left"
                      checked={testedSide === "left"}
                      onChange={() => setTestedSide("left")}
                      className="h-4 w-4 text-[#1D9E75]"
                    />
                    <span className="text-sm text-[#F9FAFB]">Left</span>
                  </label>
                </div>
              </div>
            )}

          {/* Slice 16 — pre-movement calibration attempt-plan intake (lab only) */}
          <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-medium text-[#F9FAFB]">
              Calibration attempt plan (screen-x)
            </p>
            <p className="mt-1 text-xs leading-[1.7] text-[#6B7280]">
              Pre-movement structured direction for a future calibration attempt. Values are
              raw normalized camera/screen x: positive_x = increasing raw x, negative_x =
              decreasing raw x. The CSS-mirrored preview does not change this stored value.
              Independent of testedSide. Not anatomical left/right. Not used by legacy Start
              Session.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="screenHorizontalDirection"
                  value="positive_x"
                  checked={screenHorizontalDirection === "positive_x"}
                  onChange={() => setScreenHorizontalDirection("positive_x")}
                  disabled={attemptPlanLock !== null}
                  className="h-4 w-4 text-[#1D9E75]"
                />
                <span className="text-sm text-[#F9FAFB]">
                  Positive normalized X (positive_x)
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="screenHorizontalDirection"
                  value="negative_x"
                  checked={screenHorizontalDirection === "negative_x"}
                  onChange={() => setScreenHorizontalDirection("negative_x")}
                  disabled={attemptPlanLock !== null}
                  className="h-4 w-4 text-[#1D9E75]"
                />
                <span className="text-sm text-[#F9FAFB]">
                  Negative normalized X (negative_x)
                </span>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleLockAttemptPlan}
                disabled={
                  attemptPlanLock !== null ||
                  !canLockLateralReachLabAttemptPlan(screenHorizontalDirection)
                }
                className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2 text-xs font-semibold text-[#F9FAFB] transition hover:border-[#1D9E75] disabled:opacity-50"
              >
                Confirm / lock attempt plan
              </button>
              <span className="text-xs text-[#6B7280]">
                Editable selection:{" "}
                <span className="font-mono text-[#9CA3AF]">
                  {screenHorizontalDirection ?? "null (unselected)"}
                </span>
              </span>
            </div>
            {attemptPlanLockError && (
              <p className="mt-3 text-xs text-rose-200">{attemptPlanLockError}</p>
            )}
            {attemptPlanLock && (
              <div className="mt-3 rounded-[8px] border border-[#1D9E75]/40 bg-[#0B1220] p-3 text-xs">
                <p className="font-semibold text-[#1D9E75]">Locked attempt plan</p>
                <p className="mt-2 text-[#9CA3AF]">
                  screenHorizontalDirection:{" "}
                  <span className="font-mono text-[#F9FAFB]">
                    {attemptPlanLock.lockedPlan.screenHorizontalDirection}
                  </span>
                </p>
                <p className="mt-1 text-[#9CA3AF]">
                  expectedHorizontalDirectionSign:{" "}
                  <span className="font-mono text-[#F9FAFB]">
                    {attemptPlanLock.lockedIntention.expectedHorizontalDirectionSign}
                  </span>
                </p>
                <p className="mt-2 text-[#6B7280]">
                  Diagnostics above are from the locked snapshot, not the editable radio
                  selection.
                </p>
              </div>
            )}
          </div>

          {/* Slice 17 — technical-config intake (lab only) */}
          <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-medium text-[#F9FAFB]">
              Technical Configuration (Experimental Lab Values)
            </p>
            <p className="mt-1 text-xs leading-[1.7] text-[#6B7280]">
              Explicit numeric parameters for calibration and engine runtime. These are
              lab-supplied experimental values — NOT production defaults, NOT clinically
              validated thresholds, NOT device-validated constants. All values require
              explicit entry. No production policy is established by this intake.
            </p>

            <div className="mt-3">
              <label htmlFor="config-input" className="block text-xs font-medium text-[#F9FAFB]">
                Configuration JSON (no defaults provided)
              </label>
              <textarea
                id="config-input"
                value={configInput}
                onChange={(e) => setConfigInput(e.target.value)}
                disabled={configLock !== null}
                rows={12}
                placeholder="Enter configuration JSON"
                className="mt-2 w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2 font-mono text-xs text-[#F9FAFB] placeholder-[#6B7280] disabled:opacity-50"
              />
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={handleLockTechnicalConfig}
                disabled={
                  configLock !== null ||
                  !canLockLateralReachLabTechnicalConfig(configInput)
                }
                className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2 text-xs font-semibold text-[#F9FAFB] transition hover:border-[#1D9E75] disabled:opacity-50"
              >
                Confirm / lock technical config
              </button>
            </div>

            {configLockError && (
              <p className="mt-3 text-xs text-rose-200">{configLockError}</p>
            )}

            {configLock && (
              <div className="mt-3 rounded-[8px] border border-[#1D9E75]/40 bg-[#0B1220] p-3 text-xs">
                <p className="font-semibold text-[#1D9E75]">
                  Locked Technical Configuration (Experimental Lab Snapshot)
                </p>
                <pre className="mt-2 overflow-x-auto text-[10px] text-[#9CA3AF]">
                  {JSON.stringify(configLock.lockedConfig, null, 2)}
                </pre>
                <p className="mt-2 text-[#6B7280]">
                  Diagnostics above are from the locked snapshot, not the editable textarea.
                </p>
              </div>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-[#1D9E75]">
                Structure Reference (no defaults)
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-[7px] border border-[#1E2D42] bg-[#0B1220] p-3 text-[10px] text-[#6B7280]">
{`{
  "startCaptureConfig": {
    "minStableDurationMs": <number >= 0>,
    "maxJitterRadius": <number >= 0>,
    "minStableSampleCount": <integer >= 1>,
    "totalTimeoutMs": <number >= minStableDurationMs>
  },
  "endpointCaptureConfig": {
    "minStableDurationMs": <number >= 0>,
    "maxJitterRadius": <number >= 0>,
    "minStableSampleCount": <integer >= 1>,
    "totalTimeoutMs": <number >= minStableDurationMs>,
    "minDisplacementFromStart": <number > 0>
  },
  "zoneRadii": {
    "startingZoneRadius": <number > 0>,
    "fixedTargetRadius": <number > 0>
  },
  "noiseFloor": {
    "minDirectionAlignedMagnitude": <number > 0>
  },
  "tracking": {
    "minWristVisibility": <number in [0,1]>,
    "maxAllowedGapMs": <number >= 0>
  },
  "timing": {
    "onsetConfirmationMs": <number >= 0>,
    "dwellDurationMs": <number >= 0>,
    "returnConfirmationMs": <number >= 0>
  }
}`}
              </pre>
            </details>
          </div>

          {/* Slice 18 — Calibration Startup */}
          <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-medium text-[#F9FAFB]">
              Calibration Startup (Slice 18)
            </p>
            <p className="mt-1 text-xs leading-[1.7] text-[#6B7280]">
              Explicit one-shot calibration attempt with acquisition lifecycle. Requires locked
              attempt plan and technical config. Defers controller capture start until detector
              confirms &quot;acquiring&quot;. Camera observations are bridged into the active
              calibration attempt (Slice 19). No engine activation (Slice 20).
            </p>

            {/* Calibration Lifecycle Diagnostic */}
            <div className="mt-3 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
              <p className="text-xs font-semibold text-[#F9FAFB]">
                Calibration Lifecycle:{" "}
                <span className="font-mono text-[#1D9E75]">{calibrationLifecycle}</span>
              </p>
              {activeController && (
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  Active Controller Phase:{" "}
                  <span className="font-mono text-[#F9FAFB]">{activeController.phase}</span>
                </p>
              )}
              {lastCalibrationOutcome && (
                <div className="mt-2 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <div className="text-xs font-semibold text-[#9CA3AF]">
                    Last Calibration Outcome (Lab Diagnostic)
                  </div>
                  <div className="mt-2 space-y-1 font-mono text-[10px] text-[#F9FAFB]">
                    <div>kind: {lastCalibrationOutcome.kind}</div>
                    {lastCalibrationOutcome.kind === "result" && (
                      <>
                        <div>captureOutcome: {lastCalibrationOutcome.result.captureOutcome}</div>
                        <div>geometryOutcome: {lastCalibrationOutcome.result.geometryOutcome}</div>
                        {lastCalibrationOutcome.result.captureOutcome === "failed" &&
                          lastCalibrationOutcome.result.geometryOutcome === "not_applicable" && (
                            <div>
                              failureReasons:{" "}
                              {JSON.stringify(lastCalibrationOutcome.result.failureReasons)}
                            </div>
                          )}
                        {lastCalibrationOutcome.result.geometryOutcome === "not_constructible" && (
                          <div>
                            geometryBlockers:{" "}
                            {JSON.stringify(lastCalibrationOutcome.result.geometryBlockers)}
                          </div>
                        )}
                        {lastCalibrationOutcome.result.observations?.startWrist && (
                          <div>
                            startWrist:{" "}
                            {JSON.stringify(lastCalibrationOutcome.result.observations.startWrist, null, 2)}
                          </div>
                        )}
                        {lastCalibrationOutcome.result.observations?.heldEndpoint && (
                          <div>
                            heldEndpoint:{" "}
                            {JSON.stringify(lastCalibrationOutcome.result.observations.heldEndpoint, null, 2)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
              {lastCalibrationAcquisitionDiagnostic && (
                <div className="mt-2 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <div className="text-xs font-semibold text-[#9CA3AF]">
                    Last Calibration Acquisition Diagnostic (Lab)
                  </div>
                  <div className="mt-2 space-y-1 font-mono text-[10px] text-[#F9FAFB]">
                    <div>
                      detectorStatus: {lastCalibrationAcquisitionDiagnostic.detectorStatus}
                    </div>
                    <div>
                      attempt testedSide:{" "}
                      {lastCalibrationAcquisitionDiagnostic.testedSide.toUpperCase()}
                    </div>
                    <div>
                      rawRightWristVisibility:{" "}
                      {lastCalibrationAcquisitionDiagnostic.rawRightWristVisibility !== null
                        ? lastCalibrationAcquisitionDiagnostic.rawRightWristVisibility.toFixed(3)
                        : "—"}
                    </div>
                    <div>
                      rawRightWristCoords:{" "}
                      {lastCalibrationAcquisitionDiagnostic.rawRightWristCoords
                        ? `(${lastCalibrationAcquisitionDiagnostic.rawRightWristCoords.x.toFixed(3)}, ${lastCalibrationAcquisitionDiagnostic.rawRightWristCoords.y.toFixed(3)})`
                        : "—"}
                    </div>
                    <div>
                      rawLeftWristVisibility:{" "}
                      {lastCalibrationAcquisitionDiagnostic.rawLeftWristVisibility !== null
                        ? lastCalibrationAcquisitionDiagnostic.rawLeftWristVisibility.toFixed(3)
                        : "—"}
                    </div>
                    <div>
                      rawLeftWristCoords:{" "}
                      {lastCalibrationAcquisitionDiagnostic.rawLeftWristCoords
                        ? `(${lastCalibrationAcquisitionDiagnostic.rawLeftWristCoords.x.toFixed(3)}, ${lastCalibrationAcquisitionDiagnostic.rawLeftWristCoords.y.toFixed(3)})`
                        : "—"}
                    </div>
                    <div>
                      normalizedFramePresent:{" "}
                      {lastCalibrationAcquisitionDiagnostic.normalizedFramePresent ? "yes" : "no"}
                    </div>
                    <div>
                      selectedWristPresentInFrame:{" "}
                      {lastCalibrationAcquisitionDiagnostic.selectedWristPresentInFrame
                        ? "yes"
                        : "no"}
                    </div>
                    <div>
                      selectedWristConfidencePresent:{" "}
                      {lastCalibrationAcquisitionDiagnostic.selectedWristConfidencePresent ===
                      null
                        ? "—"
                        : lastCalibrationAcquisitionDiagnostic.selectedWristConfidencePresent
                          ? "yes"
                          : "no"}
                    </div>
                    <div>
                      selectedWristVisibility:{" "}
                      {lastCalibrationAcquisitionDiagnostic.selectedWristVisibility !== null
                        ? lastCalibrationAcquisitionDiagnostic.selectedWristVisibility.toFixed(3)
                        : "—"}
                    </div>
                    <div>
                      frozen minWristVisibility:{" "}
                      {lastCalibrationAcquisitionDiagnostic.minWristVisibility.toFixed(3)}
                    </div>
                    <div>
                      trackingValid:{" "}
                      {lastCalibrationAcquisitionDiagnostic.trackingValid ? "yes" : "no"}
                    </div>
                    <div>
                      reasonLabel: {lastCalibrationAcquisitionDiagnostic.reasonLabel ?? "—"}
                    </div>
                    <div className="text-[#6B7280]">
                      capturedAtMs: {lastCalibrationAcquisitionDiagnostic.capturedAtMs.toFixed(1)}
                    </div>
                  </div>
                </div>
              )}
              {lastCalibrationEndpointDiagnostic && (
                <div className="mt-2 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <div className="text-xs font-semibold text-[#9CA3AF]">
                    Last Calibration Endpoint Diagnostic (Lab)
                  </div>
                  <div className="mt-2 space-y-1 font-mono text-[10px] text-[#F9FAFB]">
                    <div>
                      maxDisplacementFromStartSeen:{" "}
                      {lastCalibrationEndpointDiagnostic.maxDisplacementFromStartSeen.toFixed(4)}
                    </div>
                    <div>
                      currentStableSampleCount:{" "}
                      {lastCalibrationEndpointDiagnostic.currentStableSampleCount}
                    </div>
                    <div>
                      maxStableSampleCountSeen:{" "}
                      {lastCalibrationEndpointDiagnostic.maxStableSampleCountSeen}
                    </div>
                    <div>
                      endpointElapsedMs:{" "}
                      {lastCalibrationEndpointDiagnostic.endpointElapsedMs.toFixed(1)}
                    </div>
                    <div>
                      minDisplacementFromStart:{" "}
                      {lastCalibrationEndpointDiagnostic.minDisplacementFromStart.toFixed(4)}
                    </div>
                    <div>
                      maxJitterRadius:{" "}
                      {lastCalibrationEndpointDiagnostic.maxJitterRadius.toFixed(4)}
                    </div>
                    <div>
                      minStableDurationMs:{" "}
                      {lastCalibrationEndpointDiagnostic.minStableDurationMs}
                    </div>
                    <div>
                      minStableSampleCount:{" "}
                      {lastCalibrationEndpointDiagnostic.minStableSampleCount}
                    </div>
                    <div>
                      totalTimeoutMs: {lastCalibrationEndpointDiagnostic.totalTimeoutMs}
                    </div>
                    <div>
                      sawSpatialReset:{" "}
                      {lastCalibrationEndpointDiagnostic.sawSpatialReset ? "yes" : "no"}
                    </div>
                    <div>
                      sawTrackingInvalid:{" "}
                      {lastCalibrationEndpointDiagnostic.sawTrackingInvalid ? "yes" : "no"}
                    </div>
                    <div>
                      sawFramingInvalid:{" "}
                      {lastCalibrationEndpointDiagnostic.sawFramingInvalid ? "yes" : "no"}
                    </div>
                    <div className="text-[#6B7280]">
                      capturedAtMs: {lastCalibrationEndpointDiagnostic.capturedAtMs.toFixed(1)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Startup Error */}
            {startupError && (
              <div className="mt-3 rounded-[8px] border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                Startup Error: {startupError}
              </div>
            )}

            {/* Start Calibration Button */}
            {calibrationLifecycle === "idle" && snapshot?.status !== "running" && (
              <button
                type="button"
                onClick={handleStartCalibration}
                disabled={
                  !attemptPlanLock ||
                  !configLock ||
                  snapshot?.status === "initializing" ||
                  startInProgressRef.current
                }
                className="mt-3 rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165] disabled:opacity-50"
              >
                Start Calibration
              </button>
            )}

            {/* Cancel Calibration */}
            {(calibrationLifecycle === "starting" || calibrationLifecycle === "active") && (
              <button
                type="button"
                onClick={handleStop}
                className="mt-3 rounded-[7px] border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20"
              >
                {calibrationLifecycle === "starting" ? "Stop Startup" : "Cancel Calibration"}
              </button>
            )}
          </div>

          {/* Slice 20 — explicit engine handoff (lab only) */}
          {readyCalibrationResult && (
            <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
              <p className="text-sm font-medium text-[#F9FAFB]">
                Engine Handoff (Slice 20 — Lab)
              </p>
              <p className="mt-1 text-xs leading-[1.7] text-[#6B7280]">
                Explicit, one-shot activation of the existing Lateral Reach engine on the
                completed calibration&apos;s frozen geometry. Engineering wiring check only —
                pressing this button does not indicate clinical readiness or a valid
                assessment attempt.
              </p>

              {engineHandoffError && (
                <div className="mt-3 rounded-[8px] border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                  Engine Handoff Error: {engineHandoffError}
                </div>
              )}

              <button
                type="button"
                onClick={handleStartEngine}
                disabled={!canStartEngine}
                className="mt-3 rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165] disabled:opacity-50"
              >
                Start Engine From Calibration (Lab)
              </button>
            </div>
          )}

          {/* Start/Stop Buttons */}
          {/* Slice 20 QA fix — "acquiring" is a calibration-owned detector
              state (Slice 18); the legacy Start Session control does not
              apply here and would only be safely rejected if clicked, so it
              is not rendered during this status.
              Runtime QA fix — error state is gated by explicit provenance:
              calibration/unknown errors show Reset Camera Error instead. */}
          {snapshot?.status === "acquiring" ? null : snapshot?.status !== "running" ? (
            isLegacyStartSessionEligible(
              snapshot?.status ?? "idle",
              lastStartIntentionRef.current,
            ) ? (
              <button
                type="button"
                disabled={snapshot?.status === "initializing" || startInProgressRef.current}
                onClick={handleStart}
                className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165] disabled:opacity-50"
              >
                {snapshot?.status === "initializing"
                  ? snapshot.initPhase === "import"
                    ? "Loading pose library..."
                    : snapshot.initPhase === "model"
                      ? "Loading pose model..."
                      : "Starting camera..."
                  : "Start Session"}
              </button>
            ) : snapshot?.status === "error" ? (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-[7px] border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20"
              >
                Reset Camera Error
              </button>
            ) : null
          ) : (
            <div className="flex gap-3">
              {canArmReadiness && (
                <button
                  type="button"
                  onClick={handleArmReadiness}
                  className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165]"
                >
                  Arm Readiness
                </button>
              )}
              {snapshot?.readinessArmed && (
                <button
                  type="button"
                  onClick={handleDisarmReadiness}
                  className="rounded-[7px] bg-[#EF4444] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#DC2626]"
                >
                  Cancel Armed Readiness
                </button>
              )}
              {canResume && (
                <button
                  type="button"
                  onClick={handleResume}
                  className="rounded-[7px] bg-[#EF9F27] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#D68D1F]"
                >
                  Resume After Pause
                </button>
              )}
              {canEndAttempt && (
                <button
                  type="button"
                  onClick={handleEndAttemptWindow}
                  className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-semibold text-[#F9FAFB] transition hover:border-[#1D9E75]"
                >
                  End Attempt
                </button>
              )}
              <button
                type="button"
                onClick={handleStop}
                className="rounded-[7px] border border-[#1E2D42] bg-transparent px-4 py-2.5 text-sm font-semibold text-[#9CA3AF] transition hover:text-white"
              >
                Stop Session
              </button>
            </div>
          )}
        </div>

        {/* Video Preview */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
          aria-hidden
        />
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="mt-4 w-full rounded-[8px] border border-[#1E2D42] bg-[#0B1220]"
          style={{
            display: showVideo ? "block" : "none",
            transform: "scaleX(-1)", // Visual mirror only
          }}
        />

        {/* CV Quality Diagnostic (Lab) */}
        {cvQualityDiagnostic && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              CV Quality Diagnostic (Lab)
            </p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Read-only camera and pose evidence from the live detector snapshot. Does not
              gate calibration or engine behavior.
            </p>
            <div className="mt-4 space-y-1 font-mono text-[10px] text-[#F9FAFB]">
              <div>
                cameraResolution:{" "}
                {cvQualityDiagnostic.cameraResolution
                  ? `${cvQualityDiagnostic.cameraResolution.width} × ${cvQualityDiagnostic.cameraResolution.height}`
                  : "—"}
              </div>
              <div>detectorStatus: {cvQualityDiagnostic.detectorStatus}</div>
              <div>
                Wrist landmark evidence available:{" "}
                {cvQualityDiagnostic.wristLandmarkDataAvailable ? "yes" : "no"}
              </div>
              <div>
                rightWristVisibility:{" "}
                {cvQualityDiagnostic.rightWristVisibility !== null
                  ? cvQualityDiagnostic.rightWristVisibility.toFixed(3)
                  : "—"}
              </div>
              <div>
                leftWristVisibility:{" "}
                {cvQualityDiagnostic.leftWristVisibility !== null
                  ? cvQualityDiagnostic.leftWristVisibility.toFixed(3)
                  : "—"}
              </div>
              <div>
                rightWristCoords:{" "}
                {cvQualityDiagnostic.rightWristCoords
                  ? `(${cvQualityDiagnostic.rightWristCoords.x.toFixed(3)}, ${cvQualityDiagnostic.rightWristCoords.y.toFixed(3)})`
                  : "—"}
              </div>
              <div>
                leftWristCoords:{" "}
                {cvQualityDiagnostic.leftWristCoords
                  ? `(${cvQualityDiagnostic.leftWristCoords.x.toFixed(3)}, ${cvQualityDiagnostic.leftWristCoords.y.toFixed(3)})`
                  : "—"}
              </div>
              <div>
                rightEstimatedWristCoordsInFrame:{" "}
                {cvQualityDiagnostic.rightEstimatedWristCoordsInFrame.coordsInFrame === null
                  ? "—"
                  : cvQualityDiagnostic.rightEstimatedWristCoordsInFrame.coordsInFrame
                    ? "yes"
                    : "no"}
              </div>
              <div>
                leftEstimatedWristCoordsInFrame:{" "}
                {cvQualityDiagnostic.leftEstimatedWristCoordsInFrame.coordsInFrame === null
                  ? "—"
                  : cvQualityDiagnostic.leftEstimatedWristCoordsInFrame.coordsInFrame
                    ? "yes"
                    : "no"}
              </div>
            </div>
          </div>
        )}

        {/* Laterality Diagnostics */}
        {snapshot?.status === "running" && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              Laterality Diagnostics
            </p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Verify anatomical correspondence between raised arm and MediaPipe joint
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Selected Tested Side:</span>{" "}
                <span className="font-semibold text-[#F9FAFB]">
                  {snapshot.testedSide.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Right Wrist */}
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <p className="font-semibold text-[#F9FAFB]">
                    Right Wrist <span className="text-[#6B7280]">(index 16)</span>
                  </p>
                  <div className="mt-2 space-y-1">
                    <div>
                      <span className="text-[#9CA3AF]">Visibility:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.rightWristVisibility !== null
                          ? snapshot.rightWristVisibility.toFixed(2)
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized X:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.rightWristCoords?.x.toFixed(3) ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized Y:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.rightWristCoords?.y.toFixed(3) ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Left Wrist */}
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <p className="font-semibold text-[#F9FAFB]">
                    Left Wrist <span className="text-[#6B7280]">(index 15)</span>
                  </p>
                  <div className="mt-2 space-y-1">
                    <div>
                      <span className="text-[#9CA3AF]">Visibility:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.leftWristVisibility !== null
                          ? snapshot.leftWristVisibility.toFixed(2)
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized X:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.leftWristCoords?.x.toFixed(3) ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized Y:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.leftWristCoords?.y.toFixed(3) ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[#1E2D42]">
                <div>
                  <span className="text-[#9CA3AF]">Preview Visual Mirroring:</span>{" "}
                  <span className="font-semibold text-[#F9FAFB]">
                    YES (CSS scaleX(-1))
                  </span>
                </div>
                <div className="mt-1">
                  <span className="text-[#9CA3AF]">Coordinate Transform:</span>{" "}
                  <span className="font-semibold text-[#F9FAFB]">NO</span>
                </div>
                {snapshot.expectedHorizontalDirectionSign !== null && (
                  <div className="mt-1">
                    <span className="text-[#9CA3AF]">Expected Horizontal Direction Sign:</span>{" "}
                    <span className="font-mono text-[#F9FAFB]">
                      {snapshot.expectedHorizontalDirectionSign > 0 ? "+1 (rightward)" : "-1 (leftward)"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Armed Readiness Status */}
        {snapshot?.readinessArmed && (
          <div className="mt-6 rounded-[10px] border border-[#EF9F27] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#EF9F27]">
              Armed Readiness Active
            </p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Move the tested wrist into the starting zone. Readiness will confirm automatically when stable.
            </p>

            {snapshot.readinessArmedTimeRemaining !== null && (
              <div className="mt-3 text-xs">
                <span className="text-[#9CA3AF]">Time remaining:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {Math.ceil(snapshot.readinessArmedTimeRemaining / 1000)}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* Command Feedback */}
        {snapshot?.status === "running" && snapshot.lastCommandType && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              Last Command
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Type:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.lastCommandType}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Status:</span>{" "}
                <span
                  className={`font-semibold ${
                    snapshot.lastCommandStatus === "applied"
                      ? "text-[#1D9E75]"
                      : "text-rose-400"
                  }`}
                >
                  {snapshot.lastCommandStatus?.toUpperCase()}
                </span>
              </div>

              {snapshot.lastCommandStatus === "rejected" &&
                snapshot.lastCommandRejectionReason && (
                  <>
                    {/* User-friendly guidance */}
                    <div className="mt-3 rounded-[8px] border border-rose-400/25 bg-rose-400/10 p-3">
                      <p className="font-semibold text-rose-200">
                        {snapshot.lastCommandRejectionReason === "readiness_requires_wrist_in_starting_zone" &&
                          "Move the tested wrist into the starting zone, then confirm readiness."}
                        {snapshot.lastCommandRejectionReason === "resume_requires_readiness_confirmation" &&
                          "Confirm readiness first before resuming."}
                        {snapshot.lastCommandRejectionReason === "readiness_not_applicable_in_current_phase" &&
                          "Readiness can only be confirmed during idle or awaiting_readiness phase."}
                        {snapshot.lastCommandRejectionReason === "readiness_blocked_by_active_pause" &&
                          "Resume the active protective pause before confirming readiness."}
                        {snapshot.lastCommandRejectionReason === "no_active_pause_to_resume" &&
                          "No active pause to resume."}
                        {snapshot.lastCommandRejectionReason === "frame_timestamp_not_strictly_increasing" &&
                          "Frame timestamp was not strictly increasing (engine clock issue)."}
                        {!["readiness_requires_wrist_in_starting_zone", "resume_requires_readiness_confirmation", "readiness_not_applicable_in_current_phase", "readiness_blocked_by_active_pause", "no_active_pause_to_resume", "frame_timestamp_not_strictly_increasing"].includes(
                          snapshot.lastCommandRejectionReason,
                        ) &&
                          "Command could not be executed at this time."}
                      </p>
                    </div>

                    {/* Engineering diagnostic */}
                    <div className="mt-2 text-[10px] text-[#6B7280]">
                      Engine reason: {snapshot.lastCommandRejectionReason}
                    </div>
                  </>
                )}
            </div>
          </div>
        )}

        {/* Readiness Guidance */}
        {snapshot?.status === "running" &&
          snapshot.engineSnapshot &&
          (snapshot.engineSnapshot.phase === "idle" ||
            snapshot.engineSnapshot.phase === "awaiting_readiness") && (
            <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
              <p className="text-sm font-semibold text-[#F9FAFB]">
                Readiness Requirements
              </p>
              <p className="mt-1 text-xs text-[#6B7280]">
                Position the tested wrist in the starting zone
              </p>

              <div className="mt-4 space-y-2 text-xs">
                <div>
                  <span className="text-[#9CA3AF]">Tested Side:</span>{" "}
                  <span className="font-semibold text-[#F9FAFB]">
                    {snapshot.testedSide.toUpperCase()}
                  </span>
                </div>

                <div>
                  <span className="text-[#9CA3AF]">
                    {snapshot.testedSide === "right" ? "Right" : "Left"} Wrist Visibility:
                  </span>{" "}
                  <span className="font-mono text-[#F9FAFB]">
                    {snapshot.testedSide === "right"
                      ? snapshot.rightWristVisibility?.toFixed(2) ?? "—"
                      : snapshot.leftWristVisibility?.toFixed(2) ?? "—"}
                  </span>
                </div>

                <div>
                  <span className="text-[#9CA3AF]">
                    {snapshot.testedSide === "right" ? "Right" : "Left"} Wrist Position (x, y):
                  </span>{" "}
                  <span className="font-mono text-[#F9FAFB]">
                    {snapshot.testedSide === "right"
                      ? snapshot.rightWristCoords
                        ? `(${snapshot.rightWristCoords.x.toFixed(3)}, ${snapshot.rightWristCoords.y.toFixed(3)})`
                        : "—"
                      : snapshot.leftWristCoords
                        ? `(${snapshot.leftWristCoords.x.toFixed(3)}, ${snapshot.leftWristCoords.y.toFixed(3)})`
                        : "—"}
                  </span>
                </div>

                <div className="pt-2 border-t border-[#1E2D42]">
                  <div className="text-[#9CA3AF]">
                    Starting Zone (engineering reference):
                  </div>
                  <div className="mt-1 font-mono text-[#F9FAFB]">
                    Center: (0.300, 0.500)
                  </div>
                  <div className="font-mono text-[#F9FAFB]">Radius: 0.050</div>
                </div>
              </div>
            </div>
          )}

        {/* Engine State */}
        {snapshot?.engineSnapshot && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              Lateral Reach Engine State
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Phase:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.phase}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Terminal:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.terminal ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Active Pause:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.hasActivePause ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Target Reached:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.targetReached ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Dwell Confirmed:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.dwellConfirmed ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Return Completed:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.returnToStartCompleted ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Protective Pause Count:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.protectivePauseCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Terminal Result UI — lab-only diagnostic, no clinical interpretation */}
        {snapshot?.finalResult && (
          <div className="mt-6 rounded-[10px] border border-[#1D9E75]/40 bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#1D9E75]">
              Terminal Result (Lab Diagnostic)
            </p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Raw engine attemptResult from endAttemptWindow(). Engineering wiring check only —
              not a clinical outcome and not persisted.
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Completion State:</span>{" "}
                <span className="font-mono font-semibold text-[#F9FAFB]">
                  {snapshot.finalResult.completionState}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Target Reached:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.finalResult.targetReached === null
                    ? "—"
                    : snapshot.finalResult.targetReached
                      ? "Yes"
                      : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Dwell Confirmed:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.finalResult.dwellConfirmed === null
                    ? "—"
                    : snapshot.finalResult.dwellConfirmed
                      ? "Yes"
                      : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Return Completed:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.finalResult.returnToStartCompleted === null
                    ? "—"
                    : snapshot.finalResult.returnToStartCompleted
                      ? "Yes"
                      : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Tracking Quality:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.finalResult.trackingQualitySummary}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Protective Pause Count:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.finalResult.protectivePauseCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Safety Footer */}
        <div className="mt-8 rounded-[8px] border border-[#1E2D42] bg-[#0F1825] p-4">
          <p className="text-[11px] leading-relaxed text-[#6B7280]">
            <strong className="text-[#9CA3AF]">Output semantics:</strong> Screen-space wrist
            movement timing and path from live camera. Software movement-state transitions:
            readiness, onset (directional), outbound, dwelling, return. Protective pause behavior
            when tracking quality insufficient. Wrong-direction exit resets readiness. This does not
            measure range of motion, scapular-plane alignment, assess movement quality, grade
            impairment, or provide diagnostic information.
          </p>
        </div>

        {/* Back Link */}
        <div className="mt-6 text-center">
          <Link
            href="/clinician/assessments"
            className="inline-flex items-center gap-1.5 text-xs text-[#5DCAA5] hover:text-[#1D9E75]"
          >
            <span aria-hidden>←</span>
            Back to Assessment Center
          </Link>
        </div>
      </div>
    </main>
  );
}
