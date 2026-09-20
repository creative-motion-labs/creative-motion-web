/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-clinician-summary.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData } from "./battery-clinician-summary";
import { extractRemoteUpperLimbBatteryFromStructuredData } from "./extract-assessment-battery";

function sampleStructuredData() {
  return {
    schemaVersion: 1,
    assignmentId: "assign-1",
    deliveryMode: "remote_supervised",
    completedAt: "2026-09-08T09:00:00.000Z",
    remoteUpperLimbBattery: {
      schemaVersion: 1,
      testedSide: "right",
      completedAt: "2026-09-08T09:00:00.000Z",
      reviewRequired: true,
      tests: [
        {
          testId: "shoulderAbduction",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [80, 82, 81],
          trackingQuality: "good",
        },
        {
          testId: "shoulderFlexion",
          repsCompleted: 3,
          repsRequired: 3,
          peakAnglesDeg: [70],
          trackingQuality: "fair",
        },
        {
          testId: "elbowFlexion",
          repsCompleted: 2,
          repsRequired: 3,
          peakAnglesDeg: [95, 98],
          trackingQuality: "good",
        },
        {
          testId: "functionalReach",
          attemptsCompleted: 1,
          attemptsRequired: 1,
          peakReachExtent: 0.08,
          trackingQuality: "good",
          steppingMeasured: false,
          therapistReviewNote:
            "Patient was instructed to keep feet still. Stepping was not automatically measured in this release.",
        },
      ],
    },
  };
}

describe("remote upper-limb battery clinician summary", () => {
  it("extracts remoteUpperLimbBattery from assessments.structured_data", () => {
    const payload = extractRemoteUpperLimbBatteryFromStructuredData(sampleStructuredData());
    assert.ok(payload);
    assert.equal(payload.testedSide, "right");
    assert.equal(payload.tests.length, 4);
  });

  it("builds factual rows without diagnostic scores", () => {
    const summary = buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData(
      sampleStructuredData(),
      "2026-09-08T09:00:00.000Z",
    );
    assert.ok(summary);
    assert.equal(summary.title, "Remote Upper-Limb Battery");
    assert.equal(summary.testedSideLabel, "Right");
    assert.equal(summary.reviewRequired, true);
    assert.equal(summary.rows.length, 4);
    assert.equal(summary.rows[0]?.completion, "3 of 3 repetitions");
    assert.match(summary.rows[0]?.observation ?? "", /80°/);
    assert.match(summary.rows[0]?.metricConvention ?? "", /hip–shoulder–elbow/);
    assert.match(summary.rows[2]?.metricConvention ?? "", /interior elbow angle/);
    assert.match(summary.rows[3]?.observation ?? "", /Normalized reach displacement: 0\.080/);
    assert.match(summary.rows[3]?.metricConvention ?? "", /normalized camera units/);
    assert.equal(summary.disclaimer.includes("not a diagnosis"), true);
    assert.equal(JSON.stringify(summary).includes("score"), false);
  });

  it("returns null when remoteUpperLimbBattery is absent", () => {
    assert.equal(
      extractRemoteUpperLimbBatteryFromStructuredData({ kind: "general_msk", schemaVersion: 2 }),
      null,
    );
  });
});
