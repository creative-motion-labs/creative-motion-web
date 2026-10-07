import type { RemoteBatteryBoothVoiceCue } from "@/app/lib/booth/booth-voice-manifest";
import type { BatteryVoiceLang } from "./battery-voice-copy";
import type { BatterySpeechCue } from "./battery-speech-cues";
import type { RemoteUpperLimbBatterySide } from "./types";

function langSuffix(lang: BatteryVoiceLang): "en" | "ar" {
  return lang === "ar" ? "ar" : "en";
}

function sideSuffix(side: RemoteUpperLimbBatterySide): "left" | "right" {
  return side;
}

export function resolveBatteryBoothVoiceCue(
  cue: BatterySpeechCue,
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): RemoteBatteryBoothVoiceCue | null {
  const L = langSuffix(lang);
  const S = sideSuffix(side);

  switch (cue) {
    case "face-camera-setup":
      return `battery-arm-in-view-${L}` as RemoteBatteryBoothVoiceCue;
    case "tracking-lost":
      return `battery-tracking-lost-${L}` as RemoteBatteryBoothVoiceCue;
    case "movement-smooth-comfort":
      return `battery-movement-smooth-${L}` as RemoteBatteryBoothVoiceCue;
    case "rest-before-next":
      return `battery-rest-before-next-${L}` as RemoteBatteryBoothVoiceCue;
    case "stand-still":
      return `battery-stand-still-${L}` as RemoteBatteryBoothVoiceCue;
    case "reposition-side":
    case "functional-side-setup":
    case "side-view-setup":
      return `battery-reposition-${S}-${L}` as RemoteBatteryBoothVoiceCue;
    case "abduction-raise":
      return `battery-abduction-raise-${S}-${L}` as RemoteBatteryBoothVoiceCue;
    case "flexion-raise":
      return `battery-flexion-raise-${S}-${L}` as RemoteBatteryBoothVoiceCue;
    case "elbow-bend":
      return `battery-elbow-bend-${S}-${L}` as RemoteBatteryBoothVoiceCue;
    case "functional-reach":
      return `battery-functional-reach-${S}-${L}` as RemoteBatteryBoothVoiceCue;
    case "rep-one":
      return `battery-rep-one-${L}` as RemoteBatteryBoothVoiceCue;
    case "rep-two":
      return `battery-rep-two-${L}` as RemoteBatteryBoothVoiceCue;
    case "rep-three":
      return `battery-rep-three-${L}` as RemoteBatteryBoothVoiceCue;
    case "functional-done":
      return `battery-done-${L}` as RemoteBatteryBoothVoiceCue;
    case "assessment-completed":
      return `battery-assessment-complete-${L}` as RemoteBatteryBoothVoiceCue;
    case "countdown-three":
      return `battery-rep-three-${L}` as RemoteBatteryBoothVoiceCue;
    case "countdown-two":
      return `battery-rep-two-${L}` as RemoteBatteryBoothVoiceCue;
    case "countdown-one":
      return `battery-rep-one-${L}` as RemoteBatteryBoothVoiceCue;
    case "get-ready":
    case "abduction-return":
    case "flexion-return":
    case "elbow-straighten":
    case "functional-return":
    case "functional-arm-height":
    case "functional-feet-still":
      return null;
    case "test-completed":
      return `battery-final-test-saving-${L}` as RemoteBatteryBoothVoiceCue;
    default:
      return null;
  }
}
