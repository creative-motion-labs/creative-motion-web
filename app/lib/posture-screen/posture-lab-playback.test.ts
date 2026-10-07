/**
 * Run: npx tsx --test app/lib/posture-screen/posture-lab-playback.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSUFFICIENT_DATA_DISPLAY } from "@/app/lib/posture-report-presentation";
import {
  getPostureDemoScenarioLandmarkSequences,
  listPostureDemoScenarioIds,
  runPostureDemoScenario,
} from "./posture-demo-fixtures";
import {
  createPostureLabPlayback,
  formatPostureLabAggregatePanelDisplay,
  POSTURE_LAB_SCENARIO_OPTIONS,
  runFullPostureLabScenario,
  runPostureLabPlaybackToEnd,
  stepPostureLabPlayback,
} from "./posture-lab-playback";

describe("posture lab playback — session lifecycle", () => {
  it("create starts at frame 0 with insufficient presentation and no outcomes", () => {
    const state = createPostureLabPlayback("aligned");
    assert.equal(state.nextFrameIndex, 0);
    assert.equal(state.frameCount, 1);
    assert.equal(state.complete, false);
    assert.equal(state.bridgeOutcomes.length, 0);
    assert.equal(state.frameResults.length, 0);
    assert.equal(state.aggregate.dataSufficiency, "insufficient");
    assert.equal(state.presentation.isInsufficient, true);
    assert.equal(state.presentation.displayedScore, INSUFFICIENT_DATA_DISPLAY);
    assert.equal(
      state.presentation.displayedClassification,
      INSUFFICIENT_DATA_DISPLAY
    );
    assert.equal(state.presentation.exposeLegacyClinicalFields, false);
  });

  it("step advances one frame and exposes measured aggregate for aligned", () => {
    const after = stepPostureLabPlayback(createPostureLabPlayback("aligned"));
    assert.equal(after.nextFrameIndex, 1);
    assert.equal(after.complete, true);
    assert.equal(after.frameResults.length, 1);
    assert.equal(after.aggregate.score, 100);
    assert.equal(after.aggregate.dataSufficiency, "sufficient");
    assert.equal(after.presentation.displayedScore, "100%");
    assert.equal(after.presentation.displayedClassification, "Good alignment");
    assert.ok(after.lastOutcome);
    assert.equal(after.lastOutcome.shoulderTilt, 0);
  });

  it("step is idempotent when already complete", () => {
    const done = runFullPostureLabScenario("aligned");
    const again = stepPostureLabPlayback(done);
    assert.equal(again.nextFrameIndex, done.nextFrameIndex);
    assert.equal(again.bridgeOutcomes.length, done.bridgeOutcomes.length);
    assert.equal(again.aggregate.score, done.aggregate.score);
  });

  it("mixedSequence steps frame-by-frame to expected aggregate 94", () => {
    let state = createPostureLabPlayback("mixedSequence");
    assert.equal(state.frameCount, 2);

    state = stepPostureLabPlayback(state);
    assert.equal(state.nextFrameIndex, 1);
    assert.equal(state.complete, false);
    assert.equal(state.aggregate.score, 100);

    state = stepPostureLabPlayback(state);
    assert.equal(state.nextFrameIndex, 2);
    assert.equal(state.complete, true);
    assert.equal(state.aggregate.score, 94);
    assert.equal(state.presentation.displayedScore, "94%");
  });

  it("runPostureLabPlaybackToEnd matches runPostureDemoScenario aggregates", () => {
    for (const id of listPostureDemoScenarioIds()) {
      const demo = runPostureDemoScenario(id);
      const lab = runPostureLabPlaybackToEnd(createPostureLabPlayback(id));
      assert.equal(lab.complete, true);
      assert.equal(lab.frameResults.length, demo.frameResults.length);
      assert.equal(lab.bridgeOutcomes.length, demo.bridgeOutcomes.length);
      assert.deepEqual(lab.aggregate, demo.aggregate);
      assert.deepEqual(
        lab.bridgeOutcomes.map((r) => (r ? r.score : null)),
        demo.bridgeOutcomes.map((r) => (r ? r.score : null))
      );
    }
  });
});

describe("posture lab playback — insufficient scenarios", () => {
  it("lowVisibility never exposes legacy 75% / Mild asymmetry clinically", () => {
    const state = runFullPostureLabScenario("lowVisibility");
    assert.equal(state.bridgeOutcomes[0], null);
    assert.equal(state.frameResults.length, 0);
    // Phase-1 empty-aggregate persistence placeholders remain on aggregate
    assert.equal(state.aggregate.score, 75);
    assert.equal(state.aggregate.label, "Mild asymmetry detected");
    assert.equal(state.aggregate.dataSufficiency, "insufficient");
    assert.equal(state.presentation.displayedScore, INSUFFICIENT_DATA_DISPLAY);
    assert.equal(
      state.presentation.displayedClassification,
      INSUFFICIENT_DATA_DISPLAY
    );
    assert.equal(state.presentation.exposeLegacyClinicalFields, false);
  });

  it("missingRequiredJoint follows the same insufficient presentation guard", () => {
    const state = runFullPostureLabScenario("missingRequiredJoint");
    assert.equal(state.lastOutcome, null);
    assert.equal(state.presentation.isInsufficient, true);
    assert.notEqual(state.presentation.displayedScore, "75%");
    assert.notEqual(
      state.presentation.displayedClassification,
      "Mild asymmetry detected"
    );
  });
});

describe("posture lab aggregate panel display — clinical safety", () => {
  it("insufficient presentation does not expose raw 75 as a displayed aggregate value", () => {
    for (const id of [
      "lowVisibility",
      "missingRequiredJoint",
    ] as const) {
      const state = runFullPostureLabScenario(id);
      assert.equal(state.aggregate.score, 75);
      assert.equal(state.aggregate.dataSufficiency, "insufficient");
      const panel = formatPostureLabAggregatePanelDisplay(state);
      assert.equal(panel.scoreDisplay, "Hidden — legacy placeholder");
      assert.notEqual(panel.scoreDisplay, "75");
      assert.notEqual(panel.scoreDisplay, "75%");
    }

    const initial = createPostureLabPlayback("aligned");
    assert.equal(initial.aggregate.score, 75);
    assert.equal(initial.presentation.isInsufficient, true);
    const initialPanel = formatPostureLabAggregatePanelDisplay(initial);
    assert.equal(initialPanel.scoreDisplay, "Hidden — legacy placeholder");
    assert.notEqual(initialPanel.scoreDisplay, "75");
  });

  it("insufficient presentation does not expose Mild asymmetry detected as displayed aggregate classification", () => {
    for (const id of [
      "lowVisibility",
      "missingRequiredJoint",
    ] as const) {
      const state = runFullPostureLabScenario(id);
      assert.equal(state.aggregate.label, "Mild asymmetry detected");
      const panel = formatPostureLabAggregatePanelDisplay(state);
      assert.equal(panel.labelDisplay, "Hidden — legacy placeholder");
      assert.notEqual(panel.labelDisplay, "Mild asymmetry detected");
    }

    const initial = createPostureLabPlayback("aligned");
    assert.equal(initial.aggregate.label, "Mild asymmetry detected");
    const initialPanel = formatPostureLabAggregatePanelDisplay(initial);
    assert.equal(initialPanel.labelDisplay, "Hidden — legacy placeholder");
    assert.notEqual(initialPanel.labelDisplay, "Mild asymmetry detected");
  });

  it("sufficient marked shoulder tilt still displays 75 / Mild asymmetry detected", () => {
    const state = runFullPostureLabScenario("markedShoulderTilt");
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
    assert.equal(state.aggregate.score, 75);
    assert.equal(state.aggregate.label, "Mild asymmetry detected");
    const panel = formatPostureLabAggregatePanelDisplay(state);
    assert.equal(panel.scoreDisplay, "75");
    assert.equal(panel.labelDisplay, "Mild asymmetry detected");
  });

  it("mixed sequence still displays 94 / Good alignment", () => {
    const state = runFullPostureLabScenario("mixedSequence");
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
    assert.equal(state.aggregate.score, 94);
    assert.equal(state.aggregate.label, "Good alignment");
    const panel = formatPostureLabAggregatePanelDisplay(state);
    assert.equal(panel.scoreDisplay, "94");
    assert.equal(panel.labelDisplay, "Good alignment");
  });
});

describe("posture lab playback — scenario catalog", () => {
  it("POSTURE_LAB_SCENARIO_OPTIONS covers every fixture id exactly once", () => {
    const optionIds = POSTURE_LAB_SCENARIO_OPTIONS.map((o) => o.id).sort();
    const fixtureIds = [...listPostureDemoScenarioIds()].sort();
    assert.deepEqual(optionIds, fixtureIds);
  });

  it("getPostureDemoScenarioLandmarkSequences frame counts match lab frameCount", () => {
    for (const id of listPostureDemoScenarioIds()) {
      const sequences = getPostureDemoScenarioLandmarkSequences(id);
      const state = createPostureLabPlayback(id);
      assert.equal(state.frameCount, sequences.length);
    }
  });

  it("markedShoulderTilt surfaces mild label via presentation when sufficient", () => {
    const state = runFullPostureLabScenario("markedShoulderTilt");
    assert.equal(state.aggregate.score, 75);
    assert.equal(state.aggregate.label, "Mild asymmetry detected");
    assert.equal(state.aggregate.dataSufficiency, "sufficient");
    assert.equal(state.presentation.displayedScore, "75%");
    assert.equal(
      state.presentation.displayedClassification,
      "Mild asymmetry detected"
    );
  });
});
