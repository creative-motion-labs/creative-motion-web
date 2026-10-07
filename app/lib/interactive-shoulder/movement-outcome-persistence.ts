/**
 * RASQ Interactive Shoulder — clinical movement-outcome persistence
 * mapping/helpers (O1, migration 025).
 *
 * No API route in this slice — these are the pure/Supabase-client
 * helpers a future O2 route composes. provider_id/patient_id/plan_id
 * and prescribed_side are always taken from the plan_session row
 * (fetchPlanSessionForOutcomeOwnership), never from request input —
 * the same ownership contract session-result-persistence.ts already
 * established for Upper-Limb Motor Screen.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InteractiveShoulderMovementOutcomesRow } from "@/app/lib/supabase/database.types";
import {
  serializeClinicalPrescribedSideFromDb,
  type ClinicalPrescribedSide,
} from "@/app/lib/clinical/clinical-prescribed-side";
import type { InteractiveShoulderMovementOutcomeSnapshot } from "./movement-outcome-types";

// ── Ownership + prescribed-side lookup ──────────────────────────────────

export type PlanSessionOutcomeContext = {
  id: string;
  plan_id: string;
  provider_id: string;
  patient_id: string;
  prescribed_side: string | null;
};

export type FetchPlanSessionForOutcomeResult =
  | { ok: true; planSession: PlanSessionOutcomeContext }
  | { ok: false; httpStatus: 404 | 500; message: string };

/**
 * Looks up the parent plan_session for an outcome-creation request and
 * verifies it belongs to the authenticated provider. 404 covers both
 * "does not exist" and "belongs to another provider" — never
 * distinguished in the response, matching
 * fetchAssignmentForSessionResultOwnership's existence-leak policy.
 * The returned prescribed_side is the sole source the caller may use —
 * never a client-supplied value.
 */
export async function fetchPlanSessionForOutcomeOwnership(
  adminClient: SupabaseClient,
  input: { planSessionId: string; providerId: string },
): Promise<FetchPlanSessionForOutcomeResult> {
  const { data, error } = await adminClient
    .from("plan_sessions")
    .select("id, plan_id, provider_id, patient_id, prescribed_side")
    .eq("id", input.planSessionId)
    .eq("provider_id", input.providerId)
    .maybeSingle();

  if (error) {
    console.error("[fetchPlanSessionForOutcomeOwnership] query failed:", error.message);
    return { ok: false, httpStatus: 500, message: "Unable to complete request." };
  }

  if (!data) {
    return { ok: false, httpStatus: 404, message: "Plan session not found." };
  }

  return { ok: true, planSession: data as PlanSessionOutcomeContext };
}

/**
 * The single point where a raw plan_sessions.prescribed_side string
 * becomes the typed, server-owned clinical value the assembler and
 * insert row require. Never call this with anything other than the
 * value just fetched from the database — passing a client-supplied
 * string here would defeat the entire ownership contract this module
 * exists to enforce.
 */
export function resolvePrescribedSideForOutcome(
  planSession: Pick<PlanSessionOutcomeContext, "prescribed_side">,
): ClinicalPrescribedSide | null {
  return serializeClinicalPrescribedSideFromDb(planSession.prescribed_side);
}

// ── Create ───────────────────────────────────────────────────────────────

export type InteractiveShoulderMovementOutcomeInsert = {
  plan_session_id: string;
  plan_id: string;
  provider_id: string;
  patient_id: string;
  prescribed_side: string | null;
  session_state: string;
  outcome_payload: InteractiveShoulderMovementOutcomeSnapshot;
  schema_version: string;
};

export function buildInteractiveShoulderMovementOutcomeInsert(input: {
  planSession: PlanSessionOutcomeContext;
  snapshot: InteractiveShoulderMovementOutcomeSnapshot;
}): InteractiveShoulderMovementOutcomeInsert {
  return {
    plan_session_id: input.planSession.id,
    plan_id: input.planSession.plan_id,
    provider_id: input.planSession.provider_id,
    patient_id: input.planSession.patient_id,
    prescribed_side: input.snapshot.prescribedSide,
    session_state: input.snapshot.sessionState,
    outcome_payload: input.snapshot,
    schema_version: input.snapshot.schemaVersion,
  };
}

export type InteractiveShoulderMovementOutcomePublic = {
  id: string;
  planSessionId: string;
  planId: string;
  providerId: string;
  patientId: string;
  outcome: InteractiveShoulderMovementOutcomeSnapshot;
  createdAt: string;
  /** False only on the idempotent-replay path — see insertInteractiveShoulderMovementOutcome. */
  created: boolean;
};

