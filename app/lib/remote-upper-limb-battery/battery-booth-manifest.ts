import {
  getBatteryAbductionRaiseCopy,
  getBatteryArmInViewCopy,
  getBatteryAssessmentCompleteCopy,
  getBatteryDoneCopy,
  getBatteryFinalTestSavingCopy,
  getBatteryElbowBendCopy,
  getBatteryFlexionRaiseCopy,
  getBatteryFunctionalReachCopy,
  getBatteryMovementSmoothCopy,
  getBatteryRepCountCopy,
  getBatteryRestBeforeNextCopy,
  getBatterySideRepositionCopy,
  getBatteryStandStillCopy,
  getBatteryTrackingLostCopy,
} from "./battery-voice-copy";

function entry(file: string, script: string): { file: string; script: string } {
  return { file, script };
}

function repScript(n: 1 | 2 | 3, lang: "en" | "ar"): string {
  return getBatteryRepCountCopy(n, lang) ?? "";
}

export const REMOTE_BATTERY_BOOTH_VOICE_MANIFEST = {
  "battery-arm-in-view-en": entry("battery-arm-in-view-en.mp3", getBatteryArmInViewCopy("en")),
  "battery-arm-in-view-ar": entry("battery-arm-in-view-ar.mp3", getBatteryArmInViewCopy("ar")),
  "battery-tracking-lost-en": entry(
    "battery-tracking-lost-en.mp3",
    getBatteryTrackingLostCopy("en"),
  ),
  "battery-tracking-lost-ar": entry(
    "battery-tracking-lost-ar.mp3",
    getBatteryTrackingLostCopy("ar"),
  ),
  "battery-movement-smooth-en": entry(
    "battery-movement-smooth-en.mp3",
    getBatteryMovementSmoothCopy("en"),
  ),
  "battery-movement-smooth-ar": entry(
    "battery-movement-smooth-ar.mp3",
    getBatteryMovementSmoothCopy("ar"),
  ),
  "battery-rest-before-next-en": entry(
    "battery-rest-before-next-en.mp3",
    getBatteryRestBeforeNextCopy("en"),
  ),
  "battery-rest-before-next-ar": entry(
    "battery-rest-before-next-ar.mp3",
    getBatteryRestBeforeNextCopy("ar"),
  ),
  "battery-stand-still-en": entry("battery-stand-still-en.mp3", getBatteryStandStillCopy("en")),
  "battery-stand-still-ar": entry("battery-stand-still-ar.mp3", getBatteryStandStillCopy("ar")),
  "battery-reposition-right-en": entry(
    "battery-reposition-right-en.mp3",
    getBatterySideRepositionCopy("right", "en"),
  ),
  "battery-reposition-left-en": entry(
    "battery-reposition-left-en.mp3",
    getBatterySideRepositionCopy("left", "en"),
  ),
  "battery-reposition-right-ar": entry(
    "battery-reposition-right-ar.mp3",
    getBatterySideRepositionCopy("right", "ar"),
  ),
  "battery-reposition-left-ar": entry(
    "battery-reposition-left-ar.mp3",
    getBatterySideRepositionCopy("left", "ar"),
  ),
  "battery-abduction-raise-right-en": entry(
    "battery-abduction-raise-right-en.mp3",
    getBatteryAbductionRaiseCopy("right", "en"),
  ),
  "battery-abduction-raise-left-en": entry(
    "battery-abduction-raise-left-en.mp3",
    getBatteryAbductionRaiseCopy("left", "en"),
  ),
  "battery-abduction-raise-right-ar": entry(
    "battery-abduction-raise-right-ar.mp3",
    getBatteryAbductionRaiseCopy("right", "ar"),
  ),
  "battery-abduction-raise-left-ar": entry(
    "battery-abduction-raise-left-ar.mp3",
    getBatteryAbductionRaiseCopy("left", "ar"),
  ),
  "battery-flexion-raise-right-en": entry(
    "battery-flexion-raise-right-en.mp3",
    getBatteryFlexionRaiseCopy("right", "en"),
  ),
  "battery-flexion-raise-left-en": entry(
    "battery-flexion-raise-left-en.mp3",
    getBatteryFlexionRaiseCopy("left", "en"),
  ),
  "battery-flexion-raise-right-ar": entry(
    "battery-flexion-raise-right-ar.mp3",
    getBatteryFlexionRaiseCopy("right", "ar"),
  ),
  "battery-flexion-raise-left-ar": entry(
    "battery-flexion-raise-left-ar.mp3",
    getBatteryFlexionRaiseCopy("left", "ar"),
  ),
  "battery-elbow-bend-right-en": entry(
    "battery-elbow-bend-right-en.mp3",
    getBatteryElbowBendCopy("right", "en"),
  ),
  "battery-elbow-bend-left-en": entry(
    "battery-elbow-bend-left-en.mp3",
    getBatteryElbowBendCopy("left", "en"),
  ),
  "battery-elbow-bend-right-ar": entry(
    "battery-elbow-bend-right-ar.mp3",
    getBatteryElbowBendCopy("right", "ar"),
  ),
  "battery-elbow-bend-left-ar": entry(
    "battery-elbow-bend-left-ar.mp3",
    getBatteryElbowBendCopy("left", "ar"),
  ),
  "battery-functional-reach-right-en": entry(
    "battery-functional-reach-right-en.mp3",
    getBatteryFunctionalReachCopy("right", "en"),
  ),
  "battery-functional-reach-left-en": entry(
    "battery-functional-reach-left-en.mp3",
    getBatteryFunctionalReachCopy("left", "en"),
  ),
  "battery-functional-reach-right-ar": entry(
    "battery-functional-reach-right-ar.mp3",
    getBatteryFunctionalReachCopy("right", "ar"),
  ),
  "battery-functional-reach-left-ar": entry(
    "battery-functional-reach-left-ar.mp3",
    getBatteryFunctionalReachCopy("left", "ar"),
  ),
  "battery-rep-one-en": entry("battery-rep-one-en.mp3", repScript(1, "en")),
  "battery-rep-two-en": entry("battery-rep-two-en.mp3", repScript(2, "en")),
  "battery-rep-three-en": entry("battery-rep-three-en.mp3", repScript(3, "en")),
  "battery-rep-one-ar": entry("battery-rep-one-ar.mp3", repScript(1, "ar")),
  "battery-rep-two-ar": entry("battery-rep-two-ar.mp3", repScript(2, "ar")),
  "battery-rep-three-ar": entry("battery-rep-three-ar.mp3", repScript(3, "ar")),
  "battery-done-en": entry("battery-done-en.mp3", getBatteryDoneCopy("en")),
  "battery-done-ar": entry("battery-done-ar.mp3", getBatteryDoneCopy("ar")),
  "battery-assessment-complete-en": entry(
    "battery-assessment-complete-en.mp3",
    getBatteryAssessmentCompleteCopy("en"),
  ),
  "battery-assessment-complete-ar": entry(
    "battery-assessment-complete-ar.mp3",
    getBatteryAssessmentCompleteCopy("ar"),
  ),
  "battery-final-test-saving-en": entry(
    "battery-final-test-saving-en.mp3",
    getBatteryFinalTestSavingCopy("en"),
  ),
  "battery-final-test-saving-ar": entry(
    "battery-final-test-saving-ar.mp3",
    getBatteryFinalTestSavingCopy("ar"),
  ),
} satisfies Record<string, { file: string; script: string }>;
