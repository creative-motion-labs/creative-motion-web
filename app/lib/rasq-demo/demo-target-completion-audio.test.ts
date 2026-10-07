/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-target-completion-audio.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { RASQ_DEMO_VOICE_CUE_IDS } from "./demo-voice-manifest";

describe("demo target completion audio", () => {
  it("does not use per-target spoken target-reached cues", () => {
    assert.ok(!RASQ_DEMO_VOICE_CUE_IDS.includes("target-reached" as (typeof RASQ_DEMO_VOICE_CUE_IDS)[number]));
    const orchestratorPath = path.join(
      process.cwd(),
      "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx",
    );
    const source = fs.readFileSync(orchestratorPath, "utf8");
    assert.doesNotMatch(source, /target-reached/);
    assert.match(source, /playRasqDemoTargetPopForConfirmedHit\(hit\)/);
    assert.match(source, /onTargetReachConfirmed=\{handleTargetReachConfirmed\}/);
  });

  it("keeps target-not-found and target-recovered voice cues in the manifest", () => {
    assert.ok(RASQ_DEMO_VOICE_CUE_IDS.includes("target-not-found"));
    assert.ok(RASQ_DEMO_VOICE_CUE_IDS.includes("target-recovered"));
  });
});
