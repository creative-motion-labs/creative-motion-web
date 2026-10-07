/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-voice-copy.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getMovementInstruction, getTrackingLostStatus } from "./battery-patient-copy";
import {
  getBatteryAbductionRaiseCopy,
  getBatteryArmInViewCopy,
  getBatteryElbowBendCopy,
  getBatteryFlexionRaiseCopy,
  getBatteryFunctionalReachCopy,
  getBatteryTrackingLostCopy,
  LEGACY_BATTERY_TRACKING_LOST_PHRASE,
} from "./battery-voice-copy";
import {
  resolveBatterySpeechText,
  resolveBatteryTestStartSpeechCue,
  setBatterySpeechLang,
} from "./battery-speech";

describe("remote upper-limb battery voice copy", () => {
  it("uses prescribed-side wording for abduction raise", () => {
    assert.equal(
      getBatteryAbductionRaiseCopy("left", "en"),
      "Raise your left arm slowly out to the side.",
    );
    assert.equal(
      getBatteryAbductionRaiseCopy("right", "en"),
      "Raise your right arm slowly out to the side.",
    );
  });

  it("removes legacy tracking-lost phrasing from on-screen copy", () => {
    const line = getTrackingLostStatus("left", "en");
    assert.equal(line, getBatteryTrackingLostCopy("en"));
    assert.equal(line.includes(LEGACY_BATTERY_TRACKING_LOST_PHRASE), false);
    assert.equal(line.includes("clearly see your left arm"), false);
  });

  it("maps face-camera setup to face-the-camera guidance", () => {
    assert.match(getBatteryArmInViewCopy("en"), /Face the camera/i);
    assert.equal(
      resolveBatterySpeechText("face-camera-setup", "right", "en"),
      getBatteryArmInViewCopy("en"),
    );
  });

  it("uses the shared booth voice pipeline without Interactive Shoulder movement scripts", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/patient/RemoteUpperLimbBatterySession.tsx"),
      "utf8",
    );
    assert.match(source, /preloadBatteryBoothVoiceAssets/);
    assert.equal(source.includes("Reach towards the light"), false);
    const speech = readFileSync(
      join(process.cwd(), "app/lib/remote-upper-limb-battery/battery-speech.ts"),
      "utf8",
    );
    assert.equal(speech.includes("speechSynthesis"), false);
  });

  it("supports Arabic abduction raise copy", () => {
    setBatterySpeechLang("ar");
    assert.match(resolveBatterySpeechText("abduction-raise", "left", "ar"), /اليسرى/);
    setBatterySpeechLang("en");
  });

  it("uses exercise-specific movement copy for tests 2–4", () => {
    assert.equal(
      getBatteryFlexionRaiseCopy("right", "en"),
      "Raise your arm as high as you can.",
    );
    assert.equal(
      getBatteryElbowBendCopy("left", "en"),
      "Bend your elbow as far as you can.",
    );
    assert.equal(
      getBatteryFunctionalReachCopy("right", "en"),
      "Reach forward toward the target as far as you can.",
    );
    for (const testId of ["shoulderFlexion", "elbowFlexion", "functionalReach"] as const) {
      assert.equal(
        getMovementInstruction(testId, "right", "en"),
        resolveBatterySpeechText(resolveBatteryTestStartSpeechCue(testId), "right", "en"),
      );
    }
  });

  it("keeps on-screen movement instructions aligned with voice copy per prescribed side", () => {
    assert.equal(
      getMovementInstruction("shoulderAbduction", "left", "en"),
      resolveBatterySpeechText("abduction-raise", "left", "en"),
    );
    assert.equal(
      getMovementInstruction("shoulderAbduction", "right", "en"),
      resolveBatterySpeechText("abduction-raise", "right", "en"),
    );
    assert.match(getMovementInstruction("shoulderAbduction", "left", "ar"), /اليسرى/);
    assert.match(getMovementInstruction("shoulderAbduction", "right", "ar"), /اليمنى/);
  });
});
