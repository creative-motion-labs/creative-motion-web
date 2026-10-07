/**
 * Run: npx tsx --test app/lib/progress/objective-assessment-series.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSESSMENT_MOVEMENT_SOURCE,
  OBJECTIVE_RESULTS_DIRECTION_COPY,
  buildPatientObjectiveResults,
  formatObjectiveChange,
} from "./objective-assessment-series";

function batteryStructuredData(input: {
  side: "left" | "right";
  completedAt: string;
  abduction: number[];
  flexion: number[];
  elbow: number[];
  reachExtent?: number;
}) {
  return {
    schemaVersion: 1,
    assignmentId: "assign-1",
    remoteUpperLimbBattery: {
      schemaVersion: 1,
      testedSide: input.side,
      completedAt: input.completedAt,
      reviewRequired: true,
      tests: [
        {
          testId: "shoulderAbduction",
          repsCompleted: input.abduction.length,
          repsRequired: 3,
          peakAnglesDeg: input.abduction,
          trackingQuality: "good",
        },
        {
          testId: "shoulderFlexion",
          repsCompleted: input.flexion.length,
          repsRequired: 3,
          peakAnglesDeg: input.flexion,
          trackingQuality: "good",
        },
        {
          testId: "elbowFlexion",
          repsCompleted: input.elbow.length,
          repsRequired: 3,
          peakAnglesDeg: input.elbow,
          trackingQuality: "fair",
        },
        {
          testId: "functionalReach",
          attemptsCompleted: 1,
          attemptsRequired: 1,
          peakReachExtent: input.reachExtent ?? 0.12,
          trackingQuality: "fair",
          steppingMeasured: false,
          therapistReviewNote: "review required",
        },
      ],
    },
  };
}

describe("buildPatientObjectiveResults", () => {
  it("charts only assessment_movement TUG time, SLS duration, and STS reps", () => {
    const model = buildPatientObjectiveResults({
      patientId: "patient-1",
      cvMetrics: [
        {
          id: "tug-1",
          exerciseId: "timed-up-and-go",
          repCount: 0,
          sessionDurationS: 14.2,
          trackingQuality: "unknown",
          source: ASSESSMENT_MOVEMENT_SOURCE,
          recordedAt: "2026-09-01T10:00:00.000Z",
        },
        {
          id: "tug-plan",
          exerciseId: "timed-up-and-go",
          repCount: 0,
          sessionDurationS: 9,
          trackingQuality: "unknown",
          source: "patient_session",
          recordedAt: "2026-09-02T10:00:00.000Z",
        },
        {
          id: "sls-1",
          exerciseId: "single-leg-stance",
          repCount: 0,
          sessionDurationS: 8,
          trackingQuality: "fair",
          source: ASSESSMENT_MOVEMENT_SOURCE,
          recordedAt: "2026-09-01T11:00:00.000Z",
        },
        {
          id: "sts-1",
          exerciseId: "sit-to-stand",
          repCount: 7,
          sessionDurationS: 30,
          trackingQuality: "good",
          source: ASSESSMENT_MOVEMENT_SOURCE,
          recordedAt: "2026-09-01T12:00:00.000Z",
        },
        {
          id: "sts-plan",
          exerciseId: "sit-to-stand",
          repCount: 20,
          sessionDurationS: 40,
          trackingQuality: "good",
          source: "patient_session",
          recordedAt: "2026-09-03T12:00:00.000Z",
        },
      ],
      batteryAssessments: [],
    });

    assert.equal(model.series.length, 3);
    assert.equal(model.series[0]?.metricKey, "tug.completion_time_s");
    assert.equal(model.series[0]?.latest.value, 14.2);
    assert.equal(model.series[0]?.points.length, 1);
    assert.equal(model.series[1]?.metricKey, "sls.duration_s");
    assert.equal(model.series[2]?.metricKey, "sts.rep_count");
    assert.equal(model.series[2]?.latest.value, 7);
    assert.match(model.series[0]!.workspaceHref, /patientId=patient-1/);
  });

  it("computes comparable change only for the same metric and does not label improvement", () => {
    const model = buildPatientObjectiveResults({
      patientId: "patient-1",
      cvMetrics: [
        {
          id: "tug-1",
          exerciseId: "timed-up-and-go",
          repCount: 0,
          sessionDurationS: 16,
          trackingQuality: "unknown",
          source: ASSESSMENT_MOVEMENT_SOURCE,
          recordedAt: "2026-08-01T10:00:00.000Z",
        },
        {
          id: "tug-2",
          exerciseId: "timed-up-and-go",
          repCount: 0,
          sessionDurationS: 12,
          trackingQuality: "unknown",
          source: ASSESSMENT_MOVEMENT_SOURCE,
          recordedAt: "2026-09-01T10:00:00.000Z",
        },
      ],
      batteryAssessments: [],
    });

    const tug = model.series[0];
    assert.ok(tug);
    assert.equal(tug.change?.delta, -4);
    assert.equal(tug.directionCopy, OBJECTIVE_RESULTS_DIRECTION_COPY.tug);
    const changeLabel = formatObjectiveChange(tug.change, tug.unit);
    assert.equal(changeLabel, "Change: -4 s");
    assert.doesNotMatch(changeLabel ?? "", /improv/i);
  });

  it("keeps left and right battery angles in separate series and omits reach extent", () => {
    const model = buildPatientObjectiveResults({
      patientId: "patient-1",
      cvMetrics: [],
      batteryAssessments: [
        {
          id: "a-right-1",
          type: "upper_limb_motor_screen",
          createdAt: "2026-08-01T10:00:00.000Z",
          structuredData: batteryStructuredData({
            side: "right",
            completedAt: "2026-08-01T10:00:00.000Z",
            abduction: [70],
            flexion: [60],
            elbow: [80],
            reachExtent: 0.2,
          }),
        },
        {
          id: "a-right-2",
          type: "upper_limb_motor_screen",
          createdAt: "2026-09-01T10:00:00.000Z",
          structuredData: batteryStructuredData({
            side: "right",
            completedAt: "2026-09-01T10:00:00.000Z",
            abduction: [78, 82],
            flexion: [66],
            elbow: [88],
            reachExtent: 0.3,
          }),
        },
        {
          id: "a-left-1",
          type: "upper_limb_motor_screen",
          createdAt: "2026-09-02T10:00:00.000Z",
          structuredData: batteryStructuredData({
            side: "left",
            completedAt: "2026-09-02T10:00:00.000Z",
            abduction: [50],
            flexion: [48],
            elbow: [70],
          }),
        },
      ],
    });

    const rightAbd = model.series.find(
      (series) => series.seriesId === "ulms-battery.shoulder_abduction_deg.right",
    );
    const leftAbd = model.series.find(
      (series) => series.seriesId === "ulms-battery.shoulder_abduction_deg.left",
    );
    assert.ok(rightAbd);
    assert.ok(leftAbd);
    assert.equal(rightAbd.points.length, 2);
    assert.equal(rightAbd.latest.value, 82);
    assert.equal(rightAbd.change?.delta, 12);
    assert.equal(leftAbd.points.length, 1);
    assert.equal(leftAbd.change, null);
    assert.equal(rightAbd.directionCopy, OBJECTIVE_RESULTS_DIRECTION_COPY.ulAngle);
    assert.equal(
      model.series.some((series) => series.metricLabel.toLowerCase().includes("reach")),
      false,
    );
    assert.match(rightAbd.latest.workspaceHref, /assessmentId=a-right-2/);
  });

  it("does not create a composite score and ignores questionnaire-shaped rows", () => {
    const model = buildPatientObjectiveResults({
      patientId: "patient-1",
      cvMetrics: [],
      batteryAssessments: [
        {
          id: "q-1",
          type: "remote_questionnaire",
          createdAt: "2026-09-01T10:00:00.000Z",
          structuredData: {
            painAtRest: "8/10",
            bodyRegion: "shoulder",
          },
        },
      ],
    });

    assert.equal(model.series.length, 0);
    assert.equal(model.latestEvent, null);
    assert.equal(
      JSON.stringify(model).includes("RASQ"),
      false,
    );
  });
});
