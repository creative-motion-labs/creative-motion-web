/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-submit-once.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildBatteryPayload,
  buildRepTestResult,
  createBatteryOrchestratorState,
  markBatterySubmitting,
} from "./battery-orchestrator";

const PAGE = join(process.cwd(), "app/patient/assessment/[token]/page.tsx");

describe("battery auto-submit once", () => {
  it("submit guard uses a ref to prevent duplicate submission", () => {
    const source = readFileSync(PAGE, "utf8");
    assert.match(source, /submitStartedRef/);
    assert.match(source, /if \(submitStartedRef\.current\) return/);
  });

  it("markBatterySubmitting sets submitAttempted", () => {
    const state = markBatterySubmitting({
      ...createBatteryOrchestratorState(),
      phase: "assessment_completed",
      results: [
        buildRepTestResult({
          testId: "shoulderAbduction",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [80],
          trackingQuality: "good",
        }),
      ],
    });
    assert.equal(state.submitAttempted, true);
    assert.equal(state.phase, "submitting");
  });

  it("buildBatteryPayload includes all four tests for final submit", () => {
    const payload = buildBatteryPayload({
      testedSide: "right",
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
    assert.equal(payload.tests.length, 4);
  });
});
