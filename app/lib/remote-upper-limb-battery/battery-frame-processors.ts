/**
 * Remote battery frame processors — thin wrappers over existing/new CV modules.
 */

import { BLAZEPOSE_ACQUISITION_ADAPTER, type InputAcquisitionContext } from "@/app/lib/input-acquisition";
import { FunctionalReachRepCounter } from "@/app/lib/cv/functional-reach-detector";
import type { SagittalHipRepPhase } from "@/app/lib/cv/sagittal-hip-rep-core";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { computeTorsoSpan } from "@/app/lib/cv/sagittal-hip-rep-core";
import {
  createShoulderAbductionReachDetectorState,
  updateShoulderAbductionReachDetector,
  type ShoulderAbductionReachDetectorState,
} from "@/app/lib/shoulder-rehabilitation/shoulder-abduction-reach-detector";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation/shoulder-abduction-reach-contract";
import {
  createShoulderFlexionPhaseState,
  tickShoulderFlexionPhase,
  type ShoulderFlexionPhaseState,
} from "./shoulder-flexion-phase";
import { computeShoulderFlexionElevationDegrees, computeShoulderFlexionElevationFromPoseLandmarks, canObserveShoulderFlexionArm } from "./shoulder-flexion-metrics";
import { DEFAULT_SHOULDER_FLEXION_THRESHOLDS } from "./shoulder-flexion-contract";
import {
  createElbowFlexionPhaseState,
  tickElbowFlexionPhase,
  type ElbowFlexionPhaseState,
} from "./elbow-flexion-phase";
import { computeElbowFlexionInteriorAngleDegrees } from "./elbow-flexion-metrics";
import { DEFAULT_ELBOW_FLEXION_THRESHOLDS } from "./elbow-flexion-contract";
import {
  blazeIndicesForSide,
  evaluateBatteryArmTracking,
  readArmVisibility,
  visibilityQualityFromValues,
} from "./battery-tracking";
import {
  computeBatteryReachExtent,
  computeReachDisplacementFromBaseline,
  createEmptyBatteryFunctionalReachTiming,
  FUNCTIONAL_REACH_TRACKING_LOSS_RESET_TICKS,
  REMOTE_BATTERY_FUNCTIONAL_REACH_REP_CONFIG,
  type BatteryFunctionalReachTiming,
} from "./battery-reach-extent";
import type { RemoteUpperLimbBatterySide } from "./types";

export type BatteryTrackingQuality = "good" | "fair" | "poor" | "unknown";

export type BatteryFrameProcessorSnapshot = {
  trackingReady: boolean;
  trackingQuality: BatteryTrackingQuality;
  trackingRejectionReason?: string | null;
  landmarkVisibility?: {
    testedSide: RemoteUpperLimbBatterySide;
    right: { shoulder: number; elbow: number; wrist: number };
    left: { shoulder: number; elbow: number; wrist: number };
  };
  repCount: number;
  lastRepPeak: number | null;
  completedPeaksDeg: number[];
  movementPhase: string;
  peakReachExtent: number | null;
  /** Live metric used by the active test FSM. Debug/overlay only. */
  currentAngleDeg: number | null;
  /** Why the latest repCount increase was accepted. Debug/overlay only. */
  lastRepAcceptReason: string | null;
  movementTrackingEnabled: boolean;
};

export type BatteryTestProcessor = {
  reset: () => void;
  beginMovementTracking: () => void;
  isMovementTrackingEnabled: () => boolean;
  getFunctionalReachTiming?: () => BatteryFunctionalReachTiming;
  processFrame: (
    landmarks: readonly PoseLandmark[],
    context: InputAcquisitionContext,
  ) => BatteryFrameProcessorSnapshot;
};

const BATTERY_FUNCTIONAL_REACH_DEV_LOG =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

export type BatteryFunctionalReachProcessor = BatteryTestProcessor;

/**
 * Battery functional reach counts one attempt only after baseline + forward excursion + return.
 * Raw counter repCount can increment at peak entry; orchestrator must see repCount 0 until rest.
 */
export function resolveFunctionalReachCompletedAttempts(input: {
  movementTrackingEnabled: boolean;
  baselineReachExtent: number | null;
  internalRepCount: number;
  repPhase: SagittalHipRepPhase;
}): number {
  if (!input.movementTrackingEnabled) return 0;
  if (input.baselineReachExtent === null) return 0;
  if (input.internalRepCount < 1) return 0;
  // Rise-polarity FSM increments internalRepCount at peak entry; only count
  // finished cycles (return to rest). While forward, show prior completions.
  if (input.repPhase !== "rest") {
    return Math.max(0, input.internalRepCount - 1);
  }
  return input.internalRepCount;
}

