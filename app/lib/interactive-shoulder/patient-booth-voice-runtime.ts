/**
 * Catalog Interactive Shoulder — booth prerecorded voice scheduling (side-neutral scripts only).
 */

import { isBoothVoicePlaybackActive } from "@/app/lib/booth/booth-voice-audio";
import {
  BOOTH_VOICE_COOLDOWN_MS,
  resetBoothVoiceGuidance,
  speakBoothVoiceCue,
  speakBoothVoiceCueDetached,
  stopAllBoothVoicePlayback,
  stopBoothVoicePlayback,
} from "@/app/lib/booth/booth-voice-guidance";
import type { SessionBlockType } from "@/app/lib/session-orchestrator/types";
import { traceInteractiveShoulderSessionDev } from "@/app/lib/interactive-shoulder/interactive-shoulder-session-dev-trace";
import type { InteractiveShoulderBoothVoiceCue } from "@/app/lib/booth/booth-voice-manifest";
import {
  INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
  isInteractiveShoulderBoothVoiceCue,
} from "@/app/lib/booth/booth-voice-manifest";
import {
  evaluateBoothInactivityCue,
  onBoothBlockChanged,
  onBoothMeaningfulInteraction,
  type BoothInactivityState,
} from "@/app/lib/booth/booth-voice-inactivity";
import type { ShoulderAbductionReachTrackingStatus } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import {
  playPatientPnfRepetitionTick,
  playPatientTargetPopForConfirmedHit,
  stopPatientInteractiveShoulderSessionSfx,
} from "@/app/lib/interactive-shoulder/patient-interactive-shoulder-session-sfx";
import type { PatternCompletionEvent } from "@/app/lib/interactive-shoulder/motion-patterns/pattern-lifecycle";
import type { TargetHitEvent } from "@/app/lib/interactive-shoulder/types";

export const PATIENT_BOOTH_VOICE_MUTE_SESSION_KEY = "rasq:is-shoulder-voice-muted";

/** Minimum time between spoken milestone praise cues within one movement block. */
export const PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS = 12_000;

/** At most two spoken encouragement clips per movement block. */
export const PATIENT_MILESTONE_PRAISE_MAX_PER_MOVEMENT_BLOCK = 2;

/** Second milestone praise may fire on this hit index (first is always hit 1). */
export const PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX = 4;

const MOVEMENT_BLOCK_TYPES = new Set<SessionBlockType>(["movement-target", "movement-pattern"]);

const SIDE_SPECIFIC_PATTERN =
  /\b(left|right)\s+(arm|hand|side)\b|\breach\s+(to\s+)?(your\s+)?(left|right)\b/i;

export function readPatientBoothVoiceMutedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PATIENT_BOOTH_VOICE_MUTE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePatientBoothVoiceMutedPreference(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PATIENT_BOOTH_VOICE_MUTE_SESSION_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function interactiveShoulderBoothVoiceScriptsAreSideNeutral(): boolean {
  for (const entry of Object.values(INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST)) {
    if (SIDE_SPECIFIC_PATTERN.test(entry.script)) return false;
  }
  return true;
}

export type PatientBoothVoiceRuntimeOptions = {
  muted: boolean;
  nowMs?: number;
};

function speakPatientCue(
  cue: InteractiveShoulderBoothVoiceCue,
  scope: string,
  options: PatientBoothVoiceRuntimeOptions & {
    allowRepeatKey?: boolean;
    skipCooldown?: boolean;
    interruptCurrent?: boolean;
  },
): boolean {
  return speakBoothVoiceCue(cue, scope, {
    muted: options.muted,
    nowMs: options.nowMs,
    allowRepeatKey: options.allowRepeatKey,
    skipCooldown: options.skipCooldown,
    interruptCurrent: options.interruptCurrent,
  });
}

export type PatientBoothVoiceSessionState = {
  inactivity: BoothInactivityState | null;
  movementBlockActive: boolean;
  sessionEnded: boolean;
  lastSuccessfulReachVoiceAtMs: number | null;
  patternRepetitionsCompleted: number;
  activeMovementBlockId: string | null;
  targetHitsInMovementBlock: number;
  milestoneEncouragementSpokenInBlock: number;
};

export function createPatientBoothVoiceSessionState(): PatientBoothVoiceSessionState {
  return {
    inactivity: null,
    movementBlockActive: false,
    sessionEnded: false,
    lastSuccessfulReachVoiceAtMs: null,
    patternRepetitionsCompleted: 0,
    activeMovementBlockId: null,
    targetHitsInMovementBlock: 0,
    milestoneEncouragementSpokenInBlock: 0,
  };
}

export function resetPatientBoothVoiceSession(state: PatientBoothVoiceSessionState): void {
  state.inactivity = null;
  state.movementBlockActive = false;
  state.sessionEnded = false;
  state.lastSuccessfulReachVoiceAtMs = null;
  state.patternRepetitionsCompleted = 0;
  state.activeMovementBlockId = null;
  state.targetHitsInMovementBlock = 0;
  state.milestoneEncouragementSpokenInBlock = 0;
  resetBoothVoiceGuidance();
  stopAllBoothVoicePlayback();
}

function resetMovementBlockVoiceCounters(state: PatientBoothVoiceSessionState, blockId: string): void {
  state.activeMovementBlockId = blockId;
  state.targetHitsInMovementBlock = 0;
  state.milestoneEncouragementSpokenInBlock = 0;
  state.lastSuccessfulReachVoiceAtMs = null;
}

export function shouldOfferMilestoneReachPraise(
  hitsInBlock: number,
  encouragementSpokenInBlock: number,
): boolean {
  if (encouragementSpokenInBlock >= PATIENT_MILESTONE_PRAISE_MAX_PER_MOVEMENT_BLOCK) return false;
  if (encouragementSpokenInBlock === 0 && hitsInBlock === 1) return true;
  if (
    encouragementSpokenInBlock === 0 &&
    hitsInBlock >= PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX
  ) {
    return true;
  }
  if (
    encouragementSpokenInBlock === 1 &&
    hitsInBlock >= PATIENT_SECOND_MILESTONE_PRAISE_HIT_INDEX
  ) {
    return true;
  }
  return false;
}

/** Hook unmount: preserve detached session-complete audio after wrap-up navigation. */
export function disposePatientBoothVoiceHookCleanup(state: PatientBoothVoiceSessionState): void {
  if (state.sessionEnded) {
    state.inactivity = null;
    state.movementBlockActive = false;
    stopBoothVoicePlayback();
    return;
  }
  resetPatientBoothVoiceSession(state);
}

export function cancelPatientBoothVoicePlayback(): void {
  stopAllBoothVoicePlayback();
  resetBoothVoiceGuidance();
  stopPatientInteractiveShoulderSessionSfx();
}

export function patientBoothVoiceOnCountdownComplete(
  state: PatientBoothVoiceSessionState,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded) return;
  speakPatientCue("session-start", "patient-session", options);
}

export function patientBoothVoiceOnMovementBlockActivated(
  state: PatientBoothVoiceSessionState,
  blockId: string,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded) return;
  const nowMs = options.nowMs ?? Date.now();
  state.movementBlockActive = true;
  resetMovementBlockVoiceCounters(state, blockId);
  state.inactivity = onBoothBlockChanged(state.inactivity, blockId, nowMs);
  traceInteractiveShoulderSessionDev("voice-block-activated", {
    blockId,
    blockType: "movement",
  });
  speakPatientCue("during-movement", `block:${blockId}`, {
    ...options,
    nowMs,
    skipCooldown: true,
  });
}

export function patientBoothVoiceOnTherapeuticBlockRest(
  state: PatientBoothVoiceSessionState,
  completedBlockId: string,
  completedBlockType: SessionBlockType,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded) return;
  state.movementBlockActive = false;
  state.inactivity = null;
  traceInteractiveShoulderSessionDev("voice-block-rest", {
    blockId: completedBlockId,
    blockType: completedBlockType,
  });
  if (!MOVEMENT_BLOCK_TYPES.has(completedBlockType)) {
    traceInteractiveShoulderSessionDev("voice-cue-skipped", {
      cue: "session-cool-down",
      reason: "non-movement-block-transition",
    });
    return;
  }
  speakPatientCue("session-cool-down", `rest:${completedBlockId}`, {
    ...options,
    skipCooldown: true,
    interruptCurrent: false,
  });
}

