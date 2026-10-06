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
  | { ok: true }
  | { ok: false; error: string };

const STORAGE_UNAVAILABLE =
  "Unable to submit your request right now. Please try again later.";

function isDevelopmentLocalPersistenceAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

async function persistInterest(
  admin: SupabaseClient | null,
  payload: ProviderAccessInterestPayload,
): Promise<{ record: ProviderAccessInterestRecord } | { error: string }> {
  if (admin) {
    const inserted = await insertProviderAccessInterestInSupabase(admin, payload);
    if (!inserted.ok) {
      return { error: mapProviderAccessInterestPersistenceError(inserted.error) };
    }
    return { record: inserted.record };
  }

  if (!isDevelopmentLocalPersistenceAllowed()) {
    return { error: STORAGE_UNAVAILABLE };
  }

  const record = await appendProviderAccessInterestRecordLocal(payload);
  return { record };
}

export async function processProviderAccessInterestSubmit(
  payload: ProviderAccessInterestPayload,
): Promise<ProcessProviderAccessInterestSubmitResult> {
  const admin = getProviderAccessInterestAdminClient();
  const persisted = await persistInterest(admin, payload);

  if ("error" in persisted) {
    return { ok: false, error: persisted.error };
  }

  return { ok: true };
}
