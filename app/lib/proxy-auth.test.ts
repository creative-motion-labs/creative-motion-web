/**
 * Run: node --import jiti/register --test app/lib/proxy-auth.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  getProtectedRouteDecision,
  isDevBypassCmToken,
  resolveProxyAuthed,
} from "./proxy-auth";

const proxySource = readFileSync(
  path.resolve(import.meta.dirname, "../../proxy.ts"),
  "utf8",
);

describe("resolveProxyAuthed", () => {
  it("does not authenticate a forged cm_token longer than 10 chars", () => {
    const forged = "forged_cm_token_value";
    assert.ok(forged.length > 10);

    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: false,
        cmToken: forged,
        nodeEnv: "production",
      }),
      false,
    );
    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: false,
        cmToken: forged,
        nodeEnv: "development",
      }),
      false,
    );
  });

  it("authenticates when a valid Supabase session is present", () => {
    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: true,
        cmToken: undefined,
        nodeEnv: "production",
      }),
      true,
    );
    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: true,
        cmToken: "forged_cm_token_value",
        nodeEnv: "production",
      }),
      true,
    );
  });

  it("allows dev bypass only in development", () => {
    const devToken = "dev_bypass_token_1234567890";

    assert.equal(
      isDevBypassCmToken(devToken, "development"),
      true,
    );
    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: false,
        cmToken: devToken,
        nodeEnv: "development",
      }),
      true,
    );

    assert.equal(
      isDevBypassCmToken(devToken, "production"),
      false,
    );
    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: false,
        cmToken: devToken,
        nodeEnv: "production",
      }),
      false,
    );
    assert.equal(
      resolveProxyAuthed({
        supabaseAuthed: false,
        cmToken: devToken,
        nodeEnv: "test",
      }),
      false,
    );
  });
});

describe("getProtectedRouteDecision", () => {
  it("redirects unauthenticated clinician page access to login", () => {
    assert.equal(
      getProtectedRouteDecision("/clinician", false, false),
      "redirect-login",
    );
    assert.equal(
      getProtectedRouteDecision("/clinician/patients", false, false),
      "redirect-login",
    );
  });

  it("returns 401 for unauthenticated protected API routes", () => {
    assert.equal(
      getProtectedRouteDecision("/api/clinician/results", false, false),
      "json-401",
    );
  });

  it("allows authenticated clinician routes", () => {
    assert.equal(
      getProtectedRouteDecision("/clinician", true, false),
      "allow",
    );
  });

  it("allows public routes without authentication", () => {
    assert.equal(
      getProtectedRouteDecision("/login", false, true),
      "allow",
    );
    assert.equal(
      getProtectedRouteDecision("/patient/abc-token", false, true),
      "allow",
    );
  });
});

describe("proxy.ts wiring", () => {
  it("does not treat arbitrary cm_token length as authentication", () => {
    assert.doesNotMatch(proxySource, /token\.length\s*>\s*10/);
    assert.doesNotMatch(proxySource, /cmAuthed/);
    assert.match(proxySource, /resolveProxyAuthed/);
  });
});
