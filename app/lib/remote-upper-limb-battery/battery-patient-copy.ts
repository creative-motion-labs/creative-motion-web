/**
 * Remote battery patient-facing copy (no technical terms).
 */

import {
  getFaceCameraSetupInstruction,
  getRepositionProgressLabel,
  getSideRepositionInstruction,
} from "./battery-orientation";
import {
  formatBatteryArmLabel,
  getBatteryTestDefinition,
  REMOTE_UPPER_LIMB_BATTERY_TESTS,
  type RemoteUpperLimbBatterySide,
  type RemoteUpperLimbBatteryTestId,
} from "./types";

export function getBatteryOverviewLines(side: RemoteUpperLimbBatterySide): string[] {
  const arm = formatBatteryArmLabel(side);
  return REMOTE_UPPER_LIMB_BATTERY_TESTS.map((test, index) => {
    const repsLabel = test.requiredReps === 1 ? "1 attempt" : `${test.requiredReps} repetitions`;
    return `${index + 1}. ${test.title} — ${repsLabel}`;
  });
}

export function getInitialPositionInstruction(side: RemoteUpperLimbBatterySide): string {
  return getFaceCameraSetupInstruction(side);
}

export function getTestSetupInstruction(
  testId: RemoteUpperLimbBatteryTestId,
  side: RemoteUpperLimbBatterySide,
): string | null {
  const test = getBatteryTestDefinition(testId);
  if (test.setupInstruction) {
    return test.setupInstruction.replaceAll("right arm", formatBatteryArmLabel(side));
  }
  return null;
}

export function getRepositionInstruction(side: RemoteUpperLimbBatterySide): string {
  return getSideRepositionInstruction(side);
}

export { getRepositionProgressLabel } from "./battery-orientation";

export function getPositioningStatus(side: RemoteUpperLimbBatterySide, ready: boolean): string {
  const arm = formatBatteryArmLabel(side);
  if (ready) return "Position detected";
  return `Stand still and keep your ${arm} visible.`;
}

export function getHoldStillStatus(): string {
  return "Hold still while we detect your starting position.";
}

export function getTrackingLostStatus(side: RemoteUpperLimbBatterySide): string {
  const arm = formatBatteryArmLabel(side);
  return `We can't clearly see your ${arm}. Adjust your position.`;
}

export function getTestProgressLabel(
  testIndex: number,
  testId: RemoteUpperLimbBatteryTestId,
  repsCompleted: number,
  repsRequired: number,
): string {
  const test = getBatteryTestDefinition(testId);
  if (repsRequired === 1) {
    return `Test ${testIndex + 1} of 4\n${test.title}`;
  }
  return `Test ${testIndex + 1} of 4\n${test.title}\nRepetition ${repsCompleted} of ${repsRequired}`;
}

export function getRepCompletedLabel(completed: number, required: number): string {
  if (required === 1) return "";
  return `${completed} of ${required}`;
}

export function getTestCompletedMessage(testId: RemoteUpperLimbBatteryTestId): string {
  return `${getBatteryTestDefinition(testId).title} completed.`;
}

export function getMovementInstruction(
  testId: RemoteUpperLimbBatteryTestId,
  side: RemoteUpperLimbBatterySide,
): string {
  const test = getBatteryTestDefinition(testId);
  return test.instruction
    .replaceAll("right arm", formatBatteryArmLabel(side))
    .replaceAll("right side", side === "right" ? "right side" : "left side")
    .replaceAll("your side facing", side === "right" ? "your right side facing" : "your left side facing");
}
