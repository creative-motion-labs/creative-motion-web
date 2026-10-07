/**
 * Run: npx tsx --test app/lib/posture-screen/posture-live-session.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import { INSUFFICIENT_DATA_DISPLAY } from "@/app/lib/posture-report-presentation";
import {
  buildAlignedPoseLandmarks,
  buildLowVisibilityPoseLandmarks,
  buildMissingRequiredJointPoseLandmarks,
  buildShoulderTiltPoseLandmarks,
  runPostureAcquisitionPipeline,
  runPostureDemoScenario,
} from "./posture-demo-fixtures";
import {
  createPostureLiveSession,
  ingestPostureLiveFrame,
  resetPostureLiveSession,
  startPostureLiveSession,
  stopPostureLiveSession,
} from "./posture-live-session";

function requireFrame(
  landmarks: Parameters<typeof runPostureAcquisitionPipeline>[0],
  frameIndex = 0
): NormalizedMotionFrame {
  const { frame } = runPostureAcquisitionPipeline(
    landmarks,
    frameIndex,
    1_000 + frameIndex * 33
  );
  assert.ok(frame, "expected NormalizedMotionFrame from fixture pipeline");
  return frame;
}

function assertInsufficientNoLeakage(state: {
  presentation: {
    isInsufficient: boolean;
    displayedScore: string;
    displayedClassification: string;
    exposeLegacyClinicalFields: boolean;
  };
  aggregate: { score: number | null; label: string | null };
}) {
  assert.equal(state.presentation.isInsufficient, true);
  assert.equal(state.presentation.displayedScore, INSUFFICIENT_DATA_DISPLAY);
  assert.equal(
    state.presentation.displayedClassification,
    INSUFFICIENT_DATA_DISPLAY
  );
  assert.equal(state.presentation.exposeLegacyClinicalFields, false);
  assert.notEqual(state.presentation.displayedScore, "75%");
  assert.notEqual(state.presentation.displayedScore, "75");
  assert.notEqual(
    state.presentation.displayedClassification,
    "Mild asymmetry detected"
  );
}

describe("posture live session — lifecycle", () => {
  it("create starts idle with empty outcomes and insufficient presentation", () => {
    const state = createPostureLiveSession();
    assert.equal(state.status, "idle");
    assert.equal(state.bridgeOutcomes.length, 0);
    assert.equal(state.frameResults.length, 0);
    assert.equal(state.acceptedCount, 0);
    assert.equal(state.rejectedCount, 0);
    assert.equal(state.lastOutcome, null);
    assert.equal(state.aggregate.dataSufficiency, "insufficient");
    // Phase-1 empty-aggregate persistence placeholders remain on aggregate
    assert.equal(state.aggregate.score, 75);
    assert.equal(state.aggregate.label, "Mild asymmetry detected");
    assertInsufficientNoLeakage(state);
  });

  it("ingest while idle is a no-op", () => {
    const idle = createPostureLiveSession();
    const frame = requireFrame(buildAlignedPoseLandmarks());
    const after = ingestPostureLiveFrame(idle, frame);
    assert.equal(after, idle);
    assert.equal(after.status, "idle");
    assert.equal(after.acceptedCount, 0);
    assert.equal(after.bridgeOutcomes.length, 0);
    assertInsufficientNoLeakage(after);
  });

  it("start from idle enters measuring with cleared buffers", () => {
    const started = startPostureLiveSession(createPostureLiveSession());
    assert.equal(started.status, "measuring");
    assert.equal(started.bridgeOutcomes.length, 0);
    assert.equal(started.frameResults.length, 0);
    assert.equal(started.acceptedCount, 0);
    assert.equal(started.rejectedCount, 0);
    assert.equal(started.lastOutcome, null);
    assert.equal(started.aggregate.dataSufficiency, "insufficient");
    assertInsufficientNoLeakage(started);
  });

  it("accept aligned frame updates counts, aggregate, and presentation", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    const frame = requireFrame(buildAlignedPoseLandmarks());
    state = ingestPostureLiveFrame(state, frame);

    assert.equal(state.status, "measuring");
    assert.equal(state.acceptedCount, 1);
    assert.equal(state.rejectedCount, 0);
    assert.equal(state.bridgeOutcomes.length, 1);
    assert.equal(state.frameResults.length, 1);
    assert.ok(state.lastOutcome);
    assert.equal(state.lastOutcome.score, 100);
    assert.equal(state.aggregate.score, 100);
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
    assert.equal(state.presentation.isInsufficient, false);
    assert.equal(state.presentation.displayedScore, "100%");
    assert.equal(state.presentation.displayedClassification, "Good alignment");
    assert.equal(state.presentation.exposeLegacyClinicalFields, true);
  });

  it("reject lowVisibility increments reject and does not reset buffer", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks(), 0)
    );
    assert.equal(state.acceptedCount, 1);
    assert.equal(state.frameResults.length, 1);

    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildLowVisibilityPoseLandmarks(), 1)
    );
    assert.equal(state.status, "measuring");
    assert.equal(state.acceptedCount, 1);
    assert.equal(state.rejectedCount, 1);
    assert.equal(state.bridgeOutcomes.length, 2);
    assert.equal(state.bridgeOutcomes[1], null);
    assert.equal(state.frameResults.length, 1);
    assert.equal(state.lastOutcome, null);
    // Prior accept retained — aggregate / presentation still sufficient
    assert.equal(state.aggregate.score, 100);
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
    assert.equal(state.presentation.displayedScore, "100%");
  });

  it("reject missingRequiredJoint does not enter frameResults", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildMissingRequiredJointPoseLandmarks())
    );
    assert.equal(state.acceptedCount, 0);
    assert.equal(state.rejectedCount, 1);
    assert.equal(state.bridgeOutcomes.length, 1);
    assert.equal(state.bridgeOutcomes[0], null);
    assert.equal(state.frameResults.length, 0);
    assert.equal(state.lastOutcome, null);
    assert.equal(state.aggregate.dataSufficiency, "insufficient");
    assertInsufficientNoLeakage(state);
  });

  it("mixed accept/reject sequence aggregates accepted frames only", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks(), 0)
    );
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildLowVisibilityPoseLandmarks(), 1)
    );
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildShoulderTiltPoseLandmarks(5), 2)
    );

    assert.equal(state.acceptedCount, 2);
    assert.equal(state.rejectedCount, 1);
    assert.equal(state.bridgeOutcomes.length, 3);
    assert.equal(state.frameResults.length, 2);
    assert.equal(state.aggregate.score, 94);
    assert.equal(state.aggregate.label, "Good alignment");
    assert.equal(state.presentation.displayedScore, "94%");
  });

  it("stop with zero accepts is insufficient with no clinical leakage", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildLowVisibilityPoseLandmarks())
    );
    state = stopPostureLiveSession(state);

    assert.equal(state.status, "stopped");
    assert.equal(state.acceptedCount, 0);
    assert.equal(state.rejectedCount, 1);
    assert.equal(state.frameResults.length, 0);
    assert.equal(state.aggregate.dataSufficiency, "insufficient");
    assert.equal(state.aggregate.score, 75);
    assert.equal(state.aggregate.label, "Mild asymmetry detected");
    assertInsufficientNoLeakage(state);
  });

  it("stop with accepts yields sufficient presentation", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks())
    );
    state = stopPostureLiveSession(state);

    assert.equal(state.status, "stopped");
    assert.equal(state.acceptedCount, 1);
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
    assert.equal(state.aggregate.score, 100);
    assert.equal(state.presentation.isInsufficient, false);
    assert.equal(state.presentation.displayedScore, "100%");
    assert.equal(state.presentation.displayedClassification, "Good alignment");
  });

  it("ingest after stop is a no-op until reset/start", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks(), 0)
    );
    state = stopPostureLiveSession(state);
    const stopped = state;

    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildShoulderTiltPoseLandmarks(5), 1)
    );
    assert.equal(state, stopped);
    assert.equal(state.status, "stopped");
    assert.equal(state.acceptedCount, 1);
    assert.equal(state.frameResults.length, 1);
    assert.equal(state.aggregate.score, 100);
  });

  it("reset returns fresh idle session", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks())
    );
    state = stopPostureLiveSession(state);
    state = resetPostureLiveSession(state);

    assert.equal(state.status, "idle");
    assert.equal(state.acceptedCount, 0);
    assert.equal(state.rejectedCount, 0);
    assert.equal(state.bridgeOutcomes.length, 0);
    assert.equal(state.frameResults.length, 0);
    assert.equal(state.lastOutcome, null);
    assertInsufficientNoLeakage(state);

    const fresh = createPostureLiveSession();
    assert.deepEqual(
      {
        status: state.status,
        acceptedCount: state.acceptedCount,
        rejectedCount: state.rejectedCount,
        bridgeOutcomes: state.bridgeOutcomes,
        frameResults: state.frameResults,
        lastOutcome: state.lastOutcome,
        aggregate: state.aggregate,
        presentation: state.presentation,
      },
      {
        status: fresh.status,
        acceptedCount: fresh.acceptedCount,
        rejectedCount: fresh.rejectedCount,
        bridgeOutcomes: fresh.bridgeOutcomes,
        frameResults: fresh.frameResults,
        lastOutcome: fresh.lastOutcome,
        aggregate: fresh.aggregate,
        presentation: fresh.presentation,
      }
    );
  });

  it("start after stop clears prior outcomes and counts", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks(), 0)
    );
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildLowVisibilityPoseLandmarks(), 1)
    );
    state = stopPostureLiveSession(state);
    assert.equal(state.acceptedCount, 1);
    assert.equal(state.rejectedCount, 1);

    state = startPostureLiveSession(state);
    assert.equal(state.status, "measuring");
    assert.equal(state.acceptedCount, 0);
    assert.equal(state.rejectedCount, 0);
    assert.equal(state.bridgeOutcomes.length, 0);
    assert.equal(state.frameResults.length, 0);
    assert.equal(state.lastOutcome, null);
    assert.equal(state.aggregate.dataSufficiency, "insufficient");
    assertInsufficientNoLeakage(state);
  });

  it("high-FPS many accepts: every successful frame counts (no throttle)", () => {
    let state = startPostureLiveSession(createPostureLiveSession());
    const n = 30;
    for (let i = 0; i < n; i++) {
      state = ingestPostureLiveFrame(
        state,
        requireFrame(buildAlignedPoseLandmarks(), i)
      );
    }
    assert.equal(state.acceptedCount, n);
    assert.equal(state.frameResults.length, n);
    assert.equal(state.bridgeOutcomes.length, n);
    assert.equal(state.rejectedCount, 0);
    assert.equal(state.aggregate.score, 100);
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
  });

  it("optional parity: same frames as mixedSequence demo aggregate", () => {
    const demo = runPostureDemoScenario("mixedSequence");
    let state = startPostureLiveSession(createPostureLiveSession());
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildAlignedPoseLandmarks(), 0)
    );
    state = ingestPostureLiveFrame(
      state,
      requireFrame(buildShoulderTiltPoseLandmarks(5), 1)
    );
    state = stopPostureLiveSession(state);

    assert.equal(state.frameResults.length, demo.frameResults.length);
    assert.deepEqual(state.aggregate, demo.aggregate);
    assert.deepEqual(
      state.bridgeOutcomes.map((r) => (r ? r.score : null)),
      demo.bridgeOutcomes.map((r) => (r ? r.score : null))
    );
  });
});
