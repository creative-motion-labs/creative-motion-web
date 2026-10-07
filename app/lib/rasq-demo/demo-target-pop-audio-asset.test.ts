/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-target-pop-audio-asset.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME,
  RASQ_DEMO_TARGET_POP_SFX_PATH,
  RASQ_DEMO_TARGET_POP_SFX_VERSION,
  rasqDemoTargetPopPublicSrc,
} from "./demo-sfx-audio";

describe("demo target pop audio asset", () => {
  it("commits an audible-length mp3 under public/audio/demo/", () => {
    const filePath = path.join(process.cwd(), "public", "audio", "demo", "target-pop-en.mp3");
    assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
    const bytes = fs.statSync(filePath).size;
    assert.ok(bytes > 1_500, `target-pop-en.mp3 too small (${bytes} bytes)`);
    assert.equal(rasqDemoTargetPopPublicSrc(), `${RASQ_DEMO_TARGET_POP_SFX_PATH}?v=${RASQ_DEMO_TARGET_POP_SFX_VERSION}`);
  });

  it("uses a soft pleasant playback volume", () => {
    assert.ok(RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME <= 0.5);
    assert.ok(RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME > 0.2);
  });
});
