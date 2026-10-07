/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-consent-ux.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_CONSENT_BROWSER_NOTE,
  RASQ_DEMO_CONSENT_CONTINUE_BUTTON,
  RASQ_DEMO_CONSENT_DENIED_RECOVERY,
  RASQ_DEMO_CONSENT_SKIP_BUTTON,
  RASQ_DEMO_PNF_WELCOME_ANNOTATION,
} from "./demo-consent-copy";
import { isDemoCameraPermissionDeniedError } from "./demo-camera-permission";

const CORE = join(
  process.cwd(),
  "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
);
const ORCHESTRATOR = join(
  process.cwd(),
  "app/components/rasq-demo/RasqDemoOrchestratorSession.tsx",
);
const PNF_VISUAL = join(process.cwd(), "app/components/rasq-demo/RasqDemoPnfD1GuideVisual.tsx");

describe("public demo consent UX", () => {
  it("uses distinct continue and skip copy wired through publicDemoConsent", () => {
    assert.equal(RASQ_DEMO_CONSENT_CONTINUE_BUTTON, "Continue to camera setup");
    assert.equal(RASQ_DEMO_CONSENT_SKIP_BUTTON, "Continue without camera");
    assert.match(RASQ_DEMO_CONSENT_BROWSER_NOTE, /Your browser may ask you to allow camera access/i);
    assert.match(RASQ_DEMO_CONSENT_BROWSER_NOTE, /does not store raw video from this demo by default/i);
    assert.match(RASQ_DEMO_CONSENT_DENIED_RECOVERY, /Camera access is blocked/i);

    const orchestrator = readFileSync(ORCHESTRATOR, "utf8");
    assert.match(orchestrator, /publicDemoConsent=\{RASQ_DEMO_PUBLIC_CONSENT\}/);

    const core = readFileSync(CORE, "utf8");
    assert.match(core, /publicDemoConsent/);
    assert.match(core, /handleSkipCameraClick/);
    assert.match(core, /skipCameraWithoutConsentRef/);
    assert.match(core, /startSessionWithoutCamera/);
    assert.match(core, /alreadyGrantedNote/);
    assert.match(core, /handleDemoRetryCamera/);
    assert.doesNotMatch(core, /Allow camera access/);
  });

  it("does not persist capture consent when skipping camera on the public demo", () => {
    const core = readFileSync(CORE, "utf8");
    assert.match(core, /skipCameraWithoutConsentRef\.current/);
    assert.match(
      core,
      /consentAccepted && !skipCameraWithoutConsentRef\.current[\s\S]*createPatientCvCameraConsentRecord/,
    );
  });

  it("recognizes browser camera permission denial errors", () => {
    assert.equal(isDemoCameraPermissionDeniedError(new DOMException("", "NotAllowedError")), true);
    assert.equal(isDemoCameraPermissionDeniedError(new DOMException("", "PermissionDeniedError")), true);
    assert.equal(isDemoCameraPermissionDeniedError(new Error("other")), false);
  });
});

describe("PNF welcome diagram annotation", () => {
  it("keeps the short annotation on the welcome card without the long clipped phrase", () => {
    assert.equal(RASQ_DEMO_PNF_WELCOME_ANNOTATION, "5 smooth repetitions");
    const visual = readFileSync(PNF_VISUAL, "utf8");
    assert.match(visual, /RASQ_DEMO_PNF_WELCOME_ANNOTATION/);
    assert.match(visual, /RASQ_DEMO_PNF_D1_ILLUSTRATION/);
    assert.doesNotMatch(visual, /five smooth repetitions along the path/i);
  });
});
