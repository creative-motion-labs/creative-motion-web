/**
 * Camera orientation requirements per battery test.
 * Face-camera for abduction; side-view block for flexion through functional reach.
 */

import type { RemoteUpperLimbBatterySide, RemoteUpperLimbBatteryTestId } from "./types";
import { formatBatteryArmLabel } from "./types";

export type BatteryCameraOrientation = "face_camera" | "side_view";

export function getBatteryTestOrientation(testId: RemoteUpperLimbBatteryTestId): BatteryCameraOrientation {
  return testId === "shoulderAbduction" ? "face_camera" : "side_view";
}

/** Reposition is required after shoulder abduction before side-view tests. */
export function requiresSideRepositionAfterTestIndex(completedTestIndex: number): boolean {
  return completedTestIndex === 0;
}

export function getFaceCameraSetupInstruction(side: RemoteUpperLimbBatterySide): string {
  const arm = formatBatteryArmLabel(side);
  return `Stand facing the camera with your upper body and ${arm} fully visible.`;
}

export function getSideRepositionInstruction(side: RemoteUpperLimbBatterySide): string {
  const sideLabel = side === "right" ? "right side" : "left side";
  return `Please turn sideways with your ${sideLabel} facing the camera.`;
}

export function getRepositionProgressLabel(): string {
  return "Prepare for Test 2 of 4";
}

export function isSideViewTestId(testId: RemoteUpperLimbBatteryTestId): boolean {
  return getBatteryTestOrientation(testId) === "side_view";
}
