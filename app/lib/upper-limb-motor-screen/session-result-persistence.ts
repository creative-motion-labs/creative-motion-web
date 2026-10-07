/**
 * RASQ Upper-Limb Motor Screen — session-result persistence (019/020).
 *
 * Maps between the domain UpperLimbMotorScreenSessionResult object
 * and the upper_limb_motor_screen_session_results row shape.
 * provider_id/patient_id always come from the parent assignment row,
 * never from a request body — this is the composite-FK ownership
 * contract 019 enforces at the DB layer: (assignment_id, provider_id,
 * patient_id) -> assignments(id, provider_id, patient_id).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UpperLimbMotorScreenAssignmentsRow,
  UpperLimbMotorScreenSessionResultsRow,
} from "@/app/lib/supabase/database.types";
import type { UpperLimbMotorScreenSessionResult } from "./types";
import { UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION } from "./schema-version";

// ── Assignment ownership lookup ─────────────────────────────────────────────

export type AssignmentOwnershipRow = Pick<
  UpperLimbMotorScreenAssignmentsRow,
  "id" | "provider_id" | "patient_id"
>;

export type AssignmentOwnershipResult =
  | { ok: true; assignment: AssignmentOwnershipRow }
  | { ok: false; httpStatus: 404 | 500; message: string };

/**
 * Looks up the parent assignment for a session-result creation request
 * and verifies it belongs to the authenticated provider. 404 covers
 * both "does not exist" and "belongs to another provider" — never
 * distinguished in the response, matching validatePatientOwnership's
 * existence-leak policy.
 */
export async function fetchAssignmentForSessionResultOwnership(
  adminClient: SupabaseClient,
  input: { assignmentId: string; providerId: string },
): Promise<AssignmentOwnershipResult> {
  const { data, error } = await adminClient
    .from("upper_limb_motor_screen_assignments")
    .select("id, provider_id, patient_id")
    .eq("id", input.assignmentId)
    .eq("provider_id", input.providerId)
    .maybeSingle();

  if (error) {
    console.error("[fetchAssignmentForSessionResultOwnership] query failed:", error.message);
    return { ok: false, httpStatus: 500, message: "Unable to complete request." };
  }

  if (!data) {
    return { ok: false, httpStatus: 404, message: "Assignment not found." };
  }

  return { ok: true, assignment: data as AssignmentOwnershipRow };
}

// ── Create ───────────────────────────────────────────────────────────────

export type UpperLimbMotorScreenSessionResultInsert = {
  id: string;
  assignment_id: string;
  provider_id: string;
  patient_id: string;
  status: "computed";
  result_payload: UpperLimbMotorScreenSessionResult;
  overall_quality: UpperLimbMotorScreenSessionResult["technicalTrackingQuality"]["overallQuality"];
  protective_pause_count: number;
  protective_pause_duration_ms_total: number;
  schema_version: string;
};

export function buildUpperLimbMotorScreenSessionResultInsert(input: {
  providerId: string;
  patientId: string;
  result: UpperLimbMotorScreenSessionResult;
}): UpperLimbMotorScreenSessionResultInsert {
  return {
    id: input.result.id,
    assignment_id: input.result.assignmentId,
    provider_id: input.providerId,
    patient_id: input.patientId,
    status: "computed",
    result_payload: input.result,
    overall_quality: input.result.technicalTrackingQuality.overallQuality,
    protective_pause_count: input.result.technicalTrackingQuality.protectivePauseCount,
    protective_pause_duration_ms_total:
      input.result.technicalTrackingQuality.protectivePauseDurationMsTotal,
    schema_version: UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION,
  };
}

export type UpperLimbMotorScreenSessionResultPublic = {
  sessionResult: UpperLimbMotorScreenSessionResult;
  assignmentId: string;
  patientId: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
};

export function toUpperLimbMotorScreenSessionResultPublic(
  row: UpperLimbMotorScreenSessionResultsRow,
): UpperLimbMotorScreenSessionResultPublic {
  return {
    sessionResult: row.result_payload as unknown as UpperLimbMotorScreenSessionResult,
    assignmentId: row.assignment_id,
    patientId: row.patient_id,
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertUpperLimbMotorScreenSessionResult(
  adminClient: SupabaseClient,
  row: UpperLimbMotorScreenSessionResultInsert,
): Promise<
  | { ok: true; row: UpperLimbMotorScreenSessionResultsRow }
  | { ok: false; httpStatus: 500; message: string }
> {
  const { data, error } = await adminClient
    .from("upper_limb_motor_screen_session_results")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    console.error("[insertUpperLimbMotorScreenSessionResult] insert failed:", error.message);
    return { ok: false, httpStatus: 500, message: "Unable to complete request." };
  }

  return { ok: true, row: data as UpperLimbMotorScreenSessionResultsRow };
}

// ── Finalize ─────────────────────────────────────────────────────────────

export type FinalizeAccessResult =
  | { ok: true; row: UpperLimbMotorScreenSessionResultsRow }
  | { ok: false; httpStatus: 404 | 409; message: string };

/** Mirrors validateSummaryApprovalAccess: 404 for missing/cross-provider, 409 for already-finalized. */
export function validateFinalizeAccess(
  row: UpperLimbMotorScreenSessionResultsRow | null,
  providerId: string,
): FinalizeAccessResult {
  if (!row || row.provider_id !== providerId) {
    return { ok: false, httpStatus: 404, message: "Session result not found." };
  }
  if (row.status !== "computed") {
    return { ok: false, httpStatus: 409, message: "Only computed session results can be finalized." };
  }
  return { ok: true, row };
}

export type FinalizeSessionResultOutcome =
  | { ok: true; row: UpperLimbMotorScreenSessionResultsRow }
  | { ok: false; httpStatus: 404 | 409 | 500; message: string };

/**
 * Finalizes a computed session result. Sends only {status: "finalized"}
 * as the DB patch — never result_payload or any typed projection. 019's
 * enforce_ul_session_result_immutability trigger performs the actual
 * payload.status jsonb_set and independently rejects any other change;
 * this function must never attempt to send more than the status flip.
 */
export async function finalizeUpperLimbMotorScreenSessionResult(
  adminClient: SupabaseClient,
  input: { sessionResultId: string; providerId: string },
): Promise<FinalizeSessionResultOutcome> {
  const { data: existing, error: fetchError } = await adminClient
    .from("upper_limb_motor_screen_session_results")
    .select("*")
    .eq("id", input.sessionResultId)
    .maybeSingle();

  if (fetchError) {
    console.error("[finalizeUpperLimbMotorScreenSessionResult] fetch failed:", fetchError.message);
    return { ok: false, httpStatus: 500, message: "Unable to complete request." };
  }

  const access = validateFinalizeAccess(
    existing as UpperLimbMotorScreenSessionResultsRow | null,
    input.providerId,
  );
  if (!access.ok) return access;

  const { data: updated, error: updateError } = await adminClient
    .from("upper_limb_motor_screen_session_results")
    .update({ status: "finalized" })
    .eq("id", input.sessionResultId)
    .eq("provider_id", input.providerId)
    .eq("status", "computed")
    .select("*")
    .maybeSingle();

  if (updateError) {
    console.error("[finalizeUpperLimbMotorScreenSessionResult] update failed:", updateError.message);
    return { ok: false, httpStatus: 500, message: "Unable to complete request." };
  }

  if (!updated) {
    return { ok: false, httpStatus: 409, message: "Only computed session results can be finalized." };
  }

  return { ok: true, row: updated as UpperLimbMotorScreenSessionResultsRow };
}
