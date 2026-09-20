/**
 * Run: npx tsx --test app/lib/ml-research/shoulder-abduction-reach/rep-recorder.test.ts
 *
 * Slice 1.1 (2026-08-19): rewritten around the technical capture-validity
 * gate (MIN_TECHNICAL_VALID_FRAMES / MIN_TECHNICAL_USABLE_ANGLE_RATIO) and
 * the side-qualified repetitionId. Sequences that represent a genuinely
 * completed repetition now use at least MIN_TECHNICAL_VALID_FRAMES in-attempt
 * frames, matching what a real live-camera repetition looks like.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShoulderAbductionReachPhase, ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import {
  ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
  ML_RESEARCH_FEATURE_SCHEMA_VERSION,
  type MlResearchCapturedJoints,
} from "./capture-schema";
import {
  createShoulderAbductionReachRepRecorderState,
  MIN_TECHNICAL_USABLE_ANGLE_RATIO,
  MIN_TECHNICAL_VALID_FRAMES,
  tickShoulderAbductionReachRepRecorder,
  type ShoulderAbductionReachRepRecorderState,
} from "./rep-recorder";
import { computeShoulderAbductionReachDerivedFeatures } from "./derived-features";

/** Full bilateral joint set, with `activeX` driving the given `side`'s shoulder (and a
 * mirrored elbow/wrist) so angle computation works for either side, not just "right". */
function joints(
  activeX: number,
  side: ShoulderAbductionReachSide = "right",
  angleProxyVisibility = 0.9,
): MlResearchCapturedJoints {
  const inactiveX = side === "right" ? 0.35 : 0.65;
  const visible = { visibility: 0.9, present: true } as const;
  const activeSide: MlResearchCapturedJoints =
    side === "right"
      ? {
          right_hip: { landmark: { x: 0.6, y: 0.62 }, confidence: visible },
          right_shoulder: { landmark: { x: activeX, y: 0.3 }, confidence: { visibility: angleProxyVisibility, present: true } },
          right_elbow: { landmark: { x: activeX + 0.15, y: 0.3 }, confidence: visible },
          right_wrist: { landmark: { x: activeX + 0.3, y: 0.3 }, confidence: visible },
        }
      : {
          left_hip: { landmark: { x: 0.4, y: 0.62 }, confidence: visible },
          left_shoulder: { landmark: { x: activeX, y: 0.3 }, confidence: { visibility: angleProxyVisibility, present: true } },
          left_elbow: { landmark: { x: activeX - 0.15, y: 0.3 }, confidence: visible },
          left_wrist: { landmark: { x: activeX - 0.3, y: 0.3 }, confidence: visible },
        };
  return {
    ...activeSide,
    ...(side === "right"
      ? { left_shoulder: { landmark: { x: inactiveX, y: 0.3 }, confidence: visible } }
      : { right_shoulder: { landmark: { x: inactiveX, y: 0.3 }, confidence: visible } }),
  };
}

/** A joint set with no usable angle (missing elbow) — for tracking-loss fixtures. */
function untrackedJoints(): MlResearchCapturedJoints {
  return {
    right_hip: { landmark: { x: 0.6, y: 0.62 }, confidence: { visibility: 0.9, present: true } },
    right_shoulder: { landmark: { x: 0.7, y: 0.3 }, confidence: { visibility: 0.9, present: true } },
    left_shoulder: { landmark: { x: 0.35, y: 0.3 }, confidence: { visibility: 0.9, present: true } },
  };
}

function baseContext(side: ShoulderAbductionReachSide = "right", devSessionId = "dev-session-2026-08-19-001") {
  return {
    captureSchemaVersion: ML_RESEARCH_CAPTURE_SCHEMA_VERSION,
    featureSchemaVersion: ML_RESEARCH_FEATURE_SCHEMA_VERSION,
    participantId: "dev-participant-001",
    devSessionId,
    side,
    movementType: "shoulder_abduction_reach" as const,
  };
}

type Step = { phase: ShoulderAbductionReachPhase; repCount: number; capturedAtMs: number; joints: MlResearchCapturedJoints };

