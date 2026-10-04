/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-target-hit-once.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createTargetContactConsumptionState,
  resolveTargetContactForTick,
} from "@/app/lib/interactive-shoulder/orchestrator-cv-target-contact-handling";
import {
  createDemoReachTargetPerformanceSnapshot,
  registerDemoReachTargetCompleted,
  registerDemoReachTargetStarted,
} from "./demo-reach-target-performance";

describe("demo target hit — single consumption", () => {
  it("resolves targetContact to one process pass per targetId", () => {
    const consumption = createTargetContactConsumptionState();
    const hit = { targetId: "t-alpha", capturedAtMs: 1000, reactionTimeMs: 400 };
    const first = resolveTargetContactForTick(consumption, hit, { renderSeq: 1 });
    const second = resolveTargetContactForTick(consumption, hit, { renderSeq: 2 });
    assert.ok(first.contactToProcess);
    assert.equal(first.contactToProcess?.targetId, "t-alpha");
    assert.equal(first.skippedDuplicate, false);
    assert.equal(second.contactToProcess, null);
    assert.equal(second.skippedDuplicate, true);
  });

  it("does not produce a new reach performance snapshot when completion is repeated", () => {
    let snap = createDemoReachTargetPerformanceSnapshot();
    snap = registerDemoReachTargetStarted(snap, {
      targetId: "t1",
      sequence: 1,
      startedAtMs: 500,
      startedAtBlockElapsedS: 0,
    });
    const hit = { targetId: "t1", capturedAtMs: 2500, reactionTimeMs: 2000 };
    const once = registerDemoReachTargetCompleted(snap, hit, 2500);
    const again = registerDemoReachTargetCompleted(once, hit, 2600);
    assert.equal(again, once);
    assert.equal(once.completedTargets, 1);
  });

  it("guards orchestrator and demo confirmed-hit handlers by targetId", () => {
    const core = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );
    const session = readFileSync(
      join(process.cwd(), "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx"),
      "utf8",
    );
    assert.match(core, /resolveTargetContactForTick/);
    assert.match(core, /targetContactConsumptionRef/);
    assert.match(session, /confirmedReachTargetIdsRef/);
    assert.match(session, /traceDemoReachTargetHit/);
    assert.match(session, /if \(confirmedReachTargetIdsRef\.current\.has\(hit\.targetId\)\)/);
  });
});
