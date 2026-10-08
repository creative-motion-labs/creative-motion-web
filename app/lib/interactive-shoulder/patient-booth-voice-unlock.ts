/**
 * Unlocks Interactive Shoulder booth HTMLAudio after explicit user gestures.
 */

import { preloadInteractiveShoulderBoothVoiceAssets } from "@/app/lib/booth/booth-voice-guidance";

let patientBoothVoiceUnlocked = false;

export function isPatientBoothVoiceUnlockedForTests(): boolean {
  return patientBoothVoiceUnlocked;
}

export function resetPatientBoothVoiceUnlockForTests(): void {
  patientBoothVoiceUnlocked = false;
}

/** Call from Begin session, camera consent, or sound/voice toggle — not from pose tracking. */
export function unlockPatientBoothVoiceFromUserGesture(): void {
  if (patientBoothVoiceUnlocked) {
    preloadInteractiveShoulderBoothVoiceAssets();
    return;
  }
  patientBoothVoiceUnlocked = true;
  preloadInteractiveShoulderBoothVoiceAssets();
  if (typeof globalThis === "undefined") return;
  const AudioCtor = (globalThis as { Audio?: typeof Audio }).Audio;
  if (!AudioCtor) return;
  try {
    const silent = new AudioCtor(
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA",
    );
    silent.volume = 0.0001;
    const playPromise = silent.play();
    if (playPromise && typeof playPromise.then === "function") {
      void playPromise.catch(() => {
        /* autoplay policy — preloads still help once a later cue plays */
      });
    }
  } catch {
    /* ignore */
  }
}
