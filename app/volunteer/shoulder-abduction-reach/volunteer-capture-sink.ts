/**
 * Volunteer Shoulder Abduction Reach — in-memory capture sink.
 *
 * Wires detector frame callbacks to the existing rep-recorder and capture schema.
 * Persistence is handled separately by the research persistence controller.
 */

import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import type { ShoulderAbductionReachFrameResult, ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import {
  ML_RESEARCH_CAPTURED_JOINT_IDS,
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type MlResearchCapturedJoints,
  type ShoulderAbductionReachRepCaptureRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import {
  createShoulderAbductionReachRepRecorderState,
  tickShoulderAbductionReachRepRecorder,
  type ShoulderAbductionReachRejectedCapture,
  type ShoulderAbductionReachRepRecorderState,
} from "@/app/lib/ml-research/shoulder-abduction-reach/rep-recorder";

/** Picks the eight bilateral joints recorded for this exercise from a full motion frame. */
function pickCapturedJoints(frame: NormalizedMotionFrame): MlResearchCapturedJoints {
  const picked: MlResearchCapturedJoints = {};
  for (const jointId of ML_RESEARCH_CAPTURED_JOINT_IDS) {
    const joint = frame.joints[jointId];
    if (joint) {
      picked[jointId] = joint;
    }
  }
  return picked;
}

export type VolunteerCaptureFrameInput = {
  frame: NormalizedMotionFrame;
  capturedAtMs: number;
  phase: ShoulderAbductionReachFrameResult["left"]["phase"];
  repCount: number;
};

export type VolunteerInMemoryCaptureSinkOptions = {
  participantId: string;
  sessionId: string;
  side: ShoulderAbductionReachSide;
  /** Protocol metadata only — never therapist ground truth. */
  getProtocolCondition: () => string | undefined;
  /** Returns the active capture-block generation; stale callbacks must be ignored. */
  getCaptureBlockGeneration: () => number;
  onRepCaptured: (record: ShoulderAbductionReachRepCaptureRecord) => void;
  onRepRejected?: (rejected: ShoulderAbductionReachRejectedCapture) => void;
};

export type VolunteerInMemoryCaptureSink = {
  handleFrame: (input: VolunteerCaptureFrameInput) => void;
  /** Resets the private repetition recorder so the next movement block starts at index 1. */
  resetRecorder: () => void;
  /** Exposed for behavioral tests — current emitted repetition count in this recorder. */
  getEmittedRepCount: () => number;
};

export function createVolunteerInMemoryCaptureSink(
  options: VolunteerInMemoryCaptureSinkOptions,
): VolunteerInMemoryCaptureSink {
  let recorderState: ShoulderAbductionReachRepRecorderState =
    createShoulderAbductionReachRepRecorderState();

  const resetRecorder = () => {
    recorderState = createShoulderAbductionReachRepRecorderState();
  };

  return {
    resetRecorder,
    getEmittedRepCount: () => recorderState.emittedRepCount,

    handleFrame(input: VolunteerCaptureFrameInput) {
      const blockGeneration = options.getCaptureBlockGeneration();

      const protocolCondition = options.getProtocolCondition();
      const { completedRep, rejectedCapture } = tickShoulderAbductionReachRepRecorder(
        recorderState,
        {
          joints: pickCapturedJoints(input.frame),
          phase: input.phase,
          repCount: input.repCount,
          capturedAtMs: input.capturedAtMs,
        },
        {
          captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
          featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
          participantId: options.participantId,
          devSessionId: options.sessionId,
          side: options.side,
          movementType: "shoulder_abduction_reach",
          ...(protocolCondition !== undefined ? { simulationCondition: protocolCondition } : {}),
        },
      );

      if (blockGeneration !== options.getCaptureBlockGeneration()) {
        return;
      }

      if (completedRep) {
        options.onRepCaptured(completedRep);
      }
      if (rejectedCapture) {
        options.onRepRejected?.(rejectedCapture);
      }
    },
  };
}
