"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getRasqDemoVoiceLastCue,
  getRasqDemoVoiceMuted,
  replayRasqDemoVoiceLastCue,
  setRasqDemoVoiceMuted,
  toggleRasqDemoVoiceMuted,
} from "@/app/lib/rasq-demo/demo-voice-audio";
import { RASQ_DEMO_VOICE_CUE_MANIFEST } from "@/app/lib/rasq-demo/demo-voice-manifest";
import { unlockRasqDemoAudioFromUserGesture } from "@/app/lib/rasq-demo/demo-audio-unlock";

let voiceControlsRevision = 0;
const voiceControlListeners = new Set<() => void>();

export function notifyRasqDemoVoiceControlsChanged(): void {
  voiceControlsRevision += 1;
  for (const listener of voiceControlListeners) {
    listener();
  }
}

function subscribeVoiceControls(listener: () => void): () => void {
  voiceControlListeners.add(listener);
  return () => voiceControlListeners.delete(listener);
}

function getVoiceControlsSnapshot(): number {
  return voiceControlsRevision;
}

export function RasqDemoVoiceControls() {
  useSyncExternalStore(subscribeVoiceControls, getVoiceControlsSnapshot, getVoiceControlsSnapshot);

  const muted = getRasqDemoVoiceMuted();
  const lastCue = getRasqDemoVoiceLastCue();
  const lastLabel = lastCue ? RASQ_DEMO_VOICE_CUE_MANIFEST[lastCue].label : "None yet";

  const handleMuteToggle = useCallback(() => {
    unlockRasqDemoAudioFromUserGesture();
    toggleRasqDemoVoiceMuted();
    notifyRasqDemoVoiceControlsChanged();
  }, []);

  const handleReplay = useCallback(() => {
    unlockRasqDemoAudioFromUserGesture();
    if (muted) {
      setRasqDemoVoiceMuted(false);
      notifyRasqDemoVoiceControlsChanged();
    }
    replayRasqDemoVoiceLastCue();
    notifyRasqDemoVoiceControlsChanged();
  }, [muted]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white px-3 py-2 text-sm shadow-sm">
      <span className="text-[#64748B]">
        Voice guidance: <span className="font-medium text-[#0F172A]">{lastLabel}</span>
      </span>
      <button
        type="button"
        className="rounded-[8px] border border-[#CBD5E1] px-3 py-1.5 font-medium text-[#334155] hover:bg-[#F8FAFC]"
        onClick={handleMuteToggle}
        aria-pressed={muted}
      >
        {muted ? "Unmute voice" : "Mute voice"}
      </button>
      <button
        type="button"
        className="rounded-[8px] border border-[#CBD5E1] px-3 py-1.5 font-medium text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-40"
        disabled={!lastCue}
        onClick={handleReplay}
      >
        Replay last cue
      </button>
    </div>
  );
}
