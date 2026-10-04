/**
 * Unlocks demo HTMLAudio paths after explicit user gestures (autoplay policy).
 */

import { unlockRasqDemoVoiceAudio } from "./demo-voice-audio";
import { unlockRasqDemoPnfEndpointAudio } from "./demo-pnf-endpoint-sfx";
import { unlockRasqDemoPnfRepetitionTickAudio } from "./demo-pnf-repetition-tick-sfx";
import { unlockRasqDemoTargetPopAudio } from "./demo-sfx-audio";

/** Call from Start demo, camera consent Continue, mute/replay — not from pose tracking. */
export function unlockRasqDemoAudioFromUserGesture(): void {
  unlockRasqDemoVoiceAudio();
  unlockRasqDemoTargetPopAudio();
  unlockRasqDemoPnfRepetitionTickAudio();
  unlockRasqDemoPnfEndpointAudio();
}
