/**
 * Run: npx tsx --test app/lib/auth/safe-redirect.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveSafeAuthRedirectPath } from "./safe-redirect";

const CLINICIAN = "/clinician";
const ADMIN = "/admin";

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
}

describe("resolveSafeAuthRedirectPath", () => {
  it("keeps internal application paths", () => {
    assert.equal(resolveSafeAuthRedirectPath("/clinician", ADMIN), "/clinician");
    assert.equal(resolveSafeAuthRedirectPath("/admin", CLINICIAN), "/admin");
    assert.equal(
      resolveSafeAuthRedirectPath("/clinician/patients/7c1f?tab=plans#history", CLINICIAN),
      "/clinician/patients/7c1f?tab=plans#history",
    );
    assert.equal(
      resolveSafeAuthRedirectPath("/clinician/search?q=knee%20pain", CLINICIAN),
      "/clinician/search?q=knee%20pain",
    );
  });

  it("falls back to the role default when missing or empty", () => {
    assert.equal(resolveSafeAuthRedirectPath(null, CLINICIAN), CLINICIAN);
    assert.equal(resolveSafeAuthRedirectPath(undefined, ADMIN), ADMIN);
    assert.equal(resolveSafeAuthRedirectPath("", CLINICIAN), CLINICIAN);
  });

  it("rejects absolute URLs", () => {
    for (const value of [
      "https://evil.example",
      "http://evil.example/clinician",
      "HTTPS://evil.example",
      "ftp://evil.example",
    ]) {
      assert.equal(resolveSafeAuthRedirectPath(value, CLINICIAN), CLINICIAN, value);
    }
  });

  it("rejects protocol-relative and backslash variants", () => {
    for (const value of [
      "//evil.example",
      "//evil.example/clinician",
      "/\\evil.example",
      "\\\\evil.example",
      "\\/evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
    ]) {
      assert.equal(resolveSafeAuthRedirectPath(value, CLINICIAN), CLINICIAN, JSON.stringify(value));
    }
  });

  it("rejects script and data schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      assert.equal(resolveSafeAuthRedirectPath(value, CLINICIAN), CLINICIAN, value);
    }
  });

  it("rejects encoded external redirect bypasses", () => {
    for (const value of [
      "/%2F%2Fevil.example",
      "/%2f%2fevil.example",
      "%2F%2Fevil.example",
      "/%5Cevil.example",
      "/%5C%5Cevil.example",
      "/%252F%252Fevil.example",
      "/%25252F%25252Fevil.example",
      "/%09/evil.example",
      "/%0A/evil.example",
      "https%3A%2F%2Fevil.example",
      "%6A%61%76%61%73%63%72%69%70%74%3Aalert(1)",
    ]) {
      assert.equal(resolveSafeAuthRedirectPath(value, CLINICIAN), CLINICIAN, value);
    }
  });

  it("rejects malformed and non-path destinations", () => {
    for (const value of [
      "/clinician%E0%A4%A",
      "/clinician%",
      "clinician",
      "./clinician",
      "../clinician",
      "@evil.example",
      ".evil.example",
      "?next=/clinician",
      "#/clinician",
      " /clinician",
      "/clinician ",
      "/clinician\u0000",
      `/${"a".repeat(2048)}`,
    ]) {
      assert.equal(resolveSafeAuthRedirectPath(value, ADMIN), ADMIN, JSON.stringify(value).slice(0, 60));
    }
  });

  it("always returns a same-origin path", () => {
    const result = resolveSafeAuthRedirectPath("/clinician/../admin", CLINICIAN);
    assert.equal(result, "/admin");
    assert.ok(result.startsWith("/") && !result.startsWith("//"));
  });
});

describe("auth redirect wiring", () => {
  it("login page validates returnTo before redirecting", () => {
    const source = readSource("../../login/page.tsx");
    assert.match(source, /resolveSafeAuthRedirectPath\(returnTo, cfg\.defaultRedirect\)/);
    assert.doesNotMatch(source, /returnTo\s*\|\|/);
  });

  it("auth callback validates next before redirecting", () => {
    const source = readSource("../../api/auth/callback/route.ts");
    assert.match(source, /resolveSafeAuthRedirectPath\(searchParams\.get\("next"\)/);
    assert.doesNotMatch(source, /searchParams\.get\("next"\)\s*\?\?/);
  });
});
