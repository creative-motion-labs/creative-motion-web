/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-orchestrator.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginBatteryCountdown,
  buildBatteryPayload,
  buildRepTestResult,
  completeBatteryTest,
  completeSideReposition,
  createBatteryOrchestratorState,
  getActiveBatteryTestId,
  recordBatteryRepCompleted,
  retryCurrentBatteryTest,
  startBatteryAssessment,
  tickBatteryCountdown,
} from "./battery-orchestrator";

describe("battery orchestrator", () => {
  it("advances through all four tests automatically", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    assert.equal(getActiveBatteryTestId(state), "shoulderAbduction");

    for (const testId of ["shoulderAbduction", "shoulderFlexion", "elbowFlexion"] as const) {
      assert.equal(getActiveBatteryTestId(state), testId);
      for (let rep = 0; rep < 3; rep += 1) {
        state = { ...state, phase: "test_active" };
        state = recordBatteryRepCompleted(state, 70);
      }
      assert.equal(state.phase, "test_completed");
      state = completeBatteryTest(
        state,
        buildRepTestResult({
          testId,
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [70, 72, 71],
          trackingQuality: "good",
        }),
      );
      if (testId === "shoulderAbduction") {
        assert.equal(state.phase, "reposition_side");
        state = completeSideReposition(state);
      }
    }

    assert.equal(getActiveBatteryTestId(state), "functionalReach");
    state = { ...state, phase: "test_active" };
    state = recordBatteryRepCompleted(state, null);
    assert.equal(state.phase, "test_completed");
    state = completeBatteryTest(state, {
      testId: "functionalReach",
      attemptsCompleted: 1,
      attemptsRequired: 1,
      peakReachExtent: 0.12,
      trackingQuality: "good",
      steppingMeasured: false,
      therapistReviewNote: "Patient was instructed to keep feet still.",
    });

    assert.equal(state.phase, "assessment_completed");
    assert.equal(state.results.length, 4);
  });

  it("retry resets only the active test", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = completeBatteryTest(
      { ...state, phase: "test_completed", repsCompleted: 3 },
      buildRepTestResult({
        testId: "shoulderAbduction",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [80],
        trackingQuality: "good",
      }),
    );
    assert.equal(state.phase, "reposition_side");
    state = completeSideReposition(state);
    assert.equal(state.testIndex, 1);
    assert.equal(state.results.length, 1);

    state = retryCurrentBatteryTest(state);
    assert.equal(state.testIndex, 1);
    assert.equal(state.results.length, 1);
    assert.equal(state.repsCompleted, 0);
    assert.equal(state.phase, "positioning");
    assert.equal(getActiveBatteryTestId(state), "shoulderFlexion");
  });

  it("countdown reaches test_active after three ticks", () => {
    let state = beginBatteryCountdown(startBatteryAssessment(createBatteryOrchestratorState()), 3);
    assert.equal(state.countdown, 3);
    state = tickBatteryCountdown(state);
    assert.equal(state.countdown, 2);
    state = tickBatteryCountdown(state);
    assert.equal(state.countdown, 1);
    state = tickBatteryCountdown(state);
    assert.equal(state.phase, "test_active");
    assert.equal(state.countdown, null);
  });

  it("buildBatteryPayload preserves honest test order", () => {
    const payload = buildBatteryPayload({
      testedSide: "right",
      results: [
        buildRepTestResult({
          testId: "shoulderAbduction",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [90],
          trackingQuality: "good",
        }),
        buildRepTestResult({
          testId: "shoulderFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [60],
          trackingQuality: "fair",
        }),
        buildRepTestResult({
          testId: "elbowFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [75],
          trackingQuality: "good",
        }),
        {
          testId: "functionalReach",
          attemptsCompleted: 1,
          attemptsRequired: 1,
          peakReachExtent: 0.1,
          trackingQuality: "good",
          steppingMeasured: false,
          therapistReviewNote: "note",
        },
      ],
    });
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.tests.length, 4);
    assert.equal(payload.reviewRequired, true);
  });
});
