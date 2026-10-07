/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/extract-battery-payload.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractRemoteUpperLimbBatteryFromStructuredData,
  peakObservedAngleDeg,
} from "./extract-battery-payload";
import type { RemoteUpperLimbBatteryPayload } from "./types";

function validBattery(): RemoteUpperLimbBatteryPayload {
  return {
    schemaVersion: 1,
    testedSide: "right",
    completedAt: "2026-09-01T10:00:00.000Z",
    reviewRequired: true,
    tests: [
      {
        testId: "shoulderAbduction",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [80, 88, 84],
        trackingQuality: "good",
      },
      {
        testId: "shoulderFlexion",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [70, 72, 71],
        trackingQuality: "fair",
      },
      {
        testId: "elbowFlexion",
        repsCompleted: 3,
        repsRequired: 3,
        peakAnglesDeg: [95, 98, 96],
        trackingQuality: "good",
      },
      {
        testId: "functionalReach",
        attemptsCompleted: 1,
        attemptsRequired: 1,
        peakReachExtent: 0.12,
        trackingQuality: "fair",
        steppingMeasured: false,
        therapistReviewNote: "review required",
      },
    ],
  };
}

describe("extractRemoteUpperLimbBatteryFromStructuredData", () => {
  it("reads the nested battery payload", () => {
    const battery = extractRemoteUpperLimbBatteryFromStructuredData({
      schemaVersion: 1,
      assignmentId: "assign-1",
      deliveryMode: "remote_supervised",
      remoteUpperLimbBattery: validBattery(),
    });
    assert.ok(battery);
    assert.equal(battery.testedSide, "right");
    assert.equal(battery.tests.length, 4);
  });

  it("returns null when battery JSON is missing or invalid", () => {
    assert.equal(extractRemoteUpperLimbBatteryFromStructuredData(null), null);
    assert.equal(extractRemoteUpperLimbBatteryFromStructuredData({}), null);
    assert.equal(
      extractRemoteUpperLimbBatteryFromStructuredData({
        remoteUpperLimbBattery: { schemaVersion: 99 },
      }),
      null,
    );
  });
});

describe("peakObservedAngleDeg", () => {
  it("uses the maximum persisted peak, never a composite score", () => {
    assert.equal(peakObservedAngleDeg([80, 88, 84]), 88);
    assert.equal(peakObservedAngleDeg([]), null);
  });
});
