import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderAccessInterestPayload } from "./provider-access-interest-validation";

export const PROVIDER_ACCESS_INTEREST_TABLE = "provider_access_interest";

export type ProviderAccessInterestRow = {
  id: string;
  email: string;
  full_name: string | null;
  clinic_name: string | null;
  created_at: string;
};

export type ProviderAccessInterestRecord = ProviderAccessInterestPayload & {
  id: string;
  submittedAt: string;
  source: "public-signup";
};

let serviceRoleClientOverride: SupabaseClient | null = null;

/** Test-only hook — not used in production. */
export function __setProviderAccessInterestAdminClientForTests(
  client: SupabaseClient | null,
): void {
  serviceRoleClientOverride = client;
}

export function getProviderAccessInterestAdminClient(): SupabaseClient | null {
  if (serviceRoleClientOverride) return serviceRoleClientOverride;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function rowToRecord(row: ProviderAccessInterestRow): ProviderAccessInterestRecord {
  return {
    id: row.id,
    submittedAt: row.created_at,
    source: "public-signup",
    email: row.email,
    fullName: row.full_name,
    clinicName: row.clinic_name,
  };
}

function payloadToInsertRow(payload: ProviderAccessInterestPayload): Record<string, unknown> {
  return {
    email: payload.email,
    full_name: payload.fullName,
    clinic_name: payload.clinicName,
  };
}

export type InsertProviderAccessInterestResult =
  | { ok: true; record: ProviderAccessInterestRecord; duplicate: boolean }
  | { ok: false; error: string };

export async function insertProviderAccessInterestInSupabase(
  admin: SupabaseClient,
  payload: ProviderAccessInterestPayload,
): Promise<InsertProviderAccessInterestResult> {
  const { data, error } = await admin
    .from(PROVIDER_ACCESS_INTEREST_TABLE)
    .insert(payloadToInsertRow(payload))
    .select("*")
    .single();

  if (!error && data) {
    return {
      ok: true,
      record: rowToRecord(data as ProviderAccessInterestRow),
      duplicate: false,
    };
  }

  const isDuplicate =
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("duplicate"));

  if (isDuplicate) {
    const { data: existing, error: fetchError } = await admin
      .from(PROVIDER_ACCESS_INTEREST_TABLE)
      .select("*")
      .eq("email", payload.email)
      .maybeSingle();

    if (fetchError || !existing) {
      return {
        ok: false,
        error: fetchError?.message ?? "Duplicate request could not be loaded.",
      };
    }
    return {
      ok: true,
      record: rowToRecord(existing as ProviderAccessInterestRow),
      duplicate: true,
    };
  }

  return { ok: false, error: error?.message ?? "Unable to save request." };
}
