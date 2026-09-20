/**
 * Run: npx tsx --test app/lib/progress/progress-outcomes-hub-layout.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ADDITIONAL_CAMERA_OBSERVATIONS_TITLE,
  filterOutcomesHubSectionNav,
  formatInteractiveShoulderOutcomeSummary,
  INTERACTIVE_SHOULDER_SECTION_DESCRIPTION,
  shouldMountInteractiveShoulderOutcomesPanel,
  shouldShowCameraObservationsSection,
  shouldShowCaptureReliabilitySection,
  shouldShowInteractiveShoulderEmptyState,
  TRACKING_CAPTURE_NOTES_TITLE,
} from "./progress-outcomes-hub-layout";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_SOURCE = readFileSync(
  join(__dirname, "../../components/clinician/progress/ProgressOutcomesHub.tsx"),
  "utf8",
);
const PANEL_SOURCE = readFileSync(
  join(__dirname, "../../components/clinician/progress/InteractiveShoulderOutcomesPanel.tsx"),
  "utf8",
);

const SECTION_NAV = [
  { id: "session-activity", label: "Session activity" },
  { id: "interactive-shoulder-outcomes", label: "Interactive Shoulder" },
  { id: "camera-assisted-observation", label: "Camera-assisted observation" },
  { id: "technical-capture-reliability", label: "Capture reliability" },
] as const;

describe("progress-outcomes-hub-layout", () => {
  it("hides optional hub sections when there is no data", () => {
    assert.equal(shouldShowCameraObservationsSection(0), false);
    assert.equal(shouldShowCaptureReliabilitySection(0), false);
    assert.equal(shouldShowCameraObservationsSection(1), true);
    assert.equal(shouldShowCaptureReliabilitySection(2), true);
  });

  it("filters section navigation to visible sections only", () => {
    const emptyOptional = filterOutcomesHubSectionNav(SECTION_NAV, 0, 0);
    assert.deepEqual(
      emptyOptional.map((item) => item.id),
      ["session-activity", "interactive-shoulder-outcomes"],
    );

    const withData = filterOutcomesHubSectionNav(SECTION_NAV, 1, 1);
    assert.deepEqual(
      withData.map((item) => item.id),
      [
        "session-activity",
        "interactive-shoulder-outcomes",
        "camera-assisted-observation",
        "technical-capture-reliability",
      ],
    );
  });
});

describe("ProgressOutcomesHub interactive shoulder polish", () => {
  it("shows Interactive Shoulder empty state only when current and chart outcomes are both empty", () => {
    assert.equal(shouldShowInteractiveShoulderEmptyState(0, 0), true);
    assert.equal(shouldShowInteractiveShoulderEmptyState(0, 2), false);
    assert.equal(shouldShowInteractiveShoulderEmptyState(1, 2), false);
    assert.equal(shouldShowInteractiveShoulderEmptyState(1, 1), false);
    assert.ok(HUB_SOURCE.includes("shouldShowInteractiveShoulderEmptyState("));
    assert.ok(!HUB_SOURCE.includes("bundle.interactiveShoulderOutcomes.length === 0 ? ("));
  });

  it("mounts InteractiveShoulderOutcomesPanel when longitudinal chart outcomes exist without current-plan cards", () => {
    assert.equal(shouldMountInteractiveShoulderOutcomesPanel(0, 2), true);
    assert.equal(shouldMountInteractiveShoulderOutcomesPanel(0, 0), false);
    assert.equal(shouldMountInteractiveShoulderOutcomesPanel(1, 2), true);
    assert.ok(HUB_SOURCE.includes("InteractiveShoulderOutcomesPanel"));
    assert.ok(HUB_SOURCE.includes("chartOutcomes={bundle.interactiveShoulderChartOutcomes}"));
    assert.ok(HUB_SOURCE.includes("outcomes={bundle.interactiveShoulderOutcomes}"));
  });

  it("keeps historical outcomes on chartOutcomes only — session cards map current-plan outcomes", () => {
    assert.ok(PANEL_SOURCE.includes("outcomes.map((entry) => ("));
    assert.ok(PANEL_SOURCE.includes("chartOutcomes ?? outcomes"));
    assert.ok(PANEL_SOURCE.includes("longitudinalOutcomes = chartOutcomes ?? outcomes"));
  });

  it("formats summary line with recorded longitudinal count when chart outcomes exist", () => {
    assert.equal(
      formatInteractiveShoulderOutcomeSummary(0, 7),
      "7 recorded Interactive Shoulder outcomes",
    );
    assert.equal(
      formatInteractiveShoulderOutcomeSummary(1, 7),
      "7 recorded Interactive Shoulder outcomes (1 on current plan)",
    );
    assert.equal(
      formatInteractiveShoulderOutcomeSummary(0, 0),
      "0 Interactive Shoulder outcomes (current plan)",
    );
  });

  it("hides empty camera observation and capture sections", () => {
    assert.ok(HUB_SOURCE.includes("showCameraObservations"));
    assert.ok(HUB_SOURCE.includes("showCaptureReliability"));
    assert.ok(!HUB_SOURCE.includes("No camera-assisted observations recorded yet"));
    assert.ok(!HUB_SOURCE.includes("No technical capture reliability records yet"));
  });

  it("renames populated optional sections and removes duplicate shoulder review copy", () => {
    assert.ok(HUB_SOURCE.includes("ADDITIONAL_CAMERA_OBSERVATIONS_TITLE"));
    assert.ok(HUB_SOURCE.includes("TRACKING_CAPTURE_NOTES_TITLE"));
    assert.ok(HUB_SOURCE.includes("INTERACTIVE_SHOULDER_SECTION_DESCRIPTION"));
    assert.ok(!HUB_SOURCE.includes("Session-derived movement data for therapist review"));
  });

  it("does not show unrelated STS or Assessment Center links inside Interactive Shoulder section", () => {
    const shoulderStart = HUB_SOURCE.indexOf('id="interactive-shoulder-outcomes"');
    const cameraStart = HUB_SOURCE.indexOf("showCameraObservations");
    const shoulderSection = HUB_SOURCE.slice(shoulderStart, cameraStart);
    assert.ok(!shoulderSection.includes("STS review"));
    assert.ok(!shoulderSection.includes("Assessment Center"));
    assert.ok(!shoulderSection.includes("Movement tracking on chart"));
  });
});

describe("InteractiveShoulderOutcomesPanel demo polish", () => {
  it("keeps detailed block data collapsed by default", () => {
    assert.ok(PANEL_SOURCE.includes("RECORDED_BLOCK_DETAILS_CTA"));
    assert.ok(PANEL_SOURCE.includes("<details"));
    assert.ok(!PANEL_SOURCE.includes('open={true}'));
  });

  it("renders instructional phases as compact one-line rows", () => {
    assert.ok(PANEL_SOURCE.includes("InstructionalPhaseRow"));
    assert.ok(PANEL_SOURCE.includes("isInstructionalPhaseBlock"));
  });

  it("removes the duplicate session review banner", () => {
    assert.ok(!PANEL_SOURCE.includes("INTERACTIVE_SHOULDER_OUTCOMES_REVIEW_NOTE"));
    assert.ok(!PANEL_SOURCE.includes("Session-derived movement data for therapist review"));
  });

  it("hides tracking notes unless session has actual limitations", () => {
    assert.ok(PANEL_SOURCE.includes("hasInteractiveShoulderTrackingNotes"));
    assert.ok(PANEL_SOURCE.includes("TrackingCaptureNotesSection"));
  });

  it("keeps motion analysis rendering unchanged", () => {
    assert.ok(PANEL_SOURCE.includes("function MotionAnalysisSection"));
    assert.ok(PANEL_SOURCE.includes("buildSessionMotionSnapshot"));
    assert.ok(PANEL_SOURCE.includes("buildRecordedSessionObservation"));
    assert.ok(PANEL_SOURCE.includes("buildBlockMotionProfile"));
  });
});
