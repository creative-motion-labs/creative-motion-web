/**
 * Remote battery setup voice — when to speak orientation cues per orchestrator phase.
 */

import { isSideViewTestId } from "./battery-orientation";
import type { RemoteUpperLimbBatteryTestId } from "./types";

export function sideViewSetupSpeechScope(testId: RemoteUpperLimbBatteryTestId): string {
  return `side-setup-${testId}`;
}

export function shouldSpeakSideViewSetupInPositioning(
  phase: string,
  activeTestId: RemoteUpperLimbBatteryTestId,
  sideViewSetupCueSpoken: boolean,
): boolean {
  if (phase !== "positioning") return false;
  if (!isSideViewTestId(activeTestId)) return false;
  return !sideViewSetupCueSpoken;
}

/** Side-view setup must play once per test attempt during positioning, before countdown. */
export function resetSideViewSetupCueSpokenForNewTest(): boolean {
  return false;
}
