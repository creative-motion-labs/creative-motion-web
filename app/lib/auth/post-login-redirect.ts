import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSafeReturnTo } from "./safe-return-to";
import {
  isClinicianWorkspaceAllowed,
  postLoginPathForAccessState,
  resolveClinicianAccessState,
  type ProviderAccessState,
} from "./provider-authorization";

export async function resolvePostLoginDestination(input: {
  adminClient: SupabaseClient;
  authUserId: string;
  returnToRaw: string | null | undefined;
  roleDefaultRedirect: string;
}): Promise<{ path: string; access: ProviderAccessState }> {
  const access = await resolveClinicianAccessState(
    input.adminClient,
    input.authUserId,
  );

  if (!isClinicianWorkspaceAllowed(access)) {
    return { path: postLoginPathForAccessState(access), access };
  }

  const safeReturn = resolveSafeReturnTo(
    input.returnToRaw,
    input.roleDefaultRedirect,
  );

  return { path: safeReturn, access };
}
