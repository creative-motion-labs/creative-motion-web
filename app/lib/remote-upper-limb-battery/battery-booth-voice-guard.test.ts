/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-booth-voice-guard.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BOOTH_VOICE_ASSET_VERSION,
  BOOTH_VOICE_CUE_MANIFEST,
  INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST,
  isInteractiveShoulderBoothVoiceCue,
  isRemoteBatteryBoothVoiceCue,
  REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS,
  boothVoicePublicSrc,
} from "@/app/lib/booth/booth-voice-manifest";
import { INTERACTIVE_SHOULDER_BOOTH_VOICE_ID } from "@/app/lib/booth/booth-voice-tts-profile";
import { resolveBatteryBoothVoiceCue } from "./battery-booth-voice-map";
import { REMOTE_BATTERY_BOOTH_VOICE_MANIFEST } from "./battery-booth-manifest";
import type { BatterySpeechCue } from "./battery-speech-cues";
import type { RemoteUpperLimbBatterySide } from "./types";

const LEGACY_IS_FILES = new Set(
  Object.values(INTERACTIVE_SHOULDER_BOOTH_VOICE_MANIFEST).map((entry) => entry.file),
);

const ALL_BATTERY_SPEECH_CUES: BatterySpeechCue[] = [
  "stand-still",
  "get-ready",
  "face-camera-setup",
  "reposition-side",
  "tracking-lost",
  "movement-smooth-comfort",
  "rest-before-next",
  "countdown-three",
  "countdown-two",
  "countdown-one",
  "abduction-raise",
  "abduction-return",
  "flexion-raise",
  "flexion-return",
  "elbow-bend",
  "elbow-straighten",
  "functional-side-setup",
  "functional-arm-height",
  "functional-feet-still",
  "functional-reach",
  "functional-return",
  "functional-done",
  "rep-one",
  "rep-two",
  "rep-three",
  "test-completed",
  "assessment-completed",
];

/** Cues the live assessment session may speak (must map to battery MP3s). */
const SESSION_SPOKEN_BATTERY_CUES: BatterySpeechCue[] = [
  "face-camera-setup",
  "reposition-side",
  "rest-before-next",
  "stand-still",
  "countdown-three",
  "countdown-two",
  "countdown-one",
  "abduction-raise",
  "flexion-raise",
  "elbow-bend",
  "functional-reach",
  "movement-smooth-comfort",
  "tracking-lost",
  "rep-one",
  "rep-two",
  "rep-three",
  "functional-done",
  "assessment-completed",
];

describe("battery booth voice guard", () => {
  it("uses Sarah female ElevenLabs voice id for generation profile", () => {
    assert.equal(INTERACTIVE_SHOULDER_BOOTH_VOICE_ID, "EXAVITQu4vr4xnSDxMaL");
    const generator = readFileSync(
      join(process.cwd(), "scripts/generate-booth-voice-assets.ts"),
      "utf8",
    );
    assert.match(generator, /INTERACTIVE_SHOULDER_BOOTH_VOICE_ID/);
    assert.equal(generator.includes("speechSynthesis"), false);
  });

  it("cache-busts every booth public src", () => {
    const sample = boothVoicePublicSrc("battery-arm-in-view-en");
    assert.match(sample, new RegExp(`\\?v=${BOOTH_VOICE_ASSET_VERSION}$`));
    assert.equal(sample.includes("session-start"), false);
  });

  it("registers only battery-prefixed files in the remote battery manifest", () => {
    for (const cue of REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS) {
      assert.ok(cue.startsWith("battery-"), cue);
      assert.ok(isRemoteBatteryBoothVoiceCue(cue));
      assert.equal(isInteractiveShoulderBoothVoiceCue(cue), false);
      const file = REMOTE_BATTERY_BOOTH_VOICE_MANIFEST[cue].file;
      assert.ok(file.startsWith("battery-"), file);
      assert.equal(LEGACY_IS_FILES.has(file), false);
    }
  });

  it("maps countdown cues to battery rep MP3s in English and Arabic", () => {
    assert.equal(resolveBatteryBoothVoiceCue("countdown-three", "left", "en"), "battery-rep-three-en");
    assert.equal(resolveBatteryBoothVoiceCue("countdown-two", "right", "en"), "battery-rep-two-en");
    assert.equal(resolveBatteryBoothVoiceCue("countdown-one", "left", "ar"), "battery-rep-one-ar");
    assert.equal(resolveBatteryBoothVoiceCue("countdown-three", "right", "ar"), "battery-rep-three-ar");
  });

  it("never resolves session-spoken cues to legacy Interactive Shoulder assets", () => {
    const sides: RemoteUpperLimbBatterySide[] = ["left", "right"];
    for (const lang of ["en", "ar"] as const) {
      for (const cue of SESSION_SPOKEN_BATTERY_CUES) {
        for (const side of sides) {
          const resolved = resolveBatteryBoothVoiceCue(cue, side, lang);
          assert.ok(resolved, `${cue} (${side}, ${lang}) must resolve to a battery MP3`);
          assert.ok(resolved!.startsWith("battery-"), resolved);
          assert.equal(isInteractiveShoulderBoothVoiceCue(resolved!), false);
          const file = BOOTH_VOICE_CUE_MANIFEST[resolved!].file;
          assert.ok(file.startsWith("battery-"), file);
          assert.equal(LEGACY_IS_FILES.has(file), false);
          assert.notEqual(file, "session-start.mp3");
          assert.notEqual(file, "during-movement.mp3");
        }
      }
    }
  });

  it("maps silent battery speech cues to null (no legacy fallback)", () => {
    const silent: BatterySpeechCue[] = [
      "get-ready",
      "abduction-return",
      "flexion-return",
      "elbow-straighten",
      "functional-return",
      "functional-arm-height",
      "functional-feet-still",
      "test-completed",
    ];
    for (const cue of silent) {
      assert.equal(resolveBatteryBoothVoiceCue(cue, "right", "en"), null, cue);
    }
  });

  it("battery session preloads battery assets only", () => {
    const session = readFileSync(
      join(process.cwd(), "app/components/patient/RemoteUpperLimbBatterySession.tsx"),
      "utf8",
    );
    assert.match(session, /preloadBatteryBoothVoiceAssets/);
    assert.equal(session.includes("preloadBoothVoiceAssets"), false);
    assert.equal(session.includes('speakBoothVoiceCue("session-start"'), false);
  });

  it("covers every battery speech cue id in the resolver switch", () => {
    for (const cue of ALL_BATTERY_SPEECH_CUES) {
      const resolved = resolveBatteryBoothVoiceCue(cue, "left", "en");
      if (resolved) {
        assert.ok(isRemoteBatteryBoothVoiceCue(resolved));
      }
    }
  });
});
