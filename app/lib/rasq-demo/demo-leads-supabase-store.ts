import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RasqDemoLeadPayload } from "./demo-leads-validation";

export const RASQ_DEMO_LEADS_TABLE = "rasq_demo_leads";

export type RasqDemoLeadRow = {
  id: string;
  demo_session_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  main_goal: string | null;
  consent_rasq_updates: boolean;
  consent_pilot_study: boolean;
  movement_summary: Record<string, unknown> | null;
  confirmation_email_sent_at: string | null;
  confirmation_email_last_error: string | null;
  created_at: string;
};

export type RasqDemoLeadRecord = RasqDemoLeadPayload & {
  id: string;
  submittedAt: string;
  source: "rasq-public-demo";
  confirmationEmailSentAt: string | null;
  confirmationEmailLastError: string | null;
};

let serviceRoleClientOverride: SupabaseClient | null = null;

/** Test-only hook — not used in production. */
export function __setRasqDemoLeadsAdminClientForTests(client: SupabaseClient | null): void {
  serviceRoleClientOverride = client;
}

export function getRasqDemoLeadsAdminClient(): SupabaseClient | null {
  if (serviceRoleClientOverride) return serviceRoleClientOverride;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function rowToRecord(row: RasqDemoLeadRow): RasqDemoLeadRecord {
  return {
    id: row.id,
    submittedAt: row.created_at,
    source: "rasq-public-demo",
    demoSessionId: row.demo_session_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    mainGoal: (row.main_goal as RasqDemoLeadPayload["mainGoal"]) ?? null,
    consentRasqUpdates: row.consent_rasq_updates,
    consentPilotStudy: row.consent_pilot_study,
    movementSummary: row.movement_summary,
    confirmationEmailSentAt: row.confirmation_email_sent_at,
    confirmationEmailLastError: row.confirmation_email_last_error,
  };
}

function payloadToInsertRow(payload: RasqDemoLeadPayload): Record<string, unknown> {
  return {
    demo_session_id: payload.demoSessionId,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    main_goal: payload.mainGoal,
    consent_rasq_updates: payload.consentRasqUpdates,
    consent_pilot_study: payload.consentPilotStudy,
    movement_summary: payload.movementSummary,
  };
}

export type InsertRasqDemoLeadResult =
  | { ok: true; record: RasqDemoLeadRecord; duplicate: boolean }
  | { ok: false; error: string };

export async function insertRasqDemoLeadInSupabase(
  admin: SupabaseClient,
  payload: RasqDemoLeadPayload,
): Promise<InsertRasqDemoLeadResult> {
  const { data, error } = await admin
    .from(RASQ_DEMO_LEADS_TABLE)
    .insert(payloadToInsertRow(payload))
    .select("*")
    .single();

  if (!error && data) {
    return { ok: true, record: rowToRecord(data as RasqDemoLeadRow), duplicate: false };
  }

  const isDuplicate =
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("duplicate"));

  if (isDuplicate) {
    const { data: existing, error: fetchError } = await admin
      .from(RASQ_DEMO_LEADS_TABLE)
      .select("*")
      .eq("demo_session_id", payload.demoSessionId)
      .maybeSingle();

    if (fetchError || !existing) {
      return { ok: false, error: fetchError?.message ?? "Duplicate lead could not be loaded." };
    }
    return {
      ok: true,
      record: rowToRecord(existing as RasqDemoLeadRow),
      duplicate: true,
    };
  }

  return { ok: false, error: error?.message ?? "Unable to save lead." };
}

export async function markRasqDemoLeadConfirmationEmailSent(
  admin: SupabaseClient,
  leadId: string,
): Promise<void> {
  const { error } = await admin
    .from(RASQ_DEMO_LEADS_TABLE)
    .update({
      confirmation_email_sent_at: new Date().toISOString(),
      confirmation_email_last_error: null,
    })
    .eq("id", leadId);
  if (error) throw error;
}

export async function markRasqDemoLeadConfirmationEmailFailed(
  admin: SupabaseClient,
  leadId: string,
  message: string,
): Promise<void> {
  const trimmed = message.trim().slice(0, 500);
  const { error } = await admin
    .from(RASQ_DEMO_LEADS_TABLE)
    .update({ confirmation_email_last_error: trimmed || "send-failed" })
    .eq("id", leadId);
  if (error) throw error;
}
