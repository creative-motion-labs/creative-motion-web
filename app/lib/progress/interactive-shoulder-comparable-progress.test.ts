/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-comparable-progress.test.ts
 *
 * Longitudinal Interactive Shoulder charts must only plot sessions that measure the same
 * thing. Before this change every outcome a patient ever had -- left and right, any session
 * design -- was summed into one trend. These tests pin:
 *   - which sessions are comparable (same treated side AND same active-block design);
 *   - that excluded sessions are disclosed, never silently merged or dropped;
 *   - the single-session baseline (values only: no line, no claim of change);
 *   - that unavailable observations are gaps, never interpolated or shown as zero;
 *   - bounded 0-10 axes for patient-reported scales and real dates on the axis.
 *
 * All sessions below are deterministic fixtures. None is a real measurement.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractiveShoulderClinicianProgressCharts } from "@/app/components/clinician/progress/InteractiveShoulderClinicianProgressCharts";
import { ProgressSessionBarChart } from "@/app/components/clinician/progress/ProgressSessionBarChart";
import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import type {
  InteractiveShoulderOutcomeReportEntry,
  ProgressOutcomesPainPoint,
} from "@/app/lib/progress/progress-outcomes-bundle";
import {
  BASELINE_NEEDS_SECOND_SESSION_NOTE,
  BASELINE_SESSION_TITLE,
  buildBaselineSessionMetrics,
  buildClinicianProgressChartSeries,
  buildInteractiveShoulderSessionChartPoints,
  buildPatientProgressChartSeries,
  describeComparableSelection,
  MIN_SESSIONS_FOR_PROGRESS_CHARTS,
  resolveOutcomeComparabilityKey,
  selectComparableOutcomes,
  shouldShowInteractiveShoulderProgressCharts,
  toProgressChartDatedPointLabels,
} from "./interactive-shoulder-progress-charts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function block(overrides: Partial<InteractiveShoulderOutcomeBlockReport> = {}): InteractiveShoulderOutcomeBlockReport {
  return {
    blockId: "reach-the-light",
    movementId: "shoulder-abduction-reach",
    title: "Reach the Light",
    blockType: "movement-target",
    displayCategory: "target",
    completionReason: "duration",
    durationSeconds: 240,
    interaction: {
      targetsContacted: 40,
      patternsCompleted: 0,
      timingSamplesMs: [1800, 2000],
      responseConsistency: null,
      participationDurationSeconds: 240,
    },
    measured: {
      validRepetitions: 0,
      invalidRepetitions: 0,
      rangeValuesDegrees: [90],
      holdDurationSeconds: null,
      movementSpeed: null,
      returnControl: null,
      trackingConfidence: null,
    },
    interpreted: {
      compensationEvents: 0,
      asymmetryObservations: [],
      fatigueTrend: "unknown",
      reducedControl: false,
      trackingLimitations: [],
    },
    ...overrides,
  };
}

const warmUp = () =>
  block({
    blockId: "warm-up",
    movementId: "warm-up",
    blockType: "instructional",
    displayCategory: "instructional",
    interaction: { targetsContacted: 0, patternsCompleted: 0, timingSamplesMs: [], responseConsistency: null, participationDurationSeconds: 60 },
    measured: { validRepetitions: 0, invalidRepetitions: 0, rangeValuesDegrees: [], holdDurationSeconds: null, movementSpeed: null, returnControl: null, trackingConfidence: null },
  });

const patternBlock = (patterns = 20) =>
  block({
    blockId: "d1-diagonal",
    movementId: "shoulder-abduction-reach",
    title: "D1-Inspired Diagonal Reach",
    blockType: "movement-pattern",
    displayCategory: "pattern",
    interaction: { targetsContacted: 0, patternsCompleted: patterns, timingSamplesMs: [], responseConsistency: null, participationDurationSeconds: 240 },
    measured: { validRepetitions: 0, invalidRepetitions: 0, rangeValuesDegrees: [], holdDurationSeconds: null, movementSpeed: null, returnControl: null, trackingConfidence: null },
  });

