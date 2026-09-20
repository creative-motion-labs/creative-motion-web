import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/app/lib/supabase/database.types";
import type { UpperLimbMotorScreenAssignment } from "./types";
import {
  buildForwardReachAssignmentRequestSnapshot,
  serializeForwardReachAssignmentRequestSnapshot,
  type ForwardReachAssignmentRequestSnapshot,
} from "./assignment-request-payload";
import type { ForwardReachAssignmentRequestSnapshotInput } from "./assignment-request-payload";
import { UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION } from "./schema-version";
import type { UpperLimbMotorScreenAssignmentsRow } from "@/app/lib/supabase/database.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function hashForwardReachAssignmentRequestSnapshot(
  snapshot: ForwardReachAssignmentRequestSnapshot,
): string {
  const canonical = serializeForwardReachAssignmentRequestSnapshot(snapshot);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function hashForwardReachAssignmentRequestPayload(
  payload: ForwardReachAssignmentRequestSnapshotInput,
): string {
  return hashForwardReachAssignmentRequestSnapshot(
    buildForwardReachAssignmentRequestSnapshot(payload),
  );
}

export type CreateUpperLimbMotorScreenAssignmentInput = {
  providerId: string;
  patientId: string;
  assignmentRequestId: string | null;
  assignmentRequestPayloadHash: string | null;
  assignment: UpperLimbMotorScreenAssignment;
};

export type CreateUpperLimbMotorScreenAssignmentResult = {
  row: UpperLimbMotorScreenAssignmentsRow;
  created: boolean;
};

export type CreateUpperLimbMotorScreenAssignmentErrorReason =
  | "invalid_input"
  | "ownership_failed"
  | "idempotency_conflict"
  | "integrity_failed"
  | "rpc_failed";

export class CreateUpperLimbMotorScreenAssignmentError extends Error {
  readonly reason: CreateUpperLimbMotorScreenAssignmentErrorReason;

  constructor(reason: CreateUpperLimbMotorScreenAssignmentErrorReason, message: string) {
    super(message);
    this.name = "CreateUpperLimbMotorScreenAssignmentError";
    this.reason = reason;
  }
}

type RpcResultShape = {
  id: unknown;
  created: unknown;
  provider_id: unknown;
  patient_id: unknown;
  status: unknown;
  assignment_payload: unknown;
  schema_version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

function classifyRpcError(message: string): CreateUpperLimbMotorScreenAssignmentErrorReason {
  if (message.includes("required")) return "invalid_input";
  if (message.includes("patient/provider verification failed")) return "ownership_failed";
  if (message.includes("already used for a different assignment")) return "idempotency_conflict";
  if (message.includes("assignment integrity error")) return "integrity_failed";
  return "rpc_failed";
}

function invalidInput(message: string): never {
  throw new CreateUpperLimbMotorScreenAssignmentError("invalid_input", message);
}

function toAssignmentsRow(result: RpcResultShape): UpperLimbMotorScreenAssignmentsRow {
  if (
    !isUuidString(result.id) ||
    !isUuidString(result.provider_id) ||
    !isUuidString(result.patient_id) ||
    typeof result.status !== "string" ||
    typeof result.schema_version !== "string" ||
    typeof result.created_at !== "string" ||
    typeof result.updated_at !== "string" ||
    typeof result.assignment_payload !== "object" ||
    result.assignment_payload === null
  ) {
    throw new CreateUpperLimbMotorScreenAssignmentError(
      "integrity_failed",
      "Could not create the assignment.",
    );
  }

  return {
    id: result.id,
    provider_id: result.provider_id,
    patient_id: result.patient_id,
    status: result.status,
    assignment_payload: result.assignment_payload as Json,
    schema_version: result.schema_version,
    created_at: result.created_at,
    updated_at: result.updated_at,
    assignment_request_id: null,
    assignment_request_payload_hash: null,
    screen_definition_id: null,
    assigned_at: null,
    affected_side: null,
    delivery_mode: null,
    token_hash: null,
    token_expires_at: null,
  };
}

export async function createUpperLimbMotorScreenAssignment(
  client: SupabaseClient<Database>,
  input: CreateUpperLimbMotorScreenAssignmentInput,
): Promise<CreateUpperLimbMotorScreenAssignmentResult> {
  if (!input.providerId || !input.patientId || !input.assignment?.id) {
    invalidInput("providerId, patientId, and assignment.id are required.");
  }

  const hasRequestId = Boolean(input.assignmentRequestId);
  const hasHash = Boolean(input.assignmentRequestPayloadHash);
  if (hasRequestId !== hasHash) {
    invalidInput("assignmentRequestId and assignmentRequestPayloadHash must be supplied together.");
  }

  const rpcArgs: Database["public"]["Functions"]["create_upper_limb_motor_screen_assignment"]["Args"] =
    {
      p_provider_id: input.providerId,
      p_patient_id: input.patientId,
      p_assignment_request_id: input.assignmentRequestId,
      p_assignment_request_payload_hash: input.assignmentRequestPayloadHash,
      p_assignment_id: input.assignment.id,
      p_status: input.assignment.status,
      p_assignment_payload: input.assignment as unknown as Database["public"]["Functions"]["create_upper_limb_motor_screen_assignment"]["Args"]["p_assignment_payload"],
      p_schema_version: UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION,
    };

  const { data, error } = await client.rpc("create_upper_limb_motor_screen_assignment", rpcArgs);

  if (error) {
    console.error("[createUpperLimbMotorScreenAssignment] rpc failed:", error.message);
    throw new CreateUpperLimbMotorScreenAssignmentError(
      classifyRpcError(error.message ?? ""),
      "Could not create the assignment.",
    );
  }

  const result = data as RpcResultShape | null;
  if (!result || typeof result !== "object") {
    throw new CreateUpperLimbMotorScreenAssignmentError("rpc_failed", "Could not create the assignment.");
  }

  if (typeof result.created !== "boolean") {
    throw new CreateUpperLimbMotorScreenAssignmentError("integrity_failed", "Could not create the assignment.");
  }

  return {
    row: toAssignmentsRow(result),
    created: result.created,
  };
}
