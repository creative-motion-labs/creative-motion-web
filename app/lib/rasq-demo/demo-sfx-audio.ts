/**
 * Public demo sound effects — respects demo voice mute; does not use speech synthesis.
 */

import type { TargetHitEvent } from "@/app/lib/interactive-shoulder/types";
import { getRasqDemoVoiceMuted } from "./demo-voice-audio";

export const RASQ_DEMO_TARGET_POP_SFX_PATH = "/audio/demo/target-pop-en.mp3";
export const RASQ_DEMO_TARGET_POP_SFX_VERSION = "5";

/** Soft confirmation level — still respects demo mute. */
export const RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME = 0.38;

const DIRECT_SFX_TEST_TARGET_ID = "__direct-sfx-test__";

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

function isDevLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

let popAudioElement: HTMLAudioElement | null = null;
let targetPopAudioUnlocked = false;
let targetPopPlayCount = 0;
const targetPopPlayedTargetIds = new Set<string>();

export function rasqDemoTargetPopPublicSrc(): string {
  return `${RASQ_DEMO_TARGET_POP_SFX_PATH}?v=${RASQ_DEMO_TARGET_POP_SFX_VERSION}`;
}

export function getRasqDemoTargetPopPlayCountForTests(): number {
  return targetPopPlayCount;
}

export function getRasqDemoTargetPopPlayedTargetIdsForTests(): readonly string[] {
  return [...targetPopPlayedTargetIds];
}

export function getRasqDemoSharedPopAudioElementForTests(): HTMLAudioElement | null {
  return popAudioElement;
}

export function isRasqDemoTargetPopAudioUnlockedForTests(): boolean {
  return targetPopAudioUnlocked;
}

export function resetRasqDemoTargetPopPlayedTargets(): void {
  targetPopPlayedTargetIds.clear();
}

function logRasqDemoTargetHit(payload: Record<string, unknown>): void {
  if (!isDevLoggingEnabled()) return;
  console.info("[rasq-demo-target-hit]", payload);
}

function logPopAudioElementState(
  audio: HTMLAudioElement,
  extra: Record<string, unknown>,
): void {
  if (!isDevLoggingEnabled()) return;
  logRasqDemoTargetHit({
    ...extra,
    readyState: audio.readyState,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    elementMuted: audio.muted,
    volume: audio.volume,
    currentTime: audio.currentTime,
    src: audio.currentSrc || audio.src,
  });
}

function releaseConfirmedTargetDedupe(targetId: string): void {
  if (targetId === DIRECT_SFX_TEST_TARGET_ID) return;
  targetPopPlayedTargetIds.delete(targetId);
}

function ensurePopAudioElement(): HTMLAudioElement | null {
  if (!canUseHtmlAudio()) return null;
  const src = rasqDemoTargetPopPublicSrc();
  if (!popAudioElement) {
    const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
    popAudioElement = new AudioCtor(src);
    popAudioElement.preload = "auto";
    popAudioElement.crossOrigin = "anonymous";
    popAudioElement.load();
  } else if (!popAudioElement.src.includes(RASQ_DEMO_TARGET_POP_SFX_PATH)) {
    popAudioElement.src = src;
    popAudioElement.load();
  }
  return popAudioElement;
}

export function unlockRasqDemoTargetPopAudio(): void {
  const audio = ensurePopAudioElement();
  if (!audio) return;
  const savedVolume = audio.volume;
  audio.muted = false;
  audio.volume = 0.001;
  audio.currentTime = 0;
  logPopAudioElementState(audio, { event: "audio-unlock-attempt" });

  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    audio.volume = savedVolume;
    logRasqDemoTargetHit({
      targetId: "",
      audioUrl: rasqDemoTargetPopPublicSrc(),
      muted: getRasqDemoVoiceMuted(),
      played: false,
      event: "audio-unlock",
      ok: false,
      reason: "play-not-supported",
    });
    return;
  }

  void playPromise
    .then(() => {
      targetPopAudioUnlocked = true;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME;
      logPopAudioElementState(audio, { event: "audio-unlock", ok: true, played: true });
    })
    .catch((error: unknown) => {
      audio.volume = savedVolume;
      logRasqDemoTargetHit({
        targetId: "",
        audioUrl: rasqDemoTargetPopPublicSrc(),
        muted: getRasqDemoVoiceMuted(),
        played: false,
        event: "audio-unlock",
        ok: false,
        reason: "unlock-rejected",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function stopAllRasqDemoTargetPopPlayback(): void {
  if (!popAudioElement) return;
  try {
    popAudioElement.pause();
    popAudioElement.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function playPopOnSharedElement(targetId: string, audioUrl: string, muted: boolean): void {
  const audio = ensurePopAudioElement();
  if (!audio) {
    logRasqDemoTargetHit({
      targetId,
      audioUrl,
      muted,
      played: false,
      reason: "no-html-audio",
    });
    return;
  }

  audio.muted = false;
  audio.volume = RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME;
  audio.currentTime = 0;
  logPopAudioElementState(audio, { targetId, audioUrl, muted, event: "play-attempt" });

  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    logRasqDemoTargetHit({ targetId, audioUrl, muted, played: false, reason: "play-not-supported" });
    return;
  }

  void playPromise
    .then(() => {
      logPopAudioElementState(audio, { targetId, audioUrl, muted, played: true, playResult: "resolved" });
    })
    .catch((error: unknown) => {
      releaseConfirmedTargetDedupe(targetId);
      logPopAudioElementState(audio, {
        targetId,
        audioUrl,
        muted,
        played: false,
        playResult: "rejected",
        reason: targetPopAudioUnlocked ? "play-rejected" : "autoplay-not-unlocked",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function playRasqDemoTargetPopSfx(): boolean {
  if (getRasqDemoVoiceMuted()) return false;
  targetPopPlayCount += 1;
  if (!canUseHtmlAudio()) return false;
  playPopOnSharedElement(DIRECT_SFX_TEST_TARGET_ID, rasqDemoTargetPopPublicSrc(), false);
  return true;
}

export function playRasqDemoTargetPopForConfirmedHit(hit: Pick<TargetHitEvent, "targetId">): boolean {
  const audioUrl = rasqDemoTargetPopPublicSrc();
  const muted = getRasqDemoVoiceMuted();

  if (targetPopPlayedTargetIds.has(hit.targetId)) {
    logRasqDemoTargetHit({ targetId: hit.targetId, audioUrl, muted, played: false, reason: "duplicate" });
    return false;
  }
  if (muted) {
    logRasqDemoTargetHit({ targetId: hit.targetId, audioUrl, muted: true, played: false, reason: "muted" });
    return false;
  }

  targetPopPlayedTargetIds.add(hit.targetId);
  targetPopPlayCount += 1;
  playPopOnSharedElement(hit.targetId, audioUrl, false);
  return true;
}

export function resetRasqDemoSfxForTests(): void {
  stopAllRasqDemoTargetPopPlayback();
  targetPopPlayCount = 0;
  targetPopPlayedTargetIds.clear();
  targetPopAudioUnlocked = false;
  popAudioElement = null;
}

export function __testOnlyReleaseTargetPopDedupe(targetId: string): void {
  releaseConfirmedTargetDedupe(targetId);
}
