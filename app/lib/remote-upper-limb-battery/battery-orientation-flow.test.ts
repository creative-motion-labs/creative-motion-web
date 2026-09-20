/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-orientation-flow.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getBatteryTestOrientation,
  isSideViewTestId,
  requiresSideRepositionAfterTestIndex,
} from "./battery-orientation";
import {
  beginBatteryCountdown,
  buildRepTestResult,
  canBeginBatteryTest,
  completeBatteryTest,
  completeSideReposition,
  createBatteryOrchestratorState,
  getActiveBatteryTestId,
  startBatteryAssessment,
} from "./battery-orchestrator";

describe("battery orientation flow", () => {
  it("test 1 requires face-camera orientation", () => {
    assert.equal(getBatteryTestOrientation("shoulderAbduction"), "face_camera");
    assert.equal(isSideViewTestId("shoulderAbduction"), false);
  });

  it("tests 2–4 require side-view orientation", () => {
    for (const testId of ["shoulderFlexion", "elbowFlexion", "functionalReach"] as const) {
      assert.equal(getBatteryTestOrientation(testId), "side_view");
      assert.equal(isSideViewTestId(testId), true);
    }
  });

  it("starts test 1 in face-camera positioning", () => {
    const state = startBatteryAssessment(createBatteryOrchestratorState());
    assert.equal(state.phase, "positioning");
    assert.equal(state.testIndex, 0);
    assert.equal(getActiveBatteryTestId(state), "shoulderAbduction");
    assert.equal(getBatteryTestOrientation(getActiveBatteryTestId(state)), "face_camera");
  });

  it("enters reposition_side after test 1 completion, before test 2 positioning", () => {
    let state = startBatteryAssessment(createBatteryOrchestratorState());
    state = completeBatteryTest(
      { ...state, phase: "test_completed", repsCompleted: 3 },
      buildRepTestResult({
        testId: "shoulderAbduction",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [80, 82, 81],
        trackingQuality: "good",
      }),
    );

    assert.equal(state.phase, "reposition_side");
    assert.equal(state.testIndex, 1);
    assert.equal(getActiveBatteryTestId(state), "shoulderFlexion");
    assert.equal(canBeginBatteryTest(state), false);

    state = completeSideReposition(state);
    assert.equal(state.phase, "positioning");
    assert.equal(getActiveBatteryTestId(state), "shoulderFlexion");
    assert.equal(getBatteryTestOrientation("shoulderFlexion"), "side_view");
  });

  it("test 2 cannot start before reposition completes", () => {
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
    assert.equal(beginBatteryCountdown(state, 3).phase, "reposition_side");
    state = completeSideReposition(state);
    assert.equal(beginBatteryCountdown(state, 3).phase, "countdown");
  });

  it("advances from test 2 to 4 without another reposition", () => {
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
    state = completeSideReposition(state);

    for (const testId of ["shoulderFlexion", "elbowFlexion"] as const) {
      assert.equal(getActiveBatteryTestId(state), testId);
      state = completeBatteryTest(
        { ...state, phase: "test_completed", repsCompleted: 3 },
        buildRepTestResult({
          testId,
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [60],
          trackingQuality: "good",
        }),
      );
      assert.notEqual(state.phase, "reposition_side");
      assert.equal(state.phase, "positioning");
    }

    assert.equal(getActiveBatteryTestId(state), "functionalReach");
    assert.equal(getBatteryTestOrientation("functionalReach"), "side_view");
  });

  it("requires reposition only after test index 0", () => {
    assert.equal(requiresSideRepositionAfterTestIndex(0), true);
    assert.equal(requiresSideRepositionAfterTestIndex(1), false);
    assert.equal(requiresSideRepositionAfterTestIndex(2), false);
  });
});
