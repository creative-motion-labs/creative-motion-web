import type { RasqDemoVoiceCue } from "./demo-voice-manifest";
import { isRasqDemoSpeechGuidanceEnabled } from "./demo-page-settings";
import { playRasqDemoVoiceCue } from "./demo-voice-audio";

type VoiceControlsNotifier = () => void;

let notifyControls: VoiceControlsNotifier | null = null;

export function registerRasqDemoVoiceControlsNotifier(notifier: VoiceControlsNotifier | null): void {
  notifyControls = notifier;
}

export function playRasqDemoGuidanceCue(cue: RasqDemoVoiceCue): void {
  if (!isRasqDemoSpeechGuidanceEnabled()) return;
  playRasqDemoVoiceCue(cue);
  notifyControls?.();
}
