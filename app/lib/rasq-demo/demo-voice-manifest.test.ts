/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-voice-manifest.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { RASQ_DEMO_VOICE_CUE_IDS, RASQ_DEMO_VOICE_CUE_MANIFEST } from "./demo-voice-manifest";
import { RASQ_DEMO_MOVEMENT_DISCLAIMER } from "./demo-copy";

describe("RASQ demo voice manifest", () => {
  it("defines every cue with a script and mp3 file name", () => {
    for (const cue of RASQ_DEMO_VOICE_CUE_IDS) {
      const entry = RASQ_DEMO_VOICE_CUE_MANIFEST[cue];
      assert.ok(entry.script.length > 10);
      assert.match(entry.file, /\.mp3$/);
    }
  });

  it("uses the well done completion script", () => {
    assert.equal(
      RASQ_DEMO_VOICE_CUE_MANIFEST.completion.script,
      "Well done. You have completed the RASQ Interactive Movement Demo.",
    );
  });

  it("uses the interactive movement demo welcome script", () => {
    assert.equal(
      RASQ_DEMO_VOICE_CUE_MANIFEST.welcome.script,
      "Welcome to the RASQ Interactive Movement Demo. This experience is for demonstration only and is not a medical diagnosis.",
    );
  });

  it("reminds listeners the demo is not a diagnosis in welcome script", () => {
    assert.match(RASQ_DEMO_VOICE_CUE_MANIFEST.welcome.script, /not a medical diagnosis/i);
    assert.match(RASQ_DEMO_VOICE_CUE_MANIFEST.completion.script, /RASQ Interactive Movement Demo/i);
    assert.match(RASQ_DEMO_MOVEMENT_DISCLAIMER, /not a medical diagnosis/i);
    assert.doesNotMatch(RASQ_DEMO_MOVEMENT_DISCLAIMER, /prototype/i);
  });

  it("has committed mp3 assets under public/audio/demo/", () => {
    const dir = path.join(process.cwd(), "public", "audio", "demo");
    for (const cue of RASQ_DEMO_VOICE_CUE_IDS) {
      const file = RASQ_DEMO_VOICE_CUE_MANIFEST[cue].file;
      const filePath = path.join(dir, file);
      assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
      assert.ok(fs.statSync(filePath).size > 500, `empty or tiny ${file}`);
    }
  });
});
