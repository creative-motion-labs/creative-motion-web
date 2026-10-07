/**
 * Run: npx tsx --test app/lib/interactive-shoulder/session-complete-overlay.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { interactiveShoulderUi } from "./interactive-shoulder-ui";

const FORBIDDEN_EN_REP_WORDING = ["Repetitions completed", "Measured repetitions", "Reps completed"];
const FORBIDDEN_AR_REP_WORDING = ["التكرارات المكتملة", "التكرارات المقاسة"];

function readOverlaySource(): string {
  return readFileSync(
    join(process.cwd(), "app/components/patient/interactive-shoulder/SessionCompleteOverlay.tsx"),
    "utf8",
  );
}

describe("SessionCompleteOverlay — patient completion summary", () => {
  it("does not expose repetition wording in the overlay source (EN/AR wiring)", () => {
    const source = readOverlaySource();

    assert.doesNotMatch(source, /repetitionsCompleted/);
    assert.doesNotMatch(source, /repetitionsCompletedLabel/);
    for (const phrase of [...FORBIDDEN_EN_REP_WORDING, ...FORBIDDEN_AR_REP_WORDING]) {
      assert.ok(!source.includes(phrase), `overlay source must not include "${phrase}"`);
    }
  });

  it("keeps session-complete encouragement and review note in EN and AR", () => {
    const en = interactiveShoulderUi("en");
    const ar = interactiveShoulderUi("ar");

    assert.ok(en.sessionCompleteTitle.length > 0);
    assert.ok(ar.sessionCompleteTitle.length > 0);
    assert.ok(en.sessionCompleteHeadline.length > 0);
    assert.ok(ar.sessionCompleteHeadline.length > 0);
    assert.ok(en.sessionCompleteEncouragement.length > 0);
    assert.ok(ar.sessionCompleteEncouragement.length > 0);
    assert.ok(en.sessionCompleteReviewNote.length > 0);
    assert.ok(ar.sessionCompleteReviewNote.length > 0);
  });

  it("still surfaces blocks, interactions, and duration labels in EN and AR", () => {
    const en = interactiveShoulderUi("en");
    const ar = interactiveShoulderUi("ar");

    assert.equal(en.blocksCompletedLabel, "Blocks completed");
    assert.equal(ar.blocksCompletedLabel, "الكتل المكتملة");
    assert.equal(en.interactionsCompletedLabel, "Targets and paths completed");
    assert.equal(ar.interactionsCompletedLabel, "الأهداف والمسارات المكتملة");
    assert.equal(en.durationLabel, "Duration");
    assert.equal(ar.durationLabel, "المدة");
  });

  it("OrchestratorCvSessionCore no longer passes repetitionsCompleted to the overlay", () => {
    const coreSource = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );

    assert.doesNotMatch(coreSource, /repetitionsCompleted=\{summaryMetrics\.reps\}/);
  });
});
