/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-booth-voice-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBoothVoicePlaybackActive,
  isDetachedBoothVoicePlaybackActive,
  resetBoothVoiceAudioPlaybackForTests,
  stopBoothVoicePlayback,
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
  patientBoothVoiceOnMovementBlockActivated,
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
  it("speaks milestone praise at most once for rapid successive hits", () => {
    withLifecycleMockAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnMovementBlockActivated(state, "reach", { muted: false, nowMs: 0 });
      stopBoothVoicePlayback();
      const afterBlockCue = audioConstructCount;
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t1", capturedAtMs: 0, reactionTimeMs: 400, sequence: 1 },
        { muted: false, nowMs: 1_000 },
      );
      const instancesAfterFirst = audioConstructCount;
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t2", capturedAtMs: 0, reactionTimeMs: 500, sequence: 2 },
        { muted: false, nowMs: 1_000 + 100 },
      );
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t3", capturedAtMs: 0, reactionTimeMs: 600, sequence: 3 },
        { muted: false, nowMs: 1_000 + 200 },
      );
      assert.equal(
        audioConstructCount,
        instancesAfterFirst,
        "hits 2–3 do not add spoken praise clips",
      );
      assert.ok(instancesAfterFirst > afterBlockCue, "first hit may add one milestone clip");
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
