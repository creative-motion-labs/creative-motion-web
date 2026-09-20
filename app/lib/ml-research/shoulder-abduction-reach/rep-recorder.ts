/**
 * Shoulder Abduction Reach — dev-only ML research per-repetition recorder.
 * RASQ ML bridge, Slice 1 (2026-08-19); capture-hygiene fixes in Slice 1.1
 * (2026-08-19).
 *
 * A pure, stateful accumulator that turns a per-frame stream into completed
 * `ShoulderAbductionReachRepCaptureRecord`s. It has NO knowledge of angle
 * thresholds, phase transitions, or rep-counting rules — those all remain
 * owned exclusively by `shoulder-abduction-reach-phase.ts`'s
 * `tickShoulderAbductionReachPhase`. This module only WATCHES the phase and
 * repCount values that module already produces:
 *
 *  - Frames are buffered while `phase` is not "resting" (i.e. an attempt is
 *    in progress: "raising", "peak_abduction", "lowering", or "unknown"
 *    mid-attempt). Resting-phase frames are NOT buffered into the time series,
 *    but the most recent resting snapshot is frozen as the pre-onset trunk
 *    baseline for derived features (features-v2) — see `lastRestingJoints`.
 *  - When `phase` returns to "resting", the buffer is finalized IF `repCount`
 *    grew since the previous tick (mirrors the phase FSM's own "only counts
 *    if the peak band was reached" rule) — otherwise the buffer is discarded
 *    as an aborted attempt (arm raised but never reached peak, or tracking
 *    was lost mid-rep; see `tickShoulderAbductionReachPhase`'s own "known
 *    limitation" comment).
 *  - A buffer the phase FSM completed is THEN checked against a technical
 *    capture-validity gate (frame count + usable-tracking ratio — see
 *    `MIN_TECHNICAL_VALID_FRAMES`/`MIN_TECHNICAL_USABLE_ANGLE_RATIO` below).
 *    Only a buffer that passes both the FSM's own completion rule AND this
 *    gate is emitted as `completedRep`. A buffer the FSM completed but that
 *    fails the gate (a real live-capture session produced several 1-frame /
 *    0ms "stub" repetitions — see the Slice 1.1 project report for root
 *    cause) is reported as `rejectedCapture` instead: visible to the caller,
 *    never silently dropped, and never exported as if it were a clean
 *    repetition.
 *
 * This keeps rep-boundary detection as a single source of truth (the
 * existing phase FSM) instead of a second, parallel implementation — the
 * validity gate only decides whether an FSM-completed buffer is trustworthy
 * enough to persist, it never invents its own notion of what a repetition is.
 */