function mapSide(side: RemoteUpperLimbBatterySide): ShoulderAbductionReachSide {
  return side;
}

function normalizeFrame(landmarks: readonly PoseLandmark[], context: InputAcquisitionContext) {
  return BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
}

function buildLandmarkVisibilityDebug(
  landmarks: readonly PoseLandmark[],
  side: RemoteUpperLimbBatterySide,
) {
  return {
    testedSide: side,
    right: readArmVisibility(landmarks, "right"),
    left: readArmVisibility(landmarks, "left"),
  };
}

function armTrackingSnapshot(input: {
  landmarks: readonly PoseLandmark[];
  side: RemoteUpperLimbBatterySide;
  requiredParts: readonly ("shoulder" | "elbow" | "wrist")[];
  metricReady: boolean;
}) {
  const evaluation = evaluateBatteryArmTracking(input);
  return {
    trackingReady: evaluation.ready,
    trackingQuality: evaluation.quality,
    trackingRejectionReason: evaluation.rejectionReason,
    landmarkVisibility: buildLandmarkVisibilityDebug(input.landmarks, input.side),
  };
}

function idleMovementSnapshot(
  tracking: ReturnType<typeof armTrackingSnapshot>,
): BatteryFrameProcessorSnapshot {
  return {
    ...tracking,
    repCount: 0,
    lastRepPeak: null,
    completedPeaksDeg: [],
    movementPhase: "idle",
    peakReachExtent: null,
    currentAngleDeg: null,
    lastRepAcceptReason: null,
    movementTrackingEnabled: false,
  };
}

function describeCycleRepAccept(input: {
  testId: "shoulderAbduction" | "shoulderFlexion" | "elbowFlexion";
  peakDeg: number | null;
  angleDeg: number | null;
}): string {
  const peak = input.peakDeg === null ? "n/a" : input.peakDeg.toFixed(1);
  const angle = input.angleDeg === null ? "n/a" : input.angleDeg.toFixed(1);
  return `${input.testId}: accepted rest→peak→return (peak ${peak}°, now ${angle}°)`;
}

export function createShoulderAbductionProcessor(side: RemoteUpperLimbBatterySide): BatteryTestProcessor {
  let state: ShoulderAbductionReachDetectorState = createShoulderAbductionReachDetectorState();
  let lastRepCount = 0;
  let lastRepPeak: number | null = null;
  let completedPeaks: number[] = [];
  let movementTrackingEnabled = false;
  let lastRepAcceptReason: string | null = null;

  const resetTrackingState = () => {
    state = createShoulderAbductionReachDetectorState();
    lastRepCount = 0;
    lastRepPeak = null;
    completedPeaks = [];
    movementTrackingEnabled = false;
    lastRepAcceptReason = null;
  };

  return {
    reset: resetTrackingState,
    beginMovementTracking() {
      resetTrackingState();
      movementTrackingEnabled = true;
    },
    isMovementTrackingEnabled: () => movementTrackingEnabled,
    processFrame(landmarks, context) {
      if (!movementTrackingEnabled) {
        const quality = visibilityQualityFromValues(
          blazeIndicesForSide(side, ["shoulder", "elbow", "wrist"]).map(
            (index) => landmarks[index]?.visibility ?? 0,
          ),
        );
        return idleMovementSnapshot({
          trackingReady: quality !== "poor" && quality !== "unknown",
          trackingQuality: quality,
          trackingRejectionReason:
            quality === "poor" || quality === "unknown" ? `visibility_${quality}` : null,
          landmarkVisibility: buildLandmarkVisibilityDebug(landmarks, side),
        });
      }

      const result = updateShoulderAbductionReachDetector(state, landmarks, context);
      const primary = side === "right" ? result.right : result.left;
      const trackingReady = primary.abductionAngleDegrees !== null;
      if (primary.repCount > lastRepCount) {
        lastRepPeak = primary.peakAngleDegrees;
        if (primary.peakAngleDegrees !== null) {
          completedPeaks.push(primary.peakAngleDegrees);
        }
        lastRepAcceptReason = describeCycleRepAccept({
          testId: "shoulderAbduction",
          peakDeg: primary.peakAngleDegrees,
          angleDeg: primary.abductionAngleDegrees,
        });
        lastRepCount = primary.repCount;
      }
      return {
        trackingReady,
        trackingQuality: visibilityQualityFromValues(
          blazeIndicesForSide(side, ["shoulder", "elbow", "wrist"]).map(
            (index) => landmarks[index]?.visibility ?? 0,
          ),
        ),
        trackingRejectionReason: trackingReady ? null : "abduction_angle_unavailable",
        landmarkVisibility: buildLandmarkVisibilityDebug(landmarks, side),
        repCount: primary.repCount,
        lastRepPeak,
        completedPeaksDeg: [...completedPeaks],
        movementPhase: primary.phase,
        peakReachExtent: null,
        currentAngleDeg: primary.abductionAngleDegrees,
        lastRepAcceptReason,
        movementTrackingEnabled: true,
      };
    },
  };
}

