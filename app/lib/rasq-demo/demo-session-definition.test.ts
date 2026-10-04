/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-session-definition.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_DEMO_REACH_RIGHT_BLOCK_ID,
  RASQ_TWO_MINUTE_DEMO_SESSION,
} from "./demo-session-definition";

const T0 = 9_000_000;

describe("RASQ two-minute demo session definition", () => {
  it("sequences reach-right then five PNF D1 pattern repetitions", () => {
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks.length, 2);
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]?.blockId, RASQ_DEMO_REACH_RIGHT_BLOCK_ID);
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]?.side, "right");
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]?.completionMode, "duration");
    assert.ok(
      (RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]?.targetDurationSeconds ?? 0) >= 90 &&
        (RASQ_TWO_MINUTE_DEMO_SESSION.blocks[0]?.targetDurationSeconds ?? 0) <= 120,
    );
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[1]?.blockId, RASQ_DEMO_PNF_D1_BLOCK_ID);
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[1]?.prescribedRepetitions, 5);
    assert.equal(RASQ_TWO_MINUTE_DEMO_SESSION.blocks[1]?.blockType, "movement-pattern");
  });

  it("completes the D1 block after five patternCompleted events", () => {
    const orchestrator = new SessionOrchestrator(RASQ_TWO_MINUTE_DEMO_SESSION);
    orchestrator.start(T0);
    orchestrator.beginCalibration(T0);
    orchestrator.completeCalibration(T0);
    assert.equal(orchestrator.getSnapshot(T0).currentBlock?.blockId, RASQ_DEMO_REACH_RIGHT_BLOCK_ID);

    orchestrator.tick(T0 + 101_000);
    orchestrator.tick(T0 + 104_000);
    const afterReach = orchestrator.getSnapshot(T0 + 104_000);
    assert.equal(afterReach.currentBlock?.blockId, RASQ_DEMO_PNF_D1_BLOCK_ID);

    for (let i = 0; i < 5; i += 1) {
      orchestrator.reportInputEvent(
        { type: "patternCompleted", patternId: "d1-inspired-diagonal-reach", capturedAtMs: T0 + 115_000 + i * 1000 },
        T0 + 115_000 + i * 1000,
      );
    }
    orchestrator.tick(T0 + 121_000);
    const done = orchestrator.getSnapshot(T0 + 121_000);
    assert.equal(done.sessionState, "completed");
    assert.equal(done.accumulatedBlockResults[1]?.interaction.patternsCompleted, 5);
  });
});
