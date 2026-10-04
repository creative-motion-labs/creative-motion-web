/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-leads-flow.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  RASQ_DEMO_CONFIRMATION_EMAIL_SUBJECT,
  RASQ_DEMO_CONFIRMATION_FROM,
  RASQ_DEMO_CONFIRMATION_REPLY_TO,
  __setRasqDemoResendClientForTests,
  buildRasqDemoConfirmationEmailHtml,
  shouldSendRasqDemoConfirmationEmail,
} from "./demo-leads-confirmation-email";
import { RASQ_DEMO_LEADS_TABLE, type RasqDemoLeadRow } from "./demo-leads-supabase-store";
import { processRasqDemoLeadSubmit } from "./demo-leads-submit";
import { validateRasqDemoLeadBody } from "./demo-leads-validation";

type RowStore = Map<string, RasqDemoLeadRow>;

function createMockSupabase(rows: RowStore): SupabaseClient {
  const client = {
    from(table: string) {
      assert.equal(table, RASQ_DEMO_LEADS_TABLE);

      return {
        insert(payload: Record<string, unknown>) {
          const demoSessionId = payload.demo_session_id as string;
          if (rows.has(demoSessionId)) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate key value" },
                }),
              }),
            };
          }
          const row: RasqDemoLeadRow = {
            id: crypto.randomUUID(),
            demo_session_id: demoSessionId,
            name: (payload.name as string | null) ?? null,
            email: (payload.email as string | null) ?? null,
            phone: (payload.phone as null) ?? null,
            main_goal: (payload.main_goal as string | null) ?? null,
            consent_rasq_updates: Boolean(payload.consent_rasq_updates),
            consent_pilot_study: Boolean(payload.consent_pilot_study),
            movement_summary: (payload.movement_summary as Record<string, unknown> | null) ?? null,
            confirmation_email_sent_at: null,
            confirmation_email_last_error: null,
            created_at: new Date().toISOString(),
          };
          rows.set(demoSessionId, row);
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
        select: () => ({
          eq: (_column: string, demoSessionId: string) => ({
            maybeSingle: async () => ({
              data: rows.get(demoSessionId) ?? null,
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => {
            for (const [key, row] of rows.entries()) {
              if (row.id === id) {
                rows.set(key, {
                  ...row,
                  confirmation_email_sent_at:
                    (patch.confirmation_email_sent_at as string | null | undefined) ??
                    row.confirmation_email_sent_at,
                  confirmation_email_last_error:
                    (patch.confirmation_email_last_error as string | null | undefined) ??
                    row.confirmation_email_last_error,
                });
              }
            }
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  return client as unknown as SupabaseClient;
}

const basePayload = {
  demoSessionId: "session-abc",
  name: "Alex",
  email: "alex@example.com",
  phone: null,
  mainGoal: null,
  consentRasqUpdates: false,
  consentPilotStudy: true,
  movementSummary: { sessionDurationSeconds: 120 },
} as const;

describe("RASQ demo lead capture and confirmation email", () => {
  afterEach(() => {
    __setRasqDemoResendClientForTests(undefined);
  });

  it("skips persistence and email for submitIntent skip", async () => {
    const rows: RowStore = new Map();
    const result = await processRasqDemoLeadSubmit({
      payload: { ...basePayload },
      submitIntent: "skip",
      hasContactOrConsent: true,
      adminClient: createMockSupabase(rows),
    });
    assert.equal(result.ok, true);
    if (result.ok && "skipped" in result) {
      assert.equal(result.stored, false);
    }
    assert.equal(rows.size, 0);
    assert.equal(
      shouldSendRasqDemoConfirmationEmail({ submitIntent: "skip", email: "a@b.co" }),
      false,
    );
  });

  it("saves to Supabase before sending confirmation email on share with valid email", async () => {
    const rows: RowStore = new Map();
    let sendCalled = false;

    __setRasqDemoResendClientForTests({
      emails: {
        send: async () => {
          sendCalled = true;
          assert.equal(rows.size, 1, "lead row must exist before Resend is called");
          return { data: { id: "email_1" }, error: null };
        },
      },
    } as unknown as Resend);

    const result = await processRasqDemoLeadSubmit({
      payload: { ...basePayload },
      submitIntent: "share",
      hasContactOrConsent: true,
      adminClient: createMockSupabase(rows),
    });

    assert.equal(result.ok, true);
    if (result.ok && result.stored) {
      assert.equal(result.confirmationEmail.sent, true);
      assert.equal(result.duplicate, false);
    }
    assert.equal(sendCalled, true);
    const row = rows.get("session-abc");
    assert.ok(row?.confirmation_email_sent_at);
  });

  it("stores lead without email when share has contact but no email", async () => {
    const rows: RowStore = new Map();
    __setRasqDemoResendClientForTests({
      emails: {
        send: async () => {
          throw new Error("must not send");
        },
      },
    } as unknown as Resend);

    const result = await processRasqDemoLeadSubmit({
      payload: { ...basePayload, email: null },
      submitIntent: "share",
      hasContactOrConsent: true,
      adminClient: createMockSupabase(rows),
    });

    assert.equal(result.ok, true);
    if (result.ok && result.stored) {
      assert.equal(result.confirmationEmail.sent, false);
      assert.equal(result.confirmationEmail.reason, "no-email");
    }
  });

  it("keeps the lead saved and returns retry when email send fails", async () => {
    const rows: RowStore = new Map();
    __setRasqDemoResendClientForTests({
      emails: {
        send: async () => ({ data: null, error: { message: "provider down" } }),
      },
    } as unknown as Resend);

    const result = await processRasqDemoLeadSubmit({
      payload: { ...basePayload },
      submitIntent: "share",
      hasContactOrConsent: true,
      adminClient: createMockSupabase(rows),
    });

    assert.equal(result.ok, true);
    if (result.ok && result.stored) {
      assert.equal(result.confirmationEmail.sent, false);
      if (result.confirmationEmail.reason === "send-failed") {
        assert.equal(result.confirmationEmail.retry, true);
      }
    }
    assert.equal(rows.size, 1);
    const row = rows.get("session-abc");
    assert.ok(row?.confirmation_email_last_error);
  });

  it("does not re-send confirmation email on duplicate submit when already sent", async () => {
    const rows: RowStore = new Map();
    let sendCount = 0;
    __setRasqDemoResendClientForTests({
      emails: {
        send: async () => {
          sendCount += 1;
          return { data: { id: "email_1" }, error: null };
        },
      },
    } as unknown as Resend);

    const admin = createMockSupabase(rows);
    const first = await processRasqDemoLeadSubmit({
      payload: { ...basePayload },
      submitIntent: "share",
      hasContactOrConsent: true,
      adminClient: admin,
    });
    assert.equal(sendCount, 1);

    const second = await processRasqDemoLeadSubmit({
      payload: { ...basePayload },
      submitIntent: "share",
      hasContactOrConsent: true,
      adminClient: admin,
    });

    assert.equal(sendCount, 1);
    if (second.ok && second.stored) {
      assert.equal(second.duplicate, true);
      assert.equal(second.confirmationEmail.sent, false);
      assert.equal(second.confirmationEmail.reason, "already-sent");
    }
    if (first.ok && first.stored) {
      assert.equal(first.confirmationEmail.sent, true);
    }
  });

  it("keeps marketing consent and pilot interest separate in stored payload", async () => {
    const validated = validateRasqDemoLeadBody({
      demoSessionId: "s1",
      email: "user@example.com",
      consentRasqUpdates: true,
      consentPilotStudy: false,
      submitIntent: "share",
    });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.value.consentRasqUpdates, true);
      assert.equal(validated.value.consentPilotStudy, false);
    }

    const html = buildRasqDemoConfirmationEmailHtml("Sam");
    assert.match(html, /not a marketing subscription/i);
    assert.match(html, /Interactive Movement Demo/i);
    assert.match(html, /not a medical diagnosis/i);
    assert.match(html, /potential pilot opportunities/i);
    assert.match(html, /mailto:aisha@rasqhealth\.com/);
    assert.doesNotMatch(html, /hello@rasqhealth\.com/);
  });

  it("uses branded RASQ confirmation email headers", () => {
    assert.equal(RASQ_DEMO_CONFIRMATION_EMAIL_SUBJECT, "We received your RASQ demo interest");
    assert.equal(RASQ_DEMO_CONFIRMATION_FROM, "RASQ Team <aisha@rasqhealth.com>");
    assert.equal(RASQ_DEMO_CONFIRMATION_REPLY_TO, "aisha@rasqhealth.com");
  });
});
