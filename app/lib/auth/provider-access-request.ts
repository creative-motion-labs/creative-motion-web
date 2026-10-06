import type { SupabaseClient, User } from "@supabase/supabase-js";
import { parseSafeProviderBody, type EnsureProviderInput } from "./ensure-provider";

export async function upsertPendingProviderAccessRequest(
  adminClient: SupabaseClient,
  user: User,
  body: EnsureProviderInput = {},
): Promise<{ ok: true } | { ok: false; code: string }> {
  const safe = parseSafeProviderBody(body as Record<string, unknown>);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    safe.name ??
    (typeof meta.full_name === "string" ? meta.full_name.trim() : "") ??
    "Provider";
  const email =
    safe.email ??
    (typeof user.email === "string" ? user.email.toLowerCase() : null);

  if (!email) {
    return { ok: false, code: "email_required" };
  }

  const clinicName =
    safe.clinic_name !== undefined
      ? safe.clinic_name
      : typeof meta.clinic_name === "string"
        ? meta.clinic_name.trim() || null
        : null;

  const { error } = await adminClient.from("provider_access_requests").upsert(
    {
      auth_user_id: user.id,
      email,
      full_name: fullName,
      clinic_name: clinicName,
      status: "pending",
    },
    { onConflict: "auth_user_id", ignoreDuplicates: false },
  );

  if (error) {
    if (error.code === "42P01") {
      return { ok: false, code: "table_missing" };
    }
    console.error("[provider-access-request] upsert failed");
    return { ok: false, code: "upsert_failed" };
  }

  return { ok: true };
}

/**
 * Ensures email-confirmation signups get a pending request on first authenticated contact.
 */
export async function ensurePendingAccessRequestFromAuthUser(
  adminClient: SupabaseClient,
  user: User,
): Promise<void> {
  const { data: existingProvider } = await adminClient
    .from("providers")
    .select("approval_status")
    .eq("id", user.id)
    .maybeSingle<{ approval_status: string }>();

  if (existingProvider?.approval_status === "approved") {
    return;
  }

  const { data: existingRequest } = await adminClient
    .from("provider_access_requests")
    .select("auth_user_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (existingRequest) return;

  await upsertPendingProviderAccessRequest(adminClient, user);
}
