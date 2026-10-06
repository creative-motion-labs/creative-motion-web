/**
 * Safe clinician login error mapping — no credential or account enumeration.
 */

/** Shown when Supabase rejects email/password (and legacy fallback is disabled). */
export const CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE =
  "Invalid email or password.";

export const CLINICIAN_LOGIN_GENERIC_FAILURE_MESSAGE =
  "Something went wrong. Please try again.";

/** Supabase Auth message when email/password do not match a stored identity. */
export const SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE = "Invalid login credentials";

export type ClinicianLoginSupabaseErrorAction =
  | { kind: "show_message"; message: string }
  | { kind: "invalid_credentials" }
  | { kind: "legacy_fastapi_fallback" };

/**
 * When Supabase Auth is configured in production, legacy FastAPI login must not run:
 * production /api/v1 rewrites are unreachable and cm_token is not accepted by the proxy.
 */
export function resolveClinicianLoginSupabaseError(input: {
  supabaseConfigured: boolean;
  errorMessage: string;
  errorCode?: string;
}): ClinicianLoginSupabaseErrorAction {
  const code = input.errorCode?.toLowerCase() ?? "";
  const message = input.errorMessage.trim();

  if (
    message === SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE ||
    code === "invalid_credentials"
  ) {
    if (input.supabaseConfigured) {
      return { kind: "invalid_credentials" };
    }
    return { kind: "legacy_fastapi_fallback" };
  }

  if (message.toLowerCase().includes("email not confirmed")) {
    return {
      kind: "show_message",
      message:
        "Email confirmation is required before sign-in. Check your inbox or use password recovery if needed.",
    };
  }

  if (message) {
    return { kind: "show_message", message };
  }

  return { kind: "show_message", message: CLINICIAN_LOGIN_GENERIC_FAILURE_MESSAGE };
}