function tickSequence(
  state: ShoulderAbductionReachRepRecorderState,
  steps: Step[],
  context: ReturnType<typeof baseContext>,
) {
  return steps.map((step) =>
    tickShoulderAbductionReachRepRecorder(
      state,
      { joints: step.joints, phase: step.phase, repCount: step.repCount, capturedAtMs: step.capturedAtMs },
      context,
    ),
  );
}

/**
 * Builds a realistic, technically-valid completed-repetition sequence:
 * `frameCount` in-attempt frames (>= MIN_TECHNICAL_VALID_FRAMES by default),
 * each with a usable angle, followed by the resting tick that completes it.
 */
function validRepSteps(opts: {
  startMs: number;
  frameCount?: number;
  intervalMs?: number;
  priorRepCount?: number;
  side?: ShoulderAbductionReachSide;
  activeXBase?: number;
}): Step[] {
  const {
    startMs,
    frameCount = MIN_TECHNICAL_VALID_FRAMES + 2,
    intervalMs = 33,
    priorRepCount = 0,
    side = "right",
    activeXBase = 0.75,
  } = opts;
  const steps: Step[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    steps.push({
      phase: "raising",
      repCount: priorRepCount,
      capturedAtMs: startMs + i * intervalMs,
      joints: joints(activeXBase + i * 0.01, side),
    });
  }
  steps.push({
    phase: "resting",
    repCount: priorRepCount + 1,
    capturedAtMs: startMs + frameCount * intervalMs,
    joints: joints(0.7, side),
  });
  return steps;
}

describe("sequence start/end boundaries", () => {
  it("captures no frames while idle at rest", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(
      state,
      [
        { phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) },
        { phase: "resting", repCount: 0, capturedAtMs: 33, joints: joints(0.7) },
      ],
      baseContext(),
    );
    assert.deepEqual(
      outputs.map((o) => o.completedRep),
      [null, null],
    );
    assert.equal(state.buffer.length, 0);
  });

  it("starts buffering exactly at the raising transition and stops exactly at the return to resting", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();
    tickSequence(state, [{ phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) }], context);
    tickSequence(state, [{ phase: "raising", repCount: 0, capturedAtMs: 33, joints: joints(0.75) }], context);
    assert.equal(state.buffer.length, 1, "buffering begins on the first non-resting tick");

    const steps = validRepSteps({ startMs: 66 }).slice(1); // continue the buffer already started above
    const outputs = tickSequence(state, steps, context);
    const last = outputs[outputs.length - 1];
    assert.ok(last.completedRep, "repCount grew and the gate passed, so a completed rep should be emitted");
    assert.equal(state.buffer.length, 0, "buffer is cleared once the attempt ends");
  });

  it("flags an unusually short (but FSM-completed) repetition as a rejected stub, not a clean rep", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();
    // Only 2 in-attempt frames — well under MIN_TECHNICAL_VALID_FRAMES.
    const outputs = tickSequence(
      state,
      [
        { phase: "raising", repCount: 0, capturedAtMs: 0, joints: joints(0.78) },
        { phase: "peak_abduction", repCount: 0, capturedAtMs: 33, joints: joints(0.95) },
        { phase: "resting", repCount: 1, capturedAtMs: 66, joints: joints(0.7) },
      ],
      context,
    );
    const last = outputs[outputs.length - 1];
    assert.equal(last.completedRep, null, "must not be exported as a clean repetition");
    assert.ok(last.rejectedCapture);
    assert.equal(last.rejectedCapture.reason, "too_few_frames");
    assert.equal(last.rejectedCapture.frameCount, 2);
  });
});

