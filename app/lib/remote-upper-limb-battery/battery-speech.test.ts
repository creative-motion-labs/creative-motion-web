/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-speech.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelBatterySpeech,
  resetBatterySpeech,
  resolveBatteryMovementSpeechCue,
  resolveBatteryTestStartSpeechCue,
  speakBatteryCue,
} from "./battery-speech";

describe("battery speech", () => {
  it("does not throw when speech synthesis is unavailable", () => {
    resetBatterySpeech();
    cancelBatterySpeech();
    speakBatteryCue("stand-still", "right", "test");
    speakBatteryCue("stand-still", "right", "test");
  });

  it("does not announce functional reach return until a peak was detected", () => {
    assert.equal(
      resolveBatteryMovementSpeechCue({
        testId: "functionalReach",
        phase: "rest",
        hasReachedPeak: false,
      }),
      null,
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({
        testId: "functionalReach",
        phase: "peak",
        hasReachedPeak: false,
      }),
      "functional-reach",
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({
        testId: "functionalReach",
        phase: "rest",
        hasReachedPeak: true,
      }),
      "functional-return",
    );
  });

  it("maps abduction movement cues from detected phase, not elapsed time", () => {
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "shoulderAbduction", phase: "resting" }),
      null,
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "shoulderAbduction", phase: "raising" }),
      "abduction-raise",
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "shoulderAbduction", phase: "lowering" }),
      "abduction-return",
    );
  });

  it("starts each test with the current movement instruction", () => {
    assert.equal(resolveBatteryTestStartSpeechCue("shoulderAbduction"), "abduction-raise");
    assert.equal(resolveBatteryTestStartSpeechCue("shoulderFlexion"), "flexion-raise");
    assert.equal(resolveBatteryTestStartSpeechCue("elbowFlexion"), "elbow-bend");
    assert.equal(resolveBatteryTestStartSpeechCue("functionalReach"), "functional-reach");
  });

  it("maps elbow and flexion cues from detected phase", () => {
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "elbowFlexion", phase: "flexing" }),
      "elbow-bend",
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "elbowFlexion", phase: "extending" }),
      "elbow-straighten",
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "elbowFlexion", phase: "resting" }),
      null,
    );
    assert.equal(
      resolveBatteryMovementSpeechCue({ testId: "shoulderFlexion", phase: "raising" }),
      "flexion-raise",
    );
  });

  it("cancels queued speech before speaking a new cue", () => {
    const cancelCalls: number[] = [];
    const speakCalls: string[] = [];
    const previousWindow = (globalThis as { window?: unknown }).window;
    const previousUtterance = (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;

    class FakeUtterance {
      text: string;
      rate = 1;
      constructor(text: string) {
        this.text = text;
      }
    }

    (globalThis as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
    (globalThis as { window: unknown }).window = {
      speechSynthesis: {
        cancel() {
          cancelCalls.push(1);
        },
        speak(utterance: { text?: string }) {
          speakCalls.push(utterance.text ?? "");
        },
      },
    };

    try {
      resetBatterySpeech();
      speakBatteryCue("abduction-raise", "right", "test-a");
      speakBatteryCue("abduction-return", "right", "test-a", { allowRepeat: true });
      assert.equal(cancelCalls.length >= 2, true);
      assert.equal(speakCalls.includes("Raise your right arm out to the side."), true);
      assert.equal(speakCalls.includes("Return your arm to your side."), true);
    } finally {
      if (previousUtterance === undefined) {
        delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
      } else {
        (globalThis as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = previousUtterance;
      }
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previousWindow;
      }
    }
  });
});
