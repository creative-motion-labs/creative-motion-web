/**
 * Run: npx tsx --test app/lib/progress/progress-session-chart-colors.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROGRESS_CHART_SERIES_COLORS,
  resolveProgressChartSeriesColor,
} from "./progress-session-chart-colors";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHART_SOURCE = readFileSync(
  join(__dirname, "../../components/clinician/progress/ProgressSessionBarChart.tsx"),
  "utf8",
);

describe("progress-session-chart-colors", () => {
  it("maps clinician metrics to distinct semantic colors", () => {
    assert.equal(resolveProgressChartSeriesColor("targets").stroke, "#3B82F6");
    assert.equal(resolveProgressChartSeriesColor("response-time").stroke, "#8B5CF6");
    assert.equal(resolveProgressChartSeriesColor("d1-traces").stroke, "#14B8A6");
    assert.equal(resolveProgressChartSeriesColor("pain-after").stroke, "#F97316");
    assert.equal(resolveProgressChartSeriesColor("effort").stroke, "#F59E0B");
    assert.equal(resolveProgressChartSeriesColor("compensation", { secondary: true }).stroke, "#64748B");
  });

  it("reuses pain and effort colors for patient charts", () => {
    assert.equal(
      resolveProgressChartSeriesColor("pain-after", { variant: "patient" }).stroke,
      PROGRESS_CHART_SERIES_COLORS["pain-after"]?.stroke,
    );
    assert.equal(
      resolveProgressChartSeriesColor("effort", { variant: "patient" }).stroke,
      PROGRESS_CHART_SERIES_COLORS.effort?.stroke,
    );
    assert.equal(resolveProgressChartSeriesColor("sessions-completed", { variant: "patient" }).stroke, "#2563EB");
  });
});

describe("progress session line chart UI", () => {
  it("renders line charts with visible points instead of bars", () => {
    assert.ok(CHART_SOURCE.includes("<path"));
    assert.ok(CHART_SOURCE.includes("<circle"));
    assert.ok(!CHART_SOURCE.includes("rounded-t-[4px]"));
    assert.ok(CHART_SOURCE.includes("resolveProgressChartSeriesColor"));
    assert.ok(CHART_SOURCE.includes("<title>"));
  });
});
