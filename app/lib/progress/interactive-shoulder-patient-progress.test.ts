/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-patient-progress.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildPatientInteractiveShoulderProgressSessions,
  buildPatientShoulderProgressPointsFromSessions,
  filterInteractiveShoulderOutcomeRowsToPlan,
} from "./interactive-shoulder-patient-progress";
import {
  buildInteractiveShoulderSessionChartPoints,
  shouldShowInteractiveShoulderProgressCharts,
} from "./interactive-shoulder-progress-charts";
import { buildInteractiveShoulderOutcomeReportEntries } from "@/app/lib/interactive-shoulder/movement-outcome-report";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = readFileSync(
  join(__dirname, "../../components/clinician/progress/InteractiveShoulderOutcomesPanel.tsx"),
  "utf8",
);
const PATIENT_CHARTS_SOURCE = readFileSync(
  join(__dirname, "../../components/patient/progress/InteractiveShoulderPatientProgressCharts.tsx"),
  "utf8",
);
const PROGRESS_ROUTE_SOURCE = readFileSync(
  join(__dirname, "../../api/patient/interactive-shoulder-progress/route.ts"),
  "utf8",
);

const PLAN_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PLAN_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SESSION_B = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SESSION_STS = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OUTCOME_A = "11111111-1111-1111-1111-111111111111";
const OUTCOME_B = "22222222-2222-2222-2222-222222222222";

function outcomeRow(input: {
  id: string;
  planId: string;
  planSessionId: string;
  createdAt: string;
}) {
  return {
    id: input.id,
    plan_id: input.planId,
    plan_session_id: input.planSessionId,
    prescribed_side: "left",
    session_state: "completed",
    schema_version: "interactive-shoulder-movement-outcome-v1",
    created_at: input.createdAt,
    outcome_payload: {
      sessionState: "completed",
      totalElapsedSeconds: 120,
      blocksCompleted: 1,
      blocksTotal: 1,
      blockResults: [],
    },
  };
}

