/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/lateral-reach-patient-speech.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveLateralReachPatientSpeechText,
  resetLateralReachPatientSpeech,
} from "./lateral-reach-patient-speech";

describe("lateral-reach-patient-speech", () => {
  it("builds side-specific reach and return phrases", () => {
    assert.match(
      resolveLateralReachPatientSpeechText("reach-out", "right"),
      /right arm/i,
    );
    assert.match(
      resolveLateralReachPatientSpeechText("return-start", "left"),
      /left arm/i,
    );
    assert.equal(resolveLateralReachPatientSpeechText("test-completed", "right"), "Test completed.");
  });

  it("reset is safe without speech synthesis", () => {
    resetLateralReachPatientSpeech();
    assert.ok(true);
  });
});
