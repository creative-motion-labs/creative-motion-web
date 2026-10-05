/**
 * Run: npx tsx --test app/lib/booth/booth-voice-inactivity.test.ts app/lib/booth/booth-voice-guidance.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOOTH_INACTIVITY_FIRST_DELAY_MS,
  BOOTH_INACTIVITY_SECOND_DELAY_MS,
  createBoothInactivityState,
  evaluateBoothInactivityCue,
  onBoothBlockChanged,
  onBoothMeaningfulInteraction,
} from "./booth-voice-inactivity";
import { resetBoothVoiceAudioPlaybackForTests } from "./booth-voice-audio";
import {
  BOOTH_VOICE_COOLDOWN_MS,
  resetBoothVoiceGuidance,
  speakBoothVoiceCue,
} from "./booth-voice-guidance";

describe("booth voice inactivity scheduling", () => {
  it("fires first cue after 8s idle with good tracking", () => {
    const t0 = 1_000_000;
    const state = createBoothInactivityState("reach", t0);
    const before = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS - 1,
      trackingGood: true,
      sessionEligible: true,
    });
    assert.equal(before.cue, null);

    const after = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS,
      trackingGood: true,
      sessionEligible: true,
    });
    assert.equal(after.cue, "inactivity-take-your-time");
    assert.equal(after.state.inactivityCuesSpoken, 1);
  });

  it("fires second cue only after 12s more without interaction since first cue", () => {
    const t0 = 2_000_000;
    let state = createBoothInactivityState("reach", t0);
    const first = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS,
      trackingGood: true,
      sessionEligible: true,
    });
    state = first.state;

    const tooSoon = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS + BOOTH_INACTIVITY_SECOND_DELAY_MS - 1,
      trackingGood: true,
      sessionEligible: true,
    });
    assert.equal(tooSoon.cue, null);

    const second = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS + BOOTH_INACTIVITY_SECOND_DELAY_MS,
      trackingGood: true,
      sessionEligible: true,
    });
    assert.equal(second.cue, "inactivity-gentle-reach");
    assert.equal(second.state.inactivityCuesSpoken, 2);

    const third = evaluateBoothInactivityCue(second.state, {
      nowMs: t0 + 60_000,
      trackingGood: true,
      sessionEligible: true,
    });
    assert.equal(third.cue, null);
  });

  it("resets idle timer after meaningful interaction and suppresses second cue", () => {
    const t0 = 3_000_000;
    let state = createBoothInactivityState("reach", t0);
    const first = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS,
      trackingGood: true,
      sessionEligible: true,
    });
    state = first.state;
    const hitAt = t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS + 2_000;
    state = onBoothMeaningfulInteraction(state, hitAt)!;

    const blockedSecond = evaluateBoothInactivityCue(state, {
      nowMs: t0 + BOOTH_INACTIVITY_FIRST_DELAY_MS + BOOTH_INACTIVITY_SECOND_DELAY_MS + 5_000,
      trackingGood: true,
      sessionEligible: true,
    });
    assert.equal(blockedSecond.cue, null);
  });

  it("resets inactivity state on block change", () => {
    const t0 = 4_000_000;
    let state = createBoothInactivityState("block-a", t0);
    state = onBoothBlockChanged(state, "block-b", t0 + 5_000);
    assert.equal(state.blockId, "block-b");
    assert.equal(state.inactivityCuesSpoken, 0);
    assert.equal(state.lastMeaningfulInteractionMs, t0 + 5_000);
  });

  it("does not schedule cues during countdown or poor tracking", () => {
    const t0 = 5_000_000;
    const state = createBoothInactivityState("reach", t0);
    assert.equal(
      evaluateBoothInactivityCue(state, {
        nowMs: t0 + 20_000,
        trackingGood: false,
        sessionEligible: true,
      }).cue,
      null,
    );
    assert.equal(
      evaluateBoothInactivityCue(state, {
        nowMs: t0 + 20_000,
        trackingGood: true,
        sessionEligible: false,
      }).cue,
      null,
    );
  });
});

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

describe("booth voice guidance cooldown and mute", () => {
  it("respects mute immediately", () => {
    resetBoothVoiceGuidance();
    const spoke = speakBoothVoiceCue("session-start", "test-mute", { muted: true, nowMs: 0 });
    assert.equal(spoke, false);
  });

  it("enforces minimum cooldown between cues", () => {
    resetBoothVoiceGuidance();
    withMockHtmlAudio(() => {
    const first = speakBoothVoiceCue("session-start", "test-cooldown", { nowMs: 10_000 });
    assert.equal(first, true);
    const blocked = speakBoothVoiceCue("during-movement", "test-cooldown", {
      nowMs: 10_000 + BOOTH_VOICE_COOLDOWN_MS - 1,
    });
    assert.equal(blocked, false);
    const allowed = speakBoothVoiceCue("during-movement", "test-cooldown-2", {
      nowMs: 10_000 + BOOTH_VOICE_COOLDOWN_MS,
    });
    assert.equal(allowed, true);
    });
  });

  it("does not repeat the same scope+cue key", () => {
    resetBoothVoiceGuidance();
    withMockHtmlAudio(() => {
      assert.equal(speakBoothVoiceCue("session-complete", "once", { nowMs: 0 }), true);
      assert.equal(
        speakBoothVoiceCue("session-complete", "once", { nowMs: BOOTH_VOICE_COOLDOWN_MS + 1 }),
        false,
      );
    });
  });
});
