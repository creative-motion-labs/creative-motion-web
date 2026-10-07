/**
 * Shoulder Abduction Reach — detector orchestrator (v0).
 *
 * Ties together the Input Acquisition Layer (raw landmarks → normalized
 * frame), Motion Intelligence Core (frame contract validation, angle
 * computation), and this module's own metrics/phase logic. State is
 * threaded explicitly and mutated in place by `updateShoulderAbductionReachDetector`
 * — no class, no hidden internal state, matching the pure-function style of
 * `app/lib/input-acquisition` and the STS shadow-mode module rather than
 * the legacy class-based `SitToStandDetector`.
 *
 * Not wired into any live capture loop, component, or API route. Feed it a
 * recorded or synthetic landmark sequence; get back per-frame results.
 */

import { validateNormalizedMotionFrame, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  BLAZEPOSE_ACQUISITION_ADAPTER,
  type InputAcquisitionContext,
} from "@/app/lib/input-acquisition";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS,
  type ShoulderAbductionReachSide,
  type ShoulderAbductionReachThresholds,
} from "./shoulder-abduction-reach-contract";
import {
  computeBilateralAbductionAngleDifference,
  computeShoulderAbductionReachSideMetrics,
  type ShoulderAbductionReachSideMetrics,
} from "./shoulder-abduction-reach-metrics";
import {
  createShoulderAbductionReachPhaseState,
  tickShoulderAbductionReachPhase,
  type ShoulderAbductionReachPhaseState,
} from "./shoulder-abduction-reach-phase";

export type ShoulderAbductionReachDetectorState = {
  left: ShoulderAbductionReachPhaseState;
  right: ShoulderAbductionReachPhaseState;
};

export function createShoulderAbductionReachDetectorState(): ShoulderAbductionReachDetectorState {
  return {
    left: createShoulderAbductionReachPhaseState(),
    right: createShoulderAbductionReachPhaseState(),
  };
}

export type ShoulderAbductionReachSideResult = ShoulderAbductionReachSideMetrics & {
  phase: ShoulderAbductionReachPhaseState["phase"];
  repCount: number;
  peakAngleDegrees: number | null;
};

export type ShoulderAbductionReachFrameResult = {
  frameIndex: number;
  capturedAtMs: number;
  /** Whether the Input Acquisition Layer produced a frame that passes Motion Intelligence Core's own contract validation. */
  frameContractValid: boolean;
  left: ShoulderAbductionReachSideResult;
  right: ShoulderAbductionReachSideResult;
  bilateralAngleDifferenceDegrees: number | null;
};

function sideResult(
  frame: NormalizedMotionFrame | null,
  side: ShoulderAbductionReachSide,
  phaseState: ShoulderAbductionReachPhaseState,
  thresholds: ShoulderAbductionReachThresholds,
): ShoulderAbductionReachSideResult {
  const metrics = frame
    ? computeShoulderAbductionReachSideMetrics(frame, side, thresholds.minJointConfidence)
    : { side, abductionAngleDegrees: null, wristOffsetFromShoulder: null };

  tickShoulderAbductionReachPhase(phaseState, metrics.abductionAngleDegrees, thresholds);

  return {
    ...metrics,
    phase: phaseState.phase,
    repCount: phaseState.repCount,
    peakAngleDegrees: phaseState.peakAngleDegrees,
  };
}

/**
 * Advance both sides' phase/rep state for a frame with no pose landmarks at all.
 * Uses the same unusable-frame handling as a frame whose angle cannot be computed,
 * so confirmation streaks do not survive missing-landmark frames.
 */
export function advanceShoulderAbductionReachDetectorWithoutLandmarks(
  state: ShoulderAbductionReachDetectorState,
  thresholds: ShoulderAbductionReachThresholds = DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS,
): void {
  tickShoulderAbductionReachPhase(state.left, null, thresholds);
  tickShoulderAbductionReachPhase(state.right, null, thresholds);
}

/**
 * Process one frame's raw landmarks through the full pipeline and advance
 * both sides' phase/rep state in place. Returns a snapshot of the result for
 * this frame; state mutation is the source of truth for rep counts across
 * calls.
 */
export function updateShoulderAbductionReachDetector(
  state: ShoulderAbductionReachDetectorState,
  landmarks: readonly PoseLandmark[],
  context: InputAcquisitionContext,
  thresholds: ShoulderAbductionReachThresholds = DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS,
): ShoulderAbductionReachFrameResult {
  const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
  // The adapter only ever returns null or an already-well-formed frame (see
  // blazepose-acquisition-adapter.ts), so this check is a reported
  // diagnostic, not a gate — per-side metrics below independently handle
  // individual missing joints regardless of overall frame validity.
  const frameContractValid = frame !== null && validateNormalizedMotionFrame(frame).valid;

  const left = sideResult(frame, "left", state.left, thresholds);
  const right = sideResult(frame, "right", state.right, thresholds);

  return {
    frameIndex: context.frameIndex,
    capturedAtMs: context.capturedAtMs,
    frameContractValid,
    left,
    right,
    bilateralAngleDifferenceDegrees: computeBilateralAbductionAngleDifference(
      left.abductionAngleDegrees,
      right.abductionAngleDegrees,
    ),
  };
}
