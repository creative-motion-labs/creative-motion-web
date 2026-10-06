import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedApprovedUser } from "./require-approved-provider";

/**
 * Upper-limb route handlers use injected getAuthenticatedUser — enforce approval here.
 */
export async function getUpperLimbApprovedProviderUserId(
  sessionClient: SupabaseClient,
  adminClient: SupabaseClient,
): Promise<{ id: string } | null> {
  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return null;
  return { id: auth.user.id };
}

export async function getUpperLimbApprovedProviderUserIdOrResponse(
  sessionClient: SupabaseClient,
  adminClient: SupabaseClient,
): Promise<
  | { ok: true; id: string }
  | { ok: false; response: import("next/server").NextResponse }
> {
  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, id: auth.user.id };
}
