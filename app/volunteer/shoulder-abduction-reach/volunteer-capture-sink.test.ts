/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-capture-sink.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShoulderAbductionReachPhase, ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { MlResearchCapturedJoints } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import { MIN_TECHNICAL_VALID_FRAMES } from "@/app/lib/ml-research/shoulder-abduction-reach/rep-recorder";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import { createVolunteerInMemoryCaptureSink } from "./volunteer-capture-sink";

function joints(activeX: number, side: ShoulderAbductionReachSide = "right"): MlResearchCapturedJoints {
  const inactiveX = side === "right" ? 0.35 : 0.65;
  const visible = { visibility: 0.9, present: true } as const;
  return {
    right_hip: { landmark: { x: 0.6, y: 0.62 }, confidence: visible },
    right_shoulder: { landmark: { x: activeX, y: 0.3 }, confidence: visible },
    right_elbow: { landmark: { x: activeX + 0.15, y: 0.3 }, confidence: visible },
    right_wrist: { landmark: { x: activeX + 0.3, y: 0.3 }, confidence: visible },
    left_shoulder: { landmark: { x: inactiveX, y: 0.3 }, confidence: visible },
    left_hip: { landmark: { x: 0.4, y: 0.62 }, confidence: visible },
    left_elbow: { landmark: { x: inactiveX - 0.15, y: 0.3 }, confidence: visible },
    left_wrist: { landmark: { x: inactiveX - 0.3, y: 0.3 }, confidence: visible },
  };
}

function frameFromJoints(capturedJoints: MlResearchCapturedJoints): NormalizedMotionFrame {
  const jointsMap: NormalizedMotionFrame["joints"] = {};
  for (const [id, joint] of Object.entries(capturedJoints)) {
    jointsMap[id as keyof NormalizedMotionFrame["joints"]] = {
      landmark: joint.landmark,
      confidence: joint.confidence,
    };
  }
  return {
    schemaVersion: "1.0",
    source: { kind: "web_camera_pose", capturedAtMs: 0 },
    joints: jointsMap,
  };
}

type Step = {
  phase: ShoulderAbductionReachPhase;
  repCount: number;
  capturedAtMs: number;
  joints: MlResearchCapturedJoints;
};

function validRepSteps(opts: {
  startMs: number;
  frameCount?: number;
  intervalMs?: number;
  priorRepCount?: number;
}): Step[] {
  const { startMs, frameCount = MIN_TECHNICAL_VALID_FRAMES + 2, intervalMs = 33, priorRepCount = 0 } =
    opts;
  const steps: Step[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    steps.push({
      phase: "raising",
      repCount: priorRepCount,
      capturedAtMs: startMs + i * intervalMs,
      joints: joints(0.75 + i * 0.01),
    });
  }
  steps.push({
    phase: "resting",
    repCount: priorRepCount + 1,
    capturedAtMs: startMs + frameCount * intervalMs,
    joints: joints(0.7),
  });
  return steps;
}

function playSteps(
  sink: ReturnType<typeof createVolunteerInMemoryCaptureSink>,
  steps: Step[],
) {
  for (const step of steps) {
    sink.handleFrame({
      frame: frameFromJoints(step.joints),
      capturedAtMs: step.capturedAtMs,
      phase: step.phase,
      repCount: step.repCount,
    });
  }
}

function createTestSink(options?: {
  getCaptureBlockGeneration?: () => number;
  onRepCaptured?: (record: ShoulderAbductionReachRepCaptureRecord) => void;
}) {
  const captured: ShoulderAbductionReachRepCaptureRecord[] = [];
  let generation = 0;
  const sink = createVolunteerInMemoryCaptureSink({
    participantId: "test-participant",
    sessionId: "test-session",
    side: "right",
    getProtocolCondition: () => "NORMAL",
    getCaptureBlockGeneration: options?.getCaptureBlockGeneration ?? (() => generation),
    onRepCaptured: (record) => {
      options?.onRepCaptured?.(record);
      captured.push(record);
    },
  });
  return {
    sink,
    captured,
    bumpGeneration: () => {
      generation += 1;
    },
    getGeneration: () => generation,
  };
}

