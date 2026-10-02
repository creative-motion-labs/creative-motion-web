/**
 * ElevenLabs generation profile for booth prerecorded voice assets.
 *
 * Derived from forensic checks against existing Interactive Shoulder MP3s under
 * `public/audio/booth/` (file-size fingerprinting against `scripts/generate-booth-voice-assets.ts`
 * candidates; first IS batch used Sarah `EXAVITQu4vr4xnSDxMaL` per initial generation script).
 *
 * Calm booth delivery: `mp3_44100_128`, higher stability, zero style exaggeration.
 * English uses turbo; Arabic battery lines use multilingual v2 with the same voice id.
 */

/** ElevenLabs Sarah — female calm booth voice for Interactive Shoulder and battery MP3 generation. */
export const INTERACTIVE_SHOULDER_BOOTH_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export const BOOTH_VOICE_TTS_OUTPUT_FORMAT = "mp3_44100_128" as const;

export const BOOTH_VOICE_TTS_VOICE_SETTINGS = {
  stability: 0.75,
  similarity_boost: 0.85,
  style: 0,
  use_speaker_boost: true,
} as const;

export const BOOTH_VOICE_TTS_MODEL_EN = "eleven_turbo_v2_5" as const;
export const BOOTH_VOICE_TTS_MODEL_AR = "eleven_multilingual_v2" as const;

export type BoothVoiceTtsLanguage = "en" | "ar";

export function resolveBoothVoiceTtsModel(lang: BoothVoiceTtsLanguage): string {
  return lang === "ar" ? BOOTH_VOICE_TTS_MODEL_AR : BOOTH_VOICE_TTS_MODEL_EN;
}

export function resolveBoothVoiceCueLanguage(cueId: string): BoothVoiceTtsLanguage {
  return cueId.endsWith("-ar") ? "ar" : "en";
}
