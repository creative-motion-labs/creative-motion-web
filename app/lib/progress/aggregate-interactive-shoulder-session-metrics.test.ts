/**
 * Run: npx tsx --test app/lib/progress/aggregate-interactive-shoulder-session-metrics.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import { aggregateInteractiveShoulderSessionMetrics } from "./aggregate-interactive-shoulder-session-metrics";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = readFileSync(
  join(__dirname, "../../components/clinician/progress/InteractiveShoulderOutcomesPanel.tsx"),
  "utf8",
);

function emptyBlock(overrides: Record<string, unknown> = {}) {
  return {
    blockId: "block-a",
    movementId: "movement-a",
    title: "Reach the Light",
    blockType: "movement-target" as const,
    displayCategory: "target" as const,
    completionReason: "duration" as const,
    durationSeconds: 60,
    interaction: {
      targetsContacted: 0,
      patternsCompleted: 0,
      timingSamplesMs: [],
      responseConsistency: null,
      participationDurationSeconds: 0,
    },
    measured: {
      validRepetitions: 0,
      invalidRepetitions: 0,
      rangeValuesDegrees: [],
      holdDurationSeconds: null,
      movementSpeed: null,
      returnControl: null,
      trackingConfidence: null,
    },
    interpreted: {
      compensationEvents: 0,
      asymmetryObservations: [],
      fatigueTrend: "unknown" as const,
      reducedControl: false,
      trackingLimitations: [],
    },
    ...overrides,
  };
}

function sessionEntry(blocks: ReturnType<typeof emptyBlock>[]): InteractiveShoulderOutcomeReportEntry {
  return {
    id: "session-1",
    planSessionId: null,
    planId: "plan-1",
    prescribedSide: "LEFT",
    totalElapsedSeconds: 300,
    blocksCompleted: blocks.length,
    blocksTotal: blocks.length,
    schemaVersion: "v1",
    recognizedSchemaVersion: true,
    createdAt: "2026-08-30T00:00:00.000Z",
    blocks,
  };
}

describe("aggregateInteractiveShoulderSessionMetrics", () => {
  it("sums deterministic session facts and averages timing samples across blocks", () => {
    const metrics = aggregateInteractiveShoulderSessionMetrics(
      sessionEntry([
        emptyBlock({
          interaction: {
            targetsContacted: 2,
            patternsCompleted: 0,
            timingSamplesMs: [100, 200],
            responseConsistency: 0.4,
            participationDurationSeconds: 30,
          },
          measured: {
            validRepetitions: 1,
            invalidRepetitions: 0,
            rangeValuesDegrees: [],
            holdDurationSeconds: null,
            movementSpeed: 0.5,
            returnControl: null,
            trackingConfidence: 0.6,
          },
        }),
        emptyBlock({
          blockId: "block-b",
          interaction: {
            targetsContacted: 3,
            patternsCompleted: 1,
            timingSamplesMs: [300],
            responseConsistency: 0.9,
            participationDurationSeconds: 45,
          },
          measured: {
            validRepetitions: 2,
            invalidRepetitions: 0,
            rangeValuesDegrees: [],
            holdDurationSeconds: null,
            movementSpeed: 0.8,
            returnControl: null,
            trackingConfidence: 0.95,
          },
          interpreted: {
            compensationEvents: 1,
            asymmetryObservations: [],
            fatigueTrend: "unknown",
            reducedControl: false,
            trackingLimitations: ["brief occlusion"],
          },
        }),
      ]),
    );

    assert.equal(metrics.targetsContacted, 5);
    assert.equal(metrics.patternsCompleted, 1);
    assert.equal(metrics.validRepetitions, 3);
    assert.equal(metrics.averageReactionMs, 200);
    assert.equal(metrics.compensationEvents, 1);
    assert.deepEqual(metrics.trackingLimitations, ["brief occlusion"]);
    assert.equal("movementSpeed" in metrics, false);
    assert.equal("trackingConfidence" in metrics, false);
    assert.equal("responseConsistency" in metrics, false);
  });
});

describe("InteractiveShoulderOutcomesPanel session summary", () => {
  it("does not render movement speed, tracking confidence, or response consistency at session level", () => {
    const motionStart = PANEL_SOURCE.indexOf("function MotionAnalysisSection");
    const detailedStart = PANEL_SOURCE.indexOf("function RecordedBlockDetailsSection");
    assert.ok(motionStart >= 0, "expected MotionAnalysisSection");
    assert.ok(detailedStart > motionStart, "expected Recorded block details section");
    const motionSection = PANEL_SOURCE.slice(motionStart, detailedStart);
    assert.ok(!motionSection.includes("metrics.movementSpeed"));
    assert.ok(!motionSection.includes("metrics.trackingConfidence"));
    assert.ok(!motionSection.includes("metrics.responseConsistency"));
    assert.ok(motionSection.includes("buildSessionMotionSnapshot"));
    assert.ok(motionSection.includes("buildRecordedSessionObservation"));
    assert.ok(motionSection.includes("buildBlockMotionProfile"));
    assert.ok(!PANEL_SOURCE.includes('label="Valid repetitions"') || PANEL_SOURCE.includes("buildBlockDetailsMetrics"));
    const summaryStart = PANEL_SOURCE.indexOf("<SectionHeading>Session summary</SectionHeading>");
    assert.ok(!PANEL_SOURCE.slice(summaryStart, detailedStart).includes("metrics.validRepetitions"));
    assert.ok(PANEL_SOURCE.includes("buildSessionMotionSnapshot"));
  });
});