export function toInteractiveShoulderMovementOutcomePublic(
  row: InteractiveShoulderMovementOutcomesRow,
  created: boolean,
): InteractiveShoulderMovementOutcomePublic {
  return {
    id: row.id,
    planSessionId: row.plan_session_id ?? "",
    planId: row.plan_id,
    providerId: row.provider_id,
    patientId: row.patient_id,
    outcome: row.outcome_payload as unknown as InteractiveShoulderMovementOutcomeSnapshot,
    createdAt: row.created_at,
    created,
  };
}

// ── Read (O3 — clinician Progress/Outcomes report) ──────────────────────

/**
 * Narrow read-optimized projection of a stored row — exactly the
 * columns the clinician report DTO (movement-outcome-report.ts) needs.
 * Deliberately omits provider_id/patient_id: the caller already knows
 * both (they are the query's own scoping input) and neither is ever
 * rendered in the clinician UI.
 */
export type InteractiveShoulderOutcomeReportRow = Pick<
  InteractiveShoulderMovementOutcomesRow,
  | "id"
  | "plan_session_id"
  | "plan_id"
  | "prescribed_side"
  | "session_state"
  | "outcome_payload"
  | "schema_version"
  | "created_at"
>;

export type FetchInteractiveShoulderOutcomesForPatientInput = {
  providerId: string;
  patientId: string;
  /** When set, scopes to one plan — matching how session_logs is scoped in the same hub. Null shows outcomes across all of the patient's plans. */
  planId: string | null;
};

export type FetchInteractiveShoulderOutcomesForPatientResult =
  | { ok: true; rows: InteractiveShoulderOutcomeReportRow[] }
  | { ok: false };

/**
 * Read-only, provider- and patient-scoped list of this patient's
 * recorded Interactive Shoulder movement outcomes, for the clinician
 * Progress/Outcomes report (O3). Never reads or joins any volunteer/
 * research table. Ordered most-recent-first, with a tie-broken
 * secondary sort on id for deterministic pagination-free output.
 */
export async function fetchInteractiveShoulderOutcomesForPatient(
  adminClient: SupabaseClient,
  input: FetchInteractiveShoulderOutcomesForPatientInput,
): Promise<FetchInteractiveShoulderOutcomesForPatientResult> {
  let query = adminClient
    .from("interactive_shoulder_movement_outcomes")
    .select("id, plan_session_id, plan_id, prescribed_side, session_state, outcome_payload, schema_version, created_at")
    .eq("provider_id", input.providerId)
    .eq("patient_id", input.patientId);

  if (input.planId) {
    query = query.eq("plan_id", input.planId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .returns<InteractiveShoulderOutcomeReportRow[]>();

  if (error) {
    console.error("[fetchInteractiveShoulderOutcomesForPatient] query failed:", error.message);
    return { ok: false };
  }

  return { ok: true, rows: data ?? [] };
}

const UNIQUE_VIOLATION_ERROR_CODE = "23505";

export type InsertInteractiveShoulderMovementOutcomeResult =
  | { ok: true; row: InteractiveShoulderMovementOutcomesRow; created: boolean }
  | { ok: false; httpStatus: 404 | 500; message: string };

/**
 * Idempotent insert: the DB's ishmo_plan_session_unique constraint is
 * the actual guarantee (one outcome per plan session). A unique-
 * violation here means this exact plan session already has a recorded
 * outcome — that is treated as a successful replay (created: false,
 * returning the existing row unchanged), never an overwrite and never
 * a second row. No RPC needed: Postgres enforces the invariant: this
 * function only decides how to respond to it.
 */
export async function insertInteractiveShoulderMovementOutcome(
  adminClient: SupabaseClient,
  row: InteractiveShoulderMovementOutcomeInsert,
): Promise<InsertInteractiveShoulderMovementOutcomeResult> {
  const { data, error } = await adminClient
    .from("interactive_shoulder_movement_outcomes")
    .insert(row)
    .select("*")
    .single();

  if (!error) {
    return { ok: true, row: data as InteractiveShoulderMovementOutcomesRow, created: true };
  }

  if (error.code === UNIQUE_VIOLATION_ERROR_CODE) {
    const { data: existing, error: reselectError } = await adminClient
      .from("interactive_shoulder_movement_outcomes")
      .select("*")
      .eq("plan_session_id", row.plan_session_id)
      .eq("provider_id", row.provider_id)
      .maybeSingle();

    if (reselectError || !existing) {
      console.error(
        "[insertInteractiveShoulderMovementOutcome] replay reselect failed:",
        reselectError?.message,
      );
      return { ok: false, httpStatus: 500, message: "Unable to complete request." };
    }

    return { ok: true, row: existing as InteractiveShoulderMovementOutcomesRow, created: false };
  }

  console.error("[insertInteractiveShoulderMovementOutcome] insert failed:", error.message);
  return { ok: false, httpStatus: 500, message: "Unable to complete request." };
}