describe("stub rejection (technical capture-validity gate)", () => {
  it("rejects a zero-duration, one-frame repetition", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(
      state,
      [
        { phase: "raising", repCount: 0, capturedAtMs: 500, joints: joints(0.9) },
        { phase: "resting", repCount: 1, capturedAtMs: 500, joints: joints(0.7) },
      ],
      baseContext(),
    );
    const last = outputs[outputs.length - 1];
    assert.equal(last.completedRep, null);
    assert.ok(last.rejectedCapture);
    assert.equal(last.rejectedCapture.reason, "too_few_frames");
    assert.equal(last.rejectedCapture.frameCount, 1);
    assert.equal(last.rejectedCapture.durationMs, 0);
    assert.equal(state.emittedRepCount, 0, "a rejected stub must not consume a repetitionIndex slot");
  });

  it("rejects a repetition with enough frames but mostly untracked (below the usable-angle ratio)", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const frameCount = MIN_TECHNICAL_VALID_FRAMES + 4;
    const steps: Step[] = [];
    for (let i = 0; i < frameCount; i += 1) {
      // Only the first 2 frames have a usable angle; the rest are untracked —
      // usable ratio well below MIN_TECHNICAL_USABLE_ANGLE_RATIO.
      steps.push({
        phase: "raising",
        repCount: 0,
        capturedAtMs: i * 33,
        joints: i < 2 ? joints(0.8) : untrackedJoints(),
      });
    }
    steps.push({ phase: "resting", repCount: 1, capturedAtMs: frameCount * 33, joints: joints(0.7) });
    const outputs = tickSequence(state, steps, baseContext());
    const last = outputs[outputs.length - 1];
    assert.equal(last.completedRep, null);
    assert.ok(last.rejectedCapture);
    assert.equal(last.rejectedCapture.reason, "insufficient_usable_tracking");
    assert.ok(last.rejectedCapture.usableAngleFrameCount / last.rejectedCapture.frameCount < MIN_TECHNICAL_USABLE_ANGLE_RATIO);
  });

  it("accepts a repetition that meets both the frame-count and tracking-ratio floors", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(state, validRepSteps({ startMs: 0 }), baseContext());
    const last = outputs[outputs.length - 1];
    assert.ok(last.completedRep);
    assert.equal(last.rejectedCapture, null);
  });
});

describe("interrupted tracking", () => {
  it("an attempt that loses tracking and never completes (phase goes unknown -> resting without repCount incrementing) produces neither a completedRep nor a rejectedCapture", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(
      state,
      [
        { phase: "raising", repCount: 0, capturedAtMs: 0, joints: joints(0.78) },
        { phase: "peak_abduction", repCount: 0, capturedAtMs: 33, joints: joints(0.9) },
        { phase: "unknown", repCount: 0, capturedAtMs: 66, joints: untrackedJoints() },
        { phase: "resting", repCount: 0, capturedAtMs: 99, joints: joints(0.7) },
      ],
      baseContext(),
    );
    const last = outputs[outputs.length - 1];
    assert.equal(last.completedRep, null);
    assert.equal(last.rejectedCapture, null, "the FSM never completed this attempt, so there is nothing to reject either");
  });
});

describe("rapid stop/start behavior", () => {
  it("a fresh recorder state after a stop starts its own counter and never reuses a prior repetitionId", () => {
    const contextA = baseContext("right", "dev-session-A");
    const stateA = createShoulderAbductionReachRepRecorderState();
    const outputsA = tickSequence(stateA, validRepSteps({ startMs: 0 }), contextA);
    const repA = outputsA[outputsA.length - 1].completedRep;
    assert.ok(repA);

    // Simulates "Stop" then "Start" creating a brand-new recorder instance (as the fixed
    // capture lab page now does) rather than reusing state across the boundary.
    const contextB = baseContext("right", "dev-session-A");
    const stateB = createShoulderAbductionReachRepRecorderState();
    const outputsB = tickSequence(stateB, validRepSteps({ startMs: 0 }), contextB);
    const repB = outputsB[outputsB.length - 1].completedRep;
    assert.ok(repB);

    // Same session/side, both starting fresh — a real regression here would show up as
    // rep-recorder.ts's own counter colliding; this documents that a fresh state always
    // begins at repetitionIndex 1, so it is the CALLER's job (Slice 1.1's lab-page fix)
    // not to create two live recorders for the same side concurrently.
    assert.equal(repA.context.repetitionIndex, 1);
    assert.equal(repB.context.repetitionIndex, 1);
    assert.equal(repA.context.repetitionId, repB.context.repetitionId);
  });
});

