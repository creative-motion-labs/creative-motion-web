/**
 * Run: npx tsx --test app/lib/patient-portal/patient-booth-voice-outcome-once.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("patient booth voice + outcome callback", () => {
  it("invokes parent onSessionComplete exactly once from the voice hook wrapper", () => {
    const hook = readFileSync(
      join(process.cwd(), "app/hooks/usePatientInteractiveShoulderBoothVoice.ts"),
      "utf8",
    );
    assert.match(hook, /invokePatientBoothSessionCompleteHandoff\(/);
    assert.match(hook, /patientBoothVoiceOnSessionComplete\(voiceStateRef\.current, voiceOptions\)/);
    assert.match(hook, /onSessionCompleteRef\.current/);
    assert.doesNotMatch(hook, /onSessionCompleteRef\.current\?\.\(snapshot\)[\s\S]*onSessionCompleteRef\.current\?\.\(snapshot\)/);
  });

  it("does not wrap or duplicate outcome submission in the voice session shell", () => {
    const playback = readFileSync(
      join(process.cwd(), "app/components/patient/session/CatalogPatientSessionPlayback.tsx"),
      "utf8",
    );
    const voiceShell = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/PatientCatalogBoothVoiceSession.tsx"),
      "utf8",
    );
    assert.doesNotMatch(voiceShell, /submitInteractiveShoulderOutcome/);
    assert.match(playback, /submitInteractiveShoulderOutcomeWithRetry/);
    assert.match(playback, /onSessionComplete=\{handleCatalogSessionComplete\}/);
  });
});
