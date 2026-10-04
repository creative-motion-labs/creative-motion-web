/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-pnf-endpoint-sfx.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { rasqDemoSfxPublicSrc, RASQ_DEMO_SFX_CUE_MANIFEST } from "./demo-audio-manifest";
import { RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS } from "./demo-session-definition";
import {
  RASQ_DEMO_PNF_ENDPOINT_PLAYBACK_VOLUME,
  RASQ_DEMO_PNF_ENDPOINT_SFX_PATH,
  RASQ_DEMO_PNF_ENDPOINT_SFX_VERSION,
  getRasqDemoPnfEndpointPlayCountForTests,
  hasRasqDemoPnfBlockCompletionChimePlayedForTests,
  playRasqDemoPnfFinalRepetitionChimeIfComplete,
  rasqDemoPnfEndpointPublicSrc,
  resetRasqDemoPnfEndpointSfxForTests,
} from "./demo-pnf-endpoint-sfx";
import { resetRasqDemoVoiceAudioForTests, setRasqDemoVoiceMuted } from "./demo-voice-audio";

describe("demo PNF endpoint sfx", () => {
  it("lists pnf-endpoint in the demo audio manifest with cache-busted URL", () => {
    const entry = RASQ_DEMO_SFX_CUE_MANIFEST["pnf-endpoint"];
    assert.equal(entry.file, "pnf-endpoint-en.mp3");
    assert.equal(
      rasqDemoSfxPublicSrc("pnf-endpoint"),
      `${RASQ_DEMO_PNF_ENDPOINT_SFX_PATH}?v=${RASQ_DEMO_PNF_ENDPOINT_SFX_VERSION}`,
    );
    assert.equal(rasqDemoPnfEndpointPublicSrc(), rasqDemoSfxPublicSrc("pnf-endpoint"));
  });

  it("commits an audible-length mp3 under public/audio/demo/", () => {
    const filePath = path.join(process.cwd(), "public", "audio", "demo", "pnf-endpoint-en.mp3");
    assert.ok(fs.existsSync(filePath), "pnf-endpoint-en.mp3 missing — run generate-rasq-demo-pnf-endpoint.ts");
    const bytes = fs.statSync(filePath).size;
    assert.ok(bytes > 2_000, `pnf-endpoint-en.mp3 too small (${bytes} bytes)`);
  });

  it("uses a slightly clearer final completion volume", () => {
    assert.ok(RASQ_DEMO_PNF_ENDPOINT_PLAYBACK_VOLUME >= 0.3);
    assert.ok(RASQ_DEMO_PNF_ENDPOINT_PLAYBACK_VOLUME <= 0.32);
  });

  it("fires final chime from onPatternReachConfirmed only on the last repetition", () => {
    const orchestratorPath = path.join(
      process.cwd(),
      "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx",
    );
    const sessionSource = fs.readFileSync(orchestratorPath, "utf8");
    const handler =
      sessionSource.match(/const handlePatternReachConfirmed = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? "";
    assert.match(handler, /playRasqDemoPnfFinalRepetitionChimeIfComplete/);
    assert.match(handler, /playRasqDemoPnfRepetitionEndpointTick/);
    assert.match(handler, /RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS/);
  });

  it("plays once on the final repetition only and respects mute", () => {
    resetRasqDemoVoiceAudioForTests();
    resetRasqDemoPnfEndpointSfxForTests();
    setRasqDemoVoiceMuted(false);

    const prescribed = RASQ_DEMO_PNF_D1_PRESCRIBED_REPETITIONS;

    for (let i = 1; i < prescribed; i += 1) {
      assert.equal(
        playRasqDemoPnfFinalRepetitionChimeIfComplete({
          repetitionNumber: i,
          prescribedRepetitions: prescribed,
        }),
        false,
      );
    }
    assert.equal(getRasqDemoPnfEndpointPlayCountForTests(), 0);
    assert.equal(hasRasqDemoPnfBlockCompletionChimePlayedForTests(), false);

    assert.equal(
      playRasqDemoPnfFinalRepetitionChimeIfComplete({
        repetitionNumber: prescribed,
        prescribedRepetitions: prescribed,
      }),
      true,
    );
    assert.equal(getRasqDemoPnfEndpointPlayCountForTests(), 1);
    assert.equal(hasRasqDemoPnfBlockCompletionChimePlayedForTests(), true);

    assert.equal(
      playRasqDemoPnfFinalRepetitionChimeIfComplete({
        repetitionNumber: prescribed,
        prescribedRepetitions: prescribed,
      }),
      false,
    );

    resetRasqDemoPnfEndpointSfxForTests();
    setRasqDemoVoiceMuted(true);
    assert.equal(
      playRasqDemoPnfFinalRepetitionChimeIfComplete({
        repetitionNumber: prescribed,
        prescribedRepetitions: prescribed,
      }),
      false,
    );
    assert.equal(getRasqDemoPnfEndpointPlayCountForTests(), 0);
  });

  it("wires unlock with other demo audio on user gesture", () => {
    const unlockSource = fs.readFileSync(
      path.join(process.cwd(), "app/lib/rasq-demo/demo-audio-unlock.ts"),
      "utf8",
    );
    assert.match(unlockSource, /unlockRasqDemoPnfRepetitionTickAudio\(\)/);
    assert.match(unlockSource, /unlockRasqDemoPnfEndpointAudio\(\)/);
  });
});
