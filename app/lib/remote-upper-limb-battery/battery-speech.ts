/**
 * Remote battery speech cues — one utterance per current state.
 * Previous speech is cancelled so cues cannot run ahead of the live phase.
 */

import { formatBatteryArmLabel, getBatteryTestDefinition, type RemoteUpperLimbBatterySide, type RemoteUpperLimbBatteryTestId } from "./types";
import { getSideRepositionInstruction } from "./battery-orientation";

const spokenKeys = new Set<string>();

export type BatterySpeechCue =
  | "stand-still"
  | "get-ready"
  | "reposition-side"
  | "countdown-three"
  | "countdown-two"
  | "countdown-one"
  | "abduction-raise"
  | "abduction-return"
  | "flexion-raise"
  | "flexion-return"
  | "elbow-bend"
  | "elbow-straighten"
  | "functional-side-setup"
  | "functional-arm-height"
  | "functional-feet-still"
  | "functional-reach"
  | "functional-return"
  | "rep-one"
  | "rep-two"
  | "rep-three"
  | "test-completed"
  | "assessment-completed";

function resolveText(cue: BatterySpeechCue, side: RemoteUpperLimbBatterySide): string {
  const arm = formatBatteryArmLabel(side);
  switch (cue) {
    case "stand-still":
      return "Stand still.";
    case "get-ready":
      return "Get ready.";
    case "reposition-side":
      return getSideRepositionInstruction(side);
    case "countdown-three":
      return "Three.";
    case "countdown-two":
      return "Two.";
    case "countdown-one":
      return "One.";
    case "abduction-raise":
      return `Raise your ${arm} out to the side.`;
    case "abduction-return":
      return "Return your arm to your side.";
    case "flexion-raise":
      return `Raise your ${arm} forward.`;
    case "flexion-return":
      return "Return your arm to your side.";
    case "elbow-bend":
      return "Bend your elbow.";
    case "elbow-straighten":
      return "Straighten your elbow.";
    case "functional-side-setup":
      return getSideRepositionInstruction(side);
    case "functional-arm-height":
      return "Raise your arm forward to shoulder height.";
    case "functional-feet-still":
      return "Keep your feet still.";
    case "functional-reach":
      return "Reach forward as far as you comfortably can without taking a step.";
    case "functional-return":
      return "Return to the starting position.";
    case "rep-one":
      return "One of three.";
    case "rep-two":
      return "Two of three.";
    case "rep-three":
      return "Three of three.";
    case "test-completed":
      return "Test completed.";
    case "assessment-completed":
      return "Assessment completed.";
  }
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

export function resolveBatteryMovementSpeechCue(input: {
  testId: RemoteUpperLimbBatteryTestId;
  phase: string;
  hasReachedPeak?: boolean;
}): BatterySpeechCue | null {
  const { testId, phase, hasReachedPeak = false } = input;
  if (testId === "shoulderAbduction") {
    if (phase === "raising") return "abduction-raise";
    if (phase === "lowering") return "abduction-return";
  }
  if (testId === "shoulderFlexion") {
    if (phase === "raising") return "flexion-raise";
    if (phase === "lowering") return "flexion-return";
  }
  if (testId === "elbowFlexion") {
    if (phase === "flexing") return "elbow-bend";
    if (phase === "extending") return "elbow-straighten";
  }
  if (testId === "functionalReach") {
    if (phase === "peak") return "functional-reach";
    if (phase === "rest" && hasReachedPeak) return "functional-return";
  }
  return null;
}

export function cancelBatterySpeech(): void {
  if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export function speakBatteryTestCompleted(
  testId: RemoteUpperLimbBatteryTestId,
  side: RemoteUpperLimbBatterySide,
): void {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
  const key = `${testId}:completed:${side}`;
  if (spokenKeys.has(key)) return;
  spokenKeys.add(key);
  cancelBatterySpeech();
  try {
    const utterance = new SpeechSynthesisUtterance(
      `${getBatteryTestDefinition(testId).title} completed.`,
    );
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // optional
  }
}

export function speakBatteryCue(
  cue: BatterySpeechCue,
  side: RemoteUpperLimbBatterySide,
  scope = "global",
  options?: { allowRepeat?: boolean },
): void {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
  const key = `${scope}:${cue}:${side}`;
  if (!options?.allowRepeat) {
    if (spokenKeys.has(key)) return;
    spokenKeys.add(key);
  }
  cancelBatterySpeech();
  try {
    const utterance = new SpeechSynthesisUtterance(resolveText(cue, side));
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // optional
  }
}

export function resetBatterySpeech(): void {
  spokenKeys.clear();
  cancelBatterySpeech();
}

export function resetBatterySpeechForTest(cancelQueued = true): void {
  spokenKeys.clear();
  if (cancelQueued) cancelBatterySpeech();
}
