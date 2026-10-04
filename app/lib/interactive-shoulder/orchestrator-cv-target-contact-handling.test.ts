/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-target-contact-handling.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTargetContactConsumptionState,
  resolveTargetContactForTick,
} from "./orchestrator-cv-target-contact-handling";

describe("orchestrator cv target contact handling", () => {
  it("consumes each targetId once across repeated ticks", () => {
    const state = createTargetContactConsumptionState();
    const contact = { targetId: "reach-1", capturedAtMs: 500, reactionTimeMs: 200 };
    assert.ok(resolveTargetContactForTick(state, contact, { renderSeq: 1 }).contactToProcess);
    assert.equal(
      resolveTargetContactForTick(state, contact, { renderSeq: 2 }).contactToProcess,
      null,
    );
    assert.equal(
      resolveTargetContactForTick(state, contact, { renderSeq: 3 }).skippedDuplicate,
      true,
    );
  });
});
