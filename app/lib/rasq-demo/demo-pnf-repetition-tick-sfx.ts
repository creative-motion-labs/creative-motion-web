/**
 * Subtle PNF repetition endpoint tick — once per confirmed repetition, under spoken guidance.
 */

import { getRasqDemoVoiceMuted } from "./demo-voice-audio";

export const RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH = "/audio/demo/pnf-repetition-tick-en.mp3";
export const RASQ_DEMO_PNF_REPETITION_TICK_SFX_VERSION = "1";

/** Background tick — respects demo mute; kept below voice level. */
export const RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME = 0.18;

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

function isDevLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

let tickAudioElement: HTMLAudioElement | null = null;
let tickAudioUnlocked = false;
let tickPlayCount = 0;
const tickPlayedRepetitionNumbers = new Set<number>();

export function rasqDemoPnfRepetitionTickPublicSrc(): string {
  return `${RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH}?v=${RASQ_DEMO_PNF_REPETITION_TICK_SFX_VERSION}`;
}

export function getRasqDemoPnfRepetitionTickPlayCountForTests(): number {
  return tickPlayCount;
}

export function getRasqDemoPnfRepetitionTickPlayedForTests(): readonly number[] {
  return [...tickPlayedRepetitionNumbers].sort((a, b) => a - b);
}

export function resetRasqDemoPnfRepetitionTickPlayed(): void {
  tickPlayedRepetitionNumbers.clear();
}

function logTick(payload: Record<string, unknown>): void {
  if (!isDevLoggingEnabled()) return;
  console.info("[rasq-demo-pnf-repetition-tick]", payload);
}

function ensureTickAudioElement(): HTMLAudioElement | null {
  if (!canUseHtmlAudio()) return null;
  const src = rasqDemoPnfRepetitionTickPublicSrc();
  if (!tickAudioElement) {
    const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
    tickAudioElement = new AudioCtor(src);
    tickAudioElement.preload = "auto";
    tickAudioElement.crossOrigin = "anonymous";
    tickAudioElement.load();
  } else if (!tickAudioElement.src.includes(RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH)) {
    tickAudioElement.src = src;
    tickAudioElement.load();
  }
  return tickAudioElement;
}

export function unlockRasqDemoPnfRepetitionTickAudio(): void {
  const audio = ensureTickAudioElement();
  if (!audio) return;
  const savedVolume = audio.volume;
  audio.muted = false;
  audio.volume = 0.001;
  audio.currentTime = 0;

  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    audio.volume = savedVolume;
    logTick({ played: false, event: "audio-unlock", reason: "play-not-supported" });
    return;
  }

  void playPromise
    .then(() => {
      tickAudioUnlocked = true;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME;
      logTick({ played: true, event: "audio-unlock", ok: true });
    })
    .catch((error: unknown) => {
      audio.volume = savedVolume;
      logTick({
        played: false,
        event: "audio-unlock",
        reason: "unlock-rejected",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function stopAllRasqDemoPnfRepetitionTickPlayback(): void {
  if (!tickAudioElement) return;
  try {
    tickAudioElement.pause();
    tickAudioElement.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function playTickOnSharedElement(repetitionNumber: number, audioUrl: string, muted: boolean): void {
  const audio = ensureTickAudioElement();
  if (!audio) {
    logTick({ repetitionNumber, audioUrl, muted, played: false, reason: "no-html-audio" });
    return;
  }

  audio.muted = false;
  audio.volume = RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME;
  audio.currentTime = 0;
  logTick({ repetitionNumber, audioUrl, muted, event: "play-attempt" });

  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    logTick({ repetitionNumber, audioUrl, muted, played: false, reason: "play-not-supported" });
    return;
  }

  void playPromise
    .then(() => {
      logTick({ repetitionNumber, audioUrl, muted, played: true, playResult: "resolved" });
    })
    .catch((error: unknown) => {
      tickPlayedRepetitionNumbers.delete(repetitionNumber);
      logTick({
        repetitionNumber,
        audioUrl,
        muted,
        played: false,
        playResult: "rejected",
        reason: tickAudioUnlocked ? "play-rejected" : "autoplay-not-unlocked",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function playRasqDemoPnfRepetitionEndpointTick(input: { repetitionNumber: number }): boolean {
  const audioUrl = rasqDemoPnfRepetitionTickPublicSrc();
  const muted = getRasqDemoVoiceMuted();
  const { repetitionNumber } = input;

  if (repetitionNumber < 1) {
    logTick({ repetitionNumber, audioUrl, muted, played: false, reason: "invalid-repetition" });
    return false;
  }

  if (tickPlayedRepetitionNumbers.has(repetitionNumber)) {
    logTick({ repetitionNumber, audioUrl, muted, played: false, reason: "duplicate" });
    return false;
  }
  if (muted) {
    logTick({ repetitionNumber, audioUrl, muted: true, played: false, reason: "muted" });
    return false;
  }

  tickPlayedRepetitionNumbers.add(repetitionNumber);
  tickPlayCount += 1;
  playTickOnSharedElement(repetitionNumber, audioUrl, false);
  return true;
}

export function resetRasqDemoPnfRepetitionTickSfxForTests(): void {
  stopAllRasqDemoPnfRepetitionTickPlayback();
  tickPlayCount = 0;
  tickPlayedRepetitionNumbers.clear();
  tickAudioUnlocked = false;
  tickAudioElement = null;
}
