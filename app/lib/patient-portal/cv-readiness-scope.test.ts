/**
 * Run: npx tsx --test app/lib/patient-portal/cv-readiness-scope.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCvReadinessScopeKey, shouldResetCvReadinessScope } from "./cv-readiness-scope";

describe("CV readiness scope", () => {
  it("keys readiness by exercise id and session step", () => {
    assert.equal(buildCvReadinessScopeKey("interactive-shoulder", "preview"), "interactive-shoulder:preview");
    assert.equal(buildCvReadinessScopeKey("sit-to-stand", "active"), "sit-to-stand:active");
  });

  it("resets readiness when exercise or step changes", () => {
    assert.equal(
      shouldResetCvReadinessScope("ex-a:preview", "ex-a:preview"),
      false,
    );
    assert.equal(
      shouldResetCvReadinessScope("ex-a:active", "ex-a:preview"),
      true,
    );
    assert.equal(
      shouldResetCvReadinessScope("ex-b:preview", "ex-a:preview"),
      true,
    );
  });
});
