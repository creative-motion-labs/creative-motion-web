/**
 * Lateral Reach Camera Lab — Terminal Result UI: End Attempt eligibility.
 *
 * Pure decision helper gating the lab-only "End Attempt" control. The
 * control must only be available while the engine is actively running and
 * has not already reached a terminal state — never before the engine
 * exists, and never again once a terminal result has been produced.
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/terminal-attempt-control.test.ts"
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canEndAttemptWindow } from "./terminal-attempt-control";

describe("canEndAttemptWindow — engine running and not terminal", () => {
  it("allows End Attempt while running with a non-terminal engine", () => {
    assert.strictEqual(canEndAttemptWindow("running", false), true);
  });

  it("blocks End Attempt once the engine is already terminal", () => {
    assert.strictEqual(canEndAttemptWindow("running", true), false);
  });

  it("blocks End Attempt when no engine state exists yet", () => {
    assert.strictEqual(canEndAttemptWindow("running", null), false);
  });
});

describe("canEndAttemptWindow — non-running detector states", () => {
  it("blocks End Attempt when idle", () => {
    assert.strictEqual(canEndAttemptWindow("idle", false), false);
  });

  it("blocks End Attempt when initializing", () => {
    assert.strictEqual(canEndAttemptWindow("initializing", false), false);
  });

  it("blocks End Attempt when acquiring (engine not yet started)", () => {
    assert.strictEqual(canEndAttemptWindow("acquiring", false), false);
  });

  it("blocks End Attempt on error", () => {
    assert.strictEqual(canEndAttemptWindow("error", false), false);
  });
});
