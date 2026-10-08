/**
 * Local prerecorded booth voice playback — HTMLAudio only, no network at session runtime.
 */

import type { BoothVoiceCue } from "./booth-voice-manifest";
import {
  BOOTH_VOICE_CUE_IDS,
  INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
  isRemoteBatteryBoothVoiceCue,
  REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS,
  boothVoicePublicSrc,
  type InteractiveShoulderBoothVoiceCue,
  type RemoteBatteryBoothVoiceCue,
} from "./booth-voice-manifest";

const INTERACTIVE_SHOULDER_BOOTH_VOICE_CUE_IDS = Object.keys(
  INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
) as InteractiveShoulderBoothVoiceCue[];

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

const preloadedByCue = new Map<BoothVoiceCue, HTMLAudioElement>();
let currentPlayback: HTMLAudioElement | null = null;
let detachedPlayback: HTMLAudioElement | null = null;
/** Incremented on every stop/new play so in-flight `play()` promises cannot overlap. */
let playbackGeneration = 0;

export function isBoothVoicePlaybackActive(): boolean {
  if (!currentPlayback) return false;
  return !currentPlayback.paused && !currentPlayback.ended;
}

export function isDetachedBoothVoicePlaybackActive(): boolean {
  if (!detachedPlayback) return false;
  return !detachedPlayback.paused && !detachedPlayback.ended;
}

function releaseDetachedPlayback(): void {
  if (!detachedPlayback) return;
  try {
    detachedPlayback.pause();
    detachedPlayback.currentTime = 0;
    detachedPlayback.removeAttribute("src");
    detachedPlayback.load();
  } catch {
    /* ignore */
  }
  detachedPlayback = null;
}

function releaseCurrentPlayback(): void {
  playbackGeneration += 1;
  if (!currentPlayback) return;
  try {
    currentPlayback.pause();
    currentPlayback.currentTime = 0;
    currentPlayback.removeAttribute("src");
    currentPlayback.load();
  } catch {
    /* ignore */
  }
  currentPlayback = null;
}

export function preloadBoothVoiceAssets(): void {
  if (!canUseHtmlAudio()) return;
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  for (const cue of BOOTH_VOICE_CUE_IDS) {
    if (preloadedByCue.has(cue)) continue;
    const src = boothVoicePublicSrc(cue);
    const audio = new AudioCtor(src);
    audio.preload = "auto";
    preloadedByCue.set(cue, audio);
  }
}

/** Catalog Interactive Shoulder — Sarah-profile session guidance clips only (no battery assets). */
export function preloadInteractiveShoulderBoothVoiceAssets(): void {
  if (!canUseHtmlAudio()) return;
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  for (const cue of INTERACTIVE_SHOULDER_BOOTH_VOICE_CUE_IDS) {
    if (preloadedByCue.has(cue)) continue;
    const src = boothVoicePublicSrc(cue);
    const audio = new AudioCtor(src);
    audio.preload = "auto";
    preloadedByCue.set(cue, audio);
  }
}

/** Remote Upper-Limb Battery — only Sarah-profile `battery-*.mp3` assets (no IS session clips). */
export function preloadBatteryBoothVoiceAssets(): void {
  if (!canUseHtmlAudio()) return;
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  for (const cue of REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS) {
    if (preloadedByCue.has(cue)) continue;
    const src = boothVoicePublicSrc(cue);
    const audio = new AudioCtor(src);
    audio.preload = "auto";
    preloadedByCue.set(cue, audio);
  }
}

export function stopBoothVoicePlayback(): void {
  releaseCurrentPlayback();
}

/** Stops session-completion (and other detached) clips — not invoked by routine managed-cue stops. */
export function stopDetachedBoothVoicePlayback(): void {
  releaseDetachedPlayback();
}

export function stopAllBoothVoicePlayback(): void {
  stopBoothVoicePlayback();
  stopDetachedBoothVoicePlayback();
}

export type PlayBoothVoiceAssetOptions = {
  /** When false, returns false instead of interrupting an in-flight managed clip. */
  interruptCurrent?: boolean;
};

export function playBoothVoiceAsset(
  cue: BoothVoiceCue,
  onPlaybackFailed?: () => void,
  options?: PlayBoothVoiceAssetOptions,
): boolean {
  if (!canUseHtmlAudio()) return false;
  const interruptCurrent = options?.interruptCurrent ?? true;
  if (!interruptCurrent && isBoothVoicePlaybackActive()) {
    return false;
  }
  const src = boothVoicePublicSrc(cue);
  releaseCurrentPlayback();
  const generation = playbackGeneration;
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  const audio = new AudioCtor(src);
  audio.preload = "auto";
  currentPlayback = audio;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    void playPromise.catch(() => {
      if (generation !== playbackGeneration) return;
      if (currentPlayback === audio) {
        currentPlayback = null;
      }
      onPlaybackFailed?.();
    });
  }
  return true;
}

/** Plays outside managed `currentPlayback` so parent UI can unmount without truncating (e.g. session-complete). */
export function playBoothVoiceAssetDetached(cue: BoothVoiceCue, onPlaybackFailed?: () => void): boolean {
  if (!canUseHtmlAudio()) return false;
  releaseDetachedPlayback();
  const src = boothVoicePublicSrc(cue);
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  const audio = new AudioCtor(src);
  audio.preload = "auto";
  detachedPlayback = audio;
  const clearDetached = (): void => {
    if (detachedPlayback === audio) {
      detachedPlayback = null;
    }
  };
  if (typeof audio.addEventListener === "function") {
    audio.addEventListener("ended", clearDetached, { once: true });
  } else {
    audio.onended = clearDetached;
  }
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    void playPromise.catch(() => {
      if (detachedPlayback === audio) {
        detachedPlayback = null;
      }
      onPlaybackFailed?.();
    });
  }
  return true;
}

export function playRemoteBatteryBoothVoiceAsset(
  cue: RemoteBatteryBoothVoiceCue,
  onPlaybackFailed?: () => void,
): boolean {
  if (!isRemoteBatteryBoothVoiceCue(cue)) return false;
  return playBoothVoiceAsset(cue, onPlaybackFailed);
}

/** Test-only: reset module playback state without touching guidance cooldowns. */
export function resetBoothVoiceAudioPlaybackForTests(): void {
  stopAllBoothVoicePlayback();
  preloadedByCue.clear();
}
