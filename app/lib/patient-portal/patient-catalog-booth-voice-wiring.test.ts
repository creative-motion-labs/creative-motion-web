/**
 * Run: npx tsx --test app/lib/patient-portal/patient-catalog-booth-voice-wiring.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("catalog patient booth voice wiring", () => {
  it("routes catalog playback through PatientCatalogBoothVoiceSession", () => {
    const playback = read("app/components/patient/session/CatalogPatientSessionPlayback.tsx");
    assert.match(playback, /PatientCatalogBoothVoiceSession/);
    assert.doesNotMatch(playback, /<CatalogSessionPlayer/);
  });

  it("preserves interactive shoulder outcome submission on session complete", () => {
    const playback = read("app/components/patient/session/CatalogPatientSessionPlayback.tsx");
    assert.match(playback, /submitInteractiveShoulderOutcomeWithRetry/);
    assert.match(playback, /handleCatalogSessionComplete/);
    assert.match(playback, /onSessionComplete=\{handleCatalogSessionComplete\}/, "outcome handler passed into voice wrapper");
  });

  it("OrchestratorCvSessionCore exposes patient booth voice seams", () => {
    const core = read("app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx");
    assert.match(core, /patientBoothVoiceControl/);
    assert.match(core, /onOrchestratorCountdownCompleteRef/);
    assert.match(core, /onTherapeuticBlockRestRef/);
    assert.match(core, /onInteractiveShoulderAudioUnlockRef/);
  });
});