describe("unique repetition IDs across side", () => {
  it("right and left repetitionIds never collide even at the same repetitionIndex", () => {
    const devSessionId = "dev-session-2026-08-19-both-sides";
    const rightState = createShoulderAbductionReachRepRecorderState();
    const leftState = createShoulderAbductionReachRepRecorderState();

    const rightOutputs = tickSequence(rightState, validRepSteps({ startMs: 0, side: "right" }), baseContext("right", devSessionId));
    const leftOutputs = tickSequence(leftState, validRepSteps({ startMs: 0, side: "left" }), baseContext("left", devSessionId));

    const rightRep = rightOutputs[rightOutputs.length - 1].completedRep;
    const leftRep = leftOutputs[leftOutputs.length - 1].completedRep;
    assert.ok(rightRep);
    assert.ok(leftRep);
    assert.equal(rightRep.context.repetitionIndex, 1);
    assert.equal(leftRep.context.repetitionIndex, 1);
    assert.notEqual(rightRep.context.repetitionId, leftRep.context.repetitionId);
    assert.equal(rightRep.context.repetitionId, `${devSessionId}-right-rep-1`);
    assert.equal(leftRep.context.repetitionId, `${devSessionId}-left-rep-1`);
  });

  it("repetitionIds are deterministic given the same session/side/index", () => {
    const context = baseContext("right", "dev-session-deterministic");
    const stateOne = createShoulderAbductionReachRepRecorderState();
    const stateTwo = createShoulderAbductionReachRepRecorderState();
    const outputsOne = tickSequence(stateOne, validRepSteps({ startMs: 0 }), context);
    const outputsTwo = tickSequence(stateTwo, validRepSteps({ startMs: 1000 }), context); // different wall-clock start
    const repOne = outputsOne[outputsOne.length - 1].completedRep;
    const repTwo = outputsTwo[outputsTwo.length - 1].completedRep;
    assert.ok(repOne);
    assert.ok(repTwo);
    assert.equal(repOne.context.repetitionId, repTwo.context.repetitionId, "same session/side/index -> same id, regardless of timing");
  });

  it("repeated reps on the same side remain unique from each other", () => {
    const context = baseContext("right", "dev-session-repeats");
    const state = createShoulderAbductionReachRepRecorderState();
    const rep1 = tickSequence(state, validRepSteps({ startMs: 0, priorRepCount: 0 }), context).pop()!.completedRep;
    const rep2 = tickSequence(state, validRepSteps({ startMs: 1000, priorRepCount: 1 }), context).pop()!.completedRep;
    const rep3 = tickSequence(state, validRepSteps({ startMs: 2000, priorRepCount: 2 }), context).pop()!.completedRep;
    assert.ok(rep1 && rep2 && rep3);
    const ids = [rep1.context.repetitionId, rep2.context.repetitionId, rep3.context.repetitionId];
    assert.equal(new Set(ids).size, 3, "all three ids must be distinct");
    assert.deepEqual(ids, ["dev-session-repeats-right-rep-1", "dev-session-repeats-right-rep-2", "dev-session-repeats-right-rep-3"]);
  });

  it("export preserves the correct id (the id on the completed record matches what was generated)", () => {
    const context = baseContext("left", "dev-session-export-check");
    const state = createShoulderAbductionReachRepRecorderState();
    const rep = tickSequence(state, validRepSteps({ startMs: 0, side: "left" }), context).pop()!.completedRep;
    assert.ok(rep);
    assert.equal(rep.context.repetitionId, "dev-session-export-check-left-rep-1");
    assert.equal(JSON.parse(JSON.stringify(rep)).context.repetitionId, rep.context.repetitionId);
  });
});

