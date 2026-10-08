/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-booth-voice-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBoothVoicePlaybackActive,
  isDetachedBoothVoicePlaybackActive,
  resetBoothVoiceAudioPlaybackForTests,
} from "@/app/lib/booth/booth-voice-audio";
import {
  resetBoothVoiceGuidance,
  speakBoothVoiceCue,
  speakBoothVoiceCueDetached,
} from "@/app/lib/booth/booth-voice-guidance";
import {
  PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS,
  cancelPatientBoothVoicePlayback,
  createPatientBoothVoiceSessionState,
  disposePatientBoothVoiceHookCleanup,
  patientBoothVoiceOnSessionComplete,
  patientBoothVoiceOnTargetReachConfirmed,
  patientBoothVoiceSetMuted,
} from "./patient-booth-voice-runtime";

let audioConstructCount = 0;

function withLifecycleMockAudio(run: () => void): void {
  const previousAudio = (globalThis as { Audio?: typeof Audio }).Audio;
  audioConstructCount = 0;
  class MockAudio {
    preload = "auto";
    currentTime = 0;
    src = "";
    paused = true;
    ended = false;
    play(): Promise<void> {
      this.paused = false;
      this.ended = false;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
    constructor() {
      audioConstructCount += 1;
    }
  }
  (globalThis as { Audio: typeof Audio }).Audio = MockAudio as typeof Audio;
  try {
    run();
  } finally {
    resetBoothVoiceAudioPlaybackForTests();
    audioConstructCount = 0;
    if (previousAudio === undefined) {
      delete (globalThis as { Audio?: typeof Audio }).Audio;
    } else {
      (globalThis as { Audio: typeof Audio }).Audio = previousAudio;
    }
  }
}

describe("patient booth voice lifecycle", () => {
  it("throttles rapid successive target hits without interrupting active reach feedback", () => {
    withLifecycleMockAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t1", capturedAtMs: 0, reactionTimeMs: 400 },
        { muted: false, nowMs: 1_000 },
      );
      const instancesAfterFirst = audioConstructCount;
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t2", capturedAtMs: 0, reactionTimeMs: 500 },
        { muted: false, nowMs: 1_000 + 100 },
      );
      assert.equal(audioConstructCount, instancesAfterFirst, "within min gap, no new reach voice");
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t3", capturedAtMs: 0, reactionTimeMs: 600 },
        { muted: false, nowMs: 1_000 + PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS },
      );
      assert.ok(audioConstructCount > instancesAfterFirst);
    });
  });

  it("keeps detached session-complete playback when hook cleanup runs after completion", () => {
    withLifecycleMockAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnSessionComplete(state, { muted: false, nowMs: 0 });
      assert.equal(state.sessionEnded, true);
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      disposePatientBoothVoiceHookCleanup(state);
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      assert.equal(isBoothVoicePlaybackActive(), false);
    });
  });

  it("stops all audio on mid-session cancel cleanup", () => {
    withLifecycleMockAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      speakBoothVoiceCue("during-movement", "block-a", { nowMs: 0 });
      assert.equal(isBoothVoicePlaybackActive(), true);
      disposePatientBoothVoiceHookCleanup(state);
      assert.equal(isBoothVoicePlaybackActive(), false);
      assert.equal(isDetachedBoothVoicePlaybackActive(), false);
    });
  });

  it("cancelPatientBoothVoicePlayback stops detached completion clips", () => {
    withLifecycleMockAudio(() => {
      resetBoothVoiceGuidance();
      speakBoothVoiceCueDetached("session-complete", "patient-session", { nowMs: 0 });
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      cancelPatientBoothVoicePlayback();
      assert.equal(isDetachedBoothVoicePlaybackActive(), false);
    });
  });

  it("mute stops detached and managed playback", () => {
    withLifecycleMockAudio(() => {
      resetBoothVoiceGuidance();
      speakBoothVoiceCueDetached("session-complete", "patient-session", { nowMs: 0 });
      assert.equal(isDetachedBoothVoicePlaybackActive(), true);
      patientBoothVoiceSetMuted(true);
      assert.equal(isDetachedBoothVoicePlaybackActive(), false);
      assert.equal(isBoothVoicePlaybackActive(), false);
    });
  });
});
