import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isClinicianWorkspaceAllowed,
  isPlatformAdminUser,
  loadProviderAccessState,
  parsePlatformAdminAllowlist,
  postLoginPathForAccessState,
  resolveClinicianAccessState,
} from "./auth/provider-authorization";
import { isDevBypassCmToken } from "./proxy-auth";

export function isClinicianProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/clinician") || pathname.startsWith("/admin");
}

export function isAccessStatusPublicPath(pathname: string): boolean {
  return (
    pathname === "/pending-approval" ||
    pathname === "/access-unavailable"
  );
}

export async function resolveClinicianGateRedirect(input: {
  pathname: string;
  authUserId: string;
  adminClient: SupabaseClient;
  cmToken?: string;
  nodeEnv?: string;
}): Promise<string | null> {
  if (!isClinicianProtectedPath(input.pathname)) return null;
  if (isDevBypassCmToken(input.cmToken, input.nodeEnv)) return null;

  const access = await resolveClinicianAccessState(
    input.adminClient,
    input.authUserId,
  );

  if (isClinicianWorkspaceAllowed(access)) {
    if (input.pathname.startsWith("/admin")) {
      const providerState = await loadProviderAccessState(
        input.adminClient,
        input.authUserId,
      );
      if (
        !isPlatformAdminUser(
          input.authUserId,
          providerState,
          parsePlatformAdminAllowlist(),
        )
      ) {
        return "/clinician";
      }
    }
    return null;
  }

  return postLoginPathForAccessState(access);
}
