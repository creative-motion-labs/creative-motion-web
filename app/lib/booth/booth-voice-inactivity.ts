/**
 * Inactivity voice scheduling for Interactive Shoulder booth guidance.
 * Pure logic only — no clinical inference.
 */

import type { BoothVoiceCue } from "./booth-voice-manifest";

export const BOOTH_INACTIVITY_FIRST_DELAY_MS = 8_000;
export const BOOTH_INACTIVITY_SECOND_DELAY_MS = 12_000;
export const BOOTH_INACTIVITY_MAX_CUES_PER_BLOCK = 2;

export type BoothInactivityState = {
  blockId: string;
  lastMeaningfulInteractionMs: number;
  inactivityCuesSpoken: number;
  lastInactivityCueAtMs: number | null;
};

export type BoothInactivityTickInput = {
  nowMs: number;
  trackingGood: boolean;
  sessionEligible: boolean;
};

export type BoothInactivityTickResult = {
  state: BoothInactivityState | null;
  cue: BoothVoiceCue | null;
};

export function createBoothInactivityState(blockId: string, nowMs: number): BoothInactivityState {
  return {
    blockId,
    lastMeaningfulInteractionMs: nowMs,
    inactivityCuesSpoken: 0,
    lastInactivityCueAtMs: null,
  };
}

export function onBoothBlockChanged(
  _previous: BoothInactivityState | null,
  blockId: string,
  nowMs: number,
): BoothInactivityState {
  return createBoothInactivityState(blockId, nowMs);
}

export function onBoothMeaningfulInteraction(
  state: BoothInactivityState | null,
  nowMs: number,
): BoothInactivityState | null {
  if (!state) return null;
  return { ...state, lastMeaningfulInteractionMs: nowMs };
}

export function evaluateBoothInactivityCue(
  state: BoothInactivityState | null,
  input: BoothInactivityTickInput,
): BoothInactivityTickResult {
  if (!state || !input.sessionEligible || !input.trackingGood) {
    return { state, cue: null };
  }

  if (state.inactivityCuesSpoken >= BOOTH_INACTIVITY_MAX_CUES_PER_BLOCK) {
    return { state, cue: null };
  }

  const idleMs = input.nowMs - state.lastMeaningfulInteractionMs;

  if (state.inactivityCuesSpoken === 0) {
    if (idleMs >= BOOTH_INACTIVITY_FIRST_DELAY_MS) {
      const next: BoothInactivityState = {
        ...state,
        inactivityCuesSpoken: 1,
        lastInactivityCueAtMs: input.nowMs,
      };
      return { state: next, cue: "inactivity-take-your-time" };
    }
    return { state, cue: null };
  }

  if (
    state.inactivityCuesSpoken === 1 &&
    state.lastInactivityCueAtMs != null &&
    input.nowMs - state.lastInactivityCueAtMs >= BOOTH_INACTIVITY_SECOND_DELAY_MS &&
    state.lastMeaningfulInteractionMs <= state.lastInactivityCueAtMs
  ) {
    const next: BoothInactivityState = {
      ...state,
      inactivityCuesSpoken: 2,
      lastInactivityCueAtMs: input.nowMs,
    };
    return { state: next, cue: "inactivity-gentle-reach" };
  }

  return { state, cue: null };
}
