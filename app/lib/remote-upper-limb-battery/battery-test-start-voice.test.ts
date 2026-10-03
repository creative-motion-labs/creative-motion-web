/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-test-start-voice.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BOOTH_VOICE_COOLDOWN_MS, resetBoothVoiceGuidance } from "@/app/lib/booth/booth-voice-guidance";
import { boothVoicePublicSrc } from "@/app/lib/booth/booth-voice-manifest";
import { resetBoothVoiceAudioPlaybackForTests } from "@/app/lib/booth/booth-voice-audio";
import {
  resolveBatteryTestStartBoothVoiceCue,
  resolveBatteryTestStartSpeechCue,
  setBatterySpeechLang,
  speakBatteryCue,
} from "./battery-speech";

const SESSION = join(process.cwd(), "app/components/patient/RemoteUpperLimbBatterySession.tsx");

function withFakeBoothAudio(run: (playedSrcs: string[]) => void): void {
  const playedSrcs: string[] = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousAudio = (globalThis as { Audio?: unknown }).Audio;

  class FakeAudio {
    src = "";
    preload = "";
    currentTime = 0;
    constructor(src?: string) {
      if (src) this.src = src;
    }
    play() {
      playedSrcs.push(this.src);
      return Promise.resolve();
    }
    pause() {}
  }

  (globalThis as { Audio: unknown }).Audio = FakeAudio;
  (globalThis as { window: unknown }).window = {};

  try {
    run(playedSrcs);
  } finally {
    if (previousAudio === undefined) {
      delete (globalThis as { Audio?: unknown }).Audio;
    } else {
      (globalThis as { Audio: unknown }).Audio = previousAudio;
    }
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previousWindow;
    }
    resetBoothVoiceAudioPlaybackForTests();
  }
}

describe("battery test start voice at test_active", () => {
  it("maps each test to the correct speech and booth cue ids", () => {
    setBatterySpeechLang("en");
    assert.equal(resolveBatteryTestStartSpeechCue("shoulderFlexion"), "flexion-raise");
    assert.equal(resolveBatteryTestStartSpeechCue("elbowFlexion"), "elbow-bend");
    assert.equal(resolveBatteryTestStartSpeechCue("functionalReach"), "functional-reach");

    assert.equal(
      resolveBatteryTestStartBoothVoiceCue("shoulderFlexion", "right", "en"),
      "battery-flexion-raise-right-en",
    );
    assert.equal(
      resolveBatteryTestStartBoothVoiceCue("elbowFlexion", "left", "ar"),
      "battery-elbow-bend-left-ar",
    );
    assert.equal(
      resolveBatteryTestStartBoothVoiceCue("functionalReach", "right", "en"),
      "battery-functional-reach-right-en",
    );

    assert.match(
      boothVoicePublicSrc("battery-flexion-raise-right-en"),
      /\/audio\/booth\/battery-flexion-raise-right-en\.mp3\?v=6$/,
    );
  });

  it("plays movement start after countdown cues despite booth cooldown", () => {
    setBatterySpeechLang("en");
    withFakeBoothAudio((played) => {
      resetBoothVoiceGuidance();
      const now = 5_000_000;
      speakBatteryCue("countdown-one", "right", "countdown-shoulderFlexion", { nowMs: now });
      assert.equal(played.length, 1);
      const movementPlayed = speakBatteryCue("flexion-raise", "right", "shoulderFlexion-start", {
        nowMs: now + 200,
      });
      assert.equal(movementPlayed, true);
      assert.equal(played.length, 2);
      assert.match(played[1] ?? "", /battery-flexion-raise-right-en\.mp3\?v=6/);
      assert.ok(now + 200 - now < BOOTH_VOICE_COOLDOWN_MS);
    });
  });

  it("resets testStartCueSpokenRef on retry and new test transitions", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /testStartCueSpokenRef\.current = false/);
    assert.match(source, /handleRetryCurrentTest[\s\S]*?testStartCueSpokenRef\.current = false/);
    assert.match(source, /next\.phase === "reposition_side"[\s\S]*?testStartCueSpokenRef\.current = false/);
    assert.doesNotMatch(
      source,
      /sideViewSetupCueSpokenRef[\s\S]{0,80}testStartCueSpokenRef\.current = true/,
    );
    assert.equal(source.includes("movement-smooth-comfort"), false);
  });

  it("only marks test start spoken when booth playback succeeds", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /if \(played\) \{\s*testStartCueSpokenRef\.current = true;/);
    assert.match(source, /resolveBatteryTestStartBoothVoiceCue/);
    assert.match(source, /\[battery-test-start-voice\]/);
  });
});
