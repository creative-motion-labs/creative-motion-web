/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-request-validation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRemoteUpperLimbBatterySubmitRequest } from "./battery-request-validation";
import { buildBatteryPayload, buildRepTestResult } from "./battery-orchestrator";

describe("battery request validation", () => {
  it("accepts a complete four-test payload", () => {
    const battery = buildBatteryPayload({
      testedSide: "right",
      results: [
        buildRepTestResult({
          testId: "shoulderAbduction",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [88, 90, 89],
          trackingQuality: "good",
        }),
        buildRepTestResult({
          testId: "shoulderFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [58, 60, 59],
          trackingQuality: "good",
        }),
        buildRepTestResult({
          testId: "elbowFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [78, 80, 79],
          trackingQuality: "good",
        }),
        {
          testId: "functionalReach",
          attemptsCompleted: 1,
          attemptsRequired: 1,
          peakReachExtent: 0.11,
          trackingQuality: "fair",
          steppingMeasured: false,
          therapistReviewNote:
            "Patient was instructed to keep feet still. Stepping was not automatically measured in this release.",
        },
      ],
    });

    const result = validateRemoteUpperLimbBatterySubmitRequest({
      assignmentId: "assignment-1",
      battery,
    });
    assert.equal(result.ok, true);
  });
});
