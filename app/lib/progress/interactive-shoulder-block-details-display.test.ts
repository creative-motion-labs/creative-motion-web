/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-block-details-display.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import {
  TARGET_INTERACTIONS_LABEL,
  VALID_REPETITIONS_LABEL,
} from "@/app/lib/progress/interactive-shoulder-outcome-clinician-display";
import {
  D1_PATH_TRACES_COMPLETED_HELPER,
  D1_PATH_TRACES_COMPLETED_LABEL,
  PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
} from "@/app/lib/progress/interactive-shoulder-motion-analysis";
import {
  RECORDED_BLOCK_DETAILS_CTA,
  RECORDED_BLOCK_DETAILS_SUBTITLE,
  RECORDED_BLOCK_DETAILS_TITLE,
  RECORDED_BLOCK_DETAILS_COMPENSATION_FOOTNOTE,
  TECHNICAL_OBSERVATIONS_LABEL,
  buildBlockDetailsMetrics,
  buildInstructionalBlockDetails,
  buildPatternBlockDetails,
  buildTargetBlockDetails,
  buildTechnicalObservationMetrics,
  formatRecordedBlockDuration,
} from "./interactive-shoulder-block-details-display";

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
      timingSamplesMs: [1200, 1500],
      responseConsistency: null,
      participationDurationSeconds: 90,
    },
    measured: {
      validRepetitions: 42,
      invalidRepetitions: 0,
      rangeValuesDegrees: [82.4],
      holdDurationSeconds: null,
      movementSpeed: null,
      returnControl: null,
      trackingConfidence: null,
    },
    interpreted: {
      compensationEvents: 2,
      asymmetryObservations: [],
      fatigueTrend: "unknown",
      reducedControl: false,
      trackingLimitations: [],
    },
    ...overrides,
  };
}

describe("formatRecordedBlockDuration", () => {
  it("formats raw seconds as mm:ss without decimal leakage", () => {
    assert.equal(formatRecordedBlockDuration(240.025), "4:00");
    assert.equal(formatRecordedBlockDuration(278), "4:38");
    assert.equal(formatRecordedBlockDuration(240.01600000000003), "4:00");
    assert.equal(formatRecordedBlockDuration(null), "—");
  });

  it("never returns floating-point second suffixes", () => {
    const samples = [90, 240.025, 278.9, 61.7];
    for (const value of samples) {
      const formatted = formatRecordedBlockDuration(value);
      assert.ok(!formatted.includes("."));
      assert.ok(!formatted.endsWith("s"));
      assert.match(formatted, /^\d+:\d{2}$/);
    }
  });
});

describe("instructional block details", () => {
  it("shows only completion and duration for warm-up and cool-down phases", () => {
    const warmUp = buildInstructionalBlockDetails(
      block({
        blockId: "stroke-ulrf-v1-session-1-warm-up",
        title: "Warm-up",
        blockType: "instructional",
        displayCategory: "instructional",
        durationSeconds: 240.025,
      }),
    );
    assert.deepEqual(warmUp, [
      { label: "Completed", value: "Yes" },
      { label: "Duration", value: "4:00" },
    ]);

    const coolDown = buildInstructionalBlockDetails(
      block({
        blockId: "stroke-ulrf-v1-session-1-cool-down",
        title: "Cool-down",
        blockType: "instructional",
        displayCategory: "instructional",
        durationSeconds: 278,
      }),
    );
    assert.deepEqual(coolDown, [
      { label: "Completed", value: "Yes" },
      { label: "Duration", value: "4:38" },
    ]);
    assert.equal(warmUp.some((metric) => metric.label === TARGET_INTERACTIONS_LABEL), false);
    assert.equal(coolDown.some((metric) => metric.label === PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL), false);
  });
});

describe("reach block details", () => {
  it("uses safe target interaction and 2D angle labels without repetition wording", () => {
    const metrics = buildTargetBlockDetails(block());
    assert.ok(metrics.some((metric) => metric.label === TARGET_INTERACTIONS_LABEL && metric.value === "4"));
    assert.ok(
      metrics.some(
        (metric) =>
          metric.label === PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL && metric.value === "82.4°",
      ),
    );
    assert.ok(metrics.some((metric) => metric.label === "Avg target response time" && metric.value === "1.4 s"));
    assert.ok(metrics.some((metric) => metric.label === "Compensation signal" && metric.value === "2"));
    assert.ok(metrics.some((metric) => metric.label === "Duration" && metric.value === "1:30"));
    assert.equal(metrics.some((metric) => metric.label === "Valid repetitions"), false);
    assert.equal(metrics.some((metric) => metric.label.toLowerCase().includes("repetition")), false);
  });
});

