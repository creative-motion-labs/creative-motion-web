/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-analytics.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  __resetRasqDemoAnalyticsClientForTests,
  hasRasqDemoAnalyticsEventBeenSent,
  markRasqDemoAnalyticsEventSent,
} from "./demo-analytics-client";
import { buildRasqDemoAnalyticsIdempotencyKey } from "./demo-analytics-types";
import {
  RASQ_DEMO_ANALYTICS_TABLE,
  __setRasqDemoAnalyticsAdminClientForTests,
  insertRasqDemoAnalyticsEventInSupabase,
  processRasqDemoAnalyticsEvent,
} from "./demo-analytics-supabase-store";
import { validateRasqDemoAnalyticsBody } from "./demo-analytics-validation";
import { validateRasqDemoLeadBody, validateRasqDemoLeadShareFormFields } from "./demo-leads-validation";
import { processRasqDemoLeadSubmit } from "./demo-leads-submit";
import { shouldSendRasqDemoConfirmationEmail } from "./demo-leads-confirmation-email";

function createMockAnalyticsSupabase(): {
  client: SupabaseClient;
  keys: Set<string>;
} {
  const keys = new Set<string>();
  const client = {
    from(table: string) {
      assert.equal(table, RASQ_DEMO_ANALYTICS_TABLE);
      return {
        insert(row: Record<string, unknown>) {
          const key = row.idempotency_key as string;
          if (keys.has(key)) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key value" },
            });
          }
          keys.add(key);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, keys };
}

describe("RASQ demo analytics", () => {
  afterEach(() => {
    __resetRasqDemoAnalyticsClientForTests();
    __setRasqDemoAnalyticsAdminClientForTests(null);
  });

  it("dedupes events by idempotency key on the client", () => {
    const key = buildRasqDemoAnalyticsIdempotencyKey({
      visitorSessionId: "v1",
      attemptId: "a1",
      eventType: "demo_completed",
    });
    assert.equal(hasRasqDemoAnalyticsEventBeenSent(key), false);
    markRasqDemoAnalyticsEventSent(key);
    assert.equal(hasRasqDemoAnalyticsEventBeenSent(key), true);
  });

  it("uses visitor-scoped idempotency for demo_visit", () => {
    const key = buildRasqDemoAnalyticsIdempotencyKey({
      visitorSessionId: "visitor-1",
      attemptId: "attempt-ignored",
      eventType: "demo_visit",
    });
    assert.equal(key, "visitor-1:demo_visit");
  });

  it("records demo_completed without follow-up events", async () => {
    const { client, keys } = createMockAnalyticsSupabase();
    __setRasqDemoAnalyticsAdminClientForTests(client);

    const payload = {
      visitorSessionId: "v-complete",
      attemptId: "attempt-complete",
      eventType: "demo_completed" as const,
      cameraPath: "no_camera" as const,
      isInternalTest: false,
    };

    const validated = validateRasqDemoAnalyticsBody({
      ...payload,
      eventType: payload.eventType,
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const result = await processRasqDemoAnalyticsEvent({ payload: validated.value });
    assert.equal(result.ok, true);
    assert.equal(keys.size, 1);
    assert.ok(keys.has("attempt-complete:demo_completed"));
  });

  it("treats duplicate analytics inserts as success", async () => {
    const { client } = createMockAnalyticsSupabase();
    __setRasqDemoAnalyticsAdminClientForTests(client);

    const payload = {
      visitorSessionId: "v-dup",
      attemptId: "a-dup",
      eventType: "demo_started" as const,
      cameraPath: "camera" as const,
      isInternalTest: false,
    };

    const first = await insertRasqDemoAnalyticsEventInSupabase(client, payload);
    const second = await insertRasqDemoAnalyticsEventInSupabase(client, payload);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.duplicate, false);
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.duplicate, true);
  });

  it("distinguishes follow-up interested, not interested, and skipped event types", () => {
    for (const eventType of [
      "follow_up_interested",
      "follow_up_not_interested",
      "follow_up_skipped",
    ] as const) {
      const validated = validateRasqDemoAnalyticsBody({
        visitorSessionId: "v-fu",
        attemptId: "a-fu",
        eventType,
      });
      assert.equal(validated.ok, true);
    }
  });

  it("requires email or phone for share leads but keeps optional consents separate", () => {
    const blocked = validateRasqDemoLeadBody({
      demoSessionId: "s1",
      submitIntent: "share",
      consentRasqUpdates: true,
      consentPilotStudy: true,
    });
    assert.equal(blocked.ok, false);

    const phoneOnly = validateRasqDemoLeadBody({
      demoSessionId: "s2",
      phone: "+1 555 0100",
      submitIntent: "share",
      consentRasqUpdates: false,
      consentPilotStudy: false,
    });
    assert.equal(phoneOnly.ok, true);
    if (phoneOnly.ok) {
      assert.equal(phoneOnly.value.consentRasqUpdates, false);
      assert.equal(phoneOnly.value.consentPilotStudy, false);
    }

    const formOk = validateRasqDemoLeadShareFormFields({
      name: "",
      email: "",
      phone: "+1 555 0100",
      mainGoal: "",
      consentRasqUpdates: false,
      consentPilotStudy: false,
    });
    assert.equal(formOk.ok, true);
  });

  it("does not send confirmation email for internal test demo session ids", () => {
    assert.equal(
      shouldSendRasqDemoConfirmationEmail({
        submitIntent: "share",
        email: "user@example.com",
        demoSessionId: "rasq-demo-internal-test-abc",
      }),
      false,
    );
  });

  it("lead submission succeeds when analytics storage is unavailable", async () => {
    __setRasqDemoAnalyticsAdminClientForTests(null);

    const leadResult = await processRasqDemoLeadSubmit({
      payload: {
        demoSessionId: "lead-only",
        name: null,
        email: "lead@example.com",
        phone: null,
        mainGoal: null,
        consentRasqUpdates: false,
        consentPilotStudy: false,
        movementSummary: { sessionDurationSeconds: 60 },
      },
      submitIntent: "share",
      hasContactOrConsent: true,
      adminClient: null,
    });

    assert.equal(leadResult.ok, true);
  });
});
