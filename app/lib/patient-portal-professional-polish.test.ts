/**
 * Run: npx tsx --test app/lib/patient-portal-professional-polish.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("patient UI professional polish — touch targets", () => {
  it("primary session controls use the 48px minimum touch class", () => {
    const files = [
      "app/components/patient/PatientLanguageToggle.tsx",
      "app/components/patient/interactive-shoulder/ShoulderLiveStatusRail.tsx",
      "app/components/patient/interactive-shoulder/SoundToggleButton.tsx",
      "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
      "app/components/patient/session/CatalogPatientSessionPlayback.tsx",
    ];
    for (const file of files) {
      assert.match(read(file), /min-h-\[48px\]|h-\[48px\]|PATIENT_PRIMARY_TOUCH_MIN_CLASS|PATIENT_ICON_TOUCH_TARGET_CLASS/);
    }
  });

  it("guided primary buttons remain at or above 48px", () => {
    assert.match(read("app/components/patient/session/PatientGuidedSessionFlow.tsx"), /min-h-\[52px\]/);
  });
});

describe("patient UI professional polish — Arabic readability", () => {
  it("applies patient-arabic-readable on token layout without changing English globals", () => {
    const layout = read("app/patient/[token]/layout.tsx");
    const globals = read("app/globals.css");

    assert.match(layout, /patientPortalArabicClass/);
    assert.match(globals, /\.patient-arabic-readable\s*\{[^}]*font-family:\s*var\(--font-ui-ar\)/);
    assert.match(globals, /\.patient-arabic-readable\s*\{[^}]*line-height:\s*1\.78/);
    assert.match(globals, /letter-spacing:\s*0/);
    assert.doesNotMatch(globals, /Arslan Wessam/);
  });
});

describe("patient UI professional polish — camera tracking reassurance", () => {
  it("ships the indicator wired to snapshot trackingStatus", () => {
    const core = read("app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx");
    const indicator = read(
      "app/components/patient/interactive-shoulder/PatientCameraTrackingIndicator.tsx",
    );

    assert.match(core, /PatientCameraTrackingIndicator/);
    assert.match(core, /trackingStatus=\{snapshot\?\.trackingStatus\}/);
    assert.match(read("app/lib/interactive-shoulder/resolve-patient-camera-tracking-reassurance.ts"), /Camera tracking/);
    assert.match(read("app/lib/interactive-shoulder/resolve-patient-camera-tracking-reassurance.ts"), /تتبع الكاميرا/);
    assert.doesNotMatch(indicator, /poor|Poor|abnormal/i);
  });
});
