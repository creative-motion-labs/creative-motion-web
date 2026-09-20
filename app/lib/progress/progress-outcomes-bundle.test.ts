/**
 * Run: npx tsx --test app/lib/progress/progress-outcomes-bundle.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCaptureQualityHistory,
  extractCaptureQualityFromMotionQuality,
} from "./extract-capture-quality-history";
import {
  buildAssessmentHistory,
  buildPainTrendFromSessionLogs,
  buildProgressOutcomesBundle,
} from "./progress-outcomes-bundle";

const SAMPLE_CAPTURE_QUALITY = {
  qualityLevel: "high",
  bodyVisibility: "good",
  trackingConfidence: "high",
  cameraPosition: "acceptable",
  retestRecommended: false,
  warnings: [],
};

describe("extractCaptureQualityFromMotionQuality", () => {
  it("reads smtPilot.captureQuality", () => {
    const entry = extractCaptureQualityFromMotionQuality(
      "cv-1",
      "2026-06-01T10:00:00Z",
      "sit-to-stand",
      { smtPilot: { captureQuality: SAMPLE_CAPTURE_QUALITY } },
    );
    assert.ok(entry);
    assert.equal(entry.qualityLevel, "high");
    assert.equal(entry.retestRecommended, false);
  });

  it("returns null when no pilot capture quality", () => {
    const entry = extractCaptureQualityFromMotionQuality(
      "cv-2",
      "2026-06-01T10:00:00Z",
      "sit-to-stand",
      { smtPilot: { repCount: 5 } },
    );
    assert.equal(entry, null);
  });
});

describe("buildCaptureQualityHistory", () => {
  it("sorts chronologically", () => {
    const history = buildCaptureQualityHistory([
      {
        id: "b",
        recorded_at: "2026-06-02T10:00:00Z",
        exercise_id: "sit-to-stand",
        motion_quality: { smtPilot: { captureQuality: { ...SAMPLE_CAPTURE_QUALITY, qualityLevel: "medium" } } },
      },
      {
        id: "a",
        recorded_at: "2026-06-01T10:00:00Z",
        exercise_id: "sit-to-stand",
        motion_quality: { smtPilot: { captureQuality: SAMPLE_CAPTURE_QUALITY } },
      },
    ]);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.cvMetricId, "a");
    assert.equal(history[1]?.qualityLevel, "medium");
  });
});

describe("buildPainTrendFromSessionLogs", () => {
  it("parses pain before from coach notes", () => {
    const trend = buildPainTrendFromSessionLogs(
      [
        {
          id: "log-1",
          plan_session_id: "ps-1",
          effort_score: 6,
          pain_score: 4,
          notes: "[rasq-coach painBefore=7]\n",
          completed_at: "2026-06-01T12:00:00Z",
        },
      ],
      new Map([["ps-1", 2]]),
    );
    assert.equal(trend.length, 1);
    assert.equal(trend[0]?.painBefore, 7);
    assert.equal(trend[0]?.painAfter, 4);
    assert.equal(trend[0]?.sessionNumber, 2);
  });
});

describe("buildAssessmentHistory", () => {
  it("maps assessment rows newest first", () => {
    const rows = buildAssessmentHistory([
      {
        id: "a1",
        patient_id: "p1",
        type: "structured",
        created_at: "2026-06-01T10:00:00Z",
        structured_data: {
          painAtRest: 3,
          painOnMovement: 5,
          bodyRegion: "Knee",
        },
      },
      {
        id: "a2",
        patient_id: "p1",
        type: "remote_questionnaire",
        created_at: "2026-06-03T10:00:00Z",
        structured_data: null,
      },
    ]);
    assert.equal(rows[0]?.assessmentId, "a2");
    assert.equal(rows[1]?.bodyRegion, "Knee");
  });
});

describe("buildProgressOutcomesBundle", () => {
  it("assembles adherence and empty sections", () => {
    const bundle = buildProgressOutcomesBundle({
      patientId: "p1",
      patientName: "Test Patient",
      planId: "plan-1",
      planTitle: "Knee plan",
      sessionsCompleted: 2,
      totalSessions: 4,
      sessionLogs: [],
      sessionNumberById: new Map(),
      assessmentRows: [],
      cvMetricRows: [],
      interactiveShoulderOutcomeRows: [],
      interactiveShoulderChartOutcomeRows: [],
      interactiveShoulderChartSessionLogs: [],
      interactiveShoulderChartSessionNumberById: new Map(),
    });
    assert.equal(bundle.adherence?.progressPct, 50);
    assert.deepEqual(bundle.painTrend, []);
    assert.deepEqual(bundle.cvEvidence, []);
    assert.deepEqual(bundle.interactiveShoulderOutcomes, []);
    assert.deepEqual(bundle.interactiveShoulderChartOutcomes, []);
    assert.deepEqual(bundle.interactiveShoulderChartPainTrend, []);
  });
});
