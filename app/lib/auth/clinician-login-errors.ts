/**
 * Safe clinician login error mapping — no credential or account enumeration.
 */

/** Shown when Supabase rejects email/password (and legacy fallback is disabled). */
export const CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE =
  "Invalid email or password.";

export const CLINICIAN_LOGIN_GENERIC_FAILURE_MESSAGE =
  "Something went wrong. Please try again.";

/** Fail-closed when Supabase is required but not configured (production/staging). */
export const CLINICIAN_LOGIN_UNAVAILABLE_MESSAGE =
  "Sign-in is temporarily unavailable. Please try again later.";

/** Supabase Auth message when email/password do not match a stored identity. */
export const SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE = "Invalid login credentials";

export type ClinicianLoginBackend =
  | { kind: "use_supabase" }
  | { kind: "use_legacy_fastapi" }
  | { kind: "fail_closed"; message: string };

export type ClinicianLoginSupabaseErrorAction =
  | { kind: "show_message"; message: string }
  | { kind: "invalid_credentials" }
  | { kind: "legacy_fastapi_fallback" };

function resolveNodeEnv(nodeEnv?: string): string {
  return nodeEnv ?? "production";
}

/**
 * Legacy FastAPI JWT login is allowed only in local development without Supabase env vars.
 */
export function isLegacyClinicianFastApiLoginAllowed(input: {
  supabaseConfigured: boolean;
  nodeEnv?: string;
}): boolean {
  return (
    resolveNodeEnv(input.nodeEnv) === "development" && !input.supabaseConfigured
  );
}

/**
 * Primary login backend selection — production never uses legacy FastAPI.
 */
export function resolveClinicianLoginBackend(input: {
  supabaseConfigured: boolean;
  nodeEnv?: string;
}): ClinicianLoginBackend {
  if (input.supabaseConfigured) {
    return { kind: "use_supabase" };
  }
  if (isLegacyClinicianFastApiLoginAllowed(input)) {
    return { kind: "use_legacy_fastapi" };
  }
  return {
    kind: "fail_closed",
    message: CLINICIAN_LOGIN_UNAVAILABLE_MESSAGE,
  };
}

/**
 * When Supabase Auth is configured in production, legacy FastAPI login must not run:
 * production /api/v1 rewrites are unreachable and cm_token is not accepted by the proxy.
 */
export function resolveClinicianLoginSupabaseError(input: {
  supabaseConfigured: boolean;
  errorMessage: string;
  errorCode?: string;
  nodeEnv?: string;
}): ClinicianLoginSupabaseErrorAction {
  const code = input.errorCode?.toLowerCase() ?? "";
  const message = input.errorMessage.trim();
  const legacyAllowed = isLegacyClinicianFastApiLoginAllowed({
    supabaseConfigured: input.supabaseConfigured,
    nodeEnv: input.nodeEnv,
  });

  if (
    message === SUPABASE_INVALID_LOGIN_CREDENTIALS_MESSAGE ||
    code === "invalid_credentials"
  ) {
    if (input.supabaseConfigured || !legacyAllowed) {
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
