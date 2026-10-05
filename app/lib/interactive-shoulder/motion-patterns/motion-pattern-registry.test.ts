/**
 * Run: npx tsx --test app/lib/interactive-shoulder/motion-patterns/motion-pattern-registry.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE,
  resolveActiveMotionPattern,
  resolveFeedbackInteractionMode,
  resolveMotionPatternSequenceForSession,
} from "./motion-pattern-registry";
import { D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./d1-inspired-diagonal-reach-pattern";
import { samplePathAtProgress } from "./bezier-path";

describe("motion-pattern-registry", () => {
  it("resolves D1-Inspired Diagonal Reach as a motion-pattern mode", () => {
    assert.equal(resolveFeedbackInteractionMode(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE), "motion-pattern");
    const pattern = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right");
    assert.ok(pattern);
    assert.equal(pattern.id, "d1-inspired-diagonal-reach");
    assert.equal(pattern.nameEn, "D1-Inspired Diagonal Reach");
    assert.equal(pattern.nameAr, "الوصول القطري المستوحى من D1");
  });

  it("falls back to reach-the-light-targets for unknown profiles", () => {
    assert.equal(
      resolveFeedbackInteractionMode(REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE),
      "reach-the-light-targets",
    );
    assert.equal(resolveActiveMotionPattern(REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE, "right"), null);
  });

  it("mirrors path coordinates for left side without claiming PNF validation", () => {
    const right = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right");
    const left = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "left");
    assert.ok(right && left);
    const rightStart = samplePathAtProgress(right.sampledPath, 0);
    const leftStart = samplePathAtProgress(left.sampledPath, 0);
    assert.notEqual(rightStart.x, leftStart.x);
    assert.equal(rightStart.y, leftStart.y);
  });

  it("resolves sequential pattern then target profiles", () => {
    const sequence = resolveMotionPatternSequenceForSession(
      [D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE],
      "right",
    );
    assert.equal(sequence.length, 1);
    assert.equal(sequence[0]?.id, "d1-inspired-diagonal-reach");
  });
});