describe("interactive-shoulder-patient-progress cross-plan", () => {
  it("builds two sessions across reassigned plans from outcomes only", () => {
    const sessions = buildPatientInteractiveShoulderProgressSessions(
      [
        outcomeRow({
          id: OUTCOME_A,
          planId: PLAN_A,
          planSessionId: SESSION_A,
          createdAt: "2026-08-28T10:00:00.000Z",
        }),
        outcomeRow({
          id: OUTCOME_B,
          planId: PLAN_B,
          planSessionId: SESSION_B,
          createdAt: "2026-08-30T10:00:00.000Z",
        }),
      ],
      [
        {
          plan_session_id: SESSION_A,
          pain_score: 4,
          effort_score: 5,
          completed_at: "2026-08-28T10:05:00.000Z",
        },
        {
          plan_session_id: SESSION_B,
          pain_score: 3,
          effort_score: 6,
          completed_at: "2026-08-30T10:05:00.000Z",
        },
      ],
    );

    assert.equal(sessions.length, 2);
    assert.equal(sessions[0]?.id, OUTCOME_A);
    assert.equal(sessions[1]?.id, OUTCOME_B);
    assert.equal(sessions[0]?.painAfter, 4);
    assert.equal(sessions[1]?.effortScore, 6);
    assert.ok(shouldShowInteractiveShoulderProgressCharts(sessions.length));
  });

  it("excludes non-shoulder logs that are not tied to an Interactive Shoulder outcome", () => {
    const sessions = buildPatientInteractiveShoulderProgressSessions(
      [
        outcomeRow({
          id: OUTCOME_A,
          planId: PLAN_A,
          planSessionId: SESSION_A,
          createdAt: "2026-08-28T10:00:00.000Z",
        }),
        outcomeRow({
          id: OUTCOME_B,
          planId: PLAN_B,
          planSessionId: SESSION_B,
          createdAt: "2026-08-30T10:00:00.000Z",
        }),
      ],
      [
        {
          plan_session_id: SESSION_A,
          pain_score: 4,
          effort_score: 5,
          completed_at: "2026-08-28T10:05:00.000Z",
        },
        {
          plan_session_id: SESSION_STS,
          pain_score: 1,
          effort_score: 2,
          completed_at: "2026-08-29T10:05:00.000Z",
        },
        {
          plan_session_id: SESSION_B,
          pain_score: 3,
          effort_score: 6,
          completed_at: "2026-08-30T10:05:00.000Z",
        },
      ],
    );

    assert.equal(sessions.length, 2);
    assert.equal(sessions.some((session) => session.painAfter === 1), false);
  });

  it("keeps one-session empty state behavior", () => {
    const sessions = buildPatientInteractiveShoulderProgressSessions(
      [
        outcomeRow({
          id: OUTCOME_B,
          planId: PLAN_B,
          planSessionId: SESSION_B,
          createdAt: "2026-08-30T10:00:00.000Z",
        }),
      ],
      [
        {
          plan_session_id: SESSION_B,
          pain_score: 3,
          effort_score: 6,
          completed_at: "2026-08-30T10:05:00.000Z",
        },
      ],
    );

    assert.equal(sessions.length, 1);
    assert.equal(shouldShowInteractiveShoulderProgressCharts(sessions.length), false);
  });

  it("filters current-plan session cards without dropping chart history", () => {
    const rows = [
      outcomeRow({
        id: OUTCOME_A,
        planId: PLAN_A,
        planSessionId: SESSION_A,
        createdAt: "2026-08-28T10:00:00.000Z",
      }),
      outcomeRow({
        id: OUTCOME_B,
        planId: PLAN_B,
        planSessionId: SESSION_B,
        createdAt: "2026-08-30T10:00:00.000Z",
      }),
    ];

    const currentPlanRows = filterInteractiveShoulderOutcomeRowsToPlan(rows, PLAN_B);
    const chartOutcomes = buildInteractiveShoulderOutcomeReportEntries(rows);
    const currentPlanOutcomes = buildInteractiveShoulderOutcomeReportEntries(currentPlanRows);

    assert.equal(currentPlanOutcomes.length, 1);
    assert.equal(chartOutcomes.length, 2);
    assert.equal(buildInteractiveShoulderSessionChartPoints(chartOutcomes).length, 2);
  });
});

describe("patient progress wiring", () => {
  it("uses the cross-plan patient progress API instead of current plan logs", () => {
    assert.ok(PATIENT_CHARTS_SOURCE.includes("usePatientInteractiveShoulderProgress"));
    assert.ok(PATIENT_CHARTS_SOURCE.includes("buildPatientShoulderProgressPointsFromSessions"));
    assert.ok(PROGRESS_ROUTE_SOURCE.includes("planId: null"));
    assert.ok(PROGRESS_ROUTE_SOURCE.includes("resolvePatientPortalAccess"));
    assert.ok(!PROGRESS_ROUTE_SOURCE.includes("compensation"));
    assert.ok(!PROGRESS_ROUTE_SOURCE.includes("2D camera"));
  });

  it("keeps clinician session cards on current-plan outcomes while charts use chartOutcomes", () => {
    assert.ok(PANEL_SOURCE.includes("chartOutcomes"));
    assert.ok(PANEL_SOURCE.includes("chartPainTrend"));
    assert.ok(PANEL_SOURCE.includes("longitudinalOutcomes = chartOutcomes ?? outcomes"));
  });
});

describe("patient progress DTO", () => {
  it("returns only patient-safe fields from sessions", () => {
    const points = buildPatientShoulderProgressPointsFromSessions([
      {
        id: OUTCOME_A,
        completedAt: "2026-08-28T10:05:00.000Z",
        painAfter: 4,
        effortScore: 5,
      },
    ]);

    assert.deepEqual(Object.keys(points[0] ?? {}).sort(), [
      "completedAt",
      "effortScore",
      "painAfter",
      "sessionId",
      "sessionLabel",
    ]);
  });
});
