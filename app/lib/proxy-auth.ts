/**
 * Pure proxy authentication helpers for Next.js route protection.
 *
 * Clinician page access is granted only by:
 *   1. A validated Supabase session (checked in proxy.ts via getUser), or
 *   2. A development-only dev_bypass_token_* cookie when NODE_ENV === "development".
 *
 * Legacy cm_token JWT presence is intentionally NOT treated as authentication.
 * Next.js clinician APIs already require Supabase sessions; arbitrary cm_token
 * length checks allowed forged cookies through the page middleware gate.
 */

export const DEV_BYPASS_TOKEN_PREFIX = "dev_bypass_token_" as const;

export function isDevBypassCmToken(
  token: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development" && (token?.startsWith(DEV_BYPASS_TOKEN_PREFIX) ?? false);
}

export type ResolveProxyAuthedInput = {
  supabaseAuthed: boolean;
  cmToken?: string;
  nodeEnv?: string;
};

/**
 * Whether proxy middleware should treat the request as authenticated.
 */
export function resolveProxyAuthed(input: ResolveProxyAuthedInput): boolean {
  if (input.supabaseAuthed) return true;
  return isDevBypassCmToken(input.cmToken, input.nodeEnv);
}

export type ProtectedRouteDecision = "allow" | "json-401" | "redirect-login";

/**
 * Decide how to handle a protected route when authentication has been resolved.
 */
export function getProtectedRouteDecision(
  pathname: string,
  authed: boolean,
  isPublicRoute: boolean,
): ProtectedRouteDecision {
  if (isPublicRoute || authed) return "allow";
  if (pathname.startsWith("/api/")) return "json-401";
  return "redirect-login";
}