function entry(
  id: string,
  createdAt: string,
  side: InteractiveShoulderOutcomeReportEntry["prescribedSide"],
  blocks: InteractiveShoulderOutcomeBlockReport[] = [warmUp(), block(), patternBlock()],
  planSessionId: string | null = null,
): InteractiveShoulderOutcomeReportEntry {
  return {
    id,
    planSessionId,
    planId: "plan-fixture",
    prescribedSide: side,
    totalElapsedSeconds: 630,
    blocksCompleted: blocks.length,
    blocksTotal: blocks.length,
    schemaVersion: "interactive-shoulder-movement-outcome/v1",
    recognizedSchemaVersion: true,
    createdAt,
    blocks,
  };
}

const T = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;

describe("resolveOutcomeComparabilityKey", () => {
  it("is the same for the same side and the same active-block design", () => {
    assert.equal(
      resolveOutcomeComparabilityKey(entry("a", T(1), "left")),
      resolveOutcomeComparabilityKey(entry("b", T(2), "left")),
    );
  });

  it("differs by treated side", () => {
    assert.notEqual(
      resolveOutcomeComparabilityKey(entry("a", T(1), "left")),
      resolveOutcomeComparabilityKey(entry("b", T(2), "right")),
    );
  });

  it("differs by exercise design", () => {
    assert.notEqual(
      resolveOutcomeComparabilityKey(entry("a", T(1), "left")),
      resolveOutcomeComparabilityKey(entry("b", T(2), "left", [warmUp(), patternBlock()])),
    );
  });

  it("ignores instructional warm-up / cool-down differences (they carry no performance data)", () => {
    assert.equal(
      resolveOutcomeComparabilityKey(entry("a", T(1), "left", [warmUp(), block(), patternBlock()])),
      resolveOutcomeComparabilityKey(entry("b", T(2), "left", [block(), patternBlock()])),
    );
  });

  it("never assumes a legacy outcome without block types matches a current one", () => {
    const legacyBlock = block({ blockType: undefined as never, displayCategory: "unknown" });
    assert.notEqual(
      resolveOutcomeComparabilityKey(entry("old", T(1), "right", [legacyBlock])),
      resolveOutcomeComparabilityKey(entry("new", T(2), "right", [block()])),
    );
  });

  it("keeps a session with no recorded side in its own group", () => {
    assert.notEqual(
      resolveOutcomeComparabilityKey(entry("a", T(1), null)),
      resolveOutcomeComparabilityKey(entry("b", T(2), "left")),
    );
  });
});

describe("selectComparableOutcomes", () => {
  it("returns nothing for no outcomes", () => {
    assert.deepEqual(selectComparableOutcomes([]), { comparable: [], excludedCount: 0, sideLabel: null });
  });

  it("keeps every session when all are comparable, oldest first regardless of input order", () => {
    const selection = selectComparableOutcomes([
      entry("s3", T(5), "left"),
      entry("s1", T(1), "left"),
      entry("s2", T(3), "left"),
    ]);
    assert.deepEqual(selection.comparable.map((e) => e.id), ["s1", "s2", "s3"]);
    assert.equal(selection.excludedCount, 0);
    assert.equal(selection.sideLabel, "LEFT");
  });

  it("never combines left and right: the current (latest) side wins and the rest are counted", () => {
    const selection = selectComparableOutcomes([
      entry("r1", T(1), "right"),
      entry("r2", T(2), "right"),
      entry("l1", T(4), "left"),
      entry("l2", T(6), "left"),
    ]);
    assert.deepEqual(selection.comparable.map((e) => e.id), ["l1", "l2"]);
    assert.equal(selection.excludedCount, 2);
    assert.equal(selection.sideLabel, "LEFT");
  });

  it("never combines different exercise designs", () => {
    const selection = selectComparableOutcomes([
      entry("target-1", T(1), "left"),
      entry("pattern-1", T(2), "left", [warmUp(), patternBlock()]),
      entry("pattern-2", T(3), "left", [warmUp(), patternBlock()]),
    ]);
    assert.deepEqual(selection.comparable.map((e) => e.id), ["pattern-1", "pattern-2"]);
    assert.equal(selection.excludedCount, 1);
  });

  it("a single latest session on a new side is a one-session baseline for that side", () => {
    const selection = selectComparableOutcomes([
      entry("r1", T(1), "right"),
      entry("r2", T(2), "right"),
      entry("l1", T(3), "left"),
    ]);
    assert.equal(selection.comparable.length, 1);
    assert.equal(selection.comparable[0]!.id, "l1");
    assert.equal(selection.excludedCount, 2);
  });

  it("reports no side label when the side is not recorded", () => {
    assert.equal(selectComparableOutcomes([entry("a", T(1), null)]).sideLabel, null);
  });
});