export function patientBoothVoiceOnTargetReachConfirmed(
  state: PatientBoothVoiceSessionState,
  event: TargetHitEvent,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded) return;
  const nowMs = options.nowMs ?? Date.now();
  state.inactivity = onBoothMeaningfulInteraction(state.inactivity, nowMs);
  state.targetHitsInMovementBlock += 1;
  const hitsInBlock = state.targetHitsInMovementBlock;
  if (!options.muted) {
    playPatientTargetPopForConfirmedHit(event);
  }
  traceInteractiveShoulderSessionDev("target-contact-confirmed", {
    targetId: event.targetId ?? "unknown",
    hitsInBlock,
    milestoneSpoken: state.milestoneEncouragementSpokenInBlock,
  });
  if (!shouldOfferMilestoneReachPraise(hitsInBlock, state.milestoneEncouragementSpokenInBlock)) {
    traceInteractiveShoulderSessionDev("voice-cue-skipped", {
      cue: "successful-reach",
      reason: "not-a-milestone-hit",
      hitsInBlock,
    });
    return;
  }
  if (
    state.lastSuccessfulReachVoiceAtMs != null &&
    nowMs - state.lastSuccessfulReachVoiceAtMs < PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS
  ) {
    traceInteractiveShoulderSessionDev("voice-cue-skipped", {
      cue: "successful-reach",
      reason: "min-gap",
    });
    return;
  }
  if (isBoothVoicePlaybackActive()) {
    traceInteractiveShoulderSessionDev("voice-cue-skipped", {
      cue: "successful-reach",
      reason: "playback-active",
    });
    return;
  }
  const blockId = state.activeMovementBlockId ?? "movement";
  const milestoneIndex = state.milestoneEncouragementSpokenInBlock + 1;
  const spoke = speakPatientCue("successful-reach", `milestone:${blockId}:${milestoneIndex}`, {
    ...options,
    nowMs,
    skipCooldown: true,
    interruptCurrent: false,
  });
  if (spoke) {
    state.lastSuccessfulReachVoiceAtMs = nowMs;
    state.milestoneEncouragementSpokenInBlock += 1;
    traceInteractiveShoulderSessionDev("voice-cue-played", {
      cue: "successful-reach",
      milestoneIndex,
      hitsInBlock,
    });
  } else {
    traceInteractiveShoulderSessionDev("voice-cue-skipped", {
      cue: "successful-reach",
      reason: "speak-declined",
    });
  }
}

export function patientBoothVoiceOnPatternReachConfirmed(
  state: PatientBoothVoiceSessionState,
  _event: PatternCompletionEvent,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded || options.muted) return;
  state.patternRepetitionsCompleted += 1;
  traceInteractiveShoulderSessionDev("pattern-pass-completed", {
    patternRepetitionsCompleted: state.patternRepetitionsCompleted,
  });
  playPatientPnfRepetitionTick({ repetitionNumber: state.patternRepetitionsCompleted });
}

export function patientBoothVoiceOnTargetAttemptStarted(
  state: PatientBoothVoiceSessionState,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded) return;
  const nowMs = options.nowMs ?? Date.now();
  state.inactivity = onBoothMeaningfulInteraction(state.inactivity, nowMs);
}

export function patientBoothVoiceOnSessionComplete(
  state: PatientBoothVoiceSessionState,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  state.sessionEnded = true;
  state.movementBlockActive = false;
  state.inactivity = null;
  speakBoothVoiceCueDetached("session-complete", "patient-session", {
    muted: options.muted,
    nowMs: options.nowMs,
  });
}

export function patientBoothVoiceTrackingIsGood(status: ShoulderAbductionReachTrackingStatus): boolean {
  return status === "tracking";
}

export function patientBoothVoiceTickInactivity(
  state: PatientBoothVoiceSessionState,
  input: {
    nowMs: number;
    trackingStatus: ShoulderAbductionReachTrackingStatus;
    muted: boolean;
  },
): void {
  if (state.sessionEnded || !state.movementBlockActive || !state.inactivity) return;
  const result = evaluateBoothInactivityCue(state.inactivity, {
    nowMs: input.nowMs,
    trackingGood: patientBoothVoiceTrackingIsGood(input.trackingStatus),
    sessionEligible: true,
  });
  state.inactivity = result.state;
  if (!result.cue || !result.state || !isInteractiveShoulderBoothVoiceCue(result.cue)) return;
  speakPatientCue(result.cue, `inactivity:${result.state.blockId}:${result.cue}`, {
    muted: input.muted,
    nowMs: input.nowMs,
    allowRepeatKey: true,
    skipCooldown: true,
  });
}

export function patientBoothVoiceSetMuted(muted: boolean): void {
  writePatientBoothVoiceMutedPreference(muted);
  if (muted) {
    stopAllBoothVoicePlayback();
    stopPatientInteractiveShoulderSessionSfx();
  }
}

export { BOOTH_VOICE_COOLDOWN_MS };
