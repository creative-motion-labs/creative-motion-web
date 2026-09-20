/**
 * Run: npx tsx --test app/lib/session-orchestrator/adapters/shoulder-session-adapter.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapShoulderMeasuredEventToSessionInput,
  mapTargetHitToSessionInput,
} from "./shoulder-session-adapter";

describe("shoulder-session-adapter session input mapping", () => {
  it("carries reactionTimeMs on targetContact when available", () => {
    const event = mapTargetHitToSessionInput({
      targetId: "t1",
      capturedAtMs: 1_000,
      reactionTimeMs: 875,
    });
    assert.equal(event.type, "targetContact");
    if (event.type !== "targetContact") return;
    assert.equal(event.reactionTimeMs, 875);
    assert.equal(event.capturedAtMs, 1_000);
  });

  it("omits reactionTimeMs on targetContact when timing is invalid", () => {
    const event = mapTargetHitToSessionInput({
      targetId: "t1",
      capturedAtMs: 1_000,
      reactionTimeMs: Number.NaN,
    });
    assert.equal(event.type, "targetContact");
    if (event.type !== "targetContact") return;
    assert.equal("reactionTimeMs" in event, false);
  });

  it("carries peakAngleDegrees on validRepetition metrics without converting to targetContact", () => {
    const event = mapShoulderMeasuredEventToSessionInput({
      type: "repCompleted",
      capturedAtMs: 2_000,
      side: "right",
      peakAngleDegrees: 91,
    });
    assert.equal(event.type, "validRepetition");
    if (event.type !== "validRepetition") return;
    assert.equal(event.metrics?.peakAngleDegrees, 91);
  });
});
