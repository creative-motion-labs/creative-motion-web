/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-voice-block-cues.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_PNF_D1_BLOCK_ID,
  RASQ_DEMO_REACH_RIGHT_BLOCK_ID,
} from "./demo-session-definition";
import { resolveRasqDemoVoiceCueForMovementBlock } from "./demo-voice-block-cues";

describe("resolveRasqDemoVoiceCueForMovementBlock", () => {
  it("maps demo movement blocks to instruction cues", () => {
    assert.equal(
      resolveRasqDemoVoiceCueForMovementBlock(RASQ_DEMO_REACH_RIGHT_BLOCK_ID),
      "reach-right-instruction",
    );
    assert.equal(
      resolveRasqDemoVoiceCueForMovementBlock(RASQ_DEMO_PNF_D1_BLOCK_ID),
      "pnf-d1-instruction",
    );
    assert.equal(resolveRasqDemoVoiceCueForMovementBlock("other"), null);
  });
});
