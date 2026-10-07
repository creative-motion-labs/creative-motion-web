/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-pnf-repetition-tick-sfx.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { rasqDemoSfxPublicSrc, RASQ_DEMO_SFX_CUE_MANIFEST } from "./demo-audio-manifest";
import { RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS } from "./demo-session-definition";
import {
  RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME,
  RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH,
  RASQ_DEMO_PNF_REPETITION_TICK_SFX_VERSION,
  getRasqDemoPnfRepetitionTickPlayCountForTests,
  getRasqDemoPnfRepetitionTickPlayedForTests,
  playRasqDemoPnfRepetitionEndpointTick,
  rasqDemoPnfRepetitionTickPublicSrc,
  resetRasqDemoPnfRepetitionTickSfxForTests,
} from "./demo-pnf-repetition-tick-sfx";
import { resetRasqDemoVoiceAudioForTests, setRasqDemoVoiceMuted } from "./demo-voice-audio";

describe("demo PNF repetition tick sfx", () => {
  it("lists pnf-repetition-tick in the demo audio manifest", () => {
    const entry = RASQ_DEMO_SFX_CUE_MANIFEST["pnf-repetition-tick"];
    assert.equal(entry.file, "pnf-repetition-tick-en.mp3");
    assert.equal(
      rasqDemoSfxPublicSrc("pnf-repetition-tick"),
      `${RASQ_DEMO_PNF_REPETITION_TICK_SFX_PATH}?v=${RASQ_DEMO_PNF_REPETITION_TICK_SFX_VERSION}`,
    );
    assert.equal(rasqDemoPnfRepetitionTickPublicSrc(), rasqDemoSfxPublicSrc("pnf-repetition-tick"));
  });

  it("commits an mp3 under public/audio/demo/", () => {
    const filePath = path.join(process.cwd(), "public", "audio", "demo", "pnf-repetition-tick-en.mp3");
    assert.ok(
      fs.existsSync(filePath),
      "pnf-repetition-tick-en.mp3 missing — run generate-rasq-demo-pnf-repetition-tick.ts",
    );
    assert.ok(fs.statSync(filePath).size > 1_500);
  });

  it("uses a low background playback volume", () => {
    assert.ok(RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME >= 0.15);
    assert.ok(RASQ_DEMO_PNF_REPETITION_TICK_PLAYBACK_VOLUME <= 0.2);
  });

  it("plays once per repetition number and dedupes", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoPnfRepetitionTickSfxForTests();
    setRasqDemoVoiceMuted(false);

    for (let i = 1; i <= RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS; i += 1) {
      assert.equal(playRasqDemoPnfRepetitionEndpointTick({ repetitionNumber: i }), true);
      assert.equal(playRasqDemoPnfRepetitionEndpointTick({ repetitionNumber: i }), false);
    }

    assert.equal(getRasqDemoPnfRepetitionTickPlayCountForTests(), RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS);
    assert.deepEqual(
      getRasqDemoPnfRepetitionTickPlayedForTests(),
      [1, 2, 3, 4, 5],
    );
  });

  it("respects mute without recording dedupe", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoPnfRepetitionTickSfxForTests();
    setRasqDemoVoiceMuted(true);

    assert.equal(playRasqDemoPnfRepetitionEndpointTick({ repetitionNumber: 1 }), false);
    assert.deepEqual(getRasqDemoPnfRepetitionTickPlayedForTests(), []);

    setRasqDemoVoiceMuted(false);
    assert.equal(playRasqDemoPnfRepetitionEndpointTick({ repetitionNumber: 1 }), true);
  });

  it("wires tick playback from onPatternReachConfirmed", () => {
    const sessionSource = fs.readFileSync(
      path.join(process.cwd(), "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx"),
      "utf8",
    );
    const handler =
      sessionSource.match(/const handlePatternReachConfirmed = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? "";
    assert.match(handler, /playRasqDemoPnfRepetitionEndpointTick/);
    assert.match(handler, /playRasqDemoPnfFinalRepetitionChimeIfComplete/);
  });
});
