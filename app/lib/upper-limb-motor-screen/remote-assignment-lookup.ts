import type { SupabaseClient } from "@supabase/supabase-js";
import type { UpperLimbMotorScreenAssignmentsRow } from "@/app/lib/supabase/database.types";
import { hashRemoteUlmsToken } from "./remote-assessment-token";
import type { UpperLimbMotorScreenAssignment, UpperLimbSide } from "./types";

export type RemoteUlmsAssignmentRow = Pick<
  UpperLimbMotorScreenAssignmentsRow,
  "id" | "provider_id" | "patient_id" | "status" | "assignment_payload" | "token_expires_at"
>;

export type RemoteUlmsAssignmentLookupResult =
  | { ok: true; assignment: RemoteUlmsAssignmentRow }
  | { ok: false; httpStatus: 404 | 410 | 409; message: string };

export function readRemoteUlmsTestedSide(
  assignmentPayload: UpperLimbMotorScreenAssignment,
): UpperLimbSide {
  const side = assignmentPayload.taskAssignmentGroups?.[0]?.testedSide;
  return side === "left" ? "left" : "right";
}

export async function fetchRemoteUlmsAssignmentByToken(
  adminClient: SupabaseClient,
  token: string,
): Promise<RemoteUlmsAssignmentLookupResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, httpStatus: 404, message: "Invalid or expired link." };
  }

  const tokenHash = hashRemoteUlmsToken(trimmed);
  const nowIso = new Date().toISOString();

  const { data, error } = await adminClient
    .from("upper_limb_motor_screen_assignments")
    .select("id, provider_id, patient_id, status, assignment_payload, token_expires_at")
    .eq("token_hash", tokenHash)
    .gt("token_expires_at", nowIso)
    .maybeSingle<RemoteUlmsAssignmentRow>();

  if (error) {
    console.error("[fetchRemoteUlmsAssignmentByToken] query failed:", error.message);
    return { ok: false, httpStatus: 404, message: "Invalid or expired link." };
  }

  if (!data) {
    return { ok: false, httpStatus: 404, message: "Invalid or expired link." };
  }

  if (data.status === "cancelled") {
    return { ok: false, httpStatus: 410, message: "This assessment link is no longer available." };
  }

  if (data.status === "completed") {
    return { ok: false, httpStatus: 409, message: "This assessment has already been completed." };
  }

  return { ok: true, assignment: data };
}
