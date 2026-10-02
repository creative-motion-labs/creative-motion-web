/**
 * Remote battery voice — uses the same prerecorded booth HTMLAudio pipeline as Interactive Shoulder.
 */

import {
  resetBoothVoiceGuidance,
  speakBoothVoiceCue,
  stopBoothVoicePlayback,
} from "@/app/lib/booth/booth-voice-guidance";
import { isRemoteBatteryBoothVoiceCue } from "@/app/lib/booth/booth-voice-manifest";
import { getPrerecordedVoiceAudioProviderId } from "@/app/lib/booth/booth-voice-provider";
import { resolveBatteryBoothVoiceCue } from "./battery-booth-voice-map";
import {
  getBatteryArmInViewCopy,
  getBatteryAssessmentCompleteCopy,
  getBatteryDoneCopy,
  getBatteryMovementSmoothCopy,
  getBatteryRepCountCopy,
  getBatteryRestBeforeNextCopy,
  getBatteryReturnToStartCopy,
  getBatterySideRepositionCopy,
  getBatteryStandStillCopy,
  getBatteryTestStartVoiceCopy,
  getBatteryTrackingLostCopy,
  type BatteryVoiceLang,
} from "./battery-voice-copy";
import type { BatterySpeechCue } from "./battery-speech-cues";
import type { RemoteUpperLimbBatterySide, RemoteUpperLimbBatteryTestId } from "./types";

export type { BatterySpeechCue } from "./battery-speech-cues";

let batteryVoiceLang: BatteryVoiceLang = "en";

export function setBatterySpeechLang(lang: BatteryVoiceLang): void {
  batteryVoiceLang = lang;
}

export function getBatterySpeechLang(): BatteryVoiceLang {
  return batteryVoiceLang;
}

export function getBatteryVoiceAudioProviderId(): string {
  return getPrerecordedVoiceAudioProviderId();
}

/** @deprecated Manifest scripts only — playback uses booth MP3 assets, not TTS. */
export function resolveBatterySpeechText(
  cue: BatterySpeechCue,
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = batteryVoiceLang,
): string {
  switch (cue) {
    case "stand-still":
      return getBatteryStandStillCopy(lang);
    case "get-ready":
      return "";
    case "face-camera-setup":
      return getBatteryArmInViewCopy(lang);
    case "reposition-side":
    case "functional-side-setup":
      return getBatterySideRepositionCopy(side, lang);
    case "tracking-lost":
      return getBatteryTrackingLostCopy(lang);
    case "movement-smooth-comfort":
      return getBatteryMovementSmoothCopy(lang);
    case "rest-before-next":
      return getBatteryRestBeforeNextCopy(lang);
    case "countdown-three":
      return lang === "ar" ? "ثلاثة." : "Three.";
    case "countdown-two":
      return lang === "ar" ? "اثنان." : "Two.";
    case "countdown-one":
      return lang === "ar" ? "واحد." : "One.";
    case "abduction-raise":
      return getBatteryTestStartVoiceCopy("shoulderAbduction", side, lang);
    case "flexion-raise":
      return getBatteryTestStartVoiceCopy("shoulderFlexion", side, lang);
    case "elbow-bend":
      return getBatteryTestStartVoiceCopy("elbowFlexion", side, lang);
    case "functional-reach":
      return getBatteryTestStartVoiceCopy("functionalReach", side, lang);
    case "abduction-return":
    case "flexion-return":
    case "elbow-straighten":
    case "functional-return":
      return getBatteryReturnToStartCopy(lang);
    case "functional-arm-height":
    case "functional-feet-still":
    case "test-completed":
      return "";
    case "functional-done":
      return getBatteryDoneCopy(lang);
    case "rep-one":
      return getBatteryRepCountCopy(1, lang) ?? "";
    case "rep-two":
      return getBatteryRepCountCopy(2, lang) ?? "";
    case "rep-three":
      return getBatteryRepCountCopy(3, lang) ?? "";
    case "assessment-completed":
      return getBatteryAssessmentCompleteCopy(lang);
  }
}

export function resolveBatteryRepCountSpeechCue(
  completed: number,
  requiredReps: number,
): BatterySpeechCue | null {
  if (completed < 1 || completed > requiredReps) return null;
  if (requiredReps === 1) return "functional-done";
  if (completed === 1) return "rep-one";
  if (completed === 2) return "rep-two";
  if (completed === 3) return "rep-three";
  return null;
}

export function resolveBatteryTestStartSpeechCue(
  testId: RemoteUpperLimbBatteryTestId,
): BatterySpeechCue {
  switch (testId) {
    case "shoulderAbduction":
      return "abduction-raise";
    case "shoulderFlexion":
      return "flexion-raise";
    case "elbowFlexion":
      return "elbow-bend";
    case "functionalReach":
      return "functional-reach";
  }
}

export function resolveBatteryMovementSpeechCue(_input: {
  testId: RemoteUpperLimbBatteryTestId;
  phase: string;
  hasReachedPeak?: boolean;
}): BatterySpeechCue | null {
  return null;
}

export function cancelBatterySpeech(): void {
  stopBoothVoicePlayback();
}

export function speakBatteryTestCompleted(
  _testId: RemoteUpperLimbBatteryTestId,
  _side: RemoteUpperLimbBatterySide,
): void {
  // No extra per-test completion line in Pilot 1.
}

export function speakBatteryCue(
  cue: BatterySpeechCue,
  side: RemoteUpperLimbBatterySide,
  scope = "global",
  options?: { allowRepeat?: boolean; muted?: boolean },
): void {
  const boothCue = resolveBatteryBoothVoiceCue(cue, side, batteryVoiceLang);
  if (!boothCue || !isRemoteBatteryBoothVoiceCue(boothCue)) return;

  const boothScope = `remote-upper-limb-battery:${scope}:${side}`;
  const isTrackingLost = cue === "tracking-lost";

  speakBoothVoiceCue(boothCue, boothScope, {
    muted: options?.muted,
    allowRepeatKey: options?.allowRepeat ?? isTrackingLost,
    skipCooldown: isTrackingLost,
  });
}

export function resetBatterySpeech(): void {
  resetBoothVoiceGuidance();
}

export function resetBatterySpeechForTest(cancelQueued = true): void {
  if (cancelQueued) {
    resetBoothVoiceGuidance();
  } else {
    stopBoothVoicePlayback();
  }
}