describe("D1 block details", () => {
  it("uses safe D1 path trace wording with helper and compact metrics", () => {
    const metrics = buildPatternBlockDetails(
      block({
        blockId: "d1-diagonal-reach",
        title: "D1-inspired Diagonal Reach",
        blockType: "movement-pattern",
        displayCategory: "pattern",
        durationSeconds: 278,
        interaction: {
          ...block().interaction,
          targetsContacted: 0,
          patternsCompleted: 38,
          timingSamplesMs: [],
        },
      }),
    );
    const traces = metrics.find((metric) => metric.label === D1_PATH_TRACES_COMPLETED_LABEL);
    assert.ok(traces);
    assert.equal(traces?.value, "38");
    assert.equal(traces?.helper, D1_PATH_TRACES_COMPLETED_HELPER);
    assert.ok(metrics.some((metric) => metric.label === PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL));
    assert.ok(metrics.some((metric) => metric.label === "Duration" && metric.value === "4:38"));
    assert.equal(metrics.some((metric) => metric.label === TARGET_INTERACTIONS_LABEL), false);
  });
});

describe("technical observations", () => {
  it("keeps detected reach-return cycles secondary and out of primary block metrics", () => {
    const primary = buildTargetBlockDetails(block());
    const technical = buildTechnicalObservationMetrics(block());
    assert.equal(primary.some((metric) => metric.label === "Detected reach-return cycles"), false);
    assert.ok(technical.some((metric) => metric.label === "Detected reach-return cycles" && metric.value === "42"));
    assert.ok(technical[0]?.helper?.includes("not prescribed repetitions"));
  });
});

describe("repetition-dosed blocks", () => {
  it("still renders valid repetitions safely for repetition-dosed blocks", () => {
    const metrics = buildTargetBlockDetails(
      block({ completionReason: "validRepetitions", measured: { ...block().measured, validRepetitions: 10 } }),
    );
    assert.ok(metrics.some((metric) => metric.label === VALID_REPETITIONS_LABEL && metric.value === "10"));
  });
});

describe("legacy outcomes", () => {
  it("renders sparse legacy blocks without throwing or leaking raw durations", () => {
    const metrics = buildBlockDetailsMetrics(
      block({
        interaction: { ...block().interaction, timingSamplesMs: [], targetsContacted: 3 },
        measured: { ...block().measured, rangeValuesDegrees: [], validRepetitions: 0 },
        interpreted: { ...block().interpreted, compensationEvents: 0 },
        durationSeconds: 240.01600000000003,
      }),
    );
    assert.ok(metrics.some((metric) => metric.label === TARGET_INTERACTIONS_LABEL && metric.value === "3"));
    assert.ok(metrics.some((metric) => metric.label === "Duration" && metric.value === "4:00"));
    assert.equal(metrics.some((metric) => metric.label === PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL), false);
    assert.equal(metrics.some((metric) => metric.label === "Avg target response time"), false);
  });
});

describe("InteractiveShoulderOutcomesPanel recorded block details", () => {
  it("defaults block details to collapsed with the recorded block details CTA", () => {
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_TITLE"));
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_SUBTITLE"));
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_CTA"));
    assert.ok(PANEL_SOURCE.includes("<details"));
    assert.ok(PANEL_SOURCE.includes("<summary"));
    assert.ok(!PANEL_SOURCE.includes('open={true}'));
    assert.ok(!PANEL_SOURCE.includes("Detailed block data"));
  });

  it("places motion analysis above recorded block details", () => {
    const motionStart = PANEL_SOURCE.indexOf("function MotionAnalysisSection");
    const detailsStart = PANEL_SOURCE.indexOf("function RecordedBlockDetailsSection");
    assert.ok(motionStart >= 0);
    assert.ok(detailsStart > motionStart);
    const outcomeCardStart = PANEL_SOURCE.indexOf("function OutcomeEntryCard");
    const motionCall = PANEL_SOURCE.indexOf("<MotionAnalysisSection entry={entry} />", outcomeCardStart);
    const detailsCall = PANEL_SOURCE.indexOf("<RecordedBlockDetailsSection blocks={entry.blocks} />", outcomeCardStart);
    assert.ok(motionCall > 0);
    assert.ok(detailsCall > motionCall);
  });

  it("uses one section-level compensation footnote instead of per-card caveats", () => {
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_COMPENSATION_FOOTNOTE"));
    assert.ok(!PANEL_SOURCE.includes("COMPENSATION_SIGNAL_CAVEAT"));
    assert.ok(PANEL_SOURCE.includes("TECHNICAL_OBSERVATIONS_LABEL"));
  });

  it("does not render raw second suffixes in block details", () => {
    assert.ok(PANEL_SOURCE.includes("buildBlockDetailsMetrics"));
    assert.ok(!PANEL_SOURCE.includes("formatSecondsOrDash"));
    assert.ok(!PANEL_SOURCE.includes('`${value}s`'));
  });
});
