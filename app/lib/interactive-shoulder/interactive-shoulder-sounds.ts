export type InteractiveShoulderSoundCue =
  | "countdown"
  | "sessionStart"
  | "targetHit"
  | "repetition"
  | "blockComplete"
  | "sessionComplete";

type SoundPreferences = {
  muted: boolean;
};

const SESSION_MUTE_KEY = "rasq:is-shoulder-sound-muted";

function readMutedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMutedPreference(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function createAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  durationMs: number,
  gainPeak = 0.06,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + durationMs / 1000 + 0.02);
}

export function createInteractiveShoulderSoundPlayer(reducedMotion: boolean) {
  let ctx: AudioContext | null = null;
  const prefs: SoundPreferences = { muted: readMutedPreference() };

  function ensureContext(): AudioContext | null {
    if (prefs.muted || reducedMotion) return null;
    if (!ctx) ctx = createAudioContext();
    if (ctx?.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  }

  function play(cue: InteractiveShoulderSoundCue): void {
    const audio = ensureContext();
    if (!audio) return;
    switch (cue) {
      case "countdown":
        playTone(audio, 440, 90, 0.05);
        break;
      case "sessionStart":
        playTone(audio, 523, 140, 0.06);
        break;
      case "targetHit":
        playTone(audio, 659, 120, 0.055);
        break;
      case "repetition":
        playTone(audio, 587, 100, 0.05);
        break;
      case "blockComplete":
        playTone(audio, 392, 180, 0.055);
        break;
      case "sessionComplete":
        playTone(audio, 349, 220, 0.06);
        break;
      default:
        break;
    }
  }

  return {
    play,
    isMuted: () => prefs.muted,
    setMuted: (muted: boolean) => {
      prefs.muted = muted;
      writeMutedPreference(muted);
    },
    toggleMuted: () => {
      prefs.muted = !prefs.muted;
      writeMutedPreference(prefs.muted);
      return prefs.muted;
    },
  };
}

export type InteractiveShoulderSoundPlayer = ReturnType<typeof createInteractiveShoulderSoundPlayer>;
