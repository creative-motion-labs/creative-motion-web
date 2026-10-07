import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/app/lib/supabase/database.types";
import { generateSecurePatientToken } from "@/app/lib/patient-access-token";
import {
  type CatalogPlanSessionPrescriptionRpcRow,
} from "@/app/lib/clinical/clinical-prescribed-side";
import { isMissingPrescribedSideRpcArgument } from "@/app/lib/clinical/clinical-prescribed-side-capability";

/**
 * Server-only wrapper around the service-role-only
 * create_plan_from_catalog_program() RPC (migration 018).
 *
 * Server-only by convention, not by package — same as
 * load-catalog-program-for-assignment.ts (PR 6): this repo has no
 * `server-only` dependency installed. This module must never be
 * imported from a client component.
 *
 * The client parameter is `SupabaseClient<Database>` — migration 018
 * is applied to Staging and database.types.ts has been regenerated, so
 * `.rpc("create_plan_from_catalog_program", ...)` is now checked
 * against the generated Functions["create_plan_from_catalog_program"]
 * Args/Returns types below, not an untyped string call.
 *
 * One narrow, documented gap remains, inherent to `supabase gen types`
 * itself rather than anything hand-written here: generated RPC Args
 * types are derived from the function's parameter list only and do not
 * reflect SQL nullability the way generated table Row/Insert/Update
 * types do (compare `p_assessment_id: string` here to
 * `TreatmentPlansRow["assessment_id"]: string | null` for the same
 * underlying column) — the migration 018 SQL itself explicitly allows
 * `p_assessment_id` to be `NULL` (see the RPC's own
 * `if p_assessment_id is not null` branch). `assessmentIdArg` below is
 * the single, minimal, explicitly-typed cast this requires — not a
 * broad `any`, and not a hand-written addition to the generated
 * `Database` type itself.
 *
 * Token generation stays in Node — generateSecurePatientToken() (the
 * same crypto.randomBytes-based generator app/api/plans/route.ts
 * already uses) — never in SQL. The RPC's own EXECUTE privilege is
 * restricted to service_role, so the only caller able to supply a
 * token to it is trusted server code; the RPC inserts that token in
 * the same transaction as the plan/sessions, which is what makes the
 * whole assignment atomic without needing SQL-side token generation.
 *
 * Never accepts a caller-supplied provider id, patient name, token, or
 * expiry — provider identity must already have been established by the
 * caller (e.g. via auth.getUser() in the route), and everything else is
 * derived or generated here / inside the RPC itself.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type CreatePlanFromCatalogProgramInput = {
  providerId: string;
  patientId: string;
  treatmentProgramId: string;
  assessmentId: string | null;
  /** Client-supplied idempotency key — one per "assign this program" action. */
  catalogAssignmentRequestId: string;
  /** Optional therapist-authored per-session prescribed sides (fresh assignments only). */
  sessionPrescribedSides?: CatalogPlanSessionPrescriptionRpcRow[];
};

export type CreatePlanFromCatalogProgramResult = {
  planId: string;
  sessionIds: string[];
  patientToken: string;
  /** false when this call replayed an existing assignment instead of creating one. */
  created: boolean;
};

export type CreatePlanFromCatalogProgramErrorReason =
  | "invalid_input"
  | "ownership_failed"
  | "assessment_failed"
  | "program_not_eligible"
  | "idempotency_conflict"
  | "integrity_failed"
  | "prescribed_side_unavailable"
  | "rpc_failed";

/**
 * Thrown for every rejection path. Carries a stable `reason` for the
 * caller to branch on, and a message safe to surface — raw Postgres
 * error text is never returned as-is; it is only logged server-side
 * (console.error), matching the convention established in
 * load-catalog-program-for-assignment.ts and app/api/plans/route.ts.
 */
export class CreatePlanFromCatalogProgramError extends Error {
  readonly reason: CreatePlanFromCatalogProgramErrorReason;

  constructor(reason: CreatePlanFromCatalogProgramErrorReason, message: string) {
    super(message);
    this.name = "CreatePlanFromCatalogProgramError";
    this.reason = reason;
  }
}

type RpcResultShape = {
  planId: unknown;
  sessionIds: unknown;
  patientToken: unknown;
  created: unknown;
};

