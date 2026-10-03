/**

 * Camera orientation requirements per battery test.

 * Face-camera for abduction; side-view block for flexion through functional reach.

 */



import {
  getBatteryFaceCameraSetupCopy,
  getBatterySideViewSetupCopy,
  type BatteryVoiceLang,
} from "./battery-voice-copy";

import type { RemoteUpperLimbBatterySide, RemoteUpperLimbBatteryTestId } from "./types";



export type BatteryCameraOrientation = "face_camera" | "side_view";



export function getBatteryTestOrientation(testId: RemoteUpperLimbBatteryTestId): BatteryCameraOrientation {

  return testId === "shoulderAbduction" ? "face_camera" : "side_view";

}



/** Reposition is required after shoulder abduction before side-view tests. */

export function requiresSideRepositionAfterTestIndex(completedTestIndex: number): boolean {

  return completedTestIndex === 0;

}



export function getFaceCameraSetupInstruction(

  side: RemoteUpperLimbBatterySide,

  lang: BatteryVoiceLang = "en",

): string {
  return getBatteryFaceCameraSetupCopy(lang);
}

export function getSideViewSetupInstruction(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang = "en",
): string {
  return getBatterySideViewSetupCopy(side, lang);
}



export function getSideRepositionInstruction(

  side: RemoteUpperLimbBatterySide,

  lang: BatteryVoiceLang = "en",

): string {
  return getBatterySideViewSetupCopy(side, lang);
}



export function getRepositionProgressLabel(): string {

  return "Prepare for Test 2 of 4";

}



export function isSideViewTestId(testId: RemoteUpperLimbBatteryTestId): boolean {

  return getBatteryTestOrientation(testId) === "side_view";

}


