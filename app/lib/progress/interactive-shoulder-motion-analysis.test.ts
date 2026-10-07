/**
 * Run: npx tsx --test app/lib/progress/interactive-shoulder-motion-analysis.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { InteractiveShoulderOutcomeBlockReport } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import { COMPENSATION_SIGNAL_CAVEAT } from "@/app/lib/progress/interactive-shoulder-outcome-clinician-display";
import {
  D1_PATH_TRACES_COMPLETED_HELPER,
  D1_PATH_TRACES_COMPLETED_LABEL,
  FORBIDDEN_OBSERVATION_TERMS,
  PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL,
  PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER,
  PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL,
  averageTargetResponseTimeMs,
  buildBlockMotionProfile,
  buildRecordedSessionObservation,
  buildSessionMotionSnapshot,
  peakMovementAngleDegrees,
  sessionPeakMovementAngleDegrees,
} from "./interactive-shoulder-motion-analysis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOTION_ANALYSIS_SOURCE = readFileSync(
  join(__dirname, "interactive-shoulder-motion-analysis.ts"),
  "utf8",
);
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
      targetsContacted: 24,
      patternsCompleted: 0,
      timingSamplesMs: [1000, 1400],
      responseConsistency: null,
      participationDurationSeconds: 90,
    },
    measured: {
      validRepetitions: 42,
      invalidRepetitions: 0,
      rangeValuesDegrees: [72, 82],
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

describe("interactive-shoulder-motion-analysis wording", () => {
  it("does not use ROM or clinical shoulder-angle labels for the angle metric", () => {
    assert.ok(MOTION_ANALYSIS_SOURCE.includes(PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL));
    assert.ok(MOTION_ANALYSIS_SOURCE.includes(PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER));
    assert.ok(MOTION_ANALYSIS_SOURCE.includes(PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL));
    assert.ok(!MOTION_ANALYSIS_SOURCE.includes("Peak movement angle"));
    assert.ok(!MOTION_ANALYSIS_SOURCE.includes("Highest recorded shoulder angle"));
    assert.ok(!MOTION_ANALYSIS_SOURCE.includes("Peak ROM"));
    assert.ok(!PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL.toLowerCase().includes("rom"));
    assert.ok(!PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL.toLowerCase().includes("rom"));
    assert.ok(PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER.includes("normalized image space"));
    assert.ok(!PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL.toLowerCase().includes("shoulder angle"));
    assert.ok(PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER.includes("not clinical shoulder ROM"));
  });

  it("describes D1 counts as automated path traces, not repetition dose", () => {
    assert.ok(MOTION_ANALYSIS_SOURCE.includes(D1_PATH_TRACES_COMPLETED_LABEL));
    assert.ok(MOTION_ANALYSIS_SOURCE.includes(D1_PATH_TRACES_COMPLETED_HELPER));
    assert.ok(!MOTION_ANALYSIS_SOURCE.includes('"Patterns completed"'));
    assert.ok(D1_PATH_TRACES_COMPLETED_HELPER.includes("not prescribed repetition dose"));
    assert.ok(PANEL_SOURCE.includes("buildBlockDetailsMetrics"));
    assert.ok(!PANEL_SOURCE.includes('label="Patterns completed"'));
  });
});

describe("interactive-shoulder-motion-analysis", () => {
  it("derives peak movement angle only from recorded rangeValuesDegrees", () => {
    assert.equal(peakMovementAngleDegrees(block()), 82);
    assert.equal(
      peakMovementAngleDegrees(block({ measured: { ...block().measured, rangeValuesDegrees: [] } })),
      null,
    );
    assert.equal(sessionPeakMovementAngleDegrees(sessionEntry([block(), block({ measured: { ...block().measured, rangeValuesDegrees: [76] } })])), 82);
  });

  it("derives avg target response time only from timingSamplesMs", () => {
    assert.equal(averageTargetResponseTimeMs([1000, 1400]), 1200);
    assert.equal(averageTargetResponseTimeMs([]), null);
  });

  it("hides empty angle and response metrics in block profiles", () => {
    const sparse = buildBlockMotionProfile(
      block({
        interaction: { ...block().interaction, timingSamplesMs: [], targetsContacted: 0 },
        measured: { ...block().measured, rangeValuesDegrees: [], validRepetitions: 0 },
      }),
    );
    assert.deepEqual(sparse, []);
  });

  it("renders D1 path traces in block profiles with the qualified label", () => {
    const profile = buildBlockMotionProfile(
      block({
        blockId: "d1-diagonal-reach",
        title: "D1 Diagonal Reach",
        blockType: "movement-pattern",
        displayCategory: "pattern",
        interaction: {
          ...block().interaction,
          targetsContacted: 0,
          patternsCompleted: 5,
          timingSamplesMs: [],
        },
        measured: { ...block().measured, rangeValuesDegrees: [76], validRepetitions: 18 },
      }),
    );
    assert.ok(
      profile.some((line) => line.label === D1_PATH_TRACES_COMPLETED_LABEL && line.value === "5"),
    );
    const cycles = profile.find((line) => line.label === "Detected reach-return cycles");
    assert.ok(cycles);
    assert.equal(cycles?.secondary, true);
  });

  it("uses the shorter 2D camera snapshot label at session level with full helper", () => {
    const snapshot = buildSessionMotionSnapshot(sessionEntry([block()]));
    const angleMetric = snapshot.find((metric) => metric.label === PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL);
    assert.ok(angleMetric);
    assert.equal(angleMetric?.helper, PEAK_HIP_SHOULDER_ELBOW_ANGLE_HELPER);
    assert.equal(snapshot.find((metric) => metric.label === PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL), undefined);
  });

  it("always includes compensation caveat in session snapshot", () => {
    const snapshot = buildSessionMotionSnapshot(
      sessionEntry([
        block({
          interpreted: { ...block().interpreted, compensationEvents: 2 },
        }),
      ]),
    );
    const compensation = snapshot.find((metric) => metric.label === "Compensation signal");
    assert.ok(compensation);
    assert.equal(compensation?.helper, COMPENSATION_SIGNAL_CAVEAT);
  });

  it("never uses evaluative or diagnostic language in session observation", () => {
    const observation = buildRecordedSessionObservation(
      sessionEntry([
        block(),
        block({
          blockId: "d1-diagonal-reach",
          title: "D1-Inspired Diagonal Reach",
          blockType: "movement-pattern",
          displayCategory: "pattern",
          interaction: {
            ...block().interaction,
            targetsContacted: 0,
            patternsCompleted: 38,
            timingSamplesMs: [],
          },
          measured: { ...block().measured, rangeValuesDegrees: [179.2], validRepetitions: 0 },
          interpreted: { ...block().interpreted, compensationEvents: 9 },
        }),
      ]),
    );
    assert.ok(observation);
    const lower = observation!.toLowerCase();
    for (const term of FORBIDDEN_OBSERVATION_TERMS) {
      assert.ok(!lower.includes(term), `observation must not include "${term}"`);
    }
    assert.ok(observation!.includes("24 successful target interactions"));
    assert.ok(observation!.includes("average response time of 1.2 seconds"));
    assert.ok(observation!.includes("38 automated path trace completions"));
    assert.ok(observation!.includes("highest recorded 2D hip–shoulder–elbow angle was 179.2°"));
    assert.ok(observation!.includes("Automated compensation signals were flagged 9 times"));
    assert.ok(observation!.endsWith("For therapist review only."));
    assert.ok(!observation!.toLowerCase().includes(" rom"));
    assert.ok(!observation!.includes("completed patterns"));
    assert.ok(!observation!.toLowerCase().includes("repetition dose"));
  });

  it("renders old outcomes with missing measured samples safely", () => {
    const legacy = sessionEntry([
      block({
        interaction: {
          ...block().interaction,
          timingSamplesMs: [],
          targetsContacted: 3,
        },
        measured: {
          ...block().measured,
          rangeValuesDegrees: [],
          validRepetitions: 0,
        },
      }),
    ]);
    const snapshot = buildSessionMotionSnapshot(legacy);
    assert.equal(snapshot.find((metric) => metric.label === PEAK_2D_CAMERA_ANGLE_SNAPSHOT_LABEL), undefined);
    assert.equal(snapshot.find((metric) => metric.label === "Avg target response time"), undefined);
    const profile = buildBlockMotionProfile(legacy.blocks[0]);
    assert.deepEqual(profile, [{ label: "Target interactions", value: "3" }]);
    const observation = buildRecordedSessionObservation(legacy);
    assert.ok(observation?.includes("3 successful target interactions"));
    assert.ok(!observation?.includes("response time"));
    assert.ok(!observation?.includes("hip–shoulder–elbow angle"));
  });

  it("does not expose session-wide valid repetition totals in motion analysis", () => {
    const snapshot = buildSessionMotionSnapshot(sessionEntry([block()]));
    assert.equal(snapshot.find((metric) => metric.label === "Valid repetitions"), undefined);
    const observation = buildRecordedSessionObservation(sessionEntry([block()]));
    assert.ok(observation);
    assert.ok(!observation!.toLowerCase().includes("valid repetition"));
  });
});
