/**
 * PNF D1 block completion chime — once after the final repetition only.
 */

import { getRasqDemoVoiceMuted } from "./demo-voice-audio";

export const RASQ_DEMO_PNF_ENDPOINT_SFX_PATH = "/audio/demo/pnf-endpoint-en.mp3";
export const RASQ_DEMO_PNF_ENDPOINT_SFX_VERSION = "2";

/** Slightly clearer final completion — still below spoken guidance peak. */
export const RASQ_DEMO_PNF_ENDPOINT_PLAYBACK_VOLUME = 0.31;

function canUseHtmlAudio(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as { Audio?: typeof Audio }).Audio !== "undefined";
}

function isDevLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

let endpointAudioElement: HTMLAudioElement | null = null;
let pnfEndpointAudioUnlocked = false;
let pnfEndpointPlayCount = 0;
let pnfBlockCompletionChimePlayed = false;

export function rasqDemoPnfEndpointPublicSrc(): string {
  return `${RASQ_DEMO_PNF_ENDPOINT_SFX_PATH}?v=${RASQ_DEMO_PNF_ENDPOINT_SFX_VERSION}`;
}

export function getRasqDemoPnfEndpointPlayCountForTests(): number {
  return pnfEndpointPlayCount;
}

export function hasRasqDemoPnfBlockCompletionChimePlayedForTests(): boolean {
  return pnfBlockCompletionChimePlayed;
}

export function getRasqDemoSharedPnfEndpointAudioElementForTests(): HTMLAudioElement | null {
  return endpointAudioElement;
}

export function isRasqDemoPnfEndpointAudioUnlockedForTests(): boolean {
  return pnfEndpointAudioUnlocked;
}

export function resetRasqDemoPnfEndpointPlayedRepetitions(): void {
  pnfBlockCompletionChimePlayed = false;
}

function logRasqDemoPnfEndpoint(payload: Record<string, unknown>): void {
  if (!isDevLoggingEnabled()) return;
  console.info("[rasq-demo-pnf-endpoint]", payload);
}

function logEndpointAudioElementState(
  audio: HTMLAudioElement,
  extra: Record<string, unknown>,
): void {
  if (!isDevLoggingEnabled()) return;
  logRasqDemoPnfEndpoint({
    ...extra,
    readyState: audio.readyState,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    elementMuted: audio.muted,
    volume: audio.volume,
    currentTime: audio.currentTime,
    src: audio.currentSrc || audio.src,
  });
}

function ensureEndpointAudioElement(): HTMLAudioElement | null {
  if (!canUseHtmlAudio()) return null;
  const src = rasqDemoPnfEndpointPublicSrc();
  if (!endpointAudioElement) {
    const AudioCtor = (globalThis as { Audio: typeof Audio }).Audio;
    endpointAudioElement = new AudioCtor(src);
    endpointAudioElement.preload = "auto";
    endpointAudioElement.crossOrigin = "anonymous";
    endpointAudioElement.load();
  } else if (!endpointAudioElement.src.includes(RASQ_DEMO_PNF_ENDPOINT_SFX_PATH)) {
    endpointAudioElement.src = src;
    endpointAudioElement.load();
  }
  return endpointAudioElement;
}

export function unlockRasqDemoPnfEndpointAudio(): void {
  const audio = ensureEndpointAudioElement();
  if (!audio) return;
  const savedVolume = audio.volume;
  audio.muted = false;
  audio.volume = 0.001;
  audio.currentTime = 0;
  logEndpointAudioElementState(audio, { event: "audio-unlock-attempt" });

  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    audio.volume = savedVolume;
    logRasqDemoPnfEndpoint({
      audioUrl: rasqDemoPnfEndpointPublicSrc(),
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
      pnfEndpointAudioUnlocked = true;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = RASQ_DEMO_PNF_ENDPOINT_PLAYBACK_VOLUME;
      logEndpointAudioElementState(audio, { event: "audio-unlock", ok: true, played: true });
    })
    .catch((error: unknown) => {
      audio.volume = savedVolume;
      logRasqDemoPnfEndpoint({
        audioUrl: rasqDemoPnfEndpointPublicSrc(),
        muted: getRasqDemoVoiceMuted(),
        played: false,
        event: "audio-unlock",
        ok: false,
        reason: "unlock-rejected",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function stopAllRasqDemoPnfEndpointPlayback(): void {
  if (!endpointAudioElement) return;
  try {
    endpointAudioElement.pause();
    endpointAudioElement.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function playEndpointOnSharedElement(
  audioUrl: string,
  muted: boolean,
  volume: number,
  onPlayRejected: () => void,
): void {
  const audio = ensureEndpointAudioElement();
  if (!audio) {
    logRasqDemoPnfEndpoint({ audioUrl, muted, played: false, reason: "no-html-audio" });
    return;
  }

  audio.muted = false;
  audio.volume = volume;
  audio.currentTime = 0;
  logEndpointAudioElementState(audio, { audioUrl, muted, volume, event: "play-attempt" });

  const playPromise = audio.play();
  if (!playPromise || typeof playPromise.then !== "function") {
    logRasqDemoPnfEndpoint({ audioUrl, muted, played: false, reason: "play-not-supported" });
    return;
  }

  void playPromise
    .then(() => {
      logEndpointAudioElementState(audio, { audioUrl, muted, played: true, playResult: "resolved" });
    })
    .catch((error: unknown) => {
      onPlayRejected();
      logEndpointAudioElementState(audio, {
        audioUrl,
        muted,
        played: false,
        playResult: "rejected",
        reason: pnfEndpointAudioUnlocked ? "play-rejected" : "autoplay-not-unlocked",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function playRasqDemoPnfFinalRepetitionChimeIfComplete(input: {
  repetitionNumber: number;
  prescribedRepetitions: number;
}): boolean {
  const audioUrl = rasqDemoPnfEndpointPublicSrc();
  const muted = getRasqDemoVoiceMuted();

  if (input.repetitionNumber !== input.prescribedRepetitions) {
    logRasqDemoPnfEndpoint({
      audioUrl,
      muted,
      played: false,
      reason: "not-final-repetition",
      repetitionNumber: input.repetitionNumber,
      prescribedRepetitions: input.prescribedRepetitions,
    });
    return false;
  }

  if (pnfBlockCompletionChimePlayed) {
    logRasqDemoPnfEndpoint({ audioUrl, muted, played: false, reason: "already-played" });
    return false;
  }
  if (muted) {
    logRasqDemoPnfEndpoint({ audioUrl, muted: true, played: false, reason: "muted" });
    return false;
  }

  pnfBlockCompletionChimePlayed = true;
  pnfEndpointPlayCount += 1;
  playEndpointOnSharedElement(audioUrl, false, RASQ_DEMO_PNF_ENDPOINT_PLAYBACK_VOLUME, () => {
    pnfBlockCompletionChimePlayed = false;
  });
  return true;
}

export function resetRasqDemoPnfEndpointSfxForTests(): void {
  stopAllRasqDemoPnfEndpointPlayback();
  pnfEndpointPlayCount = 0;
  pnfBlockCompletionChimePlayed = false;
  pnfEndpointAudioUnlocked = false;
  endpointAudioElement = null;
}
