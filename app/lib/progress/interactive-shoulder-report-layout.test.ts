/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-report-layout.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import {
  getInteractiveShoulderTrackingNotes,
  hasInteractiveShoulderTrackingNotes,
} from "./interactive-shoulder-report-layout";

function block(
  overrides: Partial<InteractiveShoulderOutcomeBlockReport> = {},
): InteractiveShoulderOutcomeBlockReport {
  return {
    blockId: "reach-the-light",
    movementId: "shoulder-abduction-reach",
    title: "Reach the Light",
    blockType: "movement-target",
    displayCategory: "target",
    completionReason: "duration",
    durationSeconds: 90,
    interaction: {
      targetsContacted: 4,
      patternsCompleted: 0,
      timingSamplesMs: [],
      responseConsistency: null,
      participationDurationSeconds: 90,
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
      fatigueTrend: "unknown",
      reducedControl: false,
      trackingLimitations: [],
    },
    ...overrides,
  };
}

function sessionEntry(
  blocks: InteractiveShoulderOutcomeBlockReport[],
): InteractiveShoulderOutcomeReportEntry {
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

describe("interactive-shoulder-report-layout", () => {
  it("hides tracking notes when no limitations were recorded", () => {
    assert.equal(hasInteractiveShoulderTrackingNotes(sessionEntry([block()])), false);
    assert.deepEqual(getInteractiveShoulderTrackingNotes(sessionEntry([block()])), []);
  });

  it("shows tracking notes when persisted limitations exist", () => {
    const entry = sessionEntry([
      block({
        interpreted: {
          ...block().interpreted,
          trackingLimitations: ["brief occlusion", "low landmark visibility"],
        },
      }),
    ]);
    assert.equal(hasInteractiveShoulderTrackingNotes(entry), true);
    assert.deepEqual(getInteractiveShoulderTrackingNotes(entry), [
      "brief occlusion",
      "low landmark visibility",
    ]);
  });
});
