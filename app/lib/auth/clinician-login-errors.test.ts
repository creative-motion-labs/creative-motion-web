import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE,
  CLINICIAN_LOGIN_UNAVAILABLE_MESSAGE,
  isLegacyClinicianFastApiLoginAllowed,
  resolveClinicianLoginBackend,
  resolveClinicianLoginSupabaseError,
  SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE,
} from "./clinician-login-errors";

describe("resolveClinicianLoginSupabaseError", () => {
  it("does not use legacy FastAPI fallback when Supabase is configured", () => {
    const result = resolveClinicianLoginSupabaseError({
      supabaseConfigured: true,
      errorMessage: SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE,
      errorCode: "invalid_credentials",
    });
    assert.equal(result.kind, "invalid_credentials");
  });

  it("allows legacy fallback only in development when Supabase is not configured", () => {
    const result = resolveClinicianLoginSupabaseError({
      supabaseConfigured: false,
      errorMessage: SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE,
      nodeEnv: "development",
    });
    assert.equal(result.kind, "legacy_fastapi_fallback");
  });

  it("does not use legacy FastAPI fallback in production when Supabase is not configured", () => {
    const result = resolveClinicianLoginSupabaseError({
      supabaseConfigured: false,
      errorMessage: SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE,
      nodeEnv: "production",
    });
    assert.equal(result.kind, "invalid_credentials");
  });

  it("does not use legacy FastAPI fallback in production when Supabase is configured", () => {
    const result = resolveClinicianLoginSupabaseError({
      supabaseConfigured: true,
      errorMessage: SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE,
      nodeEnv: "production",
    });
    assert.equal(result.kind, "invalid_credentials");
  });

  it("surfaces email-not-confirmed without falling back to FastAPI", () => {
    const result = resolveClinicianLoginSupabaseError({
      supabaseConfigured: true,
      errorMessage: "Email not confirmed",
    });
    assert.equal(result.kind, "show_message");
    if (result.kind === "show_message") {
      assert.match(result.message, /confirmation/i);
    }
  });

  it("uses a safe generic invalid-credentials message constant", () => {
    assert.match(CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE, /Invalid email or password/i);
  });
});

describe("resolveClinicianLoginBackend", () => {
  it("uses Supabase when configured in production", () => {
    const result = resolveClinicianLoginBackend({
      supabaseConfigured: true,
      nodeEnv: "production",
    });
    assert.equal(result.kind, "use_supabase");
  });

  it("fail-closed in production when Supabase is not configured", () => {
    const result = resolveClinicianLoginBackend({
      supabaseConfigured: false,
      nodeEnv: "production",
    });
    assert.equal(result.kind, "fail_closed");
    if (result.kind === "fail_closed") {
      assert.equal(result.message, CLINICIAN_LOGIN_UNAVAILABLE_MESSAGE);
    }
  });

  it("fail-closed in preview/staging when Supabase is not configured", () => {
    const result = resolveClinicianLoginBackend({
      supabaseConfigured: false,
      nodeEnv: "test",
    });
    assert.equal(result.kind, "fail_closed");
  });

  it("allows legacy FastAPI only in development without Supabase", () => {
    const result = resolveClinicianLoginBackend({
      supabaseConfigured: false,
      nodeEnv: "development",
    });
    assert.equal(result.kind, "use_legacy_fastapi");
  });
});

describe("isLegacyClinicianFastApiLoginAllowed", () => {
  it("is false when Supabase is configured", () => {
    assert.equal(
      isLegacyClinicianFastApiLoginAllowed({
        supabaseConfigured: true,
        nodeEnv: "development",
      }),
      false,
    );
  });

  it("is false in production without Supabase", () => {
    assert.equal(
      isLegacyClinicianFastApiLoginAllowed({
        supabaseConfigured: false,
        nodeEnv: "production",
      }),
      false,
    );
  });

  it("is true in development without Supabase", () => {
    assert.equal(
      isLegacyClinicianFastApiLoginAllowed({
        supabaseConfigured: false,
        nodeEnv: "development",
      }),
      true,
    );
  });
});
