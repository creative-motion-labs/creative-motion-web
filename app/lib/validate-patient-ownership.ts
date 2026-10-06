import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatientsRow } from "./supabase/database.types";
import { API_ERRORS } from "./api/safe-errors";
import {
  forbiddenResponseForAccessState,
  isClinicianWorkspaceAllowed,
  resolveClinicianAccessState,
} from "./auth/provider-authorization";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Row from `public.patients` — sourced from generated Supabase schema types (D1). */
export type PatientRow = PatientsRow;

export type OwnershipOk = { ok: true; patient: PatientRow };
export type OwnershipFail = {
  ok: false;
  httpStatus: 401 | 403 | 404 | 500;
  message: string;
};
export type OwnershipResult = OwnershipOk | OwnershipFail;

// ── Validator ──────────────────────────────────────────────────────────────────

/**
 * Validates that a patient record exists and belongs to the requesting provider.
 *
 * Ownership is determined exclusively by patients.provider_id — the direct
 * foreign key added in migration 003. No treatment_plans inference.
 *
 * Error model:
 *   - patient not found or belongs to another provider → 404
 *     (404 is intentional: leaking existence to unauthorised callers is unsafe)
 *   - schema/DB errors → 500 with a generic client message (details logged server-side)
 *   - unexpected DB error → 500
 *
 * @param supabase   Service-role or session client with read access to patients.
 * @param patientId  UUID of the patient to look up.
 * @param providerId UUID of the authenticated provider (auth.uid()).
 */
export async function validatePatientOwnership(
  supabase: SupabaseClient,
  patientId: string,
  providerId: string,
): Promise<OwnershipResult> {
  const access = await resolveClinicianAccessState(supabase, providerId);
  if (!isClinicianWorkspaceAllowed(access)) {
    const detail = forbiddenResponseForAccessState(access);
    return {
      ok: false,
      httpStatus: detail.status,
      message: API_ERRORS.FORBIDDEN,
    };
  }

  const { data: patient, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .eq("provider_id", providerId)
    .single();

  if (error) {
    // 42703 = column does not exist (migration 003 not yet applied)
    if (error.code === "42703") {
      console.error(
        "[validatePatientOwnership] patients.provider_id column missing — apply migration 003",
      );
      return { ok: false, httpStatus: 500, message: API_ERRORS.GENERIC };
    }

    // PGRST116 = no rows returned — patient not found or wrong provider
    if (error.code === "PGRST116") {
      return { ok: false, httpStatus: 404, message: API_ERRORS.PATIENT_NOT_FOUND };
    }

    console.error("[validatePatientOwnership] unexpected error:", error.message);
    return { ok: false, httpStatus: 500, message: API_ERRORS.GENERIC };
  }

  if (!patient) {
    return { ok: false, httpStatus: 404, message: API_ERRORS.PATIENT_NOT_FOUND };
  }

  return { ok: true, patient: patient as PatientRow };
}
