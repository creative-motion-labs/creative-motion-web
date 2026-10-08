/**
 * Run: npx tsx --test app/lib/interactive-shoulder/patient-booth-voice-milestones.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resetBoothVoiceAudioPlaybackForTests,
  stopBoothVoicePlayback,
} from "@/app/lib/booth/booth-voice-audio";
import { resetBoothVoiceGuidance, speakBoothVoiceCue } from "@/app/lib/booth/booth-voice-guidance";
import {
  createPatientBoothVoiceSessionState,
  patientBoothVoiceOnMovementBlockActivated,
  patientBoothVoiceOnTargetReachConfirmed,
  patientBoothVoiceOnTherapeuticBlockRest,
  PATIENT_MILESTONE_PRAISE_MAX_PER_MOVEMENT_BLOCK,
  PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX,
  PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS,
  shouldOfferMilestoneReachPraise,
} from "./patient-booth-voice-runtime";

let audioConstructCount = 0;

function withMockHtmlAudio(run: () => void): void {
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

describe("shouldOfferMilestoneReachPraise", () => {
  it("offers at most two milestones per block", () => {
    assert.equal(shouldOfferMilestoneReachPraise(1, 0), true);
    assert.equal(shouldOfferMilestoneReachPraise(2, 1), false);
    assert.equal(
      shouldOfferMilestoneReachPraise(PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX, 1),
      true,
    );
    assert.equal(
      shouldOfferMilestoneReachPraise(PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX, 2),
      false,
    );
  });
});

describe("patientBoothVoiceOnTargetReachConfirmed — milestone speech", () => {
  it("does not speak Well done on every rapid target hit", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnMovementBlockActivated(state, "reach-block", {
        muted: false,
        nowMs: 0,
      });
      stopBoothVoicePlayback();
      const afterMovementCue = audioConstructCount;
      for (let i = 0; i < 3; i += 1) {
        patientBoothVoiceOnTargetReachConfirmed(
          state,
          { targetId: `t${i}`, capturedAtMs: 0, reactionTimeMs: 300, sequence: i + 1 },
          { muted: false, nowMs: 1_000 + i * 500 },
        );
      }
      assert.equal(
        state.milestoneEncouragementSpokenInBlock,
        1,
        "only first-hit milestone praise in first three hits",
      );
      assert.ok(
        audioConstructCount <= afterMovementCue + 1,
        "no per-target spoken praise beyond first milestone",
      );
    });
  });

  it("allows a second milestone after min gap on later hit index", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      patientBoothVoiceOnMovementBlockActivated(state, "reach-block", { muted: false, nowMs: 0 });
      stopBoothVoicePlayback();
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t1", capturedAtMs: 0, reactionTimeMs: 300, sequence: 1 },
        { muted: false, nowMs: 5_000 },
      );
      stopBoothVoicePlayback();
      assert.equal(state.milestoneEncouragementSpokenInBlock, 1);
      for (let hit = 2; hit < PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX; hit += 1) {
        patientBoothVoiceOnTargetReachConfirmed(
          state,
          { targetId: `t${hit}`, capturedAtMs: 0, reactionTimeMs: 300, sequence: hit },
          { muted: false, nowMs: 5_000 + hit * 100 },
        );
      }
      assert.equal(state.milestoneEncouragementSpokenInBlock, 1);
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t4", capturedAtMs: 0, reactionTimeMs: 300, sequence: 4 },
        {
          muted: false,
          nowMs: 5_000 + PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS + 100,
        },
      );
      assert.equal(
        state.milestoneEncouragementSpokenInBlock,
        PATIENT_MILESTONE_PRAISE_MAX_PER_MOVEMENT_BLOCK,
      );
    });
  });

  it("does not interrupt an active movement instruction clip", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      speakBoothVoiceCue("during-movement", "block:reach-block", { nowMs: 0 });
      patientBoothVoiceOnMovementBlockActivated(state, "reach-block", { muted: false, nowMs: 0 });
      patientBoothVoiceOnTargetReachConfirmed(
        state,
        { targetId: "t1", capturedAtMs: 0, reactionTimeMs: 300, sequence: 1 },
        { muted: false, nowMs: 100 },
      );
      assert.equal(state.milestoneEncouragementSpokenInBlock, 0);
    });
  });
});

describe("patientBoothVoiceOnTherapeuticBlockRest", () => {
  it("skips cool-down voice after instructional blocks", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      const before = audioConstructCount;
      patientBoothVoiceOnTherapeuticBlockRest(state, "warm-up", "instructional", {
        muted: false,
        nowMs: 0,
      });
      assert.equal(audioConstructCount, before);
    });
  });

  it("plays cool-down voice after movement-target blocks", () => {
    withMockHtmlAudio(() => {
      resetBoothVoiceGuidance();
      const state = createPatientBoothVoiceSessionState();
      const before = audioConstructCount;
      patientBoothVoiceOnTherapeuticBlockRest(state, "reach", "movement-target", {
        muted: false,
        nowMs: 0,
      });
      assert.ok(audioConstructCount > before);
    });
  });
});
