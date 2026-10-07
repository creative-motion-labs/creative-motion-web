/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-voice-audio.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  playRasqDemoVoiceCue,
  resetRasqDemoVoiceAudioForTests,
  setRasqDemoVoiceMuted,
  stopRasqDemoVoicePlayback,
} from "./demo-voice-audio";
import { rasqDemoVoicePublicSrc } from "./demo-voice-manifest";

describe("rasq demo voice audio", () => {
  it("stops the previous cue before starting a new one", () => {
    const paused: string[] = [];
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
        return Promise.resolve();
      }
      pause() {
        paused.push(this.src);
      }
      removeAttribute() {}
      load() {}
    }

    (globalThis as { Audio: unknown }).Audio = FakeAudio;
    (globalThis as { window: unknown }).window = {};

    try {
      resetRasqDemoVoiceAudioForTests();
      playRasqDemoVoiceCue("welcome");
      playRasqDemoVoiceCue("countdown");
      assert.equal(paused.length >= 1, true);
      assert.match(paused[0] ?? "", /welcome-en\.mp3\?v=/);
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
      resetRasqDemoVoiceAudioForTests();
    }
  });

  it("does not play while muted", () => {
    const previousAudio = (globalThis as { Audio?: unknown }).Audio;
    let constructed = 0;
    (globalThis as { Audio: unknown }).Audio = class {
      constructor() {
        constructed += 1;
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    (globalThis as { window: unknown }).window = {};
    try {
      resetRasqDemoVoiceAudioForTests();
      setRasqDemoVoiceMuted(true);
      assert.equal(playRasqDemoVoiceCue("welcome"), false);
      assert.equal(constructed, 0);
    } finally {
      resetRasqDemoVoiceAudioForTests();
      if (previousAudio === undefined) {
        delete (globalThis as { Audio?: unknown }).Audio;
      } else {
        (globalThis as { Audio: unknown }).Audio = previousAudio;
      }
    }
  });

  it("maps public src paths under /audio/demo/", () => {
    assert.match(rasqDemoVoicePublicSrc("camera-setup"), /^\/audio\/demo\/camera-setup-en\.mp3\?v=/);
  });
});
