import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRasqDemoAnalyticsIdempotencyKey } from "./demo-analytics-types";
import type { RasqDemoAnalyticsPayload } from "./demo-analytics-types";
import { mapRasqDemoAnalyticsPersistenceError } from "./demo-analytics-validation";

export const RASQ_DEMO_ANALYTICS_TABLE = "rasq_demo_analytics_events";

let serviceRoleClientOverride: SupabaseClient | null = null;

/** Test-only hook — not used in production. */
export function __setRasqDemoAnalyticsAdminClientForTests(client: SupabaseClient | null): void {
  serviceRoleClientOverride = client;
}

export function getRasqDemoAnalyticsAdminClient(): SupabaseClient | null {
  if (serviceRoleClientOverride) return serviceRoleClientOverride;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type InsertRasqDemoAnalyticsResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: string };

function payloadToInsertRow(payload: RasqDemoAnalyticsPayload): Record<string, unknown> {
  return {
    visitor_session_id: payload.visitorSessionId,
    attempt_id: payload.attemptId,
    event_type: payload.eventType,
    camera_path: payload.cameraPath,
    idempotency_key: buildRasqDemoAnalyticsIdempotencyKey({
      visitorSessionId: payload.visitorSessionId,
      attemptId: payload.attemptId,
      eventType: payload.eventType,
    }),
    is_internal_test: payload.isInternalTest,
  };
}

export async function insertRasqDemoAnalyticsEventInSupabase(
  admin: SupabaseClient,
  payload: RasqDemoAnalyticsPayload,
): Promise<InsertRasqDemoAnalyticsResult> {
  const { error } = await admin.from(RASQ_DEMO_ANALYTICS_TABLE).insert(payloadToInsertRow(payload));

  if (!error) {
    return { ok: true, duplicate: false };
  }

  const isDuplicate =
    error.code === "23505" ||
    (typeof error.message === "string" && error.message.toLowerCase().includes("duplicate"));

  if (isDuplicate) {
    return { ok: true, duplicate: true };
  }

  return { ok: false, error: mapRasqDemoAnalyticsPersistenceError(error.message ?? "Unable to save event.") };
}

export async function processRasqDemoAnalyticsEvent(input: {
  payload: RasqDemoAnalyticsPayload;
  adminClient?: SupabaseClient | null;
}): Promise<InsertRasqDemoAnalyticsResult> {
  const admin =
    input.adminClient !== undefined ? input.adminClient : getRasqDemoAnalyticsAdminClient();
  if (!admin) {
    return { ok: false, error: "Analytics storage is not configured." };
  }
  return insertRasqDemoAnalyticsEventInSupabase(admin, input.payload);
}
