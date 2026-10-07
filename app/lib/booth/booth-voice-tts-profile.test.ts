/**
 * Run: npx tsx --test app/lib/booth/booth-voice-tts-profile.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REMOTE_BATTERY_BOOTH_VOICE_MANIFEST } from "@/app/lib/remote-upper-limb-battery/battery-booth-manifest";
import {
  BOOTH_VOICE_TTS_MODEL_AR,
  BOOTH_VOICE_TTS_MODEL_EN,
  BOOTH_VOICE_TTS_OUTPUT_FORMAT,
  BOOTH_VOICE_TTS_VOICE_SETTINGS,
  INTERACTIVE_SHOULDER_BOOTH_VOICE_ID,
  resolveBoothVoiceCueLanguage,
  resolveBoothVoiceTtsModel,
} from "./booth-voice-tts-profile";

function isLavfEncodedMp3(filePath: string): boolean {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 1024) return false;
  if (!buf.toString("latin1").includes("Lavf")) return false;
  return buf.includes(0xff) && (buf[buf.indexOf(0xff) + 1] & 0xe0) === 0xe0;
}

function bytesPerScriptChar(filePath: string, script: string): number {
  const size = fs.statSync(filePath).size;
  const chars = script.trim().length;
  return chars > 0 ? size / chars : 0;
}

describe("booth voice TTS profile", () => {
  it("matches Interactive Shoulder Sarah voice id and calm delivery settings", () => {
    assert.equal(INTERACTIVE_SHOULDER_BOOTH_VOICE_ID, "EXAVITQu4vr4xnSDxMaL");
    assert.equal(BOOTH_VOICE_TTS_OUTPUT_FORMAT, "mp3_44100_128");
    assert.equal(BOOTH_VOICE_TTS_MODEL_EN, "eleven_turbo_v2_5");
    assert.equal(BOOTH_VOICE_TTS_MODEL_AR, "eleven_multilingual_v2");
    assert.equal(BOOTH_VOICE_TTS_VOICE_SETTINGS.stability, 0.75);
    assert.equal(BOOTH_VOICE_TTS_VOICE_SETTINGS.style, 0);
    assert.equal(resolveBoothVoiceTtsModel("en"), BOOTH_VOICE_TTS_MODEL_EN);
    assert.equal(resolveBoothVoiceTtsModel("ar"), BOOTH_VOICE_TTS_MODEL_AR);
    assert.equal(resolveBoothVoiceCueLanguage("battery-arm-in-view-ar"), "ar");
  });

  it("Interactive Shoulder reference clips use the same encoder fingerprint", () => {
    const boothDir = path.join(process.cwd(), "public", "audio", "booth");
    for (const file of ["session-start.mp3", "during-movement.mp3"]) {
      const p = path.join(boothDir, file);
      assert.ok(fs.existsSync(p), `${file} missing`);
      assert.ok(isLavfEncodedMp3(p), `${file} expected Lavf-encoded mp3 like Interactive Shoulder`);
    }
  });

  it("key battery EN clips align with Interactive Shoulder bytes-per-character delivery", () => {
    const boothDir = path.join(process.cwd(), "public", "audio", "booth");
    const referenceBpc = bytesPerScriptChar(
      path.join(boothDir, "during-movement.mp3"),
      "Reach towards the light. Keep your shoulder relaxed.",
    );
    const checks: Array<{ cue: string; maxDeltaRatio: number }> = [
      { cue: "battery-arm-in-view-en", maxDeltaRatio: 0.45 },
      { cue: "battery-abduction-raise-left-en", maxDeltaRatio: 0.45 },
      { cue: "battery-abduction-raise-right-en", maxDeltaRatio: 0.45 },
      { cue: "battery-tracking-lost-en", maxDeltaRatio: 0.45 },
      { cue: "battery-rest-before-next-en", maxDeltaRatio: 0.45 },
    ];
    for (const { cue, maxDeltaRatio } of checks) {
      const entry = REMOTE_BATTERY_BOOTH_VOICE_MANIFEST[cue as keyof typeof REMOTE_BATTERY_BOOTH_VOICE_MANIFEST];
      assert.ok(entry, cue);
      const filePath = path.join(boothDir, entry.file);
      assert.ok(fs.existsSync(filePath), entry.file);
      assert.ok(isLavfEncodedMp3(filePath), `${entry.file} expected Lavf-encoded mp3 like Interactive Shoulder`);
      const bpc = bytesPerScriptChar(filePath, entry.script);
      const ratioDelta = Math.abs(bpc - referenceBpc) / referenceBpc;
      assert.ok(
        ratioDelta <= maxDeltaRatio,
        `${entry.file} bytes/char ${bpc.toFixed(0)} vs IS ref ${referenceBpc.toFixed(0)} (delta ${(ratioDelta * 100).toFixed(0)}%)`,
      );
    }
  });
});
