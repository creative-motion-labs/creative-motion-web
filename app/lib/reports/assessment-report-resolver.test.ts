/**
 * Run: npx tsx --test app/lib/reports/assessment-report-resolver.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAssessmentReportFromDetail } from "./assessment-report-resolver";
import type { AssessmentDetailResponse } from "@/app/api/assessments/[id]/route";

function baseDetail(
  overrides: Partial<AssessmentDetailResponse> & { structured_data: AssessmentDetailResponse["structured_data"] },
): AssessmentDetailResponse {
  return {
    id: "assessment-1",
    patient_id: "patient-1",
    provider_id: "provider-1",
    type: "upper_limb_motor_screen",
    notes: null,
    status: "completed",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    patient: {
      id: "patient-1",
      full_name: "Test Patient",
      diagnosis: null,
      age: null,
      gender: null,
      sport: null,
      status: "active",
    },
    ...overrides,
  };
}

describe("resolveAssessmentReportFromDetail — remote upper-limb battery", () => {
  it("resolves a battery payload without treating it as a questionnaire", () => {
    const resolved = resolveAssessmentReportFromDetail(
      baseDetail({
        structured_data: {
          schemaVersion: 1,
          assignmentId: "assign-1",
          deliveryMode: "remote_supervised",
          remoteUpperLimbBattery: {
            schemaVersion: 1,
            testedSide: "right",
            completedAt: "2026-09-01T10:00:00.000Z",
            reviewRequired: true,
            tests: [
              {
                testId: "shoulderAbduction",
                repsCompleted: 3,
                repsRequired: 3,
                peakAnglesDeg: [80],
                trackingQuality: "good",
              },
              {
                testId: "shoulderFlexion",
                repsCompleted: 3,
                repsRequired: 3,
                peakAnglesDeg: [70],
                trackingQuality: "good",
              },
              {
                testId: "elbowFlexion",
                repsCompleted: 3,
                repsRequired: 3,
                peakAnglesDeg: [90],
                trackingQuality: "fair",
              },
              {
                testId: "functionalReach",
                attemptsCompleted: 1,
                attemptsRequired: 1,
                peakReachExtent: 0.12,
                trackingQuality: "fair",
                steppingMeasured: false,
                therapistReviewNote: "review",
              },
            ],
          },
        } as AssessmentDetailResponse["structured_data"],
      }),
    );

    assert.equal(resolved.kind, "upper_limb_motor_screen");
    assert.ok(resolved.battery);
    assert.equal(resolved.battery.testedSide, "right");
    assert.equal(resolved.loadError, "");
    assert.equal(resolved.draft, null);
  });
});
