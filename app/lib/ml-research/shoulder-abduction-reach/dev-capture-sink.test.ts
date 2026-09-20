/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/dev-capture-sink.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOTION_INTELLIGENCE_SCHEMA_VERSION,
  type JointId,
  type NormalizedMotionFrame,
} from "@/app/lib/motion-intelligence";
import { createDevRepCaptureSink, pickCapturedJoints } from "./dev-capture-sink";

function syntheticFrame(
  joints: Partial<Record<JointId, { x: number; y: number }>>,
): NormalizedMotionFrame {
  const mapped = Object.fromEntries(
    Object.entries(joints).map(([jointId, landmark]) => [
      jointId,
      { landmark, confidence: { visibility: 0.9, present: true } },
    ]),
  ) as NormalizedMotionFrame["joints"];
  return {
    schemaVersion: MOTION_INTELLIGENCE_SCHEMA_VERSION,
    source: { kind: "web_camera_pose", capturedAtMs: 0, frameIndex: 0, coordinateSpace: "normalized_2d" },
    joints: mapped,
  };
}

describe("pickCapturedJoints", () => {
  it("keeps only the eight bilateral capture joints and drops everything else", () => {
    const frame = syntheticFrame({
      nose: { x: 0.5, y: 0.1 },
      right_hip: { x: 0.6, y: 0.6 },
      right_shoulder: { x: 0.6, y: 0.3 },
      right_elbow: { x: 0.7, y: 0.4 },
      right_wrist: { x: 0.75, y: 0.5 },
      left_shoulder: { x: 0.3, y: 0.3 },
      left_hip: { x: 0.4, y: 0.6 },
      left_knee: { x: 0.4, y: 0.9 },
    });
    const picked = pickCapturedJoints(frame);
    assert.deepEqual(
      Object.keys(picked).sort(),
      ["left_hip", "left_shoulder", "right_elbow", "right_hip", "right_shoulder", "right_wrist"].sort(),
    );
    assert.equal("nose" in picked, false);
    assert.equal("left_knee" in picked, false);
  });
});

describe("createDevRepCaptureSink", () => {
  it("emits a completed rep through onRepCaptured after a full, technically-valid raise/peak/lower/rest cycle", () => {
    const captured: unknown[] = [];
    const sink = createDevRepCaptureSink({
      participantId: "dev-participant-001",
      devSessionId: "dev-session-test",
      side: "right",
      onRepCaptured: (record) => captured.push(record),
    });

    const frameAt = (shoulderX: number): NormalizedMotionFrame =>
      syntheticFrame({
        right_hip: { x: 0.6, y: 0.62 },
        right_shoulder: { x: shoulderX, y: 0.3 },
        right_elbow: { x: shoulderX + 0.1, y: 0.3 },
        right_wrist: { x: shoulderX + 0.2, y: 0.3 },
        left_shoulder: { x: 0.3, y: 0.3 },
      });

    // 10 in-attempt frames — above MIN_TECHNICAL_VALID_FRAMES (8), matching what a real
    // repetition's frame count looks like.
    for (let i = 0; i < 10; i += 1) {
      sink.handleFrame({ frame: frameAt(0.75 + i * 0.02), capturedAtMs: i * 33, phase: "raising", repCount: 0 });
    }
    sink.handleFrame({ frame: frameAt(0.7), capturedAtMs: 330, phase: "resting", repCount: 1 });

    assert.equal(captured.length, 1);
  });

  it("does not emit anything for an aborted attempt", () => {
    const captured: unknown[] = [];
    const sink = createDevRepCaptureSink({
      participantId: "dev-participant-001",
      devSessionId: "dev-session-test",
      side: "left",
      onRepCaptured: (record) => captured.push(record),
    });
    const frame = syntheticFrame({
      left_hip: { x: 0.4, y: 0.62 },
      left_shoulder: { x: 0.35, y: 0.3 },
      right_shoulder: { x: 0.65, y: 0.3 },
    });
    sink.handleFrame({ frame, capturedAtMs: 0, phase: "raising", repCount: 0 });
    sink.handleFrame({ frame, capturedAtMs: 33, phase: "resting", repCount: 0 });
    assert.equal(captured.length, 0);
  });

  it("routes an FSM-completed but technically-invalid stub to onRepRejected, not onRepCaptured (Slice 1.1)", () => {
    const captured: unknown[] = [];
    const rejected: unknown[] = [];
    const sink = createDevRepCaptureSink({
      participantId: "dev-participant-001",
      devSessionId: "dev-session-test",
      side: "right",
      onRepCaptured: (record) => captured.push(record),
      onRepRejected: (r) => rejected.push(r),
    });
    const frame = syntheticFrame({
      right_hip: { x: 0.6, y: 0.62 },
      right_shoulder: { x: 0.9, y: 0.3 },
      right_elbow: { x: 1.0, y: 0.3 },
      right_wrist: { x: 1.1, y: 0.3 },
      left_shoulder: { x: 0.3, y: 0.3 },
    });
    // Only 1 in-attempt frame — well under MIN_TECHNICAL_VALID_FRAMES.
    sink.handleFrame({ frame, capturedAtMs: 0, phase: "raising", repCount: 0 });
    sink.handleFrame({ frame, capturedAtMs: 0, phase: "resting", repCount: 1 });

    assert.equal(captured.length, 0);
    assert.equal(rejected.length, 1);
  });

  it("onRepRejected is optional and omitting it does not throw for a rejected stub", () => {
    const captured: unknown[] = [];
    const sink = createDevRepCaptureSink({
      participantId: "dev-participant-001",
      devSessionId: "dev-session-test",
      side: "right",
      onRepCaptured: (record) => captured.push(record),
    });
    const frame = syntheticFrame({
      right_hip: { x: 0.6, y: 0.62 },
      right_shoulder: { x: 0.9, y: 0.3 },
      right_elbow: { x: 1.0, y: 0.3 },
      right_wrist: { x: 1.1, y: 0.3 },
      left_shoulder: { x: 0.3, y: 0.3 },
    });
    assert.doesNotThrow(() => {
      sink.handleFrame({ frame, capturedAtMs: 0, phase: "raising", repCount: 0 });
      sink.handleFrame({ frame, capturedAtMs: 0, phase: "resting", repCount: 1 });
    });
    assert.equal(captured.length, 0);
  });
});
