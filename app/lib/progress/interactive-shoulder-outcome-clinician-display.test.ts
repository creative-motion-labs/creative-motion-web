/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-outcome-clinician-display.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import {
  isRepetitionDosedBlock,
  peakRomDegrees,
  shouldShowDetectedReachReturnCycles,
  VALID_REPETITIONS_LABEL,
} from "./interactive-shoulder-outcome-clinician-display";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = readFileSync(
  join(__dirname, "../../components/clinician/progress/InteractiveShoulderOutcomesPanel.tsx"),
  "utf8",
);

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
      validRepetitions: 42,
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

describe("interactive-shoulder-outcome-clinician-display", () => {
  it("treats only validRepetitions completion reason as repetition-dosed", () => {
    assert.equal(isRepetitionDosedBlock(block({ completionReason: "validRepetitions" })), true);
    assert.equal(isRepetitionDosedBlock(block({ completionReason: "duration" })), false);
    assert.equal(
      isRepetitionDosedBlock(
        block({ displayCategory: "pattern", blockType: "movement-pattern", completionReason: "duration" }),
      ),
      false,
    );
  });

  it("shows detected reach-return cycles for target/pattern blocks with incidental counts only", () => {
    assert.equal(shouldShowDetectedReachReturnCycles(block()), true);
    assert.equal(
      shouldShowDetectedReachReturnCycles(
        block({ displayCategory: "pattern", blockType: "movement-pattern", measured: { ...block().measured, validRepetitions: 18 } }),
      ),
      true,
    );
    assert.equal(shouldShowDetectedReachReturnCycles(block({ measured: { ...block().measured, validRepetitions: 0 } })), false);
    assert.equal(
      shouldShowDetectedReachReturnCycles(block({ completionReason: "validRepetitions", measured: { ...block().measured, validRepetitions: 10 } })),
      false,
    );
    assert.equal(
      shouldShowDetectedReachReturnCycles(
        block({ displayCategory: "instructional", blockType: "instructional", measured: { ...block().measured, validRepetitions: 3 } }),
      ),
      false,
    );
  });

  it("returns peak ROM only when range samples exist", () => {
    assert.equal(peakRomDegrees(block()), null);
    assert.equal(
      peakRomDegrees(block({ measured: { ...block().measured, rangeValuesDegrees: [82, 95.5] } })),
      95.5,
    );
  });
});

describe("InteractiveShoulderOutcomesPanel clinician semantics", () => {
  it("does not show a session-wide valid repetition total", () => {
    const summaryStart = PANEL_SOURCE.indexOf("<SectionHeading>Session summary</SectionHeading>");
    const detailsUsage = PANEL_SOURCE.indexOf("<RecordedBlockDetailsSection blocks={entry.blocks} />");
    assert.ok(summaryStart >= 0);
    assert.ok(detailsUsage > summaryStart);
    const sessionSummary = PANEL_SOURCE.slice(summaryStart, detailsUsage);
    assert.ok(!sessionSummary.includes(VALID_REPETITIONS_LABEL));
    assert.ok(!sessionSummary.includes("metrics.validRepetitions"));
  });

  it("relabels targets contacted to target interactions and uses section-level compensation footnote", () => {
    assert.ok(PANEL_SOURCE.includes("buildBlockDetailsMetrics"));
    assert.ok(!PANEL_SOURCE.includes("Targets contacted"));
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_COMPENSATION_FOOTNOTE"));
    assert.ok(!PANEL_SOURCE.includes("Compensation events"));
  });

  it("uses detected reach-return cycles in technical observations", () => {
    assert.ok(PANEL_SOURCE.includes("TECHNICAL_OBSERVATIONS_LABEL"));
    assert.ok(PANEL_SOURCE.includes("buildTechnicalObservationMetrics"));
    assert.ok(PANEL_SOURCE.includes("buildBlockDetailsMetrics"));
  });

  it("keeps valid repetitions only for repetition-dosed blocks", () => {
    assert.ok(PANEL_SOURCE.includes("buildBlockDetailsMetrics"));
  });

  it("hides empty reaction and ROM fields in motion analysis", () => {
    assert.ok(PANEL_SOURCE.includes("buildSessionMotionSnapshot"));
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_TITLE"));
  });
});
