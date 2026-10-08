/**
 * Catalog Interactive Shoulder — short confirmation SFX (shared demo MP3 assets, separate audio graph from booth voice).
 */

import type { TargetHitEvent } from "@/app/lib/interactive-shoulder/types";
import {
  RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME,
  rasqDemoPnfRepetitionTickPublicSrc,
} from "@/app/lib/rasq-demo/demo-pnf-repetition-tick-sfx";
import {
  RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME,
  rasqDemoTargetPopPublicSrc,
} from "@/app/lib/rasq-demo/demo-sfx-audio";
import { readPatientBoothVoiceMutedPreference } from "@/app/lib/interactive-shoulder/patient-booth-voice-runtime";

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

let sfxUnlocked = false;
const targetPopPlayedIds = new Set<string>();
const pnfTickPlayedRepetitions = new Set<number>();
let popPlayCount = 0;
let tickPlayCount = 0;

export function resetPatientInteractiveShoulderSessionSfxForTests(): void {
  sfxUnlocked = false;
  targetPopPlayedIds.clear();
  pnfTickPlayedRepetitions.clear();
  popPlayCount = 0;
  tickPlayCount = 0;
}

export function unlockPatientInteractiveShoulderSessionSfxFromUserGesture(): void {
  sfxUnlocked = true;
}

export function getPatientTargetPopPlayCountForTests(): number {
  return popPlayCount;
}

export function getPatientPnfTickPlayCountForTests(): number {
  return tickPlayCount;
}

function playShortSfx(src: string, volume: number): void {
  if (!sfxUnlocked || !canUseHtmlAudio()) return;
  if (readPatientBoothVoiceMutedPreference()) return;
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  const audio = new AudioCtor(src);
  audio.preload = "auto";
  audio.volume = volume;
  void audio.play().catch(() => {
    /* autoplay policy */
  });
}

export function playPatientTargetPopForConfirmedHit(hit: Pick<TargetHitEvent, "targetId">): void {
  if (readPatientBoothVoiceMutedPreference()) return;
  if (targetPopPlayedIds.has(hit.targetId)) return;
  targetPopPlayedIds.add(hit.targetId);
  popPlayCount += 1;
  playShortSfx(rasqDemoTargetPopPublicSrc(), RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME);
}

export function playPatientPnfRepetitionTick(input: { repetitionNumber: number }): void {
  if (readPatientBoothVoiceMutedPreference()) return;
  if (pnfTickPlayedRepetitions.has(input.repetitionNumber)) return;
  pnfTickPlayedRepetitions.add(input.repetitionNumber);
  tickPlayCount += 1;
  playShortSfx(rasqDemoPnfRepetitionTickPublicSrc(), RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME);
}

export function stopPatientInteractiveShoulderSessionSfx(): void {
  targetPopPlayedIds.clear();
  pnfTickPlayedRepetitions.clear();
}