describe("describeComparableSelection", () => {
  it("says nothing when every recorded session is shown", () => {
    assert.equal(describeComparableSelection(selectComparableOutcomes([entry("a", T(1), "left"), entry("b", T(2), "left")])), null);
  });

  it("discloses how many recorded sessions are not shown, and why", () => {
    const note = describeComparableSelection(
      selectComparableOutcomes([entry("r", T(1), "right"), entry("l1", T(2), "left"), entry("l2", T(3), "left")]),
    );
    assert.ok(note);
    assert.match(note, /2 comparable recorded sessions shown \(LEFT side, same session design\)/);
    assert.match(note, /1 other recorded session not shown because the treated side or session design differs/);
  });
});

describe("single-session baseline", () => {
  it("keeps the two-session minimum for a trend", () => {
    assert.equal(MIN_SESSIONS_FOR_PROGRESS_CHARTS, 2);
    assert.equal(shouldShowInteractiveShoulderProgressCharts(1), false);
    assert.equal(shouldShowInteractiveShoulderProgressCharts(2), true);
  });

  it("lists the recorded measures with units, using the same definitions as the trend", () => {
    const pain: ProgressOutcomesPainPoint[] = [
      { sessionLogId: "log", sessionNumber: 1, planSessionId: "ps-1", completedAt: T(1), painBefore: null, painAfter: 3, effortScore: 6 },
    ];
    const metrics = buildBaselineSessionMetrics(entry("a", T(1), "left", undefined, "ps-1"), pain);
    const byId = Object.fromEntries(metrics.map((m) => [m.id, m.value]));
    assert.equal(byId["targets"], "40");
    assert.equal(byId["response-time"], "1.9 s");
    assert.equal(byId["d1-traces"], "20");
    assert.equal(byId["pain-after"], "3/10");
    assert.equal(byId["effort"], "6/10");
  });

  it("omits a measure that was not recorded instead of showing zero", () => {
    const metrics = buildBaselineSessionMetrics(entry("a", T(1), "left", [warmUp(), patternBlock()]));
    const ids = metrics.map((m) => m.id);
    assert.ok(!ids.includes("targets"), "no target block, no target-interaction row");
    assert.ok(!ids.includes("response-time"), "no timing samples, no response-time row");
    assert.ok(!ids.includes("pain-after") && !ids.includes("effort"), "no patient report linked");
    assert.deepEqual(ids, ["d1-traces"]);
  });

  it("labels the compensation signal as a technical proxy, never as a clinical measure", () => {
    const withComp = block({ interpreted: { compensationEvents: 3, asymmetryObservations: [], fatigueTrend: "unknown", reducedControl: false, trackingLimitations: [] } });
    const metrics = buildBaselineSessionMetrics(entry("a", T(1), "left", [warmUp(), withComp]));
    const comp = metrics.find((m) => m.id === "compensation");
    assert.ok(comp);
    assert.equal(comp.secondary, true);
    assert.match(comp.helper ?? "", /not a validated clinical compensation measure/i);
  });
});

