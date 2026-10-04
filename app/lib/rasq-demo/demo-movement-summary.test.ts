/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-movement-summary.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyMovementBlockResult } from "@/app/lib/session-orchestrator/types";
import {
  RASQ_DEMO_METRIC_NOT_AVAILABLE,
  buildRasqDemoMovementAnalysisSummary,
  resolveDemoMovementSmoothness,
} from "./demo-movement-summary";
import { computeDemoReachTargetAggregateMetrics } from "./demo-reach-target-performance";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_DEMO_REACH_RIGHT_BLOCK_ID,
  RASQ_TWO_MINUTE_DEMO_SESSION,
} from "./demo-session-definition";

describe("buildRasqDemoMovementAnalysisSummary", () => {
  it("reports measured counts and not-available smoothness when no block metric exists", () => {
    const reachBlock = RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]!;
    const d1Block = RASQ_TWO_MINUTE_DEMO_SESSION.blocks[1]!;
    const reachResult = createEmptyMovementBlockResult(reachBlock, 0);
    reachResult.blockId = RASQ_DEMO_REACH_RIGHT_BLOCK_ID;
    reachResult.interaction.targetsContacted = 3;
    const d1Result = createEmptyMovementBlockResult(d1Block, 1);
    d1Result.blockId = RASQ_DEMO_PNF_D1_BLOCK_ID;
    d1Result.interaction.patternsCompleted = 5;

    const reachAggregate = computeDemoReachTargetAggregateMetrics({
      records: [
        {
          targetId: "a",
          sequence: 1,
          targetStartedAtMs: 0,
          targetCompletedAtMs: 2800,
          targetDurationSeconds: 2.8,
        },
      ],
      reachBlockStartedAtMs: 0,
      reachBlockEndedAtMs: 60_000,
    });

    const summary = buildRasqDemoMovementAnalysisSummary({
      snapshot: {
        sessionElapsedSeconds: 118,
        accumulatedBlockResults: [reachResult, d1Result],
      },
      poseSample: { framesWithPose: 80, framesTotal: 100, lastTrackingQuality: "good" },
      reachTargetAggregate: reachAggregate,
    });

    assert.equal(summary.sessionDurationSeconds, 118);
    assert.match(summary.targetsReached.display, /3 targets reached/);
    assert.match(summary.reachAverageTargetTime.display, /2.8 seconds average/);
    assert.match(summary.reachTargetsPerMinute.display, /1.0 targets per minute/);
    assert.match(summary.pnfRepetitionsCompleted.display, /5 PNF repetitions completed/);
    assert.match(summary.trackingQuality.display, /80%/);
    assert.equal(summary.movementSmoothness.display, RASQ_DEMO_METRIC_NOT_AVAILABLE);
  });

  it("uses movement speed when present for smoothness", () => {
    const block = createEmptyMovementBlockResult(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]!, 0);
    block.measured.movementSpeed = 0.72;
    const smoothness = resolveDemoMovementSmoothness([block]);
    assert.equal(smoothness.available, true);
    assert.match(smoothness.display, /0.72/);
  });
});
