/**
 * Run: npx tsx --test app/lib/auth/recovery-hash-redirect.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  isSupabaseRecoveryHash,
  resolveUpdatePasswordRecoveryRedirect,
} from "./recovery-hash-redirect";

const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("isSupabaseRecoveryHash", () => {
  it("detects type=recovery in the fragment", () => {
    assert.equal(
      isSupabaseRecoveryHash("#access_token=abc&refresh_token=def&type=recovery"),
      true,
    );
  });

  it("ignores empty or non-recovery hashes", () => {
    assert.equal(isSupabaseRecoveryHash(""), false);
    assert.equal(isSupabaseRecoveryHash("#"), false);
    assert.equal(isSupabaseRecoveryHash("#type=signup"), false);
    assert.equal(isSupabaseRecoveryHash("#access_token=x&type=magiclink"), false);
  });
});

describe("resolveUpdatePasswordRecoveryRedirect", () => {
  it("routes root recovery hash to /update-password preserving the hash exactly", () => {
    const hash = "#access_token=abc&refresh_token=def&type=recovery&expires_in=3600";
    assert.equal(resolveUpdatePasswordRecoveryRedirect(hash), `/update-password${hash}`);
  });

  it("returns null for normal root visits", () => {
    assert.equal(resolveUpdatePasswordRecoveryRedirect(""), null);
    assert.equal(resolveUpdatePasswordRecoveryRedirect("#section=platform"), null);
  });
});

describe("recovery redirect wiring (no token logging)", () => {
  it("home page mounts RootRecoveryHashRedirect", () => {
    const home = readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
    assert.match(home, /RootRecoveryHashRedirect/);
  });

  it("redirect helper and component do not log hashes or tokens", () => {
    for (const relative of [
      "app/lib/auth/recovery-hash-redirect.ts",
      "app/components/auth/RootRecoveryHashRedirect.tsx",
    ]) {
      const source = readFileSync(path.join(ROOT, relative), "utf8");
      assert.doesNotMatch(source, /console\.(log|info|debug|warn|error)/);
      assert.doesNotMatch(source, /access_token|refresh_token/);
    }
  });
});

describe("update-password recovery flow (source contract)", () => {
  it("recognizes PASSWORD_RECOVERY, updates password, and signs out", () => {
    const page = readFileSync(path.join(ROOT, "app/(auth)/update-password/page.tsx"), "utf8");
    assert.match(page, /PASSWORD_RECOVERY/);
    assert.match(page, /updateUser\(\{ password \}\)/);
    assert.match(page, /auth\.signOut\(\)/);
    assert.doesNotMatch(page, /console\.(log|info|debug)/);
  });
});
