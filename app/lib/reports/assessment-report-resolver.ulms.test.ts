/**
 * Run: npx tsx --test app/lib/reports/assessment-report-resolver.ulms.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAssessmentReportFromDetail } from "./assessment-report-resolver";
import { extractRemoteUpperLimbBatteryFromStructuredData } from "@/app/lib/remote-upper-limb-battery/extract-assessment-battery";
import { buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData } from "@/app/lib/remote-upper-limb-battery/battery-clinician-summary";

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
          peakAnglesDeg: [80.4, 82, 81],
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

describe("ULMS assessment report resolver", () => {
  it("resolves upper_limb_motor_screen from persisted structured_data", () => {
    const structuredData = sampleStructuredData();
    const resolved = resolveAssessmentReportFromDetail({
      id: "ulms-1",
      patient_id: "patient-1",
      provider_id: "provider-1",
      type: "upper_limb_motor_screen",
      structured_data: structuredData as never,
      notes: null,
      status: "completed",
      created_at: "2026-09-08T09:00:00.000Z",
      updated_at: "2026-09-08T09:00:00.000Z",
      patient: {
        id: "patient-1",
        full_name: "Test Patient",
        diagnosis: null,
        age: null,
        gender: null,
        sport: null,
        status: "active",
      },
    });

    assert.equal(resolved.kind, "upper_limb_motor_screen");
    assert.equal(resolved.loadError, "");
    assert.ok(resolved.remoteUpperLimbBattery);
    assert.deepEqual(
      resolved.remoteUpperLimbBattery?.tests[0],
      extractRemoteUpperLimbBatteryFromStructuredData(structuredData)?.tests[0],
    );
  });

  it("displays the same persisted peak numbers without inventing scores", () => {
    const structuredData = sampleStructuredData();
    const payload = extractRemoteUpperLimbBatteryFromStructuredData(structuredData);
    const summary = buildRemoteUpperLimbBatteryClinicianSummaryFromStructuredData(
      structuredData,
      "2026-09-08T09:00:00.000Z",
    );
    assert.ok(payload);
    assert.ok(summary);
    assert.equal(payload.tests[0] && "peakAnglesDeg" in payload.tests[0] ? payload.tests[0].peakAnglesDeg[0] : null, 80.4);
    assert.match(summary.rows[0]?.observation ?? "", /80\.4°/);
    assert.equal(JSON.stringify(summary).includes("score"), false);
    assert.match(summary.rows[3]?.observation ?? "", /Normalized reach displacement/);
  });
});
