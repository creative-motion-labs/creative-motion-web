/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-page-settings.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  __testOnlySetRasqDemoSpeechGuidanceEnabled,
  isRasqDemoSpeechGuidanceEnabled,
  RASQ_DEMO_SPEECH_GUIDANCE_ENABLED,
} from "./demo-page-settings";
import { playRasqDemoGuidanceCue } from "./demo-voice-play";
import {
  getRasqDemoVoiceLastCue,
  resetRasqDemoVoiceAudioForTests,
  setRasqDemoVoiceMuted,
} from "./demo-voice-audio";

describe("demo page settings", () => {
  it("enables spoken guidance on the public demo page by default", () => {
    assert.equal(RASQ_DEMO_SPEECH_GUIDANCE_ENABLED, true);
    assert.equal(isRasqDemoSpeechGuidanceEnabled(), true);
  });

  it("does not play guidance cues when speech is disabled via test override", () => {
    __testOnlySetRasqDemoSpeechGuidanceEnabled(false);
    try {
      resetRasqDemoVoiceAudioForTests();
      setRasqDemoVoiceMuted(false);
      playRasqDemoGuidanceCue("welcome");
      assert.equal(getRasqDemoVoiceLastCue(), null);
    } finally {
      __testOnlySetRasqDemoSpeechGuidanceEnabled(null);
    }
  });

  it("keeps the welcome screen on Start demo without a pre-consent camera notice", () => {
    const page = readFileSync(join(process.cwd(), "app/demo/page.tsx"), "utf8");
    const experience = readFileSync(
      join(process.cwd(), "app/components/rasq-demo/RasqDemoExperience.tsx"),
      "utf8",
    );
    assert.doesNotMatch(page, /permissions-policy/);
    assert.doesNotMatch(experience, /RASQ_DEMO_CAMERA_ACCESS_NOTICE/);
    assert.match(experience, /Start demo/);
    assert.doesNotMatch(experience, /Allow camera/);
    assert.match(experience, /<RasqDemoVoiceControls \/>/);
  });
});
