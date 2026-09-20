/**
 * Lateral Reach Camera Lab — Terminal Result UI: source-level regression.
 *
 * Guards the wiring itself, not just the pure eligibility helper in
 * terminal-attempt-control.test.ts: page.tsx must actually call
 * detector.endAttemptWindow() and must actually read/render
 * snapshot.finalResult. A future edit that quietly drops either call would
 * leave canEndAttemptWindow() green while the lab control silently breaks.
 *
 * Source-level (string) check only — no React Testing Library, no DOM
 * rendering, no new dependency.
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/terminal-result-ui.test.ts"
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "page.tsx",
);

function readPageSource(): string {
  return readFileSync(PAGE_SOURCE_PATH, "utf8");
}

describe("Terminal Result UI — page.tsx wiring", () => {
  it("explicitly calls detectorRef.current?.endAttemptWindow()", () => {
    const source = readPageSource();
    assert.ok(
      source.includes("detectorRef.current?.endAttemptWindow()"),
      "page.tsx must call detectorRef.current?.endAttemptWindow() to bridge the End Attempt control to the detector",
    );
  });

  it("reads snapshot?.finalResult to gate rendering the terminal result panel", () => {
    const source = readPageSource();
    assert.ok(
      source.includes("snapshot?.finalResult"),
      "page.tsx must read snapshot?.finalResult to decide when the terminal result panel is shown",
    );
  });

  it("renders fields from snapshot.finalResult, not just gates on its presence", () => {
    const source = readPageSource();
    assert.ok(
      source.includes("snapshot.finalResult.completionState"),
      "page.tsx must render snapshot.finalResult.completionState verbatim once finalResult is present",
    );
  });
});
