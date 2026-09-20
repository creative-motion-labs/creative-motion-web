/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-functional-reach-processor.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { mockFunctionalReachLandmarks } from "@/app/lib/cv/functional-reach-detector";
import { PATIENT_FUNCTIONAL_REACH_REP_CONFIG } from "@/app/lib/cv/cv-patient-config";
import {
  createFunctionalReachProcessor,
  createPreviewPositionProcessor,
  resolveFunctionalReachCompletedAttempts,
} from "./battery-frame-processors";
import { FUNCTIONAL_REACH_TRACKING_LOSS_RESET_TICKS } from "./battery-reach-extent";
import {
  completeBatteryTest,
  createBatteryOrchestratorState,
  getActiveBatteryTestId,
  markBatterySubmitting,
  recordBatteryRepCompleted,
  startBatteryAssessment,
  buildRepTestResult,
} from "./battery-orchestrator";

const BASELINE_MS = PATIENT_FUNCTIONAL_REACH_REP_CONFIG.baselineDurationMs;
const R_SHOULDER = 12;
const R_WRIST = 16;
const L_SHOULDER = 11;
const L_WRIST = 15;
const SESSION = join(
  process.cwd(),
  "app/components/patient/RemoteUpperLimbBatterySession.tsx",
);

function ctx(capturedAtMs: number, frameIndex = 0) {
  return { frameIndex, capturedAtMs };
}

function rightReachLandmarks(reachExtent: number, vis = 0.85): PoseLandmark[] {
  const landmarks = mockFunctionalReachLandmarks(reachExtent, vis);
  landmarks[R_SHOULDER] = { x: 0.42, y: 0.32, visibility: vis };
  landmarks[R_WRIST] = { x: 0.42 + reachExtent, y: 0.38, visibility: vis };
  landmarks[11] = { x: 0.58, y: 0.32, visibility: vis * 0.2 };
  landmarks[15] = { x: 0.62, y: 0.42, visibility: vis * 0.2 };
  landmarks[23] = { x: 0.45, y: 0.55, visibility: vis };
  landmarks[24] = { x: 0.55, y: 0.55, visibility: vis };
  return landmarks;
}

function leftReachLandmarks(normalizedExtent: number, vis = 0.85): PoseLandmark[] {
  const landmarks = mockFunctionalReachLandmarks(Math.abs(normalizedExtent), vis);
  landmarks[L_SHOULDER] = { x: 0.58, y: 0.32, visibility: vis };
  landmarks[L_WRIST] = { x: 0.58 - normalizedExtent, y: 0.38, visibility: vis };
  landmarks[R_SHOULDER] = { x: 0.42, y: 0.32, visibility: vis * 0.2 };
  landmarks[R_WRIST] = { x: 0.38, y: 0.42, visibility: vis * 0.2 };
  landmarks[23] = { x: 0.45, y: 0.55, visibility: vis };
  landmarks[24] = { x: 0.55, y: 0.55, visibility: vis };
  return landmarks;
}

function leftForwardReachLandmarks(forwardDelta: number, vis = 0.85): PoseLandmark[] {
  const landmarks = mockFunctionalReachLandmarks(Math.abs(forwardDelta), vis);
  landmarks[L_SHOULDER] = { x: 0.42, y: 0.32, visibility: vis };
  landmarks[L_WRIST] = { x: 0.42 + forwardDelta, y: 0.38, visibility: vis };
  landmarks[R_SHOULDER] = { x: 0.58, y: 0.32, visibility: vis * 0.2 };
  landmarks[R_WRIST] = { x: 0.62, y: 0.42, visibility: vis * 0.2 };
  landmarks[23] = { x: 0.45, y: 0.55, visibility: vis };
  landmarks[24] = { x: 0.55, y: 0.55, visibility: vis };
  return landmarks;
}