export function createShoulderFlexionProcessor(side: RemoteUpperLimbBatterySide): BatteryTestProcessor {
  let state: ShoulderFlexionPhaseState = createShoulderFlexionPhaseState();
  let lastRepCount = 0;
  let lastRepPeak: number | null = null;
  let movementTrackingEnabled = false;
  let lastRepAcceptReason: string | null = null;

  const resetTrackingState = () => {
    state = createShoulderFlexionPhaseState();
    lastRepCount = 0;
    lastRepPeak = null;
    movementTrackingEnabled = false;
    lastRepAcceptReason = null;
  };

  return {
    reset: resetTrackingState,
    beginMovementTracking() {
      resetTrackingState();
      movementTrackingEnabled = true;
    },
    isMovementTrackingEnabled: () => movementTrackingEnabled,
    processFrame(landmarks, context) {
      const frame = normalizeFrame(landmarks, context);
      const elevationFromFrame = frame
        ? computeShoulderFlexionElevationDegrees(frame, mapSide(side), DEFAULT_SHOULDER_FLEXION_THRESHOLDS.minJointConfidence)
        : null;
      const elevation =
        elevationFromFrame ??
        computeShoulderFlexionElevationFromPoseLandmarks(
          landmarks,
          mapSide(side),
          DEFAULT_SHOULDER_FLEXION_THRESHOLDS.minJointConfidence,
        );
      const tracking = armTrackingSnapshot({
        landmarks,
        side,
        requiredParts: ["shoulder", "elbow"],
        metricReady:
          canObserveShoulderFlexionArm(
            landmarks,
            mapSide(side),
            DEFAULT_SHOULDER_FLEXION_THRESHOLDS.minJointConfidence,
          ) || elevation !== null,
      });
      if (!movementTrackingEnabled) {
        return idleMovementSnapshot(tracking);
      }

      tickShoulderFlexionPhase(state, elevation, DEFAULT_SHOULDER_FLEXION_THRESHOLDS);
      if (state.repCount > lastRepCount) {
        lastRepPeak = state.completedPeaksDeg.at(-1) ?? state.peakElevationDegrees;
        lastRepAcceptReason = describeCycleRepAccept({
          testId: "shoulderFlexion",
          peakDeg: lastRepPeak,
          angleDeg: elevation,
        });
        lastRepCount = state.repCount;
      }
      return {
        ...tracking,
        repCount: state.repCount,
        lastRepPeak,
        completedPeaksDeg: [...state.completedPeaksDeg],
        movementPhase: state.phase,
        peakReachExtent: null,
        currentAngleDeg: elevation,
        lastRepAcceptReason,
        movementTrackingEnabled: true,
      };
    },
  };
}

export function createElbowFlexionProcessor(side: RemoteUpperLimbBatterySide): BatteryTestProcessor {
  let state: ElbowFlexionPhaseState = createElbowFlexionPhaseState();
  let lastRepCount = 0;
  let lastRepPeak: number | null = null;
  let movementTrackingEnabled = false;
  let lastRepAcceptReason: string | null = null;

  const resetTrackingState = () => {
    state = createElbowFlexionPhaseState();
    lastRepCount = 0;
    lastRepPeak = null;
    movementTrackingEnabled = false;
    lastRepAcceptReason = null;
  };

  return {
    reset: resetTrackingState,
    beginMovementTracking() {
      resetTrackingState();
      movementTrackingEnabled = true;
    },
    isMovementTrackingEnabled: () => movementTrackingEnabled,
    processFrame(landmarks, context) {
      const frame = normalizeFrame(landmarks, context);
      const interiorAngle = frame
        ? computeElbowFlexionInteriorAngleDegrees(
            frame,
            mapSide(side),
            DEFAULT_ELBOW_FLEXION_THRESHOLDS.minJointConfidence,
          )
        : null;
      const tracking = armTrackingSnapshot({
        landmarks,
        side,
        requiredParts: ["shoulder", "elbow", "wrist"],
        metricReady: interiorAngle !== null,
      });
      if (!movementTrackingEnabled) {
        return idleMovementSnapshot(tracking);
      }

      tickElbowFlexionPhase(state, interiorAngle, DEFAULT_ELBOW_FLEXION_THRESHOLDS);
      if (state.repCount > lastRepCount) {
        lastRepPeak = state.completedPeaksDeg.at(-1) ?? state.peakFlexionAngleDegrees;
        lastRepAcceptReason = describeCycleRepAccept({
          testId: "elbowFlexion",
          peakDeg: lastRepPeak,
          angleDeg: interiorAngle,
        });
        lastRepCount = state.repCount;
      }
      return {
        ...tracking,
        repCount: state.repCount,
        lastRepPeak,
        completedPeaksDeg: [...state.completedPeaksDeg],
        movementPhase: state.phase,
        peakReachExtent: null,
        currentAngleDeg: interiorAngle,
        lastRepAcceptReason,
        movementTrackingEnabled: true,
      };
    },
  };
}

