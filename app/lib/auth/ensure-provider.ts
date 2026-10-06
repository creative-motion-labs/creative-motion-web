import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type ProviderRow = {
  id: string;
  name: string;
  clinic_name: string | null;
  email: string | null;
  role: string;
  approval_status?: string;
  created_at: string;
  updated_at: string;
};

export type EnsureProviderInput = {
  name?: string;
  clinic_name?: string | null;
  email?: string;
};

export type EnsureProviderResult =
  | { ok: true; provider: ProviderRow; created: boolean }
  | { ok: false; pending: true; reason: string }
  | { ok: false; pending: false; error: string; code?: "not_found" | "forbidden" };

const MAX_FIELD_LEN = 200;

function sanitizeText(value: unknown, maxLen = MAX_FIELD_LEN): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return undefined;
  return trimmed;
}

function sanitizeEmail(value: unknown): string | undefined {
  const email = sanitizeText(value, 254);
  if (!email || !email.includes("@")) return undefined;
  return email.toLowerCase();
}

/** Strip untrusted keys; never accept provider id, role, or approval from the client. */
export function parseSafeProviderBody(raw: Record<string, unknown>): EnsureProviderInput {
  const clinic = raw.clinic_name;
  return {
    name: sanitizeText(raw.name),
    clinic_name:
      clinic === null
        ? null
        : sanitizeText(clinic) ?? undefined,
    email: sanitizeEmail(raw.email),
  };
}

function metadataDefaults(user: User): EnsureProviderInput {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    name:
      sanitizeText(meta.full_name) ??
      sanitizeText(meta.name),
    clinic_name: sanitizeText(meta.clinic_name) ?? null,
    email: sanitizeEmail(user.email),
  };
}

function resolveInsertFields(
  user: User,
  body: EnsureProviderInput,
): { name: string; clinic_name: string | null; email: string | null } {
  const meta = metadataDefaults(user);
  const name =
    body.name ??
    meta.name ??
    sanitizeEmail(user.email) ??
    "Provider";
  const clinic_name =
    body.clinic_name !== undefined ? body.clinic_name : meta.clinic_name ?? null;
  const email =
    body.email ?? meta.email ?? sanitizeEmail(user.email) ?? null;

  return { name, clinic_name, email };
}

const PROVIDER_SELECT =
  "id, name, clinic_name, email, role, approval_status, created_at, updated_at";

/**
 * Returns an existing provider row only — never creates a row (pilot access control).
 */
export async function ensureProviderForUser(
  writeClient: SupabaseClient,
  user: User,
  _body: EnsureProviderInput = {},
): Promise<EnsureProviderResult> {
  const { data: existing, error: selectErr } = await writeClient
    .from("providers")
    .select(PROVIDER_SELECT)
    .eq("id", user.id)
    .maybeSingle<ProviderRow>();

  if (selectErr) {
    if (selectErr.code === "42P01") {
      return {
        ok: false,
        pending: true,
        reason: "providers_table_not_yet_migrated",
      };
    }
    console.error("[ensure-provider] select error");
    return { ok: false, pending: false, error: "provider_lookup_failed" };
  }

  if (existing) {
    return { ok: true, provider: existing, created: false };
  }

  return {
    ok: false,
    pending: false,
    error: "provider_not_provisioned",
    code: "not_found",
  };
}

/**
 * Updates non-privileged profile fields for an existing approved provider.
 */
export async function updateProviderProfileForUser(
  writeClient: SupabaseClient,
  user: User,
  body: EnsureProviderInput,
): Promise<EnsureProviderResult> {
  const existingResult = await ensureProviderForUser(writeClient, user);
  if (!existingResult.ok) return existingResult;

  const fields = resolveInsertFields(user, body);
  const { data: updated, error } = await writeClient
    .from("providers")
    .update({
      name: fields.name,
      clinic_name: fields.clinic_name,
      email: fields.email,
    })
    .eq("id", user.id)
    .select(PROVIDER_SELECT)
    .single<ProviderRow>();

  if (error) {
    console.error("[ensure-provider] profile update error");
    return { ok: false, pending: false, error: "provider_update_failed" };
  }

  return { ok: true, provider: updated, created: false };
}

export async function upsertApprovedProviderForUser(
  writeClient: SupabaseClient,
  user: User,
  body: EnsureProviderInput,
  reviewedBy: string,
): Promise<EnsureProviderResult> {
  const fields = resolveInsertFields(user, body);
  const now = new Date().toISOString();

  const { data, error } = await writeClient
    .from("providers")
    .upsert(
      {
        id: user.id,
        name: fields.name,
        clinic_name: fields.clinic_name,
        email: fields.email,
        role: "provider",
        approval_status: "approved",
        approved_at: now,
        approved_by: reviewedBy,
      },
      { onConflict: "id" },
    )
    .select(PROVIDER_SELECT)
    .single<ProviderRow>();

  if (error) {
    console.error("[ensure-provider] approved upsert error");
    return { ok: false, pending: false, error: "provider_approval_provision_failed" };
  }

  return { ok: true, provider: data, created: true };
}

export function buildProviderWriteClient(
  supabaseUrl: string,
  serviceRoleKey: string | undefined,
  sessionClient: SupabaseClient,
): SupabaseClient {
  if (serviceRoleKey) {
    return createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return sessionClient;
}
