/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-missing-outcomes.test.ts
 *
 * A completed Interactive Shoulder session can exist WITHOUT a saved movement outcome (the
 * patient-reported completion and the camera-derived outcome are separate saves; the second
 * can fail, or the feature can be off). The clinician must be told, plainly, and the page
 * must never present such a session as having motion analysis -- nor invent data for it.
 *
 * All rows are deterministic fixtures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractiveShoulderMissingOutcomeNotice } from "@/app/components/clinician/progress/InteractiveShoulderMissingOutcomeNotice";
import { buildProgressOutcomesBundle } from "./progress-outcomes-bundle";
import {
  COMPLETED_WITHOUT_OUTCOME_TITLE,
  countCompletedCatalogSessionsWithoutOutcome,
  describeCompletedWithoutOutcomeNotice,
} from "./interactive-shoulder-missing-outcomes";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("countCompletedCatalogSessionsWithoutOutcome", () => {
  it("counts a completed catalog session that has no outcome row", () => {
    assert.equal(
      countCompletedCatalogSessionsWithoutOutcome([{ id: "s1", status: "completed" }], new Set()),
      1,
    );
  });

  it("does not count a completed session that has its outcome", () => {
    assert.equal(
      countCompletedCatalogSessionsWithoutOutcome([{ id: "s1", status: "completed" }], new Set(["s1"])),
      0,
    );
  });

  it("does not count sessions that are not completed (nothing was done, nothing is missing)", () => {
    const sessions = ["upcoming", "today", "skipped"].map((status, i) => ({ id: `s${i}`, status }));
    assert.equal(countCompletedCatalogSessionsWithoutOutcome(sessions, new Set()), 0);
  });

  it("handles the real production shape: one session with an outcome, one without", () => {
    const sessions = [
      { id: "with-outcome", status: "completed" },
      { id: "without-outcome", status: "completed" },
      { id: "not-done-yet", status: "upcoming" },
    ];
    assert.equal(countCompletedCatalogSessionsWithoutOutcome(sessions, new Set(["with-outcome"])), 1);
  });

  it("an outcome for some OTHER session never hides this session's gap", () => {
    assert.equal(
      countCompletedCatalogSessionsWithoutOutcome([{ id: "s1", status: "completed" }], new Set(["s2"])),
      1,
    );
  });

  it("returns 0 for no catalog sessions", () => {
    assert.equal(countCompletedCatalogSessionsWithoutOutcome([], new Set(["s1"])), 0);
  });
});

describe("describeCompletedWithoutOutcomeNotice", () => {
  it("is silent when nothing is missing", () => {
    for (const count of [0, -1, Number.NaN]) assert.equal(describeCompletedWithoutOutcomeNotice(count), null);
  });

  it("says plainly what is and is not available, singular", () => {
    const message = describeCompletedWithoutOutcomeNotice(1);
    assert.ok(message);
    assert.match(message, /^1 completed session in this plan has no saved movement outcome\./);
    assert.match(message, /pain and effort report was recorded/);
    assert.match(message, /was not saved for this session and cannot be reconstructed/);
  });

  it("pluralises correctly", () => {
    const message = describeCompletedWithoutOutcomeNotice(3);
    assert.ok(message);
    assert.match(message, /^3 completed sessions in this plan have no saved movement outcome\./);
    assert.match(message, /was not saved for these sessions/);
  });

  it("makes no clinical claim and promises no recovery of the data", () => {
    const message = describeCompletedWithoutOutcomeNotice(2) ?? "";
    assert.doesNotMatch(message, /\b(improv|declin|recover(y|ed)?|good|poor|normal|abnormal|diagnos)/i);
    assert.match(message, /cannot be reconstructed/);
  });
});

describe("InteractiveShoulderMissingOutcomeNotice (server-rendered)", () => {
  it("renders nothing when every completed session has its outcome", () => {
    assert.equal(renderToStaticMarkup(createElement(InteractiveShoulderMissingOutcomeNotice, { count: 0 })), "");
  });

  it("renders a labelled note when a completed session has no saved movement outcome", () => {
    const html = renderToStaticMarkup(createElement(InteractiveShoulderMissingOutcomeNotice, { count: 1 }));
    assert.match(html, /data-testid="completed-without-outcome-notice"/);
    assert.match(html, /role="note"/);
    assert.ok(html.includes(COMPLETED_WITHOUT_OUTCOME_TITLE));
    assert.match(html, /1 completed session in this plan has no saved movement outcome/);
  });
});

describe("progress bundle and hub wiring", () => {
  const baseInput = {
    patientId: "p",
    patientName: "Fixture Patient",
    planId: "plan",
    planTitle: "Plan",
    sessionsCompleted: 2,
    totalSessions: 3,
    sessionLogs: [],
    sessionNumberById: new Map<string, number>(),
    assessmentRows: [],
    cvMetricRows: [],
    interactiveShoulderOutcomeRows: [],
    interactiveShoulderChartOutcomeRows: [],
    interactiveShoulderChartSessionLogs: [],
    interactiveShoulderChartSessionNumberById: new Map<string, number>(),
  };

  it("carries the count through the bundle", () => {
    const bundle = buildProgressOutcomesBundle({ ...baseInput, interactiveShoulderCompletedWithoutOutcome: 2 });
    assert.equal(bundle.interactiveShoulderCompletedWithoutOutcome, 2);
  });

  it("defaults to 0 for a caller that does not supply it (backward compatible)", () => {
    assert.equal(buildProgressOutcomesBundle(baseInput).interactiveShoulderCompletedWithoutOutcome, 0);
  });

  it("does not create or alter any movement data: outcomes stay exactly as stored", () => {
    const bundle = buildProgressOutcomesBundle({ ...baseInput, interactiveShoulderCompletedWithoutOutcome: 5 });
    assert.deepEqual(bundle.interactiveShoulderOutcomes, []);
    assert.deepEqual(bundle.interactiveShoulderChartOutcomes, []);
  });

  it("the route computes the count from existing rows only, tolerating a legacy schema", () => {
    const route = read("app/api/clinician/progress-outcomes/route.ts");
    assert.match(route, /\.not\("source_program_session_id", "is", null\)/);
    assert.match(route, /if \(!catalogSessionsErr\)/);
    assert.match(route, /countCompletedCatalogSessionsWithoutOutcome\(/);
    assert.match(route, /interactiveShoulderCompletedWithoutOutcome,\s*\r?\n\s*\}\);/);
  });

  it("the hub shows the notice inside the Interactive Shoulder section, separate from CV reports", () => {
    const hub = read("app/components/clinician/progress/ProgressOutcomesHub.tsx");
    const sectionStart = hub.indexOf('id="interactive-shoulder-outcomes"');
    const cameraStart = hub.indexOf('id="camera-assisted-observation"');
    const noticeAt = hub.indexOf("<InteractiveShoulderMissingOutcomeNotice");
    assert.ok(sectionStart >= 0 && cameraStart > sectionStart && noticeAt > sectionStart && noticeAt < cameraStart);
  });
});
