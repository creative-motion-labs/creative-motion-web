/**
 * Rolling-deployment capability probes for migration 023
 * (plan_sessions.prescribed_side + catalog RPC seventh argument).
 *
 * Safe release behavior:
 * - Migration-first is preferred.
 * - Legacy no-side writes remain operational if application code arrives first.
 * - Side-aware writes fail closed with HTTP 503 until migration 023 is available.
 * - Coordinate migration and app deploy before enabling clinician side-selection UI.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingPrescribedSideColumn,
  normalizePostgresErrorCode,
} from "@/app/api/patient/plan/plan-session-query";

export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
};

export type PrescribedSideCapabilityProbeResult =
  | { ok: true; available: boolean }
  | { ok: false };

/**
 * Probes whether migration 023 storage is available by selecting
 * plan_sessions.prescribed_side with limit 0.
 *
 * Returns available:false only for the exact missing-column signature.
 * Any other error fails closed as ok:false without treating it as legacy.
 */
export async function probePrescribedSideStorageCapability(
  admin: SupabaseClient,
): Promise<PrescribedSideCapabilityProbeResult> {
  const { error } = await admin.from("plan_sessions").select("prescribed_side").limit(0);

  if (!error) {
    return { ok: true, available: true };
  }

  if (isMissingPrescribedSideColumn(error)) {
    return { ok: true, available: false };
  }

  console.error(
    "[probePrescribedSideStorageCapability] unexpected probe error",
    JSON.stringify({ errorCode: normalizePostgresErrorCode(error) }),
  );
  return { ok: false };
}

/**
 * PostgREST reports an unmatched RPC signature when the seventh
 * prescribed-side argument is sent before migration 023 is applied.
 */
export function isMissingPrescribedSideRpcArgument(
  error: PostgrestErrorLike | null | undefined,
): boolean {
  if (!error) return false;

  if (error.code === "PGRST202") {
    const message = (error.message ?? "").toLowerCase();
    return message.includes("p_session_prescribed_sides");
  }

  return false;
}