describe("longitudinal series", () => {
  it("plots only the comparable sessions, in chronological order, never mixing sides", () => {
    const selection = selectComparableOutcomes([
      entry("r1", T(1), "right", [warmUp(), block({ interaction: { targetsContacted: 99, patternsCompleted: 0, timingSamplesMs: [900], responseConsistency: null, participationDurationSeconds: 240 } })]),
      entry("l2", T(7), "left", [warmUp(), block({ interaction: { targetsContacted: 44, patternsCompleted: 0, timingSamplesMs: [1500], responseConsistency: null, participationDurationSeconds: 240 } })]),
      entry("l1", T(4), "left", [warmUp(), block({ interaction: { targetsContacted: 38, patternsCompleted: 0, timingSamplesMs: [1700], responseConsistency: null, participationDurationSeconds: 240 } })]),
    ]);
    const points = buildInteractiveShoulderSessionChartPoints(selection.comparable);
    const targets = buildClinicianProgressChartSeries(points).find((s) => s.id === "targets");
    assert.ok(targets);
    assert.deepEqual(targets.values, [38, 44], "the right-side 99 is not part of the left trend");
    assert.deepEqual(points.map((p) => p.sessionLabel), ["S1", "S2"]);
  });

  it("an unavailable observation is a gap (null), never zero and never interpolated", () => {
    const noTiming = block({ interaction: { targetsContacted: 30, patternsCompleted: 0, timingSamplesMs: [], responseConsistency: null, participationDurationSeconds: 240 } });
    const points = buildInteractiveShoulderSessionChartPoints([
      entry("a", T(1), "left"),
      entry("b", T(2), "left", [warmUp(), noTiming]),
      entry("c", T(3), "left"),
    ]);
    const response = buildClinicianProgressChartSeries(points).find((s) => s.id === "response-time");
    assert.ok(response);
    assert.deepEqual(response.values, [1.9, null, 1.9]);

    const html = renderToStaticMarkup(
      createElement(ProgressSessionBarChart, {
        pointLabels: toProgressChartDatedPointLabels(points),
        series: response,
        variant: "clinician",
      }),
    );
    assert.equal((html.match(/<circle/g) ?? []).length, 2, "only the two real measurements are plotted");
    assert.equal((html.match(/<path/g) ?? []).length, 0, "no line is drawn across the missing session");
  });

  it("puts the real session date under each point on the clinician axis", () => {
    const points = buildInteractiveShoulderSessionChartPoints([entry("a", T(2), "left"), entry("b", T(9), "left")]);
    const labels = toProgressChartDatedPointLabels(points);
    assert.equal(labels.length, 2);
    for (const label of labels) assert.match(label.dateLabel ?? "", /^[A-Z][a-z]{2} \d{1,2}$/);
    assert.notEqual(labels[0]!.dateLabel, labels[1]!.dateLabel);
  });

  it("keeps patient-reported pain and effort on their real 0-10 scale", () => {
    const pain: ProgressOutcomesPainPoint[] = ["a", "b"].map((id, i) => ({
      sessionLogId: id, sessionNumber: i + 1, planSessionId: `ps-${i}`, completedAt: T(i + 1), painBefore: null, painAfter: 3 + i, effortScore: 5,
    }));
    const points = buildInteractiveShoulderSessionChartPoints(
      [entry("a", T(1), "left", undefined, "ps-0"), entry("b", T(2), "left", undefined, "ps-1")],
      pain,
    );
    const series = buildClinicianProgressChartSeries(points);
    assert.equal(series.find((s) => s.id === "pain-after")?.axisMax, 10);
    assert.equal(series.find((s) => s.id === "effort")?.axisMax, 10);
    assert.equal(series.find((s) => s.id === "targets")?.axisMax, undefined, "counts keep an auto axis");

    const patientSeries = buildPatientProgressChartSeries(
      points.map((p) => ({ sessionId: p.sessionId, sessionLabel: p.sessionLabel, completedAt: p.sessionDate, painAfter: p.painAfter, effortScore: p.effortScore })),
    );
    assert.equal(patientSeries.find((s) => s.id === "pain-after")?.axisMax, 10);

    const html = renderToStaticMarkup(
      createElement(ProgressSessionBarChart, {
        pointLabels: toProgressChartDatedPointLabels(points),
        series: series.find((s) => s.id === "pain-after")!,
        variant: "clinician",
      }),
    );
    const cys = [...html.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.equal(cys.length, 2);
    assert.ok(Math.min(...cys) > 40, "4/10 sits well below the top of a 0-10 axis, not at the ceiling");
  });
});

describe("InteractiveShoulderClinicianProgressCharts (server-rendered)", () => {
  const render = (outcomes: InteractiveShoulderOutcomeReportEntry[], painTrend: ProgressOutcomesPainPoint[] = []) =>
    renderToStaticMarkup(createElement(InteractiveShoulderClinicianProgressCharts, { outcomes, painTrend }));

  it("renders nothing when there are no recorded sessions", () => {
    assert.equal(render([]), "");
  });

  it("one session: a clearly labelled baseline, values only, no chart and no claim of change", () => {
    const html = render([entry("a", T(1), "left")]);
    assert.match(html, /data-testid="progress-baseline"/);
    assert.ok(html.includes(BASELINE_SESSION_TITLE));
    assert.ok(html.includes(BASELINE_NEEDS_SECOND_SESSION_NOTE));
    assert.match(html, /Target interactions/);
    assert.doesNotMatch(html, /<svg/, "no line chart from a single point");
    assert.doesNotMatch(html, /improv|declin|recover|better|worse/i);
  });

  it("two comparable sessions: the line charts appear, with no baseline card", () => {
    const html = render([entry("a", T(1), "left"), entry("b", T(5), "left")]);
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, /data-testid="progress-baseline"/);
    assert.doesNotMatch(html, /not shown because/, "nothing was excluded");
  });

  it("mixed sides: charts only the current side and says how many sessions are left out", () => {
    const html = render([entry("r1", T(1), "right"), entry("r2", T(2), "right"), entry("l1", T(5), "left"), entry("l2", T(6), "left")]);
    assert.match(html, /<svg/);
    assert.match(html, /2 comparable recorded sessions shown \(LEFT side, same session design\)/);
    assert.match(html, /2 other recorded sessions not shown/);
  });

  it("one session on a new side: baseline for that side plus a disclosure of the others", () => {
    const html = render([entry("r1", T(1), "right"), entry("r2", T(2), "right"), entry("l1", T(5), "left")]);
    assert.match(html, /data-testid="progress-baseline"/);
    assert.doesNotMatch(html, /<svg/);
    assert.match(html, /2 other recorded sessions not shown because the treated side or session design differs/);
  });
});

