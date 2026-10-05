/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-pnf-camera-path-pipeline.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PATTERN_BLOCK_RUNNER } from "@/app/lib/interactive-shoulder/block-engine/pattern-block-runner";
import {
  projectPointOntoPath,
  samplePathAtProgress,
} from "@/app/lib/interactive-shoulder/motion-patterns/bezier-path";
import { resolveActiveMotionPattern } from "@/app/lib/interactive-shoulder/motion-patterns/motion-pattern-registry";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import {
  RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE,
  RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN,
} from "./rasq-demo-d1-diagonal-reach-pattern";
import { RASQ_TWO_MINUTE_DEMO_SESSION } from "./demo-session-definition";
import {
  previewWristFromFacingCameraLandmarks,
  PNF_DEMO_END_LANDMARKS,
  PNF_DEMO_START_LANDMARKS,
} from "./demo-pnf-presentation-fixtures";

describe("public demo PNF camera path pipeline", () => {
  it("maps raw right-wrist start pose to mirrored preview near path progress 0", () => {
    const pattern = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const wrist = previewWristFromFacingCameraLandmarks("right", PNF_DEMO_START_LANDMARKS);
    const projection = projectPointOntoPath(pattern.sampledPath, wrist);
    assert.ok(projection.progress <= 0.22, `expected near path start, got ${projection.progress}`);
    assert.ok(wrist.x > 0.55);
    assert.ok(wrist.y > 0.55);
  });

  it("maps illustration end pose closer to path end than clinical would", () => {
    const demo = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const clinical = resolveActiveMotionPattern("d1-inspired-diagonal-reach", "right")!;
    const wrist = previewWristFromFacingCameraLandmarks("right", PNF_DEMO_END_LANDMARKS);
    const onDemo = projectPointOntoPath(demo.sampledPath, wrist);
    const onClinical = projectPointOntoPath(clinical.sampledPath, wrist);
    assert.ok(onDemo.progress > onClinical.progress);
    assert.ok(onDemo.progress >= 0.72);
  });

  it("screen-facing path runs right low → left upper (mirrored preview coords)", () => {
    const pattern = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    const start = samplePathAtProgress(pattern.sampledPath, 0);
    const end = samplePathAtProgress(pattern.sampledPath, 1);
    assert.ok(start.x > end.x);
    assert.ok(start.y > end.y);
  });

  it("advances demo pattern completion when wrist follows sampled path progress", () => {
    const pattern = resolveActiveMotionPattern(RASQ_DEMO_D1_DIAGONAL_REACH_FEEDBACK_PROFILE, "right")!;
    let state = PATTERN_BLOCK_RUNNER.createInitialState(pattern.id);
    let completions = 0;
    for (let i = 0; i <= 40; i += 1) {
      const progress = i / 40;
      const wrist = samplePathAtProgress(pattern.sampledPath, progress);
      const ticked = PATTERN_BLOCK_RUNNER.tick("active", state, {
        wrist,
        nowMs: 2_000_000 + i * 40,
        pattern,
        completionExitTransitionMs: 0,
      });
      state = ticked.state;
      if (ticked.completionEvent) completions += 1;
    }
    assert.equal(completions, 1);
  });

  it("completes five orchestrator repetitions with demo pattern id", () => {
    const orchestrator = new SessionOrchestrator(RASQ_TWO_MINUTE_DEMO_SESSION);
    const T0 = 12_000_000;
    orchestrator.start(T0);
    orchestrator.beginCalibration(T0);
    orchestrator.completeCalibration(T0);
    orchestrator.tick(T0 + 101_000);
    orchestrator.tick(T0 + 104_000);
    for (let i = 0; i < 5; i += 1) {
      orchestrator.reportInputEvent(
        {
          type: "patternCompleted",
          patternId: RASQ_DEMO_D1_DIAGONAL_REACH_PATTERN.id,
          capturedAtMs: T0 + 115_000 + i * 1000,
        },
        T0 + 115_000 + i * 1000,
      );
    }
    orchestrator.tick(T0 + 121_000);
    assert.equal(orchestrator.getSnapshot(T0 + 121_000).sessionState, "completed");
  });
});