function feedExtent(
  processor: ReturnType<typeof createFunctionalReachProcessor>,
  extent: number,
  startMs: number,
  durationMs: number,
  build = rightReachLandmarks,
) {
  let snapshot = processor.processFrame(build(extent), ctx(startMs));
  for (let t = startMs + 33; t <= startMs + durationMs; t += 33) {
    snapshot = processor.processFrame(build(extent), ctx(t));
  }
  return snapshot;
}

function completeReachCycle(processor: ReturnType<typeof createFunctionalReachProcessor>) {
  processor.beginMovementTracking();
  const restExtent = 0.1;
  const peakExtent = 0.02;
  feedExtent(processor, restExtent, 0, BASELINE_MS);
  feedExtent(processor, peakExtent, BASELINE_MS + 900, 200);
  feedExtent(processor, peakExtent, BASELINE_MS + 1_200, 200);
  return feedExtent(processor, restExtent, BASELINE_MS + 1_600, 400);
}

describe("resolveFunctionalReachCompletedAttempts", () => {
  it("requires movement tracking, baseline, internal rep, and return to rest", () => {
    assert.equal(
      resolveFunctionalReachCompletedAttempts({
        movementTrackingEnabled: false,
        baselineReachExtent: 0.1,
        internalRepCount: 1,
        repPhase: "rest",
      }),
      0,
    );
    assert.equal(
      resolveFunctionalReachCompletedAttempts({
        movementTrackingEnabled: true,
        baselineReachExtent: null,
        internalRepCount: 1,
        repPhase: "rest",
      }),
      0,
    );
    assert.equal(
      resolveFunctionalReachCompletedAttempts({
        movementTrackingEnabled: true,
        baselineReachExtent: 0.1,
        internalRepCount: 1,
        repPhase: "peak",
      }),
      0,
    );
    assert.equal(
      resolveFunctionalReachCompletedAttempts({
        movementTrackingEnabled: true,
        baselineReachExtent: 0.1,
        internalRepCount: 1,
        repPhase: "rest",
      }),
      1,
    );
  });
});