/**
 * Classifies a raw Postgres RAISE EXCEPTION message from migration
 * 018's RPC into a stable, caller-safe reason. Coupled to the exact
 * wording in supabase/migrations/018_create_plan_from_catalog_program.sql
 * by necessity — postgrest-js surfaces RAISE EXCEPTION text verbatim in
 * error.message, and there is no structured error-code convention
 * elsewhere in this codebase's zero prior .rpc() calls to follow
 * instead. Only these specific, stable messages the RPC itself emits
 * are classified; anything else — including a raw constraint-violation
 * message such as a duplicate patient_access_tokens.token, or a
 * plpgsql NO_DATA_FOUND/TOO_MANY_ROWS message from the RPC's own
 * `SELECT ... INTO STRICT` — is never promoted to a trusted
 * application-level reason and always falls through to the fully
 * generic "rpc_failed".
 */
function classifyRpcError(message: string, errorCode?: string | null): CreatePlanFromCatalogProgramErrorReason {
  if (isMissingPrescribedSideRpcArgument({ code: errorCode, message })) {
    return "prescribed_side_unavailable";
  }
  if (message.includes("required")) return "invalid_input";
  if (message.includes("patient/provider verification failed")) return "ownership_failed";
  if (message.includes("assessment verification failed")) return "assessment_failed";
  if (message.includes("not eligible for assignment")) return "program_not_eligible";
  if (message.includes("already used for a different assignment")) return "idempotency_conflict";
  if (message.includes("catalog assignment integrity error")) return "integrity_failed";
  return "rpc_failed";
}

function invalidInput(message: string): never {
  throw new CreatePlanFromCatalogProgramError("invalid_input", message);
}

export async function createPlanFromCatalogProgram(
  client: SupabaseClient<Database>,
  input: CreatePlanFromCatalogProgramInput,
): Promise<CreatePlanFromCatalogProgramResult> {
  if (!input.providerId || !input.patientId || !input.treatmentProgramId) {
    invalidInput("providerId, patientId, and treatmentProgramId are required.");
  }
  if (!input.catalogAssignmentRequestId) {
    invalidInput("catalogAssignmentRequestId is required.");
  }

  const token = generateSecurePatientToken();

  // p_assessment_id genuinely accepts SQL NULL (see the module doc
  // comment above) -- the generated Args type just doesn't say so.
  const assessmentIdArg = input.assessmentId as unknown as string;

  const rpcArgs: Database["public"]["Functions"]["create_plan_from_catalog_program"]["Args"] = {
    p_provider_id: input.providerId,
    p_patient_id: input.patientId,
    p_program_id: input.treatmentProgramId,
    p_assessment_id: assessmentIdArg,
    p_catalog_assignment_request_id: input.catalogAssignmentRequestId,
    p_patient_token: token,
  };

  if (input.sessionPrescribedSides && input.sessionPrescribedSides.length > 0) {
    rpcArgs.p_session_prescribed_sides = input.sessionPrescribedSides;
  }

  const { data, error } = await client.rpc("create_plan_from_catalog_program", rpcArgs);

  if (error) {
    console.error("[createPlanFromCatalogProgram] rpc failed:", error.message);
    throw new CreatePlanFromCatalogProgramError(
      classifyRpcError(error.message ?? "", error.code),
      "Could not create the treatment plan.",
    );
  }

  const result = data as RpcResultShape | null;

  if (!result || typeof result !== "object") {
    console.error("[createPlanFromCatalogProgram] rpc returned no result");
    throw new CreatePlanFromCatalogProgramError("rpc_failed", "Could not create the treatment plan.");
  }

  if (!isUuidString(result.planId)) {
    console.error("[createPlanFromCatalogProgram] rpc returned an invalid planId");
    throw new CreatePlanFromCatalogProgramError("rpc_failed", "Could not create the treatment plan.");
  }

  if (!Array.isArray(result.sessionIds) || result.sessionIds.length === 0) {
    console.error("[createPlanFromCatalogProgram] rpc returned an empty or invalid sessionIds");
    throw new CreatePlanFromCatalogProgramError("rpc_failed", "Could not create the treatment plan.");
  }

  if (!result.sessionIds.every(isUuidString)) {
    console.error("[createPlanFromCatalogProgram] rpc returned a non-UUID sessionIds entry");
    throw new CreatePlanFromCatalogProgramError("rpc_failed", "Could not create the treatment plan.");
  }

  if (typeof result.patientToken !== "string" || result.patientToken.trim() === "") {
    console.error("[createPlanFromCatalogProgram] rpc returned a blank patientToken");
    throw new CreatePlanFromCatalogProgramError("rpc_failed", "Could not create the treatment plan.");
  }

  if (typeof result.created !== "boolean") {
    console.error("[createPlanFromCatalogProgram] rpc returned a non-boolean created flag");
    throw new CreatePlanFromCatalogProgramError("rpc_failed", "Could not create the treatment plan.");
  }

  return {
    planId: result.planId,
    sessionIds: result.sessionIds as string[],
    patientToken: result.patientToken,
    created: result.created,
  };
}
