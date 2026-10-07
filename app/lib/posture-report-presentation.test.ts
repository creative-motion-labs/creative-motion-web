/**
 * Run: npx tsx --test app/lib/posture-report-presentation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PostureCheckResult } from "./posture-analyzer";
import {
  INSUFFICIENT_DATA_DISPLAY,
  labelFromPostureScore,
  resolvePostureReportPresentation,
} from "./posture-report-presentation";

const sampleFrame: PostureCheckResult = {
  shoulderTilt: 2,
  headOffset: 0.01,
  trunkOffset: 0.01,
  hipTilt: 2,
  score: 100,
  label: "Good alignment",
  details: "No significant deviations detected.",
};

describe("resolvePostureReportPresentation — insufficient guard", () => {
  it("does not surface 75% as a valid clinical score when insufficient", () => {
    const presentation = resolvePostureReportPresentation({
      dataSufficiency: "insufficient",
      lastFrame: null,
      score: 75,
      label: "Mild asymmetry detected",
    });

    assert.equal(presentation.isInsufficient, true);
    assert.equal(presentation.exposeLegacyClinicalFields, false);
    assert.equal(presentation.displayedScore, INSUFFICIENT_DATA_DISPLAY);
    assert.notEqual(presentation.displayedScore, "75%");
    assert.equal(presentation.displayedScore.includes("75"), false);
  });

  it("does not surface Mild asymmetry detected as a clinical classification when insufficient", () => {
    const presentation = resolvePostureReportPresentation({
      dataSufficiency: "insufficient",
      lastFrame: null,
      score: 75,
      label: "Mild asymmetry detected",
    });

    assert.equal(
      presentation.displayedClassification,
      INSUFFICIENT_DATA_DISPLAY
    );
    assert.notEqual(
      presentation.displayedClassification,
      "Mild asymmetry detected"
    );
  });

  it("returns Insufficient data for score and classification when insufficient", () => {
    const presentation = resolvePostureReportPresentation({
      dataSufficiency: "insufficient",
      lastFrame: null,
      score: 75,
      label: "Mild asymmetry detected",
    });

    assert.equal(presentation.displayedScore, "Insufficient data");
    assert.equal(presentation.displayedClassification, "Insufficient data");
  });

  it("treats missing lastFrame as insufficient even if dataSufficiency omitted", () => {
    const presentation = resolvePostureReportPresentation({
      lastFrame: null,
      score: 75,
      label: "Mild asymmetry detected",
    });
    assert.equal(presentation.isInsufficient, true);
    assert.equal(presentation.displayedScore, INSUFFICIENT_DATA_DISPLAY);
  });
});

describe("resolvePostureReportPresentation — sufficient path", () => {
  it("exposes existing score and label behavior for sufficient captures", () => {
    const presentation = resolvePostureReportPresentation({
      dataSufficiency: "sufficient",
      lastFrame: sampleFrame,
      score: 90,
      label: "Good alignment",
    });

    assert.equal(presentation.isInsufficient, false);
    assert.equal(presentation.exposeLegacyClinicalFields, true);
    assert.equal(presentation.displayedScore, "90%");
    assert.equal(presentation.displayedClassification, "Good alignment");
  });

  it("exposes Mild asymmetry detected when sufficient and score is 75", () => {
    // Real measured aggregate can legitimately be 75 with that label.
    const presentation = resolvePostureReportPresentation({
      dataSufficiency: "sufficient",
      lastFrame: { ...sampleFrame, score: 75, label: "Mild asymmetry detected" },
      score: 75,
      label: "Mild asymmetry detected",
    });

    assert.equal(presentation.displayedScore, "75%");
    assert.equal(
      presentation.displayedClassification,
      "Mild asymmetry detected"
    );
  });
});

describe("labelFromPostureScore — unchanged thresholds", () => {
  it("maps legacy score bands", () => {
    assert.equal(labelFromPostureScore(100), "Good alignment");
    assert.equal(labelFromPostureScore(80), "Good alignment");
    assert.equal(labelFromPostureScore(75), "Mild asymmetry detected");
    assert.equal(labelFromPostureScore(60), "Mild asymmetry detected");
    assert.equal(labelFromPostureScore(59), "Postural deviation observed");
    assert.equal(labelFromPostureScore(null), null);
  });
});
