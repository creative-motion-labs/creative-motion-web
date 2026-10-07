/**
 * Patient-mode voice prompts for lateral reach capture.
 * Uses browser SpeechSynthesis when available; never blocks the test flow.
 */

import { formatLateralReachPatientArmLabel } from "@/app/lib/upper-limb-motor-screen/upper-limb-lateral-reach-capture-attempt-control";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

export type LateralReachPatientSpeechCue =
  | "stand-still"
  | "reach-out"
  | "return-start"
  | "test-completed";

const spokenCueKeys = new Set<string>();

function buildReachOutPhrase(testedSide: UpperLimbSide): string {
  const arm = formatLateralReachPatientArmLabel(testedSide);
  return `Raise your ${arm} out to the side as far as you comfortably can.`;
}

function buildReturnPhrase(testedSide: UpperLimbSide): string {
  const arm = formatLateralReachPatientArmLabel(testedSide);
  return `Now return your ${arm} to the starting position.`;
}

export function resolveLateralReachPatientSpeechText(
  cue: LateralReachPatientSpeechCue,
  testedSide: UpperLimbSide,
): string {
  switch (cue) {
    case "stand-still":
      return "Stand still";
    case "reach-out":
      return buildReachOutPhrase(testedSide);
    case "return-start":
      return buildReturnPhrase(testedSide);
    case "test-completed":
      return "Test completed.";
  }
}

export function speakLateralReachPatientCue(
  cue: LateralReachPatientSpeechCue,
  testedSide: UpperLimbSide,
): void {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") {
    return;
  }

  const sessionKey = `${cue}:${testedSide}`;
  if (spokenCueKeys.has(sessionKey)) {
    return;
  }
  spokenCueKeys.add(sessionKey);

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      resolveLateralReachPatientSpeechText(cue, testedSide),
    );
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Audio is optional — never block capture.
  }
}

export function resetLateralReachPatientSpeech(): void {
  spokenCueKeys.clear();
  if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}