describe("functional reach battery processor", () => {
  it("does not count reps before movement tracking is armed", () => {
    const processor = createFunctionalReachProcessor("right");
    const snapshot = feedExtent(processor, 0.1, 0, BASELINE_MS + 2_000);
    assert.equal(snapshot.repCount, 0);
    assert.equal(processor.isMovementTrackingEnabled(), false);
  });

  it("stable positioning via preview processor never completes functional reach", () => {
    const preview = createPreviewPositionProcessor("right");
    const snapshot = preview.processFrame(rightReachLandmarks(0.1), ctx(0));
    assert.equal(snapshot.repCount, 0);
    assert.equal(snapshot.movementPhase, "preview");
  });

  it("arm already forward before arming does not complete on entry", () => {
    const processor = createFunctionalReachProcessor("right");
    feedExtent(processor, 0.14, 0, BASELINE_MS);
    processor.beginMovementTracking();
    const snapshot = feedExtent(processor, 0.14, BASELINE_MS + 500, BASELINE_MS);
    assert.equal(snapshot.repCount, 0);
  });

  it("forward excursion without return does not complete", () => {
    const processor = createFunctionalReachProcessor("right");
    processor.beginMovementTracking();
    feedExtent(processor, 0.1, 0, BASELINE_MS);
    const snapshot = feedExtent(processor, 0.02, BASELINE_MS + 900, 500);
    assert.equal(snapshot.repCount, 0);
    assert.equal(snapshot.movementPhase, "peak");
  });

  it("return without prior valid excursion does not complete", () => {
    const processor = createFunctionalReachProcessor("right");
    processor.beginMovementTracking();
    const snapshot = feedExtent(processor, 0.1, 0, BASELINE_MS + 2_000);
    assert.equal(snapshot.repCount, 0);
  });

  it("completes exactly one attempt after reach and return", () => {
    const processor = createFunctionalReachProcessor("right");
    const snapshot = completeReachCycle(processor);
    assert.equal(snapshot.repCount, 1);
    assert.ok(snapshot.peakReachExtent !== null);
    assert.ok((snapshot.peakReachExtent as number) > 0.04);
    assert.ok((snapshot.peakReachExtent as number) < 0.1);
    const after = feedExtent(processor, 0.1, BASELINE_MS + 3_000, 500);
    assert.equal(after.repCount, 1);
  });

  it("completes a left-side movement cycle using inverted forward reach", () => {
    const processor = createFunctionalReachProcessor("left");
    processor.beginMovementTracking();
    feedExtent(processor, 0.1, 0, BASELINE_MS, leftForwardReachLandmarks);
    feedExtent(processor, 0.26, BASELINE_MS + 900, 200, leftForwardReachLandmarks);
    feedExtent(processor, 0.26, BASELINE_MS + 1_200, 200, leftForwardReachLandmarks);
    const snapshot = feedExtent(
      processor,
      0.1,
      BASELINE_MS + 1_600,
      400,
      leftForwardReachLandmarks,
    );
    assert.equal(snapshot.repCount, 1);
    assert.ok(snapshot.peakReachExtent !== null);
    assert.ok((snapshot.peakReachExtent as number) > 0.08);
    assert.ok((snapshot.peakReachExtent as number) < 0.22);
  });

  it("completes a left-side cycle when landmarks are placed in normalized extent space", () => {
    const processor = createFunctionalReachProcessor("left");
    processor.beginMovementTracking();
    feedExtent(processor, 0.1, 0, BASELINE_MS, leftReachLandmarks);
    feedExtent(processor, 0.02, BASELINE_MS + 900, 200, leftReachLandmarks);
    feedExtent(processor, 0.02, BASELINE_MS + 1_200, 200, leftReachLandmarks);
    const snapshot = feedExtent(processor, 0.1, BASELINE_MS + 1_600, 400, leftReachLandmarks);
    assert.equal(snapshot.repCount, 1);
  });

  it("does not advance baseline or FSM on unusable tracking frames", () => {
    const processor = createFunctionalReachProcessor("right");
    processor.beginMovementTracking();
    feedExtent(processor, 0.1, 0, BASELINE_MS);
    let snapshot = processor.processFrame(rightReachLandmarks(0.1), ctx(BASELINE_MS + 100));
    assert.equal(snapshot.movementPhase, "rest");
    assert.equal(snapshot.repCount, 0);

    for (let i = 0; i < 5; i += 1) {
      snapshot = processor.processFrame(
        rightReachLandmarks(0.0, 0.05),
        ctx(BASELINE_MS + 200 + i * 33),
      );
    }
    assert.equal(snapshot.repCount, 0);
    assert.equal(snapshot.movementPhase, "rest");
  });

  it("recalibrates after prolonged tracking loss and requires a new baseline", () => {
    const processor = createFunctionalReachProcessor("right");
    processor.beginMovementTracking();
    feedExtent(processor, 0.1, 0, BASELINE_MS);

    const lossStart = BASELINE_MS + 200;
    let snapshot = processor.processFrame(rightReachLandmarks(0.1), ctx(lossStart));
    for (let i = 0; i < FUNCTIONAL_REACH_TRACKING_LOSS_RESET_TICKS; i += 1) {
      snapshot = processor.processFrame(
        rightReachLandmarks(0.0, 0.05),
        ctx(lossStart + (i + 1) * 33),
      );
    }
    assert.equal(snapshot.repCount, 0);

    const afterLoss = lossStart + (FUNCTIONAL_REACH_TRACKING_LOSS_RESET_TICKS + 2) * 33;
    feedExtent(processor, 0.02, afterLoss, 200);
    snapshot = feedExtent(processor, 0.1, afterLoss + 400, 300);
    assert.equal(snapshot.repCount, 0);

    const rebaselineStart = afterLoss + 800;
    feedExtent(processor, 0.1, rebaselineStart, BASELINE_MS);
    feedExtent(processor, 0.02, rebaselineStart + BASELINE_MS + 900, 200);
    feedExtent(processor, 0.02, rebaselineStart + BASELINE_MS + 1_200, 200);
    snapshot = feedExtent(processor, 0.1, rebaselineStart + BASELINE_MS + 1_600, 400);
    assert.equal(snapshot.repCount, 1);
  });

  it("reset on retry clears functional reach attempt state", () => {
    const processor = createFunctionalReachProcessor("right");
    completeReachCycle(processor);
    processor.reset();
    assert.equal(processor.isMovementTrackingEnabled(), false);
    const snapshot = processor.processFrame(rightReachLandmarks(0.1), ctx(0));
    assert.equal(snapshot.repCount, 0);
    processor.beginMovementTracking();
    const afterRetry = feedExtent(processor, 0.1, 0, BASELINE_MS + 500);
    assert.equal(afterRetry.repCount, 0);
  });
});