describe("volunteer-capture-sink", () => {
  it("assigns repetitionIndex 1, 2, 3 across three completed repetitions", () => {
    const { sink, captured } = createTestSink();
    playSteps(sink, [{ phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) }]);
    playSteps(sink, validRepSteps({ startMs: 33, priorRepCount: 0 }));
    playSteps(sink, validRepSteps({ startMs: 2000, priorRepCount: 1 }));
    playSteps(sink, validRepSteps({ startMs: 4000, priorRepCount: 2 }));

    assert.equal(captured.length, 3);
    assert.deepEqual(
      captured.map((record) => record.context.repetitionIndex),
      [1, 2, 3],
    );
  });

  it("resetRecorder restarts repetitionIndex at 1 for a new movement block", () => {
    const { sink, captured, bumpGeneration } = createTestSink();
    playSteps(sink, [{ phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) }]);
    playSteps(sink, validRepSteps({ startMs: 33, priorRepCount: 0 }));
    playSteps(sink, validRepSteps({ startMs: 2000, priorRepCount: 1 }));
    assert.equal(sink.getEmittedRepCount(), 2);

    bumpGeneration();
    sink.resetRecorder();
    assert.equal(sink.getEmittedRepCount(), 0);

    playSteps(sink, validRepSteps({ startMs: 4000, priorRepCount: 0 }));
    assert.equal(captured.length, 3);
    assert.equal(captured[2]!.context.repetitionIndex, 1);
  });

  it("ignores completed reps when capture-block generation changes before emission", () => {
    const captured: ShoulderAbductionReachRepCaptureRecord[] = [];
    let bumpOnNextSecondRead = false;
    let readsInCurrentHandle = 0;

    const baseSink = createVolunteerInMemoryCaptureSink({
      participantId: "test-participant",
      sessionId: "test-session",
      side: "right",
      getProtocolCondition: () => "NORMAL",
      getCaptureBlockGeneration: () => {
        readsInCurrentHandle += 1;
        if (readsInCurrentHandle === 1) return 0;
        return bumpOnNextSecondRead ? 1 : 0;
      },
      onRepCaptured: (record) => {
        captured.push(record);
      },
    });

    const sink = {
      ...baseSink,
      handleFrame(input: Parameters<typeof baseSink.handleFrame>[0]) {
        readsInCurrentHandle = 0;
        baseSink.handleFrame(input);
      },
    };

    playSteps(sink, [{ phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) }]);
    playSteps(sink, validRepSteps({ startMs: 33, priorRepCount: 0 }));
    assert.equal(captured.length, 1);

    bumpOnNextSecondRead = true;
    playSteps(sink, validRepSteps({ startMs: 2000, priorRepCount: 1 }));
    assert.equal(captured.length, 1, "stale generation must not emit into the new block");
  });

  it("does not reset the recorder when only the onRepCaptured callback identity changes", () => {
    let handlerVersion = 0;
    const captured: ShoulderAbductionReachRepCaptureRecord[] = [];

    const sink = createVolunteerInMemoryCaptureSink({
      participantId: "test-participant",
      sessionId: "test-session",
      side: "right",
      getProtocolCondition: () => "NORMAL",
      getCaptureBlockGeneration: () => 0,
      onRepCaptured: (record) => {
        void handlerVersion;
        captured.push(record);
      },
    });

    playSteps(sink, [{ phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) }]);
    playSteps(sink, validRepSteps({ startMs: 33, priorRepCount: 0 }));
    handlerVersion += 1;
    playSteps(sink, validRepSteps({ startMs: 2000, priorRepCount: 1 }));

    assert.equal(sink.getEmittedRepCount(), 2);
    assert.deepEqual(
      captured.map((record) => record.context.repetitionIndex),
      [1, 2],
    );
  });
});
