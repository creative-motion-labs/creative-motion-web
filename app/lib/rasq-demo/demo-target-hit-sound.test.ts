/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-target-hit-sound.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_TARGET_POP_SFX_PATH,
  RASQ_DEMO_TARGET_POP_SFX_VERSION,
  getRasqDemoTargetPopPlayCountForTests,
  getRasqDemoTargetPopPlayedTargetIdsForTests,
  playRasqDemoTargetPopForConfirmedHit,
  rasqDemoTargetPopPublicSrc,
  resetRasqDemoSfxForTests,
} from "./demo-sfx-audio";
import { resetRasqDemoVoiceAudioForTests, setRasqDemoVoiceMuted } from "./demo-voice-audio";

describe("demo target hit sound", () => {
  it("fires from onTargetReachConfirmed on the orchestrator targetContact path only", () => {
    const orchestratorPath = path.join(
      process.cwd(),
      "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx",
    );
    const corePath = path.join(
      process.cwd(),
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
    );
    const sessionSource = fs.readFileSync(orchestratorPath, "utf8");
    const coreSource = fs.readFileSync(corePath, "utf8");

    assert.match(sessionSource, /onTargetReachConfirmed=\{handleTargetReachConfirmed\}/);
    assert.match(
      fs.readFileSync(path.join(process.cwd(), "app/components/rasq-demo/RasqDemoExperience.tsx"), "utf8"),
      /unlockRasqDemoAudioFromUserGesture\(\)/,
    );
    assert.match(
      fs.readFileSync(path.join(process.cwd(), "app/lib/rasq-demo/demo-sfx-audio.ts"), "utf8"),
      /\[rasq-demo-target-hit\]/,
    );
    const reachConfirmedHandler =
      sessionSource.match(/const handleTargetReachConfirmed = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? "";
    assert.match(reachConfirmedHandler, /playRasqDemoTargetPopForConfirmedHit\(hit\)/);
    const poseHandler =
      sessionSource.match(/const handlePoseDetectorSnapshot = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? "";
    assert.doesNotMatch(poseHandler, /playRasqDemoTargetPop/);
    assert.match(coreSource, /resolveTargetContactForTick/);
    assert.match(coreSource, /onTargetReachConfirmedRef\.current\?\.\(processedTargetContact\)/);
  });

  it("uses the versioned public target-pop URL", () => {
    assert.equal(rasqDemoTargetPopPublicSrc(), `${RASQ_DEMO_TARGET_POP_SFX_PATH}?v=${RASQ_DEMO_TARGET_POP_SFX_VERSION}`);
  });

  it("plays exactly once per target id and respects mute", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoSfxForTests();
    setRasqDemoVoiceMuted(false);

    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "t1" }), true);
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "t1" }), false);
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "t2" }), true);
    assert.equal(getRasqDemoTargetPopPlayCountForTests(), 2);
    assert.deepEqual(getRasqDemoTargetPopPlayedTargetIdsForTests(), ["t1", "t2"]);

    setRasqDemoVoiceMuted(true);
    assert.equal(playRasqDemoTargetPopForConfirmedHit({ targetId: "t3" }), false);
    assert.equal(getRasqDemoTargetPopPlayCountForTests(), 2);
  });
});
