/**
 * plan_sessions read path for GET /api/patient/plan.
 *
 * Modern schemas include source_program_session_id (migration 017).
 * Legacy Production schemas omit it; only that exact missing-column case
 * triggers a narrow legacy projection retry.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanSessionRow = {
  id: string;
  session_number: number;
  title: string;
  exercises: unknown;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  source_program_session_id: string | null;
  prescribed_side: string | null;
};

type LegacyPlanSessionRow = Omit<PlanSessionRow, "source_program_session_id">;

export type PlanSessionQueryMode = "modern" | "legacy";

export type FetchPlanSessionsSuccess = {
  ok: true;
  sessions: PlanSessionRow[];
  queryMode: PlanSessionQueryMode;
};

export type FetchPlanSessionsFailure = {
  ok: false;
  errorCode: string | null;
  queryMode: PlanSessionQueryMode;
  reason: "query_failed" | "legacy_retry_failed";
};

export type FetchPlanSessionsResult = FetchPlanSessionsSuccess | FetchPlanSessionsFailure;

export const MODERN_PLAN_SESSION_SELECT =
  "id, session_number, title, exercises, status, scheduled_at, completed_at, source_program_session_id, prescribed_side";

export const LEGACY_PLAN_SESSION_SELECT =
  "id, session_number, title, exercises, status, scheduled_at, completed_at";

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
};

export function isMissingSourceProgramSessionIdColumn(
  error: PostgrestErrorLike | null | undefined,
): boolean {
  if (!error) return false;

  const code = normalizePostgresErrorCode(error);
  if (code !== "42703") return false;

  const message = (error.message ?? "").toLowerCase();
  return message.includes("source_program_session_id");
}

export function isMissingPrescribedSideColumn(
  error: PostgrestErrorLike | null | undefined,
): boolean {
  if (!error) return false;

  const code = normalizePostgresErrorCode(error);
  if (code !== "42703") return false;

  const message = (error.message ?? "").toLowerCase();
  return message.includes("prescribed_side");
}

export function normalizePostgresErrorCode(error: PostgrestErrorLike): string | null {
  if (error.code && /^\d{5}$/.test(error.code)) {
    return error.code;
  }

  const message = error.message ?? "";
  const match = message.match(/\b(\d{5})\b/);
  return match?.[1] ?? null;
}

async function queryPlanSessions(
  admin: SupabaseClient,
  planId: string,
  select: string,
): Promise<{ data: unknown[] | null; error: PostgrestErrorLike | null }> {
  const { data, error } = await admin
    .from("plan_sessions")
    .select(select)
    .eq("plan_id", planId)
    .order("session_number", { ascending: true });

  return {
    data: (data as unknown[] | null) ?? null,
    error: (error as PostgrestErrorLike | null) ?? null,
  };
}

function mapLegacyRows(rows: readonly LegacyPlanSessionRow[]): PlanSessionRow[] {
  return rows.map((row) => ({
    ...row,
    source_program_session_id: null,
    prescribed_side: null,
  }));
}

function mapLegacyRowsWithSource(rows: readonly (LegacyPlanSessionRow & { source_program_session_id?: string | null })[]): PlanSessionRow[] {
  return rows.map((row) => ({
    ...row,
    source_program_session_id: row.source_program_session_id ?? null,
    prescribed_side: null,
  }));
}

export async function fetchPlanSessionsForPatientPortal(
  admin: SupabaseClient,
  planId: string,
): Promise<FetchPlanSessionsResult> {
  const modernResult = await queryPlanSessions(admin, planId, MODERN_PLAN_SESSION_SELECT);

  if (!modernResult.error) {
    return {
      ok: true,
      sessions: (modernResult.data ?? []) as PlanSessionRow[],
      queryMode: "modern",
    };
  }

  if (isMissingPrescribedSideColumn(modernResult.error)) {
    const legacyWithSourceSelect =
      "id, session_number, title, exercises, status, scheduled_at, completed_at, source_program_session_id";
    const legacyWithSourceResult = await queryPlanSessions(admin, planId, legacyWithSourceSelect);

    if (!legacyWithSourceResult.error) {
      return {
        ok: true,
        sessions: mapLegacyRowsWithSource(
          (legacyWithSourceResult.data ?? []) as (LegacyPlanSessionRow & {
            source_program_session_id?: string | null;
          })[],
        ),
        queryMode: "legacy",
      };
    }

    if (!isMissingSourceProgramSessionIdColumn(legacyWithSourceResult.error)) {
      return {
        ok: false,
        errorCode: normalizePostgresErrorCode(legacyWithSourceResult.error),
        queryMode: "legacy",
        reason: "legacy_retry_failed",
      };
    }
  } else if (!isMissingSourceProgramSessionIdColumn(modernResult.error)) {
    return {
      ok: false,
      errorCode: normalizePostgresErrorCode(modernResult.error),
      queryMode: "modern",
      reason: "query_failed",
    };
  }

  const legacyResult = await queryPlanSessions(admin, planId, LEGACY_PLAN_SESSION_SELECT);

  if (legacyResult.error) {
    return {
      ok: false,
      errorCode: normalizePostgresErrorCode(legacyResult.error),
      queryMode: "legacy",
      reason: "legacy_retry_failed",
    };
  }

  return {
    ok: true,
    sessions: mapLegacyRows((legacyResult.data ?? []) as LegacyPlanSessionRow[]),
    queryMode: "legacy",
  };
}
