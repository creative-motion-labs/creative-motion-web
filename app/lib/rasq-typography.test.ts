/**
 * Run: npx tsx --test app/lib/rasq-typography.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FONT_DATA_CLASS,
  FONT_UI_AR_CLASS,
  FONT_UI_EN_CLASS,
  patientPortalArabicClass,
  patientPortalArabicSurfaceClass,
} from "./rasq-typography";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("rasq typography tokens", () => {
  it("defines centralized UI and data font classes", () => {
    const globals = read("app/globals.css");
    const tokens = read("app/tokens.css");

    assert.equal(FONT_UI_EN_CLASS, "font-ui-en");
    assert.equal(FONT_UI_AR_CLASS, "font-ui-ar");
    assert.equal(FONT_DATA_CLASS, "font-data");

    assert.match(globals, /--font-ui-en:/);
    assert.match(globals, /--font-ui-ar:/);
    assert.match(globals, /--font-data:/);
    assert.match(globals, /\.font-ui-en/);
    assert.match(globals, /\.font-ui-ar/);
    assert.match(globals, /\.font-data/);
    assert.match(tokens, /--rasq-font-display:\s*var\(--font-ui-en\)/);
    assert.doesNotMatch(read("app/layout.tsx"), /Space_Grotesk/);
  });

  it("routes Arabic patient portal through IBM Plex Sans Arabic classes", () => {
    assert.equal(patientPortalArabicClass(true), "font-ui-ar patient-arabic-readable");
    assert.equal(patientPortalArabicClass(false), "font-ui-en");
    assert.equal(patientPortalArabicSurfaceClass(true), "font-ui-ar");
    assert.equal(patientPortalArabicSurfaceClass(false), "");

    const layout = read("app/patient/[token]/layout.tsx");
    assert.match(layout, /patientPortalArabicClass/);
    assert.doesNotMatch(layout, /font-inter/);
    assert.doesNotMatch(layout, /font-geist/);
    assert.doesNotMatch(read("app/components/patient/PatientLanguageProvider.tsx"), /IBM_Plex_Sans_Arabic/);
  });
});
