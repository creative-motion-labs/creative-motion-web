/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-interactive-shoulder-session-sfx.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPatientPnfTickPlayCountForTests,
  getPatientTargetPopPlayCountForTests,
  playPatientPnfRepetitionTick,
  playPatientTargetPopForConfirmedHit,
  resetPatientInteractiveShoulderSessionSfxForTests,
  unlockPatientInteractiveShoulderSessionSfxFromUserGesture,
} from "./patient-interactive-shoulder-session-sfx";
import { writePatientBoothVoiceMutedPreference } from "./patient-booth-voice-runtime";

const sessionStore = new Map<string, string>();

function withPatientSessionStorage(run: () => void): void {
  const previousWindow = (globalThis as { window?: Window }).window;
  (globalThis as { window: Window }).window = {
    sessionStorage: {
      getItem: (key: string) => sessionStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        sessionStore.set(key, value);
      },
      removeItem: (key: string) => {
        sessionStore.delete(key);
      },
      clear: () => sessionStore.clear(),
      key: () => null,
      length: 0,
    },
  } as Window;
  try {
    run();
  } finally {
    sessionStore.clear();
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window: Window }).window = previousWindow;
    }
  }
}

function withMockAudio(run: () => void): void {
  const previousAudio = (globalThis as { Audio?: typeof Audio }).Audio;
  class MockAudio {
    preload = "auto";
    volume = 1;
    play(): Promise<void> {
      return Promise.resolve();
    }
    pause(): void {}
  }
  (globalThis as { Audio: typeof Audio }).Audio = MockAudio as typeof Audio;
  try {
    run();
  } finally {
    if (previousAudio === undefined) {
      delete (globalThis as { Audio?: typeof Audio }).Audio;
    } else {
      (globalThis as { Audio: typeof Audio }).Audio = previousAudio;
    }
  }
}

describe("patient interactive shoulder session sfx", () => {
  it("plays target pop once per target when unlocked and unmuted", () => {
    withPatientSessionStorage(() => withMockAudio(() => {
    resetPatientInteractiveShoulderSessionSfxForTests();
    writePatientBoothVoiceMutedPreference(false);
    unlockPatientInteractiveShoulderSessionSfxFromUserGesture();
    playPatientTargetPopForConfirmedHit({ targetId: "a" });
    playPatientTargetPopForConfirmedHit({ targetId: "a" });
    playPatientTargetPopForConfirmedHit({ targetId: "b" });
    assert.equal(getPatientTargetPopPlayCountForTests(), 2);
    }));
  });

  it("skips sfx when patient voice is muted", () => {
    withPatientSessionStorage(() => withMockAudio(() => {
    resetPatientInteractiveShoulderSessionSfxForTests();
    writePatientBoothVoiceMutedPreference(true);
    unlockPatientInteractiveShoulderSessionSfxFromUserGesture();
    playPatientTargetPopForConfirmedHit({ targetId: "a" });
    assert.equal(getPatientTargetPopPlayCountForTests(), 0);
    }));
  });

  it("plays one pnf tick per repetition number", () => {
    withPatientSessionStorage(() => withMockAudio(() => {
    resetPatientInteractiveShoulderSessionSfxForTests();
    writePatientBoothVoiceMutedPreference(false);
    unlockPatientInteractiveShoulderSessionSfxFromUserGesture();
    playPatientPnfRepetitionTick({ repetitionNumber: 1 });
    playPatientPnfRepetitionTick({ repetitionNumber: 1 });
    playPatientPnfRepetitionTick({ repetitionNumber: 2 });
    assert.equal(getPatientPnfTickPlayCountForTests(), 2);
    }));
  });
});
