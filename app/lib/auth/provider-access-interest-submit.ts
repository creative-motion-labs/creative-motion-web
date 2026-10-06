import type { SupabaseClient } from "@supabase/supabase-js";
import { appendProviderAccessInterestRecordLocal } from "./provider-access-interest-persistence";
import {
  getProviderAccessInterestAdminClient,
  insertProviderAccessInterestInSupabase,
  type ProviderAccessInterestRecord,
} from "./provider-access-interest-store";
import {
  mapProviderAccessInterestPersistenceError,
  type ProviderAccessInterestPayload,
} from "./provider-access-interest-validation";

export type ProcessProviderAccessInterestSubmitResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; error: string };

async function persistInterest(
  admin: SupabaseClient | null,
  payload: ProviderAccessInterestPayload,
): Promise<{ record: ProviderAccessInterestRecord; duplicate: boolean } | { error: string }> {
  if (admin) {
    const inserted = await insertProviderAccessInterestInSupabase(admin, payload);
    if (!inserted.ok) {
      return { error: mapProviderAccessInterestPersistenceError(inserted.error) };
    }
    return { record: inserted.record, duplicate: inserted.duplicate };
  }

  const record = await appendProviderAccessInterestRecordLocal(payload);
  return { record, duplicate: false };
}

export async function processProviderAccessInterestSubmit(
  payload: ProviderAccessInterestPayload,
): Promise<ProcessProviderAccessInterestSubmitResult> {
  const admin = getProviderAccessInterestAdminClient();
  const persisted = await persistInterest(admin, payload);

  if ("error" in persisted) {
    return { ok: false, error: persisted.error };
  }

  return {
    ok: true,
    id: persisted.record.id,
    duplicate: persisted.duplicate,
  };
}
