/**
 * Run: npx tsx --test app/lib/progress/patient-home-progress-chart.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { workspaceUi } from "@/app/lib/patient-portal-ui";
import {
  buildPatientProgressChartSeries,
  toProgressChartDateLabels,
} from "@/app/lib/progress/interactive-shoulder-progress-charts";
import type { PatientShoulderProgressPoint } from "@/app/lib/progress/interactive-shoulder-patient-progress";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOME_SOURCE = readFileSync(
  join(__dirname, "../../components/patient/workspace/PatientWorkspaceHome.tsx"),
  "utf8",
);
const PREVIEW_SOURCE = readFileSync(
  join(
    __dirname,
    "../../components/patient/workspace/PatientHomeProgressChartPreview.tsx",
  ),
  "utf8",
);

function point(
  overrides: Partial<PatientShoulderProgressPoint> = {},
): PatientShoulderProgressPoint {
  return {
    sessionId: "session-1",
    sessionLabel: "Session 1",
    completedAt: "2026-08-01T10:00:00.000Z",
    painAfter: 2,
    effortScore: 6,
    ...overrides,
  };
}

describe("patient home progress chart — data labels", () => {
  it("uses session dates on the chart axis instead of session numbers", () => {
    const labels = toProgressChartDateLabels(
      [
        point({ sessionId: "a", completedAt: "2026-08-01T10:00:00.000Z" }),
        point({ sessionId: "b", completedAt: "2026-08-08T10:00:00.000Z" }),
      ],
      "en",
    );

    assert.equal(labels.length, 2);
    assert.match(labels[0]!.sessionLabel, /Aug/i);
    assert.match(labels[1]!.sessionLabel, /Aug/i);
    assert.doesNotMatch(labels[0]!.sessionLabel, /Session/i);
  });

  it("keeps pain and effort as separate chart series", () => {
    const series = buildPatientProgressChartSeries(
      [
        point({ painAfter: 2, effortScore: 6 }),
        point({ sessionId: "session-2", painAfter: 3, effortScore: 7 }),
      ],
      "en",
    );

    const ids = series.map((entry) => entry.id);
    assert.deepEqual(ids, ["sessions-completed", "pain-after", "effort"]);
    assert.equal(series[1]!.values[0], 2);
    assert.equal(series[2]!.values[1], 7);
  });

  it("localizes Arabic chart series labels", () => {
    const series = buildPatientProgressChartSeries(
      [point({ painAfter: 2 }), point({ sessionId: "session-2", effortScore: 5 })],
      "ar",
    );

    assert.ok(series.some((entry) => entry.label.includes("الجلسات")));
    assert.ok(series.some((entry) => entry.label.includes("شعورك")));
    assert.ok(series.some((entry) => entry.label.includes("جهدك")));
  });
});

describe("patient home progress chart — wiring", () => {
  it("mounts the preview on the patient home page", () => {
    assert.match(HOME_SOURCE, /PatientHomeProgressChartPreview/);
  });

  it("places the progress chart directly after quick stats", () => {
    const statsIndex = HOME_SOURCE.indexOf("<QuickStatsGrid");
    assert.ok(statsIndex >= 0);

    const afterStats = HOME_SOURCE.slice(statsIndex);
    const chartOffset = afterStats.indexOf("<PatientHomeProgressChartPreview");
    const lifetimeOffset = afterStats.indexOf("<PatientLifetimeSummaryCard");

    assert.ok(chartOffset >= 0);
    assert.ok(lifetimeOffset > chartOffset);
  });

  it("reuses the existing interactive shoulder progress hook and chart component", () => {
    assert.match(PREVIEW_SOURCE, /usePatientInteractiveShoulderProgress/);
    assert.match(PREVIEW_SOURCE, /ProgressSessionBarChart/);
    assert.match(PREVIEW_SOURCE, /buildPatientProgressChartSeries/);
    assert.doesNotMatch(PREVIEW_SOURCE, /compensation/i);
    assert.doesNotMatch(PREVIEW_SOURCE, /responseTime/i);
  });

  it("exposes bilingual home progress copy and progress link", () => {
    const en = workspaceUi("en");
    const ar = workspaceUi("ar");
    assert.equal(en.homeProgressTitle, "Your progress");
    assert.equal(ar.homeProgressTitle, "تقدمك");
    assert.equal(en.homeProgressViewLink, "View progress");
    assert.equal(ar.homeProgressViewLink, "عرض التقدم");
  });
});
