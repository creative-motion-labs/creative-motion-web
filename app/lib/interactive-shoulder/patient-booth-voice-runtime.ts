/**
 * Catalog Interactive Shoulder — booth prerecorded voice scheduling (side-neutral scripts only).
 */

import {
  BOOTH_VOICE_COOLDOWN_MS,
  resetBoothVoiceGuidance,
  speakBoothVoiceCue,
  speakBoothVoiceCueDetached,
  stopAllBoothVoicePlayback,
  stopBoothVoicePlayback,
} from "@/app/lib/booth/booth-voice-guidance";
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
import type { TargetHitEvent } from "@/app/lib/interactive-shoulder/types";

export const PATIENT_BOOTH_VOICE_MUTE_SESSION_KEY = "rasq:is-shoulder-voice-muted";

/** Minimum time between spoken successful-reach cues (avoids interrupting "Nice reach."). */
export const PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS = 4_000;

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
};

export function createPatientBoothVoiceSessionState(): PatientBoothVoiceSessionState {
  return {
    inactivity: null,
    movementBlockActive: false,
    sessionEnded: false,
    lastSuccessfulReachVoiceAtMs: null,
  };
}

export function resetPatientBoothVoiceSession(state: PatientBoothVoiceSessionState): void {
  state.inactivity = null;
  state.movementBlockActive = false;
  state.sessionEnded = false;
  state.lastSuccessfulReachVoiceAtMs = null;
  resetBoothVoiceGuidance();
  stopAllBoothVoicePlayback();
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
  state.inactivity = onBoothBlockChanged(state.inactivity, blockId, nowMs);
  speakPatientCue("during-movement", `block:${blockId}`, {
    ...options,
    nowMs,
    skipCooldown: true,
  });
}

export function patientBoothVoiceOnTherapeuticBlockRest(
  state: PatientBoothVoiceSessionState,
  completedBlockId: string,
  options: PatientBoothVoiceRuntimeOptions,
): void {
  if (state.sessionEnded) return;
  state.movementBlockActive = false;
  state.inactivity = null;
  speakPatientCue("session-cool-down", `rest:${completedBlockId}`, {
    ...options,
    skipCooldown: true,
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
  if (
    state.lastSuccessfulReachVoiceAtMs != null &&
    nowMs - state.lastSuccessfulReachVoiceAtMs < PATIENT_SUCCESSFUL_REACH_VOICE_MIN_GAP_MS
  ) {
    return;
  }
  const targetKey = event.targetId ?? `seq-${event.sequence ?? 0}`;
  const spoke = speakPatientCue("successful-reach", `target:${targetKey}`, {
    ...options,
    nowMs,
    skipCooldown: true,
    interruptCurrent: true,
  });
  if (spoke) {
    state.lastSuccessfulReachVoiceAtMs = nowMs;
  }
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
  }
}

export { BOOTH_VOICE_COOLDOWN_MS };
