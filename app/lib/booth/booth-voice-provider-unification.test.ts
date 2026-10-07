/**
 * Run: npx tsx --test app/lib/booth/booth-voice-provider-unification.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getPrerecordedVoicePlaybackFunctions, getPrerecordedVoiceAudioProviderId } from "./booth-voice-provider";
import { getBatteryVoiceAudioProviderId } from "@/app/lib/remote-upper-limb-battery/battery-speech";
import { getBatteryArmInViewCopy } from "@/app/lib/remote-upper-limb-battery/battery-voice-copy";
import { playBoothVoiceAsset } from "./booth-voice-audio";

describe("prerecorded voice provider unification", () => {
  it("Interactive Shoulder and Remote Upper-Limb Assessment share the same provider id", () => {
    const providerId = getPrerecordedVoiceAudioProviderId();
    assert.equal(getBatteryVoiceAudioProviderId(), providerId);
    assert.equal(providerId, "booth-html-audio");
  });

  it("battery speech routes through booth HTMLAudio playback", () => {
    const batterySpeech = readFileSync(
      join(process.cwd(), "app/lib/remote-upper-limb-battery/battery-speech.ts"),
      "utf8",
    );
    assert.equal(batterySpeech.includes("speechSynthesis"), false);
    assert.match(batterySpeech, /speakBoothVoiceCue/);
    assert.match(batterySpeech, /getPrerecordedVoiceAudioProviderId/);

    const playback = getPrerecordedVoicePlaybackFunctions();
    assert.equal(playback.play, playBoothVoiceAsset);
  });

  it("does not map battery cues to Interactive Shoulder movement lines", () => {
    const manifest = readFileSync(
      join(process.cwd(), "app/lib/booth/booth-voice-manifest.ts"),
      "utf8",
    );
    assert.equal(manifest.includes("Reach towards the light"), true);
    const batteryManifest = readFileSync(
      join(process.cwd(), "app/lib/remote-upper-limb-battery/battery-booth-manifest.ts"),
      "utf8",
    );
    assert.equal(batteryManifest.includes("Reach towards the light"), false);
    assert.equal(
      getBatteryArmInViewCopy("en"),
      "Place your arm in view of the camera.",
    );
  });
});
