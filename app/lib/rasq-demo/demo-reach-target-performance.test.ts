/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-reach-target-performance.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDemoReachTargetAggregateMetrics,
  createDemoReachTargetPerformanceSnapshot,
  registerDemoReachTargetCompleted,
  registerDemoReachTargetStarted,
} from "./demo-reach-target-performance";

describe("demo reach target performance", () => {
  it("records start and completion timestamps from lifecycle events", () => {
    let snap = createDemoReachTargetPerformanceSnapshot();
    snap = registerDemoReachTargetStarted(snap, {
      targetId: "t1",
      sequence: 1,
      startedAtMs: 1000,
      startedAtBlockElapsedS: 0,
    });
    snap = registerDemoReachTargetCompleted(
      snap,
      { targetId: "t1", capturedAtMs: 3800, reactionTimeMs: 2800 },
      3800,
    );
    assert.equal(snap.completedTargets, 1);
    assert.equal(snap.records[0]?.targetDurationSeconds, 2.8);
  });

  it("ignores duplicate completion for the same target id", () => {
    let snap = createDemoReachTargetPerformanceSnapshot();
    snap = registerDemoReachTargetStarted(snap, {
      targetId: "t1",
      sequence: 1,
      startedAtMs: 1000,
      startedAtBlockElapsedS: 0,
    });
    const hit = { targetId: "t1", capturedAtMs: 3800, reactionTimeMs: 2800 };
    const once = registerDemoReachTargetCompleted(snap, hit, 3800);
    const again = registerDemoReachTargetCompleted(once, hit, 3900);
    assert.equal(again, once);
  });

  it("computes aggregate targets per minute and completion rate", () => {
    const records = [
      {
        targetId: "t1",
        sequence: 1,
        targetStartedAtMs: 0,
        targetCompletedAtMs: 2000,
        targetDurationSeconds: 2,
      },
      {
        targetId: "t2",
        sequence: 2,
        targetStartedAtMs: 2500,
        targetCompletedAtMs: null,
        targetDurationSeconds: null,
      },
    ];
    const aggregate = computeDemoReachTargetAggregateMetrics({
      records,
      reachBlockStartedAtMs: 0,
      reachBlockEndedAtMs: 60_000,
    });
    assert.equal(aggregate.completedTargets, 1);
    assert.equal(aggregate.targetsPresented, 2);
    assert.equal(aggregate.targetCompletionRate, 0.5);
    assert.equal(aggregate.averageTargetDurationSeconds, 2);
    assert.equal(aggregate.targetsPerMinute, 1);
  });
});
