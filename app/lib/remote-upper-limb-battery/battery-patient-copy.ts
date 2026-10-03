/**
 * Remote battery patient-facing copy (no technical terms).
 * Movement and setup text is prescribed-side aware via battery-voice-copy.
 */

import {
  getBatteryTestOrientation,
  getFaceCameraSetupInstruction,
  getRepositionProgressLabel,
  getSideRepositionInstruction,
  getSideViewSetupInstruction,
} from "./battery-orientation";
import {
  getBatteryFaceCameraSetupCopy,
  getBatteryPositioningStatusCopy,
  getBatteryFinalTestSavingCopy,
  getBatteryTestStartVoiceCopy,
  getBatteryTrackingLostCopy,
  type BatteryVoiceLang,
} from "./battery-voice-copy";
import {
  getBatteryTestDefinition,
  REMOTE_UPPER_LIMB_BATTERY_TESTS,
  type RemoteUpperLimbBatterySide,
  type RemoteUpperLimbBatteryTestId,
} from "./types";

export function getBatteryOverviewLines(_side: RemoteUpperLimbBatterySide): string[] {
  return REMOTE_UPPER_LIMB_BATTERY_TESTS.map((test, index) => {
    const repsLabel = test.requiredReps === 1 ? "1 attempt" : `${test.requiredReps} repetitions`;
    return `${index + 1}. ${test.title} — ${repsLabel}`;
  });
}

export function getInitialPositionInstruction(
  _side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string {
  return getBatteryFaceCameraSetupCopy(lang);
}

export function getTestSetupInstruction(
  testId: RemoteUpperLimbBatteryTestId,
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string | null {
  if (getBatteryTestOrientation(testId) === "face_camera") {
    return getFaceCameraSetupInstruction(side, lang);
  }
  return getSideViewSetupInstruction(side, lang);
}

export function getRepositionInstruction(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string {
  return getSideRepositionInstruction(side, lang);
}

export { getRepositionProgressLabel } from "./battery-orientation";

export function getPositioningStatus(
  side: RemoteUpperLimbBatterySide,
  ready: boolean,
  lang: BatteryVoiceLang = "en",
): string {
  return getBatteryPositioningStatusCopy(side, ready, lang);
}

export function getHoldStillStatus(): string {
  return "Hold still while we detect your starting position.";
}

export function getTrackingLostStatus(
  _side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string {
  return getBatteryTrackingLostCopy(lang);
}

export function getTestProgressLabel(
  testIndex: number,
  testId: RemoteUpperLimbBatteryTestId,
  repsCompleted: number,
  repsRequired: number,
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string {
  const test = getBatteryTestDefinition(testId);
  const movementSubtitle = getBatteryTestStartVoiceCopy(testId, side, lang);
  if (repsRequired === 1) {
    return `Test ${testIndex + 1} of 4\n${test.title}\n${movementSubtitle}`;
  }
  return `Test ${testIndex + 1} of 4\n${test.title}\n${movementSubtitle}\nRepetition ${repsCompleted} of ${repsRequired}`;
}

export function getRepCompletedLabel(completed: number, required: number): string {
  if (required === 1) return "";
  return `${completed} of ${required}`;
}

export function getTestCompletedMessage(testId: RemoteUpperLimbBatteryTestId): string {
  return `${getBatteryTestDefinition(testId).title} completed.`;
}

/** Shown after the final test’s last valid repetition while results are saved. */
export function getBatteryFinalTestSavingStatus(lang: BatteryVoiceLang = "en"): string {
  return getBatteryFinalTestSavingCopy(lang);
}

export function getBatterySubmitFailedStatus(lang: BatteryVoiceLang = "en"): string {
  if (lang === "ar") {
    return "تعذّر حفظ نتائجك. يمكنك المحاولة مرة أخرى.";
  }
  return "Your results could not be saved. You can try again.";
}

export function getMovementInstruction(
  testId: RemoteUpperLimbBatteryTestId,
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string {
  return getBatteryTestStartVoiceCopy(testId, side, lang);
}