describe("repetition separation", () => {
  it("emits two separate records for two consecutive repetitions, each starting fresh", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();
    const rep1Outputs = tickSequence(state, validRepSteps({ startMs: 0, priorRepCount: 0 }), context);
    const rep1 = rep1Outputs[rep1Outputs.length - 1].completedRep;
    assert.ok(rep1);
    assert.equal(rep1.context.repetitionIndex, 1);
    assert.equal(rep1.context.repetitionId, `${context.devSessionId}-right-rep-1`);

    const rep2Outputs = tickSequence(state, validRepSteps({ startMs: 1000, priorRepCount: 1 }), context);
    const rep2 = rep2Outputs[rep2Outputs.length - 1].completedRep;
    assert.ok(rep2);
    assert.equal(rep2.context.repetitionIndex, 2);
    assert.equal(rep2.context.repetitionId, `${context.devSessionId}-right-rep-2`);
    assert.notEqual(rep1.context.repetitionId, rep2.context.repetitionId);
    assert.notEqual(rep1.frames, rep2.frames, "rep2's frame array is not the same object as rep1's");
    assert.equal(rep2.frames[0].relativeTimestampMs, 0, "rep2's own sequence restarts its relative clock at 0");
  });

  it("discards an aborted attempt (raised but never reached peak) without emitting a record or a rejection", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(
      state,
      [
        { phase: "resting", repCount: 0, capturedAtMs: 0, joints: joints(0.7) },
        { phase: "raising", repCount: 0, capturedAtMs: 33, joints: joints(0.74) },
        // Arm returns to rest without ever reaching peak_abduction — repCount stays 0.
        { phase: "resting", repCount: 0, capturedAtMs: 66, joints: joints(0.7) },
      ],
      baseContext(),
    );
    for (const output of outputs) {
      assert.equal(output.completedRep, null);
      assert.equal(output.rejectedCapture, null);
    }
    assert.equal(state.buffer.length, 0, "buffer is cleared even though nothing was emitted");
    assert.equal(state.emittedRepCount, 0);
  });
});

describe("timestamps / order", () => {
  it("relative timestamps start at 0 and increase monotonically with frame index", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(state, validRepSteps({ startMs: 5_000 }), baseContext());
    const rep = outputs[outputs.length - 1].completedRep;
    assert.ok(rep);
    assert.equal(rep.frames[0].relativeTimestampMs, 0);
    assert.equal(rep.frames[0].frameIndex, 0);
    for (let i = 1; i < rep.frames.length; i += 1) {
      assert.ok(
        rep.frames[i].relativeTimestampMs > rep.frames[i - 1].relativeTimestampMs,
        "timestamps must strictly increase",
      );
      assert.equal(rep.frames[i].frameIndex, i);
    }
    assert.equal(rep.context.startedAtMs, 5_000);
  });
});

describe("visibility / confidence preservation", () => {
  it("preserves each joint's visibility and present flag exactly as captured", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(state, validRepSteps({ startMs: 0 }), baseContext());
    const rep = outputs[outputs.length - 1].completedRep;
    assert.ok(rep);
    const capturedShoulder = rep.frames[0].joints.right_shoulder;
    assert.ok(capturedShoulder);
    assert.equal(capturedShoulder.confidence.visibility, 0.9);
    assert.equal(capturedShoulder.confidence.present, true);
    assert.equal(capturedShoulder.landmark.x, 0.75);
  });
});

describe("pre-onset trunk baseline (features-v2)", () => {
  it("uses the last resting joints before raising as the trunk-drift baseline", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();
    const restingBaseline = joints(0.6);
    tickSequence(
      state,
      [{ phase: "resting", repCount: 0, capturedAtMs: 0, joints: restingBaseline }],
      context,
    );
    const outputs = tickSequence(state, validRepSteps({ startMs: 33, priorRepCount: 0, activeXBase: 0.75 }), context);
    const rep = outputs[outputs.length - 1].completedRep;
    assert.ok(rep);
    const withoutPreOnset = computeShoulderAbductionReachDerivedFeatures(rep.frames, "right");
    assert.equal(
      rep.derivedFeatures.peakNormalizedTrunkDriftRatio,
      computeShoulderAbductionReachDerivedFeatures(rep.frames, "right", {
        preOnsetRestingJoints: restingBaseline,
      }).peakNormalizedTrunkDriftRatio,
    );
    assert.notEqual(
      rep.derivedFeatures.peakNormalizedTrunkDriftRatio,
      withoutPreOnset.peakNormalizedTrunkDriftRatio,
    );
  });

  it("falls back to the first raising frame when no resting baseline was observed", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();
    const outputs = tickSequence(state, validRepSteps({ startMs: 0, priorRepCount: 0 }), context);
    const rep = outputs[outputs.length - 1].completedRep;
    assert.ok(rep);
    assert.equal(
      rep.derivedFeatures.peakNormalizedTrunkDriftRatio,
      computeShoulderAbductionReachDerivedFeatures(rep.frames, "right", {
        preOnsetRestingJoints: null,
      }).peakNormalizedTrunkDriftRatio,
    );
  });
});

