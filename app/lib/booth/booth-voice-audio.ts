/**
 * Local prerecorded booth voice playback — HTMLAudio only, no network at session runtime.
 */

import type { BoothVoiceCue } from "./booth-voice-manifest";
import {
  BOOTH_VOICE_CUE_IDS,
  isRemoteBatteryBoothVoiceCue,
  REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS,
  boothVoicePublicSrc,
  type RemoteBatteryBoothVoiceCue,
} from "./booth-voice-manifest";

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

const preloadedByCue = new Map<BoothVoiceCue, HTMLAudioElement>();
let currentPlayback: HTMLAudioElement | null = null;
/** Incremented on every stop/new play so in-flight `play()` promises cannot overlap. */
let playbackGeneration = 0;

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

export function playBoothVoiceAsset(cue: BoothVoiceCue, onPlaybackFailed?: () => void): boolean {
  if (!canUseHtmlAudio()) return false;
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

export function playRemoteBatteryBoothVoiceAsset(
  cue: RemoteBatteryBoothVoiceCue,
  onPlaybackFailed?: () => void,
): boolean {
  if (!isRemoteBatteryBoothVoiceCue(cue)) return false;
  return playBoothVoiceAsset(cue, onPlaybackFailed);
}

/** Test-only: reset module playback state without touching guidance cooldowns. */
export function resetBoothVoiceAudioPlaybackForTests(): void {
  stopBoothVoicePlayback();
  preloadedByCue.clear();
}
