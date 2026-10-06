/**
 * Run: npx tsx --test app/lib/qa/pr313-production-guard.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPr313QaNavEnabled,
  isPr313QaPath,
  isPr313QaPublicInCurrentRuntime,
  shouldBlockPr313QaInProduction,
} from "./pr313-production-guard";

describe("PR313 QA production guard", () => {
  it("matches the full /qa/pr313 route tree", () => {
    assert.equal(isPr313QaPath("/qa/pr313"), true);
    assert.equal(isPr313QaPath("/qa/pr313/rest-countdown"), true);
    assert.equal(isPr313QaPath("/qa/pr313/nav-assessment"), true);
    assert.equal(isPr313QaPath("/qa/other"), false);
  });

  it("blocks production runtimes only", () => {
    assert.equal(
      shouldBlockPr313QaInProduction("/qa/pr313", "production", undefined),
      true,
    );
    assert.equal(
      shouldBlockPr313QaInProduction("/qa/pr313", "development", "production"),
      true,
    );
    assert.equal(
      shouldBlockPr313QaInProduction("/qa/pr313", "development", "preview"),
      false,
    );
    assert.equal(
      shouldBlockPr313QaInProduction("/demo", "production", "production"),
      false,
    );
  });

  it("never enables the floating QA nav in production, even with the flag set", () => {
    assert.equal(isPr313QaNavEnabled("1", "development", undefined), true);
    assert.equal(isPr313QaNavEnabled(undefined, "development", undefined), false);
    assert.equal(isPr313QaNavEnabled("1", "production", undefined), false);
    assert.equal(isPr313QaNavEnabled("1", "production", "preview"), false);
    assert.equal(isPr313QaNavEnabled("1", "development", "production"), false);
  });

  it("allows public access outside production", () => {
    assert.equal(isPr313QaPublicInCurrentRuntime("development", "preview"), true);
    assert.equal(isPr313QaPublicInCurrentRuntime("production", "production"), false);
  });
});
