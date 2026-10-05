/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-pnf-pattern-presentation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveMotionPattern } from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-registry";
import { samplePathAtProgress } from "@/app/lib/interactive-shoulder/motion-patterns/bezier-path";
import { RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./rasq-demo-d1-diagonal-reach-pattern";
import { resolveDemoPnfRunnerWrist } from "./demo-pnf-pattern-presentation";
import { previewWristFromFacingCameraLandmarks, PNF_DEMO_START_LANDMARKS } from "./demo-pnf-presentation-fixtures";

describe("demo PNF presentation (single mirror, no duplicate flip)", () => {
  it("keeps demo path direction when resolved with left side (public demo is right-arm only)", () => {
    const asRight = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const asLeft = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "left")!;
    const rightStart = samplePathAtProgress(asRight.sampledPath, 0);
    const leftStart = samplePathAtProgress(asLeft.sampledPath, 0);
    assert.ok(rightStart.x > 0.55);
    assert.ok(leftStart.x > 0.55, "demo profile must not x-mirror to clinical direction on left side");
    assert.equal(rightStart.x, leftStart.x);
  });

  it("uses one mirrored-preview wrist conversion for runner and marker", () => {
    const wrist = previewWristFromFacingCameraLandmarks("right", PNF_DEMO_START_LANDMARKS);
    const runner = resolveDemoPnfRunnerWrist({
      measured: { x: 1 - wrist.x, y: wrist.y },
      devMousePreview: null,
    });
    assert.deepEqual(runner, wrist);
  });
});
