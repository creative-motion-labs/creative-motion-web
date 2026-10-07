/**
 * Run: npx tsx --test app/components/clinician/remote-upper-limb-battery-profile-card.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

describe("patient profile battery card stays compact", () => {
  it("does not render per-test metrics on the profile card", () => {
    const source = readFileSync(
      join(ROOT, "app/components/clinician/RemoteUpperLimbBatteryResultsCard.tsx"),
      "utf8",
    );
    assert.match(source, /View Assessment Report/);
    assert.match(source, /Completed/);
    assert.match(source, /Therapist review required/);
    assert.equal(source.includes("summary.rows"), false);
    assert.equal(source.includes("Shoulder Abduction"), false);
    assert.equal(source.includes("peakAnglesDeg"), false);
  });

  it("puts full battery metrics on the dedicated report view", () => {
    const source = readFileSync(
      join(ROOT, "app/components/clinician/RemoteUpperLimbBatteryReportView.tsx"),
      "utf8",
    );
    assert.match(source, /summary\.rows/);
    assert.match(source, /metricConvention/);
    assert.match(source, /disclaimer/);
    assert.match(source, /Back to Patient Profile/);
  });
});
