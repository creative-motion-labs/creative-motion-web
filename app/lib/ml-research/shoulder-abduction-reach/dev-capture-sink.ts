/**
 * Shoulder Abduction Reach — dev-only capture sink glue.
 * RASQ ML bridge, Slice 1 (2026-08-19).
 *
 * Wires `ShoulderAbductionReachPoseDetector`'s optional `onDevFrameCaptured`
 * callback to the pure `rep-recorder`, and posts completed repetitions to
 * the dev-only local API route. This is the only place that imports both
 * `app/lib/cv` (the live detector's callback shape) and
 * `app/lib/ml-research` — kept deliberately thin so the detector class
 * itself never needs to know this module, or ml-research, exists.
 */

import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import type { ShoulderAbductionReachFrameResult, ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import {
  ML_RESEARCH_CAPTURED_JOINT_IDS,
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type MlResearchCapturedJoints,
  type ShoulderAbductionReachRepCaptureRecord,
} from "./capture-schema";
import {
  createShoulderAbductionReachRepRecorderState,
  tickShoulderAbductionReachRepRecorder,
  type ShoulderAbductionReachRejectedCapture,
} from "./rep-recorder";

/** Picks only the eight bilateral joints this capture pipeline records, from a full frame. */
export function pickCapturedJoints(frame: NormalizedMotionFrame): MlResearchCapturedJoints {
  const picked: MlResearchCapturedJoints = {};
  for (const jointId of ML_RESEARCH_CAPTURED_JOINT_IDS) {
    const joint = frame.joints[jointId];
    if (joint) {
      picked[jointId] = joint;
    }
  }
  return picked;
}

export type DevRepCaptureFrameInput = {
  frame: NormalizedMotionFrame;
  capturedAtMs: number;
  phase: ShoulderAbductionReachFrameResult["left"]["phase"];
  repCount: number;
};

export type DevRepCaptureSinkOptions = {
  participantId: string;
  devSessionId: string;
  side: ShoulderAbductionReachSide;
  /** Dev/internal-fixture field only — never therapist ground truth. See README. */
  simulationCondition?: string;
  onRepCaptured: (record: ShoulderAbductionReachRepCaptureRecord) => void;
  /**
   * Slice 1.1 — fires when the phase FSM completed a repetition but it
   * failed the technical capture-validity gate (see `rep-recorder.ts`).
   * Optional so existing callers keep compiling; a caller that omits this
   * simply never learns about rejected stubs (they are still never exported
   * as `onRepCaptured` records either way).
   */
  onRepRejected?: (rejected: ShoulderAbductionReachRejectedCapture) => void;
};

export type DevRepCaptureSink = {
  handleFrame: (input: DevRepCaptureFrameInput) => void;
};

export function createDevRepCaptureSink(options: DevRepCaptureSinkOptions): DevRepCaptureSink {
  const state = createShoulderAbductionReachRepRecorderState();

  return {
    handleFrame(input: DevRepCaptureFrameInput) {
      const { completedRep, rejectedCapture } = tickShoulderAbductionReachRepRecorder(
        state,
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
          devSessionId: options.devSessionId,
          side: options.side,
          movementType: "shoulder_abduction_reach",
          ...(options.simulationCondition !== undefined
            ? { simulationCondition: options.simulationCondition }
            : {}),
        },
      );
      if (completedRep) {
        options.onRepCaptured(completedRep);
      }
      if (rejectedCapture) {
        options.onRepRejected?.(rejectedCapture);
      }
    },
  };
}

/** Posts one completed repetition to the dev-only local capture API route. */
export async function postDevRepCaptureRecord(
  record: ShoulderAbductionReachRepCaptureRecord,
): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  const response = await fetch("/api/dev/ml-research/shoulder-abduction-reach-capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  const body = (await response.json().catch(() => ({}))) as { filePath?: string; error?: string };
  return { ok: response.ok, ...body };
}
