/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-catalog-session-audio-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDetachedBoothVoicePlaybackActive,
  resetBoothVoiceAudioPlaybackForTests,
} from "@/app/lib/booth/booth-voice-audio";
import { resetBoothVoiceGuidance, speakBoothVoiceCueDetached } from "@/app/lib/booth/booth-voice-guidance";
import { createCatalogPatientSessionAudioCleanup } from "./patient-catalog-session-audio-lifecycle";
import {
  createPatientBoothVoiceSessionState,
  disposePatientBoothVoiceHookCleanup,
  patientBoothVoiceOnSessionComplete,
} from "./patient-booth-voice-runtime";

function withMockAudio(run: () => void): void {
  const previousAudio = (globalThis as { Audio?: typeof Audio }).Audio;
  class MockAudio {
    preload = "auto";
    currentTime = 0;
    src = "";
    paused = true;
    ended = false;
    onended: (() => void) | null = null;
    play(): Promise<void> {
      this.paused = false;
      this.ended = false;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
  }
  (globalThis as { Audio: typeof Audio }).Audio = MockAudio as typeof Audio;
  try {
    run();
  } finally {
    resetBoothVoiceAudioPlaybackForTests();
    if (previousAudio === undefined) {
      delete (globalThis as { Audio?: typeof Audio }).Audio;
    } else {
      (globalThis as { Audio: typeof Audio }).Audio = previousAudio;
    }
  }
}

/** Mirrors CatalogPatientSessionPlayback `useEffect(..., [token, session.id])`. */
function mountCatalogPatientSessionAudioScope(): () => void {
  return createCatalogPatientSessionAudioCleanup();
}

describe("catalog patient session audio lifecycle", () => {
  it("parent cleanup stops detached completion audio (navigation away)", () => {
    withMockAudio(() => {
      resetBoothVoiceGuidance();
      speakBoothVoiceCueDetached("session-complete", "patient-session", { nowMs: 0 });
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      createCatalogPatientSessionAudioCleanup()();
      assert.equal(isDetachedBoothVoicePlaybackActive(), false);
    });
  });

  it("voice child unmount after completion preserves detached audio (wrap-up transition)", () => {
    withMockAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnSessionComplete(state, { muted: false, nowMs: 0 });
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      disposePatientBoothVoiceHookCleanup(state);
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
    });
  });

  it("parent session scope cleanup runs on navigation (effect cleanup contract)", () => {
    withMockAudio(() => {
      resetBoothVoiceGuidance();
      const scopeA = mountCatalogPatientSessionAudioScope();
      speakBoothVoiceCueDetached("session-complete", "patient-session", { nowMs: 0 });
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      scopeA();
      assert.equal(isDetachedBoothVoicePlaybackActive(), false);
      mountCatalogPatientSessionAudioScope();
    });
  });

  it("wrap-up only disposes voice child while parent scope keeps completion audio", () => {
    withMockAudio(() => {
      resetBoothVoiceGuidance();
      const parentScope = mountCatalogPatientSessionAudioScope();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnSessionComplete(state, { muted: false, nowMs: 0 });
      disposePatientBoothVoiceHookCleanup(state);
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      parentScope();
      assert.equal(isDetachedBoothVoicePlaybackActive(), false);
    });
  });
});
