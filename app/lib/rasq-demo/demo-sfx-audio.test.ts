/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-sfx-audio.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_TARGET_POP_SFX_PATH,
  RASQ_DEMO_TARGET_POP_SFX_VERSION,
  getRasqDemoTargetPopPlayCountForTests,
  playRasqDemoTargetPopForConfirmedHit,
  playRasqDemoTargetPopSfx,
  rasqDemoTargetPopPublicSrc,
  resetRasqDemoSfxForTests,
} from "./demo-sfx-audio";
import { resetRasqDemoVoiceAudioForTests, setRasqDemoVoiceMuted } from "./demo-voice-audio";

describe("demo target pop sfx", () => {
  it("commits a short mp3 under public/audio/demo/", () => {
    const filePath = path.join(process.cwd(), "public", "audio", "demo", "target-pop-en.mp3");
    assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
    assert.ok(fs.statSync(filePath).size > 4_000, "target pop asset too small");
    assert.match(rasqDemoTargetPopPublicSrc(), new RegExp(RASQ_DEMO_TARGET_POP_SFX_PATH.replace("/", "\\/")));
    assert.equal(
      rasqDemoTargetPopPublicSrc(),
      `${RASQ_DEMO_TARGET_POP_SFX_PATH}?v=${RASQ_DEMO_TARGET_POP_SFX_VERSION}`,
    );
  });

  it("increments play count once per invocation when not muted", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoSfxForTests();
    setRasqDemoVoiceMuted(false);
    const before = getRasqDemoTargetPopPlayCountForTests();
    playRasqDemoTargetPopSfx();
    playRasqDemoTargetPopSfx();
    assert.equal(getRasqDemoTargetPopPlayCountForTests(), before + 2);
  });

  it("dedupes confirmed hits by target id", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoSfxForTests();
    setRasqDemoVoiceMuted(false);
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "alpha" }), true);
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "alpha" }), false);
    assert.equal(getRasqDemoTargetPopPlayCountForTests(), 1);
  });

  it("does not play when demo audio is muted", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoSfxForTests();
    setRasqDemoVoiceMuted(true);
    const before = getRasqDemoTargetPopPlayCountForTests();
    assert.equal(playRasqDemoTargetPopSfx(), false);
    assert.equal(getRasqDemoTargetPopPlayCountForTests(), before);
  });
});
