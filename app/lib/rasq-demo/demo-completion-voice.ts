/**
 * Session completion narration — once per demo run, after full session completes.
 */

import { isRasqDemoSpeechGuidanceEnabled } from "./demo-page-settings";
import { getRasqDemoVoiceMuted, playRasqDemoVoiceCue } from "./demo-voice-audio";
import { rasqDemoVoicePublicSrc } from "./demo-voice-manifest";

function isDevLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

let sessionCompletionVoicePlayed = false;

export function resetRasqDemoSessionCompletionVoice(): void {
  sessionCompletionVoicePlayed = false;
}

export function hasRasqDemoSessionCompletionVoicePlayedForTests(): boolean {
  return sessionCompletionVoicePlayed;
}

function logCompletionVoice(payload: { played: boolean; audioUrl: string; error?: string; reason?: string }): void {
  if (!isDevLoggingEnabled()) return;
  console.info("[rasq-demo-completion-voice]", payload);
}

/** Plays completion cue exactly once for the current demo session (full session complete only). */
export function playRasqDemoSessionCompletionVoice(): boolean {
  const audioUrl = rasqDemoVoicePublicSrc("completion");

  if (!isRasqDemoSpeechGuidanceEnabled()) {
    logCompletionVoice({ played: false, audioUrl, reason: "speech-disabled" });
    return false;
  }

  if (sessionCompletionVoicePlayed) {
    logCompletionVoice({ played: false, audioUrl, reason: "already-played" });
    return false;
  }
  if (getRasqDemoVoiceMuted()) {
    logCompletionVoice({ played: false, audioUrl, reason: "muted" });
    return false;
  }

  sessionCompletionVoicePlayed = true;
  let playError: string | undefined;
  const started = playRasqDemoVoiceCue("completion", () => {
    playError = "play-rejected";
    logCompletionVoice({ played: false, audioUrl, error: playError });
  });

  logCompletionVoice({ played: started, audioUrl, error: playError });
  return true;
}
