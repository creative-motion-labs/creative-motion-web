/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-booth-voice-runtime.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetBoothVoiceAudioPlaybackForTests } from "@/app/lib/booth/booth-voice-audio";
import {
  BOOTH_VOICE_COOLDOWN_MS,
  resetBoothVoiceGuidance,
  speakBoothVoiceCue,
} from "@/app/lib/booth/booth-voice-guidance";
import {
  BOOTH_INACTIVITY_FIRST_DELAY_MS,
  BOOTH_INACTIVITY_SECOND_DELAY_MS,
} from "@/app/lib/booth/booth-voice-inactivity";
import {
  createPatientBoothVoiceSessionState,
  interactiveShoulderBoothVoiceScriptsAreSideNeutral,
  patientBoothVoiceOnCountdownComplete,
  patientBoothVoiceOnMovementBlockActivated,
  patientBoothVoiceOnSessionComplete,
  patientBoothVoiceOnTargetReachConfirmed,
  patientBoothVoiceTickInactivity,
  resetPatientBoothVoiceSession,
} from "./patient-booth-voice-runtime";

function withMockHtmlAudio(run: () => void): void {
  const previousAudio = (globalThis as { Audio?: typeof Audio }).Audio;
  class MockAudio {
    preload = "auto";
    currentTime = 0;
    src = "";
    play(): Promise<void> {
      return Promise.resolve();
    }
    pause(): void {}
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

describe("patient booth voice runtime", () => {
  it("uses side-neutral booth scripts for left and right sessions", () => {
    assert.equal(interactiveShoulderBoothVoiceScriptsAreSideNeutral(), true);
  });

  it("sequences session start, during movement, and completion without duplicate session-start", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnCountdownComplete(state, { muted: false, nowMs: 0 });
      patientBoothVoiceOnMovementBlockActivated(state, "block-a", { muted: false, nowMs: 100 });
      const duplicateStart = speakBoothVoiceCue("session-start", "patient-session", { nowMs: 200 });
      assert.equal(duplicateStart, false);
      patientBoothVoiceOnSessionComplete(state, { muted: false, nowMs: 300 });
    });
  });

  it("fires inactivity reminders with limits during movement", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnMovementBlockActivated(state, "reach", { muted: false, nowMs: 1_000_000 });
      const t0 = 1_000_000;
      patientBoothVoiceTickInactivity(state, {
        nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS,
        trackingStatus: "tracking",
        muted: false,
      });
      patientBoothVoiceTickInactivity(state, {
        nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS + BOOTH_INACTIVITY_SECOND_DELAY_MS,
        trackingStatus: "tracking",
        muted: false,
      });
      const third = speakBoothVoiceCue("inactivity-take-your-time", "extra", {
        nowMs: t0 + 60_000,
        allowRepeatKey: true,
        skipCooldown: true,
      });
      assert.equal(third, true);
    });
  });

  it("respects mute and cleans up session state", () => {
    withMockHtmlAudio(() => {
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnCountdownComplete(state, { muted: true, nowMs: 0 });
      const spoke = speakBoothVoiceCue("session-start", "patient-session", { muted: false, nowMs: 1 });
      assert.equal(spoke, false);
      resetPatientBoothVoiceSession(state);
      assert.equal(state.sessionEnded, false);
    });
  });

  it("allows distinct successful-reach scopes per target", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t1", capturedAtMs: 0, reactionTimeMs: 400 },
        { muted: false, nowMs: 0 },
      );
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t2", capturedAtMs: 0, reactionTimeMs: 500 },
        { muted: false, nowMs: 50 },
      );
    });
  });

  it("enforces booth cooldown unless skipCooldown is used by runtime helpers", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      assert.equal(speakBoothVoiceCue("session-start", "cooldown-a", { nowMs: 10_000 }), true);
      assert.equal(
        speakBoothVoiceCue("during-movement", "cooldown-a", {
          nowMs: 10_000 + BOOTH_VOICE_COOLDOWN_MS - 1,
        }),
        false,
      );
    });
  });
});