import {
  DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS,
  type ShoulderAbductionReachPhase,
  type ShoulderAbductionReachSide,
} from "@/app/lib/shoulder-rehabilitation";
import { computeCapturedAngleTrace, computeShoulderAbductionReachDerivedFeatures } from "./derived-features";
import type {
  MlResearchCapturedJoints,
  ShoulderAbductionReachCapturedFrame,
  ShoulderAbductionReachRepCaptureContext,
  ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";

/**
 * Minimum captured frames for a completed buffer to be technically valid.
 * Reuses `poseLostUnknownMinTicks` from the EXISTING phase FSM thresholds —
 * the same "how many consecutive frames separate signal from noise" boundary
 * already established elsewhere in this codebase for this exact exercise,
 * not a newly invented number. Every genuinely usable repetition in the
 * first real live-capture session had at least 20 frames; every degenerate
 * stub had 1.
 */
export const MIN_TECHNICAL_VALID_FRAMES: number =
  DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS.poseLostUnknownMinTicks;

/**
 * Minimum fraction of a completed buffer's frames that must have produced a
 * usable angle. Reuses the existing "poor" tracking-quality boundary
 * (ratio < 0.5) already defined by
 * `ShoulderAbductionReachPoseDetector.computeTrackingQuality()` — not a new
 * threshold invented for this gate.
 */
export const MIN_TECHNICAL_USABLE_ANGLE_RATIO = 0.5;

export type ShoulderAbductionReachRejectedCaptureReason =
  | "too_few_frames"
  | "insufficient_usable_tracking";

/**
 * A buffer the phase FSM completed (repCount grew) but that failed the
 * technical capture-validity gate. Deliberately NOT a
 * `ShoulderAbductionReachRepCaptureRecord` — it must never be exported or
 * mistaken for a clean repetition by a caller.
 */
export type ShoulderAbductionReachRejectedCapture = {
  side: ShoulderAbductionReachSide;
  reason: ShoulderAbductionReachRejectedCaptureReason;
  frameCount: number;
  usableAngleFrameCount: number;
  durationMs: number;
};

export type ShoulderAbductionReachRepRecorderState = {
  buffer: ShoulderAbductionReachCapturedFrame[];
  bufferStartCapturedAtMs: number | null;
  previousPhase: ShoulderAbductionReachPhase;
  previousRepCount: number;
  /** Count of repetitions this recorder has emitted so far, for repetitionIndex/Id. */
  emittedRepCount: number;
  /**
   * Most recent resting-phase joint snapshot — frozen as the pre-onset trunk
   * baseline for the next completed repetition. Updated on every resting tick
   * AFTER any in-progress attempt finalizes, so the completion tick itself
   * does not overwrite the pre-raise baseline for the rep being finalized.
   */
  lastRestingJoints: MlResearchCapturedJoints | null;
};

export function createShoulderAbductionReachRepRecorderState(): ShoulderAbductionReachRepRecorderState {
  return {
    buffer: [],
    bufferStartCapturedAtMs: null,
    previousPhase: "resting",
    previousRepCount: 0,
    emittedRepCount: 0,
    lastRestingJoints: null,
  };
}

export type ShoulderAbductionReachRepRecorderTickInput = {
  joints: MlResearchCapturedJoints;
  phase: ShoulderAbductionReachPhase;
  repCount: number;
  capturedAtMs: number;
};

export type ShoulderAbductionReachRepRecorderTickOutput = {
  /** A completed, technically-valid repetition, ready to persist — or null on ticks that don't finalize one. */
  completedRep: ShoulderAbductionReachRepCaptureRecord | null;
  /** An FSM-completed buffer that failed the technical validity gate — see module doc comment. Never a valid rep. */
  rejectedCapture: ShoulderAbductionReachRejectedCapture | null;
};

function isInAttemptPhase(phase: ShoulderAbductionReachPhase): boolean {
  return phase !== "resting";
}

/**
 * Advance the recorder by one frame. Mutates `state` in place, matching the
 * mutate-in-place convention already used by
 * `tickShoulderAbductionReachPhase` and
 * `updateShoulderAbductionReachCompensation`.
 */
export function tickShoulderAbductionReachRepRecorder(
  state: ShoulderAbductionReachRepRecorderState,
  input: ShoulderAbductionReachRepRecorderTickInput,
  context: Pick<
    ShoulderAbductionReachRepCaptureContext,
    "captureSchemaVersion" | "featureSchemaVersion" | "participantId" | "devSessionId" | "side" | "movementType" | "simulationCondition"
  >,
): ShoulderAbductionReachRepRecorderTickOutput {
  const wasInAttempt = isInAttemptPhase(state.previousPhase);
  const isInAttempt = isInAttemptPhase(input.phase);

  if (isInAttempt) {
    if (state.buffer.length === 0) {
      state.bufferStartCapturedAtMs = input.capturedAtMs;
    }
    const relativeTimestampMs = input.capturedAtMs - (state.bufferStartCapturedAtMs ?? input.capturedAtMs);
    state.buffer.push({
      relativeTimestampMs,
      frameIndex: state.buffer.length,
      joints: input.joints,
    });
  }

  let completedRep: ShoulderAbductionReachRepCaptureRecord | null = null;
  let rejectedCapture: ShoulderAbductionReachRejectedCapture | null = null;

  if (wasInAttempt && !isInAttempt) {
    const repCompleted = input.repCount > state.previousRepCount;
    if (repCompleted && state.buffer.length > 0) {
      const frames = state.buffer;
      const angleTrace = computeCapturedAngleTrace(frames, context.side);
      const usableAngleFrameCount = angleTrace.filter((angle) => angle !== null).length;
      const durationMs =
        frames.length > 0 ? frames[frames.length - 1].relativeTimestampMs - frames[0].relativeTimestampMs : 0;
      const usableRatio = frames.length > 0 ? usableAngleFrameCount / frames.length : 0;

      // Technical capture-validity gate — see MIN_TECHNICAL_VALID_FRAMES /
      // MIN_TECHNICAL_USABLE_ANGLE_RATIO doc comments for why these specific
      // values. This is NOT a movement-quality or clinical judgment: it only
      // asks "is there enough real, trackable signal here to trust this as a
      // repetition at all," the same question `tickShoulderAbductionReachPhase`
      // already asks (via `poseLostUnknownMinTicks`) for a single frame gap,
      // applied here to a whole completed buffer.
      if (frames.length < MIN_TECHNICAL_VALID_FRAMES) {
        rejectedCapture = {
          side: context.side,
          reason: "too_few_frames",
          frameCount: frames.length,
          usableAngleFrameCount,
          durationMs,
        };
      } else if (usableRatio < MIN_TECHNICAL_USABLE_ANGLE_RATIO) {
        rejectedCapture = {
          side: context.side,
          reason: "insufficient_usable_tracking",
          frameCount: frames.length,
          usableAngleFrameCount,
          durationMs,
        };
      } else {
        state.emittedRepCount += 1;
        const repetitionIndex = state.emittedRepCount;
        // Side is part of the ID (Slice 1.1 fix) — repetitionIndex alone
        // collided across sides because each side's counter starts at 1
        // independently. See the Slice 1.1 project report for the real
        // live-capture session this was found in.
        const repetitionId = `${context.devSessionId}-${context.side}-rep-${repetitionIndex}`;
        completedRep = {
          context: {
            captureSchemaVersion: context.captureSchemaVersion,
            featureSchemaVersion: context.featureSchemaVersion,
            participantId: context.participantId,
            devSessionId: context.devSessionId,
            repetitionIndex,
            repetitionId,
            side: context.side,
            movementType: context.movementType,
            startedAtMs: state.bufferStartCapturedAtMs ?? input.capturedAtMs,
            endedAtMs: input.capturedAtMs,
            ...(context.simulationCondition !== undefined
              ? { simulationCondition: context.simulationCondition }
              : {}),
          },
          frames,
          // Computed strictly from `frames` above — no externally supplied
          // peak value is threaded through anymore (Slice 1.1 stale-feature fix).
          derivedFeatures: computeShoulderAbductionReachDerivedFeatures(frames, context.side, {
            preOnsetRestingJoints: state.lastRestingJoints,
          }),
        };
      }
    }
    // Whether completed, rejected, or aborted, the attempt is over — start
    // the next buffer fresh. Idle ("resting") frames between attempts are
    // never captured; they belong to no specific repetition.
    state.buffer = [];
    state.bufferStartCapturedAtMs = null;
  }

  if (!isInAttempt) {
    state.lastRestingJoints = input.joints;
  }

  state.previousPhase = input.phase;
  state.previousRepCount = input.repCount;

  return { completedRep, rejectedCapture };
}
