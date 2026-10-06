import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE,
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

  it("allows legacy fallback only when Supabase is not configured", () => {
    const result = resolveClinicianLoginSupabaseError({
      supabaseConfigured: false,
      errorMessage: SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE,
    });
    assert.equal(result.kind, "legacy_fastapi_fallback");
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
