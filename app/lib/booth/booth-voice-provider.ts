/**
 * Shared prerecorded voice provider for Interactive Shoulder and Remote Upper-Limb Assessment.
 */
import { playBoothVoiceAsset, stopBoothVoicePlayback } from "./booth-voice-audio";

export const RASQ_PRERECORDED_VOICE_PROVIDER_ID = "booth-html-audio";

export function getPrerecordedVoiceAudioProviderId(): string {
  return RASQ_PRERECORDED_VOICE_PROVIDER_ID;
}

export function getPrerecordedVoicePlaybackFunctions(): {
  play: typeof playBoothVoiceAsset;
  stop: typeof stopBoothVoicePlayback;
} {
  return { play: playBoothVoiceAsset, stop: stopBoothVoicePlayback };
}
