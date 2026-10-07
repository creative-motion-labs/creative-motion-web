/**
 * RASQ Upper-Limb Motor Screen — assignment persistence (019/020/024).
 *
 * Maps between the domain UpperLimbMotorScreenAssignment object and
 * the upper_limb_motor_screen_assignments row shape. Legacy-only
 * columns (screen_definition_id, assigned_at, affected_side,
 * delivery_mode, token_hash, token_expires_at) exist only for
 * Staging's pre-019 rows (020's compatibility upgrade) and are never
 * written by this module — every row created here leaves them NULL.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UpperLimbMotorScreenAssignmentsRow } from "@/app/lib/supabase/database.types";
import type { UpperLimbMotorScreenAssignment } from "./types";
import { UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION } from "./schema-version";
import {
  CreateUpperLimbMotorScreenAssignmentError,
  createUpperLimbMotorScreenAssignment,
} from "./create-upper-limb-motor-screen-assignment";

export type UpperLimbMotorScreenAssignmentInsert = {
  id: string;
  provider_id: string;
  patient_id: string;
  status: UpperLimbMotorScreenAssignment["status"];
  assignment_payload: UpperLimbMotorScreenAssignment;
  schema_version: string;
  assignment_request_id?: string | null;
  assignment_request_payload_hash?: string | null;
};

export function buildUpperLimbMotorScreenAssignmentInsert(input: {
  providerId: string;
  patientId: string;
  assignment: UpperLimbMotorScreenAssignment;
  assignmentRequestId?: string | null;
  assignmentRequestPayloadHash?: string | null;
}): UpperLimbMotorScreenAssignmentInsert {
  return {
    id: input.assignment.id,
    provider_id: input.providerId,
    patient_id: input.patientId,
    status: input.assignment.status,
    assignment_payload: input.assignment,
    schema_version: UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION,
    assignment_request_id: input.assignmentRequestId ?? null,
    assignment_request_payload_hash: input.assignmentRequestPayloadHash ?? null,
  };
}

export type UpperLimbMotorScreenAssignmentPublic = {
  assignment: UpperLimbMotorScreenAssignment;
  patientId: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  created: boolean;
};

export function toUpperLimbMotorScreenAssignmentPublic(
  row: UpperLimbMotorScreenAssignmentsRow,
  created: boolean,
): UpperLimbMotorScreenAssignmentPublic {
  return {
    assignment: row.assignment_payload as unknown as UpperLimbMotorScreenAssignment,
    patientId: row.patient_id,
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    created,
  };
}

export type InsertUpperLimbMotorScreenAssignmentResult =
  | { ok: true; row: UpperLimbMotorScreenAssignmentsRow; created: boolean }
  | { ok: false; httpStatus: 400 | 404 | 409 | 500; message: string };

export async function insertUpperLimbMotorScreenAssignment(
  adminClient: SupabaseClient,
  row: UpperLimbMotorScreenAssignmentInsert,
): Promise<InsertUpperLimbMotorScreenAssignmentResult> {
  try {
    const result = await createUpperLimbMotorScreenAssignment(adminClient, {
      providerId: row.provider_id,
      patientId: row.patient_id,
      assignmentRequestId: row.assignment_request_id ?? null,
      assignmentRequestPayloadHash: row.assignment_request_payload_hash ?? null,
      assignment: row.assignment_payload,
    });

    return { ok: true, row: result.row, created: result.created };
  } catch (error) {
    if (error instanceof CreateUpperLimbMotorScreenAssignmentError) {
      if (error.reason === "invalid_input") {
        return { ok: false, httpStatus: 400, message: "Invalid assignment request." };
      }
      if (error.reason === "ownership_failed") {
        return { ok: false, httpStatus: 404, message: "Patient not found." };
      }
      if (error.reason === "idempotency_conflict") {
        return { ok: false, httpStatus: 409, message: "Assignment request conflict." };
      }
      console.error("[insertUpperLimbMotorScreenAssignment]", error.message);
      return { ok: false, httpStatus: 500, message: "Unable to complete request." };
    }

    console.error("[insertUpperLimbMotorScreenAssignment] unexpected failure:", error);
    return { ok: false, httpStatus: 500, message: "Unable to complete request." };
  }
}
