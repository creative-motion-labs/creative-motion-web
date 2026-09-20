/**
 * Lateral Reach Camera Lab — Runtime QA: error provenance / Retry ownership.
 *
 * Proves the critical ownership boundary: a calibration startup failure that
 * returns lifecycle to "idle" while detector remains "error" must NOT expose
 * the legacy Retry button merely because lifecycle is idle.
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/error-provenance.test.ts"
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLegacyRetryEligible,
  isLegacyStartSessionEligible,
} from "./error-provenance";

// ---------------------------------------------------------------------------
// CRITICAL BUG REPRODUCTION TESTS
// ---------------------------------------------------------------------------

describe("isLegacyRetryEligible — calibration error with lifecycle=idle bug", () => {
  it("calibration error BLOCKS legacy Retry even when lifecycle returned to idle", () => {
    // Reproduces the actual bug scenario:
    // 1. User starts calibration
    // 2. Camera acquisition fails
    // 3. Calibration startup handler sets lifecycle back to "idle"
    // 4. Detector remains in "error" status
    // 5. Old broken condition: detectorStatus === "error" && lifecycle === "idle" → TRUE (WRONG!)
    // 6. New correct condition: detectorStatus === "error" && provenance === "legacy" → FALSE (CORRECT)

    const eligible = isLegacyRetryEligible("error", "calibration");

    assert.strictEqual(
      eligible,
      false,
      "calibration error must NEVER expose legacy Retry",
    );
  });

  it("legacy error ALLOWS legacy Retry", () => {
    const eligible = isLegacyRetryEligible("error", "legacy");

    assert.strictEqual(eligible, true, "legacy error should show legacy Retry");
  });

  it("unknown/null provenance error BLOCKS legacy Retry (fail-closed)", () => {
    const eligible = isLegacyRetryEligible("error", null);

    assert.strictEqual(
      eligible,
      false,
      "unknown provenance must fail closed (no Retry)",
    );
  });
});

describe("isLegacyRetryEligible — non-error states", () => {
  it("idle status blocks Retry regardless of provenance", () => {
    assert.strictEqual(isLegacyRetryEligible("idle", "legacy"), false);
    assert.strictEqual(isLegacyRetryEligible("idle", "calibration"), false);
    assert.strictEqual(isLegacyRetryEligible("idle", null), false);
  });

  it("initializing status blocks Retry", () => {
    assert.strictEqual(isLegacyRetryEligible("initializing", "legacy"), false);
  });

  it("acquiring status blocks Retry", () => {
    assert.strictEqual(isLegacyRetryEligible("acquiring", "legacy"), false);
  });

  it("running status blocks Retry", () => {
    assert.strictEqual(isLegacyRetryEligible("running", "legacy"), false);
  });
});

describe("isLegacyRetryEligible — provenance transitions", () => {
  it("provenance cleared after success prevents stale Retry on unrelated error", () => {
    // Scenario:
    // 1. Legacy start succeeds → provenance cleared to null
    // 2. Later unrelated error occurs
    // 3. Stale provenance should NOT make Retry eligible

    const eligible = isLegacyRetryEligible("error", null);

    assert.strictEqual(
      eligible,
      false,
      "cleared provenance must not resurrect Retry",
    );
  });
});

// ---------------------------------------------------------------------------
// LEGACY START SESSION ELIGIBILITY (bottom control)
// ---------------------------------------------------------------------------

describe("isLegacyStartSessionEligible — calibration error with lifecycle=idle bug", () => {
  it("calibration error BLOCKS legacy Start Session even when lifecycle returned to idle", () => {
    // Critical: reproduces the second blocker:
    // After calibration error, lifecycle returns to "idle", but provenance is "calibration".
    // The bottom "Start Session" button must NOT be shown.

    const eligible = isLegacyStartSessionEligible("error", "calibration");

    assert.strictEqual(
      eligible,
      false,
      "calibration error must NEVER expose legacy Start Session",
    );
  });

  it("legacy error ALLOWS legacy Start Session for recovery", () => {
    const eligible = isLegacyStartSessionEligible("error", "legacy");

    assert.strictEqual(
      eligible,
      true,
      "legacy error should allow legacy Start Session",
    );
  });

  it("unknown/null provenance error BLOCKS legacy Start Session (fail-closed)", () => {
    const eligible = isLegacyStartSessionEligible("error", null);

    assert.strictEqual(
      eligible,
      false,
      "unknown error provenance must fail closed (no Start Session)",
    );
  });

  it("idle status ALLOWS legacy Start Session (normal flow)", () => {
    // Normal non-error idle should show Start Session regardless of provenance
    assert.strictEqual(isLegacyStartSessionEligible("idle", null), true);
    assert.strictEqual(isLegacyStartSessionEligible("idle", "legacy"), true);
    assert.strictEqual(isLegacyStartSessionEligible("idle", "calibration"), true);
  });
});

describe("isLegacyStartSessionEligible — other detector states", () => {
  it("initializing blocks Start Session", () => {
    assert.strictEqual(isLegacyStartSessionEligible("initializing", null), false);
  });

  it("acquiring blocks Start Session", () => {
    assert.strictEqual(isLegacyStartSessionEligible("acquiring", null), false);
  });

  it("running blocks Start Session", () => {
    assert.strictEqual(isLegacyStartSessionEligible("running", null), false);
  });
});
