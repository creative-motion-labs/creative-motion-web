/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-completion-voice.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  hasRasqDemoSessionCompletionVoicePlayedForTests,
  playRasqDemoSessionCompletionVoice,
  resetRasqDemoSessionCompletionVoice,
} from "./demo-completion-voice";
import { __testOnlySetRasqDemoSpeechGuidanceEnabled } from "./demo-page-settings";
import { RASQ_DEMO_VOICE_ASSET_VERSION, rasqDemoVoicePublicSrc } from "./demo-voice-manifest";
import { resetRasqDemoVoiceAudioForTests, setRasqDemoVoiceMuted } from "./demo-voice-audio";

describe("demo session completion voice", () => {
  it("plays from RasqDemoExperience after full session, not from orchestrator unmount", () => {
    const experience = fs.readFileSync(
      path.join(process.cwd(), "app/components/rasq-demo/RasqDemoExperience.tsx"),
      "utf8",
    );
    const orchestrator = fs.readFileSync(
      path.join(process.cwd(), "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx"),
      "utf8",
    );
    assert.match(experience, /playRasqDemoSessionCompletionVoice\(\)/);
    assert.match(experience, /handleSessionComplete[\s\S]*setPhase\("summary"\)/);
    assert.doesNotMatch(orchestrator, /playRasqDemoGuidanceCue\("completion"\)/);
    assert.doesNotMatch(orchestrator, /stopRasqDemoVoicePlayback\(\)/);
  });

  it("uses versioned completion MP3 URL", () => {
    assert.equal(rasqDemoVoicePublicSrc("completion"), `/audio/demo/completion-en.mp3?v=${RASQ_DEMO_VOICE_ASSET_VERSION}`);
    const filePath = path.join(process.cwd(), "public", "audio", "demo", "completion-en.mp3");
    assert.ok(fs.existsSync(filePath));
    assert.ok(fs.statSync(filePath).size > 800);
  });

  it("plays exactly once per demo session when not muted", () => {
    __testOnlySetRasqDemoSpeechGuidanceEnabled(true);
    try {
      resetRasqDemoVoiceAudioForTests();
      resetRasqDemoSessionCompletionVoice();
      setRasqDemoVoiceMuted(false);
      assert.equal(playRasqDemoSessionCompletionVoice(), true);
      assert.equal(hasRasqDemoSessionCompletionVoicePlayedForTests(), true);
      assert.equal(playRasqDemoSessionCompletionVoice(), false);
    } finally {
      __testOnlySetRasqDemoSpeechGuidanceEnabled(null);
    }
  });
});
