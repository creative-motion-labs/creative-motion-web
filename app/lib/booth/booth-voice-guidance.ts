/**
 * Booth demo voice cues — local prerecorded audio only (see `public/audio/booth/`).
 * Callers must gate on user Start and an explicit voice-enabled toggle.
 */

import { playBoothVoiceAsset, stopBoothVoicePlayback } from "./booth-voice-audio";
import type { BoothVoiceCue } from "./booth-voice-manifest";

export type { BoothVoiceCue } from "./booth-voice-manifest";
export {
  preloadBatteryBoothVoiceAssets,
  preloadBoothVoiceAssets,
  preloadInteractiveShoulderBoothVoiceAssets,
  stopBoothVoicePlayback,
} from "./booth-voice-audio";
export { BOOTH_VOICE_CUE_MANIFEST } from "./booth-voice-manifest";

export const BOOTH_VOICE_COOLDOWN_MS = 12_000;

const spokenScopes = new Set<string>();
let lastBoothVoiceSpokenAtMs: number | null = null;

export function getLastBoothVoiceSpokenAtMs(): number | null {
  return lastBoothVoiceSpokenAtMs;
}

export function resetBoothVoiceGuidance(): void {
  spokenScopes.clear();
  lastBoothVoiceSpokenAtMs = null;
  stopBoothVoicePlayback();
}

export type SpeakBoothVoiceCueOptions = {
  nowMs?: number;
  muted?: boolean;
  /** When true, the same scope+cue may play again (inactivity uses per-block scopes). */
  allowRepeatKey?: boolean;
  /** When true, bypass the global inter-cue cooldown (e.g. tracking-lost reminders). */
  skipCooldown?: boolean;
};

export function speakBoothVoiceCue(
  cue: BoothVoiceCue,
  scope = "global",
  options?: SpeakBoothVoiceCueOptions,
): boolean {
  if (options?.muted) {
    stopBoothVoicePlayback();
    return false;
  }

  const nowMs = options?.nowMs ?? Date.now();
  if (
    !options?.skipCooldown &&
    lastBoothVoiceSpokenAtMs != null &&
    nowMs - lastBoothVoiceSpokenAtMs < BOOTH_VOICE_COOLDOWN_MS
  ) {
    return false;
  }

  const key = `${scope}:${cue}`;
  if (!options?.allowRepeatKey && spokenScopes.has(key)) return false;
  spokenScopes.add(key);

  const played = playBoothVoiceAsset(cue, () => {
    spokenScopes.delete(key);
    if (lastBoothVoiceSpokenAtMs === nowMs) {
      lastBoothVoiceSpokenAtMs = null;
    }
  });
  if (!played) {
    spokenScopes.delete(key);
    return false;
  }
  lastBoothVoiceSpokenAtMs = nowMs;
  return true;
}