export function createFunctionalReachProcessor(
  side: RemoteUpperLimbBatterySide,
): BatteryFunctionalReachProcessor {
  const reachConfig = REMOTE_BATTERY_FUNCTIONAL_REACH_REP_CONFIG;
  const counter = new FunctionalReachRepCounter(reachConfig);
  let movementTrackingEnabled = false;
  let baselineStarted = false;
  let minReachExtent: number | null = null;
  let peakReachExtent: number | null = null;
  let lastCompletedAttempts = 0;
  let consecutiveUnusableFrames = 0;
  let lastRepAcceptReason: string | null = null;
  let timing = createEmptyBatteryFunctionalReachTiming();
  let hadBaseline = false;
  let hadPeakPhase = false;

  const resetTiming = () => {
    timing = createEmptyBatteryFunctionalReachTiming();
    hadBaseline = false;
    hadPeakPhase = false;
  };

  const resetTrackingState = () => {
    counter.resetBaseline();
    counter.resetReps();
    movementTrackingEnabled = false;
    baselineStarted = false;
    minReachExtent = null;
    peakReachExtent = null;
    lastCompletedAttempts = 0;
    consecutiveUnusableFrames = 0;
    lastRepAcceptReason = null;
    resetTiming();
  };

  const recalibrateAfterTrackingLoss = () => {
    counter.resetBaseline();
    counter.resetReps();
    baselineStarted = false;
    minReachExtent = null;
    peakReachExtent = null;
    lastCompletedAttempts = 0;
    consecutiveUnusableFrames = 0;
    lastRepAcceptReason = null;
    resetTiming();
  };

  const beginMovementTracking = () => {
    resetTrackingState();
    movementTrackingEnabled = true;
  };

  const logReachTiming = (event: string, nowMs: number, extra?: Record<string, unknown>) => {
    if (!BATTERY_FUNCTIONAL_REACH_DEV_LOG) return;
    console.info("[battery-functional-reach-timing]", {
      event,
      testedSide: side,
      nowMs,
      movementStartedAtMs: timing.movementStartedAtMs,
      msSinceMovementStart:
        timing.movementStartedAtMs === null ? null : nowMs - timing.movementStartedAtMs,
      ...extra,
    });
  };

  return {
    reset: resetTrackingState,
    beginMovementTracking,
    isMovementTrackingEnabled: () => movementTrackingEnabled,
    getFunctionalReachTiming: () => timing,
    processFrame(landmarks, context) {
      const nowMs = context.capturedAtMs;
      const testedVisibility = readArmVisibility(landmarks, side);
      const trackingReady =
        testedVisibility.shoulder >= reachConfig.minShoulderVisibility &&
        testedVisibility.wrist >= reachConfig.minWristVisibility;
      const quality = visibilityQualityFromValues([
        testedVisibility.shoulder,
        testedVisibility.wrist,
      ]);
      const reachExtent = computeBatteryReachExtent(landmarks, side);
      const trackingUsable =
        trackingReady && quality !== "poor" && quality !== "unknown" && reachExtent !== null;

      if (movementTrackingEnabled) {
        if (timing.movementStartedAtMs === null) {
          timing.movementStartedAtMs = nowMs;
          logReachTiming("movement_tracking_started", nowMs);
        }
        if (!trackingUsable) {
          consecutiveUnusableFrames += 1;
          if (consecutiveUnusableFrames >= FUNCTIONAL_REACH_TRACKING_LOSS_RESET_TICKS) {
            recalibrateAfterTrackingLoss();
            movementTrackingEnabled = true;
          }
        } else {
          consecutiveUnusableFrames = 0;
          if (!baselineStarted) {
            counter.startBaselineWindow(nowMs);
            baselineStarted = true;
            logReachTiming("baseline_window_started", nowMs, {
              baselineDurationMs: reachConfig.baselineDurationMs,
            });
          }
          const torsoSpan = computeTorsoSpan(landmarks as PoseLandmark[]);
          counter.driveFrame(reachExtent, nowMs, torsoSpan);
          const liveSnapshot = counter.getSnapshot();
          if (liveSnapshot.baselineReachExtent !== null) {
            minReachExtent =
              minReachExtent === null ? reachExtent : Math.min(minReachExtent, reachExtent);
            peakReachExtent = computeReachDisplacementFromBaseline(
              liveSnapshot.baselineReachExtent,
              minReachExtent,
            );
          }
        }
      }

      const snapshot = counter.getSnapshot();
      if (
        movementTrackingEnabled &&
        snapshot.baselineReachExtent !== null &&
        !hadBaseline
      ) {
        hadBaseline = true;
        timing.baselineFinalizedAtMs = nowMs;
        logReachTiming("baseline_finalized", nowMs, {
          baselineReachExtent: snapshot.baselineReachExtent,
        });
      }
      if (
        movementTrackingEnabled &&
        snapshot.repPhase === "peak" &&
        !hadPeakPhase
      ) {
        hadPeakPhase = true;
        timing.forwardPeakRecognizedAtMs = nowMs;
        logReachTiming("forward_peak_recognized", nowMs, {
          reachExtent,
          peakReachExtent,
        });
      }
      const completedAttempts = resolveFunctionalReachCompletedAttempts({
        movementTrackingEnabled,
        baselineReachExtent: snapshot.baselineReachExtent,
        internalRepCount: snapshot.repCount,
        repPhase: snapshot.repPhase,
      });
      const lastRepPeak =
        completedAttempts > lastCompletedAttempts ? peakReachExtent : null;
      if (completedAttempts > lastCompletedAttempts) {
        lastCompletedAttempts = completedAttempts;
        timing.attemptCompletedAtMs = nowMs;
        logReachTiming("attempt_completed", nowMs, {
          peakReachExtent,
          reachExtent,
        });
        lastRepAcceptReason =
          "functionalReach: accepted baseline→forward excursion→return to rest";
      }

      return {
        trackingReady,
        trackingQuality: quality,
        trackingRejectionReason: trackingReady
          ? quality === "poor"
            ? "visibility_poor"
            : null
          : "reach_landmarks_not_visible",
        landmarkVisibility: buildLandmarkVisibilityDebug(landmarks, side),
        repCount: completedAttempts,
        lastRepPeak,
        completedPeaksDeg: peakReachExtent !== null ? [peakReachExtent] : [],
        movementPhase: movementTrackingEnabled ? snapshot.repPhase : "idle",
        peakReachExtent,
        currentAngleDeg: peakReachExtent,
        lastRepAcceptReason,
        movementTrackingEnabled,
      };
    },
  };
}

