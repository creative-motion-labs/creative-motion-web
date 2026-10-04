/**
 * Public demo prerecorded voice — HTMLAudio only, isolated from booth/battery assets.
 */

import type { RasqDemoVoiceCue } from "./demo-voice-manifest";
import { rasqDemoVoicePublicSrc } from "./demo-voice-manifest";

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

let currentPlayback: HTMLAudioElement | null = null;
let playbackGeneration = 0;
let lastPlayedCue: RasqDemoVoiceCue | null = null;
let muted = false;
let voiceAudioUnlocked = false;

function isDevLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isRasqDemoVoiceAudioUnlockedForTests(): boolean {
  return voiceAudioUnlocked;
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

export function getRasqDemoVoiceMuted(): boolean {
  return muted;
}

export function setRasqDemoVoiceMuted(nextMuted: boolean): boolean {
  muted = nextMuted;
  if (muted) {
    releaseCurrentPlayback();
    void import("./demo-sfx-audio").then((module) => {
      module.stopAllRasqDemoTargetPopPlayback();
    });
    void import("./demo-pnf-endpoint-sfx").then((module) => {
      module.stopAllRasqDemoPnfEndpointPlayback();
    });
    void import("./demo-pnf-repetition-tick-sfx").then((module) => {
      module.stopAllRasqDemoPnfRepetitionTickPlayback();
    });
  }
  return muted;
}

export function toggleRasqDemoVoiceMuted(): boolean {
  return setRasqDemoVoiceMuted(!muted);
}

export function getRasqDemoVoiceLastCue(): RasqDemoVoiceCue | null {
  return lastPlayedCue;
}

export function stopRasqDemoVoicePlayback(): void {
  releaseCurrentPlayback();
}

/** Unlocks narration HTMLAudio after a user gesture (separate from target SFX element). */
export function unlockRasqDemoVoiceAudio(): void {
  if (!canUseHtmlAudio()) return;
  const src = rasqDemoVoicePublicSrc("welcome");
  const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
  const audio = new AudioCtor(src);
  audio.preload = "auto";
  audio.volume = 0.001;
  audio.currentTime = 0;
  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") return;
  void playPromise
    .then(() => {
      voiceAudioUnlocked = true;
      audio.pause();
      if (isDevLoggingEnabled()) {
        console.info("[rasq-demo-completion-voice]", { event: "voice-audio-unlock", ok: true, audioUrl: src });
      }
    })
    .catch((error: unknown) => {
      if (isDevLoggingEnabled()) {
        console.info("[rasq-demo-completion-voice]", {
          event: "voice-audio-unlock",
          ok: false,
          audioUrl: src,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
}

export function replayRasqDemoVoiceLastCue(): boolean {
  if (!lastPlayedCue || muted) return false;
  return playRasqDemoVoiceCue(lastPlayedCue);
}

export function playRasqDemoVoiceCue(cue: RasqDemoVoiceCue, onPlaybackFailed?: () => void): boolean {
  if (!canUseHtmlAudio() || muted) return false;
  const src = rasqDemoVoicePublicSrc(cue);
  releaseCurrentPlayback();
  lastPlayedCue = cue;
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

/** Test-only: reset module playback state. */
export function resetRasqDemoVoiceAudioForTests(): void {
  stopRasqDemoVoicePlayback();
  lastPlayedCue = null;
  muted = false;
  voiceAudioUnlocked = false;
}
