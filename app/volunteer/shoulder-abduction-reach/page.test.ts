/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/page.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PAGE_PATH = join(process.cwd(), "app/volunteer/shoulder-abduction-reach/page.tsx");
const HOOK_PATH = join(process.cwd(), "app/hooks/useVolunteerCaptureSession.ts");
const PERSISTENCE_HOOK_PATH = join(process.cwd(), "app/hooks/useVolunteerResearchPersistence.ts");
const PROXY_PATH = join(process.cwd(), "proxy.ts");

const VOLUNTEER_SOURCE_FILES = [
  PAGE_PATH,
  HOOK_PATH,
  PERSISTENCE_HOOK_PATH,
  join(process.cwd(), "app/volunteer/shoulder-abduction-reach/volunteer-protocol.ts"),
  join(process.cwd(), "app/volunteer/shoulder-abduction-reach/volunteer-capture-sink.ts"),
  join(process.cwd(), "app/volunteer/shoulder-abduction-reach/volunteer-browser-persistence-client.ts"),
  join(process.cwd(), "app/volunteer/shoulder-abduction-reach/volunteer-research-persistence-controller.ts"),
  join(process.cwd(), "app/volunteer/shoulder-abduction-reach/components/VolunteerWizardShell.tsx"),
];

describe("volunteer shoulder abduction reach — Slice 8B.3 integrity", () => {
  it("proxy.ts exposes only the exact volunteer page path (not a broad /volunteer prefix)", () => {
    const source = readFileSync(PROXY_PATH, "utf8");
    assert.match(source, /["']\/volunteer\/shoulder-abduction-reach["']/);
    const prefixesBlock = source.slice(
      source.indexOf("const PUBLIC_PREFIXES"),
      source.indexOf("const PUBLIC_PATHS"),
    );
    assert.doesNotMatch(prefixesBlock, /\/volunteer/);
  });

  it("consent Continue stays disabled until both checkboxes and campaign code are required in source", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /canProceedFromConsentWithCampaign\(consent, campaignCode\)/);
    assert.match(source, /ageConfirmed/);
    assert.match(source, /participationAgreed/);
    assert.match(source, /campaignCode/);
    assert.match(source, /setCampaignCode\(""\)/);
  });

  it("startCapture calls stop-before-start in the volunteer hook", () => {
    const source = readFileSync(HOOK_PATH, "utf8");
    const startBody = source.slice(
      source.indexOf("const startCapture = useCallback"),
      source.indexOf("const reattachCameraPreview = useCallback"),
    );
    const stopCallIndex = startBody.indexOf("stopDetector();");
    const constructorIndex = startBody.indexOf("new ShoulderAbductionReachPoseDetector");
    assert.ok(stopCallIndex >= 0, "startCapture must call stopDetector() first");
    assert.ok(constructorIndex > stopCallIndex, "stopDetector() must run before constructing detector");
    assert.match(source, /createCameraRequestController/);
    assert.match(source, /beginDetectorRequest/);
    assert.match(source, /isDetectorCurrent/);
  });

  it("consent copy accurately describes research upload and omits outdated not-uploaded claims", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.doesNotMatch(source, /anonymous movement-tracking data/i);
    assert.match(source, /movement data without name or contact information/i);
    assert.match(source, /normal network downloads/i);
    assert.match(source, /random research participant identifier/i);
    assert.match(source, /pose-landmark time-series/i);
    assert.match(source, /derived technical movement features/i);
    assert.match(source, /Raw camera video, photos, and audio are/);
    assert.doesNotMatch(source, /not uploaded.*pilot version/i);
    assert.doesNotMatch(source, /held in memory only/i);
    assert.doesNotMatch(source, /This data was not uploaded/i);
  });

  it("summary is gated on persistence completion, not local capture count alone", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /isCompleted/);
    assert.match(source, /displayStep === "summary"/);
    assert.doesNotMatch(source, /View summary/);
    assert.match(source, /createMovementSession/);
    assert.match(source, /notifyCaptureTargetReached/);
    assert.match(source, /onRepCaptured/);
  });

  it("retry UI is gated on retryKind so buttons are never no-ops", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    assert.match(source, /retryKind === "rep"/);
    assert.match(source, /retryKind === "completion"/);
    assert.match(source, /retryKind === "session"/);
    const captureSection = source.slice(
      source.indexOf('{step === "capture" ?'),
      source.indexOf('{displayStep === "summary"'),
    );
    assert.doesNotMatch(captureSection, /retryCompletion\(\)[\s\S]*retryFailedRep/);
  });

  it("capture hook retains count metadata without a capturedRecords array", () => {
    const source = readFileSync(HOOK_PATH, "utf8");
    assert.match(source, /capturedCount/);
    assert.doesNotMatch(source, /capturedRecords/);
    assert.match(source, /resetRecorder/);
    assert.match(source, /captureBlockGenerationRef/);
  });

  it("movement safety reminders are shown before and during capture", () => {
    const pageSource = readFileSync(PAGE_PATH, "utf8");
    const protocolSource = readFileSync(
      join(process.cwd(), "app/volunteer/shoulder-abduction-reach/volunteer-protocol.ts"),
      "utf8",
    );
    assert.match(pageSource, /VOLUNTEER_MOVEMENT_SAFETY_REMINDERS/);
    assert.match(protocolSource, /pain-free range of motion/i);
    assert.match(protocolSource, /Stop immediately for pain, dizziness/i);
    assert.equal((pageSource.match(/<MovementSafetyReminder \/>/g) ?? []).length, 2);
  });

  it("volunteer source files never import dev-capture-sink or dev API helpers", () => {
    for (const filePath of VOLUNTEER_SOURCE_FILES) {
      const source = readFileSync(filePath, "utf8");
      assert.doesNotMatch(source, /from\s+["']@\/app\/lib\/ml-research\/shoulder-abduction-reach\/dev-capture-sink["']/);
      assert.doesNotMatch(source, /from\s+["'][^"']*dev-capture-sink[^"']*["']/);
      assert.doesNotMatch(source, /createDevRepCaptureSink/);
      assert.doesNotMatch(source, /postDevRepCaptureRecord/);
      assert.doesNotMatch(source, /\/api\/dev\//);
    }
  });

  it("persistence client uses research volunteer API routes with omit credentials", () => {
    const source = readFileSync(
      join(process.cwd(), "app/volunteer/shoulder-abduction-reach/volunteer-browser-persistence-client.ts"),
      "utf8",
    );
    assert.match(source, /\/api\/research\/volunteer\/sessions/);
    assert.match(source, /credentials:\s*"omit"/);
    assert.match(source, /cache:\s*"no-store"/);
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /sessionStorage/);
    assert.doesNotMatch(source, /sendBeacon/);
    assert.doesNotMatch(source, /IndexedDB/);
  });

  it("campaign code input is only on consent step and cleared after session creation", () => {
    const source = readFileSync(PAGE_PATH, "utf8");
    const consentSection = source.slice(
      source.indexOf('{step === "consent" ?'),
      source.indexOf('{step === "camera" ?'),
    );
    assert.match(consentSection, /value=\{campaignCode\}/);
    assert.match(source, /setCampaignCode\(""\)/);
    const captureSection = source.slice(
      source.indexOf('{step === "capture" ?'),
      source.indexOf('{step === "summary"'),
    );
    const summarySection = source.slice(source.indexOf('{step === "summary"'));
    assert.doesNotMatch(captureSection, /value=\{campaignCode\}/);
    assert.doesNotMatch(summarySection, /value=\{campaignCode\}/);
    assert.doesNotMatch(source, /sessionToken/);
  });

  for (const filePath of VOLUNTEER_SOURCE_FILES) {
    const label = filePath.replace(process.cwd(), "").replace(/\\/g, "/");
    it(`${label} does not use browser persistent storage or supabase`, () => {
      const source = readFileSync(filePath, "utf8");
      assert.doesNotMatch(source, /supabase/i);
      assert.doesNotMatch(source, /\/api\/dev\//i);
      assert.doesNotMatch(source, /postDevRepCaptureRecord/);
      assert.doesNotMatch(source, /localStorage/);
      assert.doesNotMatch(source, /sessionStorage/);
      assert.doesNotMatch(source, /IndexedDB/);
      assert.doesNotMatch(source, /sendBeacon/);
    });
  }
});
