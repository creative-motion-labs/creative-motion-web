import { REMOTE_BATTERY_BOOTH_VOICE_MANIFEST } from "@/app/lib/remote-upper-limb-battery/battery-booth-manifest";

export type BoothVoiceCueManifestEntry = {
  /** Filename under `public/audio/booth/`. */
  file: string;
  /** Spoken script used for licensed studio / TTS asset generation (not read at runtime). */
  script: string;
};

export const INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST = {
  "session-start": {
    file: "session-start.mp3",
    script: "Let's begin. Move comfortably and at your own pace.",
  },
  "during-movement": {
    file: "during-movement.mp3",
    script: "Reach towards the light. Keep your shoulder relaxed.",
  },
  "successful-reach": {
    file: "successful-reach.mp3",
    script: "Nice reach. Well done.",
  },
  "session-complete": {
    file: "session-complete.mp3",
    script: "Well done. Your session is complete.",
  },
  "session-cool-down": {
    file: "session-cool-down.mp3",
    script: "Great work. Let your arm rest and breathe comfortably.",
  },
  "inactivity-take-your-time": {
    file: "inactivity-take-your-time.mp3",
    script: "Take your time. When you're ready, try reaching for the next light.",
  },
  "inactivity-gentle-reach": {
    file: "inactivity-gentle-reach.mp3",
    script: "You're doing well. A gentle reach toward the light is enough.",
  },
} satisfies Record<string, BoothVoiceCueManifestEntry>;

export type InteractiveShoulderBoothVoiceCue = keyof typeof INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST;
export type RemoteBatteryBoothVoiceCue = keyof typeof REMOTE_BATTERY_BOOTH_VOICE_MANIFEST;

export type BoothVoiceCue = InteractiveShoulderBoothVoiceCue | RemoteBatteryBoothVoiceCue;

export const BOOTH_VOICE_CUE_MANIFEST: Record<BoothVoiceCue, BoothVoiceCueManifestEntry> = {
  ...INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
  ...REMOTE_BATTERY_BOOTH_VOICE_MANIFEST,
};

export const BOOTH_VOICE_CUE_IDS = Object.keys(BOOTH_VOICE_CUE_MANIFEST) as BoothVoiceCue[];

export const REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS = Object.keys(
  REMOTE_BATTERY_BOOTH_VOICE_MANIFEST,
) as RemoteBatteryBoothVoiceCue[];

/** Bump when regenerating booth MP3s so browsers do not reuse stale cached audio. */
export const BOOTH_VOICE_ASSET_VERSION = "6";

const INTERACTIVE_SHOULDER_BOOTH_VOICE_CUE_IDS = Object.keys(
  INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
) as InteractiveShoulderBoothVoiceCue[];

export function isInteractiveShoulderBoothVoiceCue(
  cue: BoothVoiceCue,
): cue is InteractiveShoulderBoothVoiceCue {
  return (INTERACTIVE_SHOULDER_BOOTH_VOICE_CUE_IDS as readonly string[]).includes(cue);
}

export function isRemoteBatteryBoothVoiceCue(cue: BoothVoiceCue): cue is RemoteBatteryBoothVoiceCue {
  return (REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS as readonly string[]).includes(cue);
}

export function boothVoicePublicSrc(cue: BoothVoiceCue): string {
  const file = BOOTH_VOICE_CUE_MANIFEST[cue].file;
  return `/audio/booth/${file}?v=${BOOTH_VOICE_ASSET_VERSION}`;
}
