/**
 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-patient-ui-contract.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const SESSION = join(ROOT, "app/components/patient/RemoteUpperLimbBatterySession.tsx");
const PAGE = join(ROOT, "app/patient/assessment/[token]/page.tsx");

describe("remote battery patient UX contract", () => {
  it("does not expose Finish Test or clickable Hold Still controls", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.equal(source.includes("Finish Test"), false);
    assert.equal(source.includes("Finish attempt"), false);
    assert.equal(source.includes("Hold Still"), false);
    assert.equal(source.includes("Send Test"), false);
    assert.equal(source.includes("trackingValid"), false);
    assert.equal(source.includes("engineConfig"), false);
    assert.equal(source.includes("sagittal"), false);
    assert.equal(source.includes("calibration"), false);
  });

  it("includes reposition flow between test 1 and test 2", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /reposition_side/);
    assert.match(source, /completeSideReposition/);
    assert.match(source, /reposition-side/);
  });

  it("includes recovery controls only", () => {
    const source = readFileSync(SESSION, "utf8");
    assert.match(source, /Retry Current Test/);
    assert.match(source, /Cancel Assessment/);
  });

  it("submit failure path exposes Send Again and preserves payload", () => {
    const source = readFileSync(PAGE, "utf8");
    assert.match(source, /Send Again/);
    assert.match(source, /completedPayload/);
    assert.match(source, /submitStartedRef/);
  });
});
