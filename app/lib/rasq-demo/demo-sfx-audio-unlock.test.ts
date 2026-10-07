/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-sfx-audio-unlock.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  __testOnlyReleaseTargetPopDedupe,
  getRasqDemoTargetPopPlayedTargetIdsForTests,
  playRasqDemoTargetPopForConfirmedHit,
  resetRasqDemoSfxForTests,
} from "./demo-sfx-audio";
import { resetRasqDemoVoiceAudioForTests, setRasqDemoVoiceMuted } from "./demo-voice-audio";

describe("demo target pop unlock and shared audio", () => {
  it("wires unlock on Start demo, mute, replay, and camera consent", () => {
    const experience = fs.readFileSync(
      path.join(process.cwd(), "app/components/rasq-demo/RasqDemoExperience.tsx"),
      "utf8",
    );
    const controls = fs.readFileSync(
      path.join(process.cwd(), "app/components/rasq-demo/RasqDemoVoiceControls.tsx"),
      "utf8",
    );
    const orchestratorSession = fs.readFileSync(
      path.join(process.cwd(), "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx"),
      "utf8",
    );
    const core = fs.readFileSync(
      path.join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );

    assert.match(experience, /unlockRasqDemoAudioFromUserGesture\(\)/);
    assert.match(controls, /handleMuteToggle[\s\S]*unlockRasqDemoAudioFromUserGesture\(\)/);
    assert.match(controls, /handleReplay[\s\S]*unlockRasqDemoAudioFromUserGesture\(\)/);
    assert.match(orchestratorSession, /onDemoTargetPopAudioUnlock=\{unlockRasqDemoAudioFromUserGesture\}/);
    assert.match(core, /handleSkipCameraClick[\s\S]*onDemoTargetPopAudioUnlock\?\.\(\)/);
    assert.match(core, /onDemoTargetPopAudioUnlock\?\.\(\)/);
  });

  it("uses one shared HTMLAudioElement module singleton", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/lib/rasq-demo/demo-sfx-audio.ts"),
      "utf8",
    );
    assert.match(source, /let popAudioElement: HTMLAudioElement \| null = null/);
    assert.match(source, /audio\.currentTime = 0/);
    assert.match(source, /RASQ_DEMO_TARGET_POP_PLAYBACK_VOLUME/);
  });

  it("allows retry after simulated play rejection by clearing dedupe", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoSfxForTests();
    setRasqDemoVoiceMuted(false);

    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "retry-me" }), true);
    assert.deepEqual(getRasqDemoTargetPopPlayedTargetIdsForTests(), ["retry-me"]);

    __testOnlyReleaseTargetPopDedupe("retry-me");
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "retry-me" }), true);
    assert.deepEqual(getRasqDemoTargetPopPlayedTargetIdsForTests(), ["retry-me"]);
  });

  it("does not add targetId to dedupe when muted", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoSfxForTests();
    setRasqDemoVoiceMuted(true);

    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "muted-target" }), false);
    assert.deepEqual(getRasqDemoTargetPopPlayedTargetIdsForTests(), []);

    setRasqDemoVoiceMuted(false);
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "muted-target" }), true);
    assert.deepEqual(getRasqDemoTargetPopPlayedTargetIdsForTests(), ["muted-target"]);
  });
});