export function createPreviewPositionProcessor(side: RemoteUpperLimbBatterySide): BatteryTestProcessor {
  return {
    reset() {},
    beginMovementTracking() {},
    isMovementTrackingEnabled: () => false,
    processFrame(landmarks) {
      const tracking = armTrackingSnapshot({
        landmarks,
        side,
        requiredParts: ["shoulder", "elbow"],
        metricReady: landmarks.length > 0,
      });
      return {
        ...tracking,
        repCount: 0,
        lastRepPeak: null,
        completedPeaksDeg: [],
        movementPhase: "preview",
        peakReachExtent: null,
        currentAngleDeg: null,
        lastRepAcceptReason: null,
        movementTrackingEnabled: false,
      };
    },
  };
}

export function createBatteryTestProcessor(
  testId: "shoulderAbduction" | "shoulderFlexion" | "elbowFlexion" | "functionalReach",
  side: RemoteUpperLimbBatterySide,
): BatteryTestProcessor {
  switch (testId) {
    case "shoulderAbduction":
      return createShoulderAbductionProcessor(side);
    case "shoulderFlexion":
      return createShoulderFlexionProcessor(side);
    case "elbowFlexion":
      return createElbowFlexionProcessor(side);
    case "functionalReach":
      return createFunctionalReachProcessor(side);
  }
}
