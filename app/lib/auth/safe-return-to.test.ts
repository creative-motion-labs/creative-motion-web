import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSafeReturnTo } from "./safe-return-to";

describe("resolveSafeReturnTo", () => {
  const fallback = "/clinician";

  it("accepts safe internal paths", () => {
    assert.equal(resolveSafeReturnTo("/clinician", fallback), "/clinician");
    assert.equal(resolveSafeReturnTo("/clinician/dashboard", fallback), "/clinician/dashboard");
    assert.equal(resolveSafeReturnTo("/patients/123", fallback), "/patients/123");
  });

  it("rejects absolute external URLs", () => {
    assert.equal(resolveSafeReturnTo("https://evil.example", fallback), fallback);
    assert.equal(resolveSafeReturnTo("http://evil.example/path", fallback), fallback);
  });

  it("rejects protocol-relative URLs", () => {
    assert.equal(resolveSafeReturnTo("//evil.example", fallback), fallback);
  });

  it("rejects backslash open redirect forms", () => {
    assert.equal(resolveSafeReturnTo("/\\evil.example", fallback), fallback);
  });

  it("rejects javascript scheme", () => {
    assert.equal(resolveSafeReturnTo("javascript:alert(1)", fallback), fallback);
  });

  it("falls back for malformed values", () => {
    assert.equal(resolveSafeReturnTo("", fallback), fallback);
    assert.equal(resolveSafeReturnTo("clinician", fallback), fallback);
    assert.equal(resolveSafeReturnTo("/%2f%2fevil.example", fallback), fallback);
  });
});