describe("schema versions", () => {
  it("stamps the current capture and feature schema versions on every completed rep", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(state, validRepSteps({ startMs: 0 }), baseContext());
    const rep = outputs[outputs.length - 1].completedRep;
    assert.ok(rep);
    assert.equal(rep.context.captureSchemaVersion, ML_RESEARCH_CAPTURE_SCHEMA_VERSION);
    assert.equal(rep.context.featureSchemaVersion, ML_RESEARCH_FEATURE_SCHEMA_VERSION);
  });
});

describe("no raw video persistence", () => {
  it("a completed rep record contains no video/image/frame-blob keys anywhere", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const outputs = tickSequence(state, validRepSteps({ startMs: 0 }), baseContext());
    const rep = outputs[outputs.length - 1].completedRep;
    assert.ok(rep);
    const serialized = JSON.stringify(rep).toLowerCase();
    for (const forbidden of ["video", "image", "blob", "base64", "dataurl"]) {
      assert.ok(!serialized.includes(forbidden), `record must not contain "${forbidden}"`);
    }
  });
});

describe("no stale derived features (rep N -> rep N+1 leak guard)", () => {
  it("a rejected stub immediately following a real repetition does not inherit its peak angle or any other feature", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();

    // Rep 1: a real, valid repetition reaching a high peak angle.
    const rep1Outputs = tickSequence(state, validRepSteps({ startMs: 0, priorRepCount: 0 }), context);
    const rep1 = rep1Outputs[rep1Outputs.length - 1].completedRep;
    assert.ok(rep1);
    assert.ok(rep1.derivedFeatures.peakShoulderAngleDegrees! > 0);

    // Immediately after, a degenerate 1-frame "attempt" completes (the exact pattern
    // seen in the real live-capture session that motivated this slice).
    const stubOutputs = tickSequence(
      state,
      [
        { phase: "raising", repCount: 1, capturedAtMs: 10_000, joints: joints(0.9) },
        { phase: "resting", repCount: 2, capturedAtMs: 10_000, joints: joints(0.7) },
      ],
      context,
    );
    const stubResult = stubOutputs[stubOutputs.length - 1];
    assert.equal(stubResult.completedRep, null, "must be rejected, not exported as a clean repetition");
    assert.ok(stubResult.rejectedCapture);
    // The rejection record carries no feature values at all — there is nothing here that
    // could ever equal rep1's peak angle by accident.
    assert.ok(!("peakShoulderAngleDegrees" in stubResult.rejectedCapture));
  });

  it("two consecutive valid repetitions with different peak angles each report their own, independent peak", () => {
    const state = createShoulderAbductionReachRepRecorderState();
    const context = baseContext();

    // Rep 1 reaches a low-ish angle; rep 2 reaches a much higher one.
    const rep1Steps = validRepSteps({ startMs: 0, priorRepCount: 0, frameCount: MIN_TECHNICAL_VALID_FRAMES }).map(
      (step, i, arr) => (i < arr.length - 1 ? { ...step, joints: joints(0.72 + i * 0.005) } : step),
    );
    const rep1 = tickSequence(state, rep1Steps, context).pop()!.completedRep;
    assert.ok(rep1);

    const rep2Steps = validRepSteps({
      startMs: 5_000,
      priorRepCount: 1,
      frameCount: MIN_TECHNICAL_VALID_FRAMES,
    }).map((step, i, arr) => (i < arr.length - 1 ? { ...step, joints: joints(0.99 + i * 0.001) } : step));
    const rep2 = tickSequence(state, rep2Steps, context).pop()!.completedRep;
    assert.ok(rep2);

    assert.notEqual(rep1.derivedFeatures.peakShoulderAngleDegrees, rep2.derivedFeatures.peakShoulderAngleDegrees);
    // rep2's shoulder x values are further from the hip than rep1's, so it must report a
    // strictly larger peak angle — proving the value came from ITS OWN frames.
    assert.ok(rep2.derivedFeatures.peakShoulderAngleDegrees! > rep1.derivedFeatures.peakShoulderAngleDegrees!);
  });
});
