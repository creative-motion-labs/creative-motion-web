/**
 * Run: npx tsx --test app/lib/booth/interactive-shoulder-booth-voice-assets.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BOOTH_VOICE_ASSET_VERSION,
  INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
  boothVoicePublicSrc,
  type InteractiveShoulderBoothVoiceCue,
} from "./booth-voice-manifest";

const BOOTH_DIR = join(process.cwd(), "public", "audio", "booth");

describe("Interactive Shoulder booth voice assets", () => {
  it("manifest filenames match committed MP3 files with non-zero size", () => {
    for (const [cue, entry] of Object.entries(INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST)) {
      const filePath = join(BOOTH_DIR, entry.file);
      assert.ok(existsSync(filePath), `${cue} missing file ${entry.file}`);
      const { size } = statSync(filePath);
      assert.ok(size > 512, `${entry.file} looks empty (${size} bytes)`);
    }
  });

  it("cache-busts public src for every Interactive Shoulder cue", () => {
    for (const cue of Object.keys(INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST) as InteractiveShoulderBoothVoiceCue[]) {
      const src = boothVoicePublicSrc(cue);
      assert.match(src, new RegExp(`\\?v=${BOOTH_VOICE_ASSET_VERSION}$`));
      assert.match(src, /^\/audio\/booth\//);
    }
  });

  it("manifest scripts are present for generation audit", () => {
    for (const entry of Object.values(INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST)) {
      assert.ok(entry.script.trim().length > 8);
    }
  });
});
