/**
 * Run: npx tsx --test app/lib/rasq-demo/rasq-demo-d1-diagonal-reach-pattern.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE } from "@/app/lib/interactive-shoulder/motion-patterns/d1-inspired-diagonal-reach-pattern";
import { samplePathAtProgress } from "@/app/lib/interactive-shoulder/motion-patterns/bezier-path";
import { PATTERN_BLOCK_RUNNER } from "@/app/lib/interactive-shoulder/block-engine/pattern-block-runner";
import {
  resolveActiveMotionPattern,
  resolveFeedbackInteractionMode,
} from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-registry";
import { CLINICAL_MOTION_PATTERN_SESSION } from "@/app/lib/interactive-shoulder/clinical-motion-pattern-session-definition";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import {
  RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE,
  RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN,
} from "./rasq-demo-d1-diagonal-reach-pattern";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_TWO_MINUTE_DEMO_SESSION,
} from "./demo-session-definition";

describe("RASQ demo D1 diagonal reach pattern", () => {
  it("registers as motion-pattern mode and resolves distinct from clinical D1", () => {
    assert.equal(
      resolveFeedbackInteractionMode(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE),
      "motion-pattern",
    );
    const demo = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right");
    const clinical = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right");
    assert.ok(demo && clinical);
    assert.equal(demo.id, "rasq-demo-d1-diagonal-reach");
    assert.equal(clinical.id, "d1-inspired-diagonal-reach");
    assert.notEqual(
      samplePathAtProgress(demo.sampledPath, 0).x,
      samplePathAtProgress(clinical.sampledPath, 0).x,
    );
  });

  it("right-arm path starts low on screen right and ends toward left shoulder (mirrored preview)", () => {
    const pattern = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const start = samplePathAtProgress(pattern.sampledPath, 0);
    const end = samplePathAtProgress(pattern.sampledPath, 1);
    assert.ok(start.x > 0.55, "start should be on screen right (high x)");
    assert.ok(start.y > 0.55, "start should be low in frame (high y)");
    assert.ok(end.x < 0.45, "end should be on screen left (low x)");
    assert.ok(end.y < 0.35, "end should be elevated (low y)");
    assert.ok(start.x > end.x, "path travels from screen right toward screen left");
    assert.ok(start.y > end.y, "path travels upward diagonally");
  });

  it("x-mirrors demo path when resolved with left side (public demo pins presentation side in orchestrator)", () => {
    const right = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const left = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "left")!;
    const rightStart = samplePathAtProgress(right.sampledPath, 0);
    const leftStart = samplePathAtProgress(left.sampledPath, 0);
    assert.notEqual(rightStart.x, leftStart.x);
    assert.equal(rightStart.y, leftStart.y);
  });

  it("x-reflects clinical waypoints for the public demo illustration alignment", () => {
    const clinical = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const demo = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const clinicalStart = samplePathAtProgress(clinical.sampledPath, 0);
    const demoStart = samplePathAtProgress(demo.sampledPath, 0);
    assert.equal(demoStart.x, 1 - clinicalStart.x);
    assert.equal(demoStart.y, clinicalStart.y);
  });

  it("public demo PNF block references demo-only feedback profile", () => {
    const pnf = RASQ_TWO_MINUTE_DEMO_SESSION.blocks.find((b) => b.blockId === RASQ_DEMO_PNF_D1_BLOCK_ID);
    assert.ok(pnf);
    assert.equal(pnf.feedbackProfile, RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE);
    assert.notEqual(pnf.feedbackProfile, D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE);
  });

  it("completes repetitions through the shared pattern block runner", () => {
    const pattern = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    let state = PATTERN_BLOCK_RUNNER.createInitialState(pattern.id);
    let completions = 0;
    for (let i = 0; i <= 40; i += 1) {
      const progress = i / 40;
      const wrist = samplePathAtProgress(pattern.sampledPath, progress);
      const ticked = PATTERN_BLOCK_RUNNER.tick("active", state, {
        wrist,
        nowMs: 1_000_000 + i * 50,
        pattern,
        completionExitTransitionMs: 0,
      });
      state = ticked.state;
      if (ticked.completionEvent) {
        completions += 1;
        assert.equal(ticked.completionEvent.patternId, "rasq-demo-d1-diagonal-reach");
      }
    }
    assert.equal(completions, 1);
  });

  it("patient and rehab sessions still use clinical d1-inspired-diagonal-reach", () => {
    assert.equal(
      CLINICAL_MOTION_PATTERN_SESSION.blocks[0]?.feedbackProfile,
      D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE,
    );
    const strokePatternBlock = STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1.blocks.find(
      (b) => b.feedbackProfile === D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE,
    );
    assert.ok(strokePatternBlock, "stroke foundation should still wire clinical D1 profile");
    assert.equal(RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN.feedbackProfileKey, "rasq-demo-d1-diagonal-reach");
  });
});
