/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-speech.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetBoothVoiceAudioPlaybackForTests } from "@/app/lib/booth/booth-voice-audio";
import { resetBoothVoiceGuidance } from "@/app/lib/booth/booth-voice-guidance";
import {
  resetBatterySpeech,
  resolveBatteryMovementSpeechCue,
  resolveBatteryRepCountSpeechCue,
  resolveBatterySpeechText,
  resolveBatteryTestStartSpeechCue,
  setBatterySpeechLang,
  speakBatteryCue,
} from "./battery-speech";
import { resolveBatteryBoothVoiceCue } from "./battery-booth-voice-map";

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

describe("battery speech (booth audio)", () => {
  it("does not replay movement instructions from later phases", () => {
    assert.equal(
      resolveBatteryMovementSpeechCue({
        testId: "functionalReach",
        phase: "rest",
        hasReachedPeak: false,
      }),
      null,
    );
  });

  it("maps prescribed-side cues to booth assets", () => {
    setBatterySpeechLang("en");
    assert.equal(
      resolveBatteryBoothVoiceCue("abduction-raise", "left", "en"),
      "battery-abduction-raise-left-en",
    );
    assert.equal(
      resolveBatterySpeechText("abduction-raise", "left"),
      "Raise your left arm slowly out to the side.",
    );
  });

  it("plays booth MP3 assets instead of speech synthesis", () => {
    setBatterySpeechLang("en");
    withFakeBoothAudio((played) => {
      resetBoothVoiceGuidance();
      resetBatterySpeech();
      speakBatteryCue("face-camera-setup", "right", "assessment");
      assert.equal(played.length, 1);
      assert.match(played[0] ?? "", /battery-arm-in-view-en\.mp3\?v=/);
      speakBatteryCue("face-camera-setup", "right", "assessment");
      assert.equal(played.length, 1);
    });
  });

  it("resolves rep count cues", () => {
    assert.equal(resolveBatteryRepCountSpeechCue(1, 3), "rep-one");
    assert.equal(resolveBatteryTestStartSpeechCue("shoulderAbduction"), "abduction-raise");
  });

  it("allows tracking-lost repeat via booth options", () => {
    setBatterySpeechLang("en");
    withFakeBoothAudio((played) => {
      resetBoothVoiceGuidance();
      resetBatterySpeech();
      speakBatteryCue("tracking-lost", "right", "tracking", { allowRepeat: true });
      speakBatteryCue("tracking-lost", "right", "tracking", { allowRepeat: true });
      assert.ok(played.length >= 1);
      assert.match(played[0] ?? "", /battery-tracking-lost-en\.mp3\?v=/);
    });
  });
});
