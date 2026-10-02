/**
 * Run: npx tsx --test app/lib/booth/booth-voice-audio-single-playback.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  playBoothVoiceAsset,
  playRemoteBatteryBoothVoiceAsset,
  resetBoothVoiceAudioPlaybackForTests,
  stopBoothVoicePlayback,
} from "./booth-voice-audio";

describe("booth voice single playback", () => {
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
      resetBoothVoiceAudioPlaybackForTests();
      playBoothVoiceAsset("battery-arm-in-view-en");
      playBoothVoiceAsset("battery-stand-still-en");
      assert.equal(paused.length >= 1, true);
      assert.match(paused[0] ?? "", /battery-arm-in-view-en\.mp3\?v=/);
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
  });

  it("rejects Interactive Shoulder cues on the battery-only play helper", () => {
    const previousAudio = (globalThis as { Audio?: unknown }).Audio;
    (globalThis as { Audio: unknown }).Audio = class {
      src = "";
      preload = "";
      currentTime = 0;
      play() {
        return Promise.resolve();
      }
      pause() {}
      removeAttribute() {}
      load() {}
    };
    (globalThis as { window: unknown }).window = {};
    try {
      resetBoothVoiceAudioPlaybackForTests();
      assert.equal(playRemoteBatteryBoothVoiceAsset("session-start" as never), false);
      assert.equal(playRemoteBatteryBoothVoiceAsset("battery-tracking-lost-en"), true);
    } finally {
      if (previousAudio === undefined) {
        delete (globalThis as { Audio?: unknown }).Audio;
      } else {
        (globalThis as { Audio: unknown }).Audio = previousAudio;
      }
      resetBoothVoiceAudioPlaybackForTests();
    }
  });

  it("invalidates in-flight play when stop is called", () => {
    let rejectPlay: (() => void) | null = null;
    const previousAudio = (globalThis as { Audio?: unknown }).Audio;

    class FakeAudio {
      src = "";
      preload = "";
      currentTime = 0;
      constructor(src?: string) {
        if (src) this.src = src;
      }
      play() {
        return new Promise<void>((_, reject) => {
          rejectPlay = () => reject(new Error("aborted"));
        });
      }
      pause() {}
      removeAttribute() {}
      load() {}
    }

    (globalThis as { Audio: unknown }).Audio = FakeAudio;
    (globalThis as { window: unknown }).window = {};

    try {
      resetBoothVoiceAudioPlaybackForTests();
      let failed = false;
      playBoothVoiceAsset("battery-rest-before-next-en", () => {
        failed = true;
      });
      stopBoothVoicePlayback();
      rejectPlay?.();
      assert.equal(failed, false);
    } finally {
      if (previousAudio === undefined) {
        delete (globalThis as { Audio?: unknown }).Audio;
      } else {
        (globalThis as { Audio: unknown }).Audio = previousAudio;
      }
      resetBoothVoiceAudioPlaybackForTests();
    }
  });
});