describe("functional reach battery completion wiring", () => {
  it("entering functional reach positioning does not complete the battery", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    for (const testId of ["shoulderAbduction", "shoulderFlexion", "elbowFlexion"] as const) {
      for (let rep = 0; rep < 3; rep += 1) {
        state = { ...state, phase: "test_active" };
        state = recordBatteryRepCompleted(state, 70);
      }
      state = completeBatteryTest(
        state,
        buildRepTestResult({
          testId,
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [70],
          trackingQuality: "good",
        }),
      );
      if (testId === "shoulderAbduction") {
        state = { ...state, phase: "positioning" };
      }
    }
    assert.equal(getActiveBatteryTestId(state), "functionalReach");
    assert.equal(state.phase, "positioning");
    assert.notEqual(state.phase, "assessment_completed");
    assert.equal(state.results.length, 3);
  });

  it("battery auto-submit guard remains single-fire", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /testProcessorArmedRef/);
    assert.match(source, /bindPreviewProcessor\(\)/);
    assert.match(source, /armActiveTestProcessor/);
    assert.match(source, /orchestrator\.phase !== "test_active"/);
    assert.match(source, /submitAttempted/);
    assert.match(source, /processor\.beginMovementTracking\(\)/);
    assert.equal(source.includes("switchToActiveTestProcessor"), false);
  });

  it("marks assessment completed only after functional reach rep is recorded in test_active", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = {
      ...state,
      testIndex: 3,
      phase: "test_active",
      repsCompleted: 0,
      results: [
        buildRepTestResult({
          testId: "shoulderAbduction",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [80],
          trackingQuality: "good",
        }),
        buildRepTestResult({
          testId: "shoulderFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [60],
          trackingQuality: "good",
        }),
        buildRepTestResult({
          testId: "elbowFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [75],
          trackingQuality: "good",
        }),
      ],
    };
    assert.equal(getActiveBatteryTestId(state), "functionalReach");
    state = recordBatteryRepCompleted(state, 0.12);
    assert.equal(state.phase, "test_completed");
    state = completeBatteryTest(state, {
      testId: "functionalReach",
      attemptsCompleted: 1,
      attemptsRequired: 1,
      peakReachExtent: 0.12,
      trackingQuality: "good",
      steppingMeasured: false,
      therapistReviewNote: "note",
    });
    assert.equal(state.phase, "assessment_completed");
    state = markBatterySubmitting(state);
    assert.equal(state.submitAttempted, true);
  });

  it("does not record functional reach reps outside test_active", () => {
    let state = {
      ...startBatteryAssessment(createBatteryOrchestratorState()),
      testIndex: 3,
      phase: "positioning" as const,
    };
    state = recordBatteryRepCompleted(state, 0.12);
    assert.equal(state.repsCompleted, 0);
    assert.equal(state.phase, "positioning");
  });
});