describe("clinician chart wiring", () => {
  const source = readFileSync(
    path.join(ROOT, "app/components/clinician/progress/InteractiveShoulderClinicianProgressCharts.tsx"),
    "utf8",
  );

  it("selects comparable sessions before charting and keeps the two-session guard", () => {
    assert.match(source, /selectComparableOutcomes\(outcomes\)/);
    assert.match(source, /shouldShowInteractiveShoulderProgressCharts\(comparable\.length\)/);
    assert.match(source, /buildInteractiveShoulderSessionChartPoints\(comparable, painTrend\)/);
    assert.match(source, /buildInteractiveShoulderProgressSessionsSummary\(comparable\)/);
  });
});

describe("same patient, two separate plans", () => {
  // Each plan holds exactly one comparable LEFT-side session. Neither plan alone can chart,
  // but together they are two comparable sessions of one patient, so a two-point trend shows.
  const planA = { ...entry("a1", T(1), "left", undefined, "ps-a1"), planId: "plan-a" };
  const planB = { ...entry("b1", T(8), "left", undefined, "ps-b1"), planId: "plan-b" };

  it("each plan alone is only a baseline (guard of 2 untouched)", () => {
    assert.equal(MIN_SESSIONS_FOR_PROGRESS_CHARTS, 2);
    assert.equal(selectComparableOutcomes([planA]).comparable.length, 1);
    assert.equal(shouldShowInteractiveShoulderProgressCharts(selectComparableOutcomes([planA]).comparable.length), false);
    assert.equal(shouldShowInteractiveShoulderProgressCharts(selectComparableOutcomes([planB]).comparable.length), false);
  });

  it("both plans together give two comparable sessions and nothing excluded", () => {
    const selection = selectComparableOutcomes([planB, planA]);
    assert.equal(selection.comparable.length, 2);
    assert.equal(selection.excludedCount, 0);
    assert.equal(shouldShowInteractiveShoulderProgressCharts(selection.comparable.length), true);
  });

  it("produces a valid two-point chronological series across the plans", () => {
    const { comparable } = selectComparableOutcomes([planB, planA]);
    const points = buildInteractiveShoulderSessionChartPoints(comparable);
    assert.deepEqual(points.map((p) => p.sessionId), ["a1", "b1"]);
    assert.deepEqual(points.map((p) => p.sessionLabel), ["S1", "S2"]);
    const series = buildClinicianProgressChartSeries(points);
    assert.ok(series.length > 0);
    for (const one of series) assert.equal(one.values.length, 2);
  });

  it("renders a chart, not a baseline card", () => {
    const html = renderToStaticMarkup(
      createElement(InteractiveShoulderClinicianProgressCharts, { outcomes: [planB, planA], painTrend: [] }),
    );
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, /data-testid="progress-baseline"/);
  });
});
