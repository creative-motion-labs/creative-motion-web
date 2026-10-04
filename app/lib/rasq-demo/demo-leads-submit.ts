import type { SupabaseClient } from "@supabase/supabase-js";
import { appendRasqDemoLeadRecordLocal } from "./demo-leads-persistence";
import {
  insertRasqDemoLeadInSupabase,
  markRasqDemoLeadConfirmationEmailFailed,
  markRasqDemoLeadConfirmationEmailSent,
  getRasqDemoLeadsAdminClient,
  type RasqDemoLeadRecord,
} from "./demo-leads-supabase-store";
import {
  mapRasqDemoLeadPersistenceError,
  type RasqDemoLeadPayload,
  type RasqDemoLeadSubmitIntent,
} from "./demo-leads-validation";
import {
  sendRasqDemoConfirmationEmail,
  shouldSendRasqDemoConfirmationEmail,
} from "./demo-leads-confirmation-email";

export type RasqDemoLeadConfirmationEmailStatus =
  | { sent: true }
  | { sent: false; reason: "skipped" | "already-sent" | "no-email" }
  | { sent: false; reason: "send-failed"; retry: true; message: string };

export type ProcessRasqDemoLeadSubmitResult =
  | {
      ok: true;
      stored: true;
      id: string;
      duplicate: boolean;
      confirmationEmail: RasqDemoLeadConfirmationEmailStatus;
    }
  | { ok: true; stored: false; skipped: true }
  | { ok: false; error: string };

async function persistLead(
  admin: SupabaseClient | null,
  payload: RasqDemoLeadPayload,
): Promise<{ record: RasqDemoLeadRecord; duplicate: boolean } | { error: string }> {
  if (admin) {
    const inserted = await insertRasqDemoLeadInSupabase(admin, payload);
    if (!inserted.ok) return { error: inserted.error };
    return { record: inserted.record, duplicate: inserted.duplicate };
  }

  const record = await appendRasqDemoLeadRecordLocal(payload);
  return { record, duplicate: false };
}

async function trySendConfirmationEmail(
  admin: SupabaseClient | null,
  record: RasqDemoLeadRecord,
): Promise<RasqDemoLeadConfirmationEmailStatus> {
  if (!record.email) {
    return { sent: false, reason: "no-email" };
  }

  if (record.confirmationEmailSentAt) {
    return { sent: false, reason: "already-sent" };
  }

  const sendResult = await sendRasqDemoConfirmationEmail({
    to: record.email,
    recipientName: record.name,
  });

  if (sendResult.ok) {
    if (admin) {
      await markRasqDemoLeadConfirmationEmailSent(admin, record.id);
    }
    return { sent: true };
  }

  if (admin) {
    await markRasqDemoLeadConfirmationEmailFailed(admin, record.id, sendResult.error);
  }

  return {
    sent: false,
    reason: "send-failed",
    retry: true,
    message:
      "Your details were saved, but we could not send the confirmation email. Please try Share details again in a moment.",
  };
}

export async function processRasqDemoLeadSubmit(input: {
  payload: RasqDemoLeadPayload;
  submitIntent: RasqDemoLeadSubmitIntent;
  hasContactOrConsent: boolean;
  adminClient?: SupabaseClient | null;
}): Promise<ProcessRasqDemoLeadSubmitResult> {
  if (input.submitIntent === "skip") {
    return { ok: true, stored: false, skipped: true };
  }

  if (!input.hasContactOrConsent) {
    return { ok: true, stored: false, skipped: true };
  }

  const admin = input.adminClient !== undefined ? input.adminClient : getRasqDemoLeadsAdminClient();
  const saved = await persistLead(admin, input.payload);
  if ("error" in saved) {
    return { ok: false, error: mapRasqDemoLeadPersistenceError(saved.error) };
  }

  const { record, duplicate } = saved;

  let confirmationEmail: RasqDemoLeadConfirmationEmailStatus = { sent: false, reason: "skipped" };

  if (
    shouldSendRasqDemoConfirmationEmail({
      submitIntent: input.submitIntent,
      email: record.email,
      demoSessionId: record.demoSessionId,
    })
  ) {
    confirmationEmail = await trySendConfirmationEmail(admin, record);
  } else if (!record.email) {
    confirmationEmail = { sent: false, reason: "no-email" };
  }

  return {
    ok: true,
    stored: true,
    id: record.id,
    duplicate,
    confirmationEmail,
  };
}
