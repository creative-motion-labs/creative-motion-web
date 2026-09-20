/**
 * Run: npx tsx --test app/lib/research/volunteer-crypto.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateVolunteerDeletionCode,
  generateVolunteerSessionToken,
  hashVolunteerSecret,
  verifyVolunteerSecretHash,
} from "./volunteer-crypto";

describe("volunteer-crypto", () => {
  it("generates session tokens with at least 32 bytes entropy", () => {
    const token = generateVolunteerSessionToken();
    const decoded = Buffer.from(token, "base64url");
    assert.ok(decoded.length >= 32);
  });

  it("hashes secrets deterministically", () => {
    const a = hashVolunteerSecret("alpha");
    const b = hashVolunteerSecret("alpha");
    const c = hashVolunteerSecret("beta");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it("does not store recoverable raw token from hash", () => {
    const token = generateVolunteerSessionToken();
    const hash = hashVolunteerSecret(token);
    assert.notEqual(hash, token);
    assert.ok(!hash.includes(token.slice(0, 8)));
  });

  it("verifies secret hashes with timing-safe comparison", () => {
    const raw = "pilot-code-123";
    const hash = hashVolunteerSecret(raw);
    assert.equal(verifyVolunteerSecretHash(raw, hash), true);
    assert.equal(verifyVolunteerSecretHash("wrong", hash), false);
  });

  it("generates human-readable deletion codes", () => {
    const code = generateVolunteerDeletionCode();
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });
});
