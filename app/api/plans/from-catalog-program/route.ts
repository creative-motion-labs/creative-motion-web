import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createPlanFromCatalogProgram,
  CreatePlanFromCatalogProgramError,
  type CreatePlanFromCatalogProgramErrorReason,
} from "../../../lib/rehab-programs/create-plan-from-catalog-program";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
  type RateLimitResult,
} from "../../../lib/rate-limit";
import { serviceUnavailableResponse } from "../../../lib/api/safe-errors";
import {
  parsePlanSessionPrescriptionsFromBody,
  toCatalogRpcSessionPrescribedSides,
} from "../../../lib/clinical/clinical-prescribed-side";
import { probePrescribedSideStorageCapability } from "../../../lib/clinical/clinical-prescribed-side-capability";

const PLAN_CREATE_ERROR = "Failed to create plan.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Every reason the wrapper can throw maps to exactly one controlled status. */
const ERROR_STATUS: Record<CreatePlanFromCatalogProgramErrorReason, number> = {
  invalid_input: 400,
  ownership_failed: 404,
  assessment_failed: 404,
  program_not_eligible: 422,
  idempotency_conflict: 409,
  integrity_failed: 500,
  prescribed_side_unavailable: 503,
  rpc_failed: 500,
};

type PostBody = {
  patientId?: string;
  treatmentProgramId?: string;
  assessmentId?: string | null;
  catalogAssignmentRequestId?: string;
  sessions?: unknown;
};

const CATALOG_POST_ALLOWED_KEYS = new Set([
  "patientId",
  "treatmentProgramId",
  "assessmentId",
  "catalogAssignmentRequestId",
  "sessions",
]);

function rejectUnknownCatalogPostKeys(body: PostBody): string | null {
  for (const key of Object.keys(body)) {
    if (!CATALOG_POST_ALLOWED_KEYS.has(key)) {
      return `Unknown request field: ${key}.`;
    }
  }
  return null;
}

export type CatalogPlanPostDependencies = {
  /** Resolves the authenticated caller, or null if unauthenticated. */
  getAuthenticatedUser: () => Promise<{ id: string } | null>;
  /** Service-role client passed to the RPC wrapper. */
  adminClient: SupabaseClient;
  checkWriteLimit: (providerId: string, route: string) => RateLimitResult;
  createPlan: typeof createPlanFromCatalogProgram;
};

// ── Dependency-injected handler ────────────────────────────────────────────────
//
// Lets tests inject fakes for auth, rate limiting, the admin client, and
// the RPC wrapper directly, without module mocking — node:test's
// mock.module is unavailable in this execution environment. The
// exported production POST handler below wires this factory up with
// the real session client, the real admin client, the real rate
// limiter, and the real createPlanFromCatalogProgram wrapper; nothing
// about the actual request-handling logic differs between the two.

export function createCatalogPlanPostHandler(deps: CatalogPlanPostDependencies) {
  return async function handleCatalogPlanPost(req: NextRequest): Promise<NextResponse> {
    const user = await deps.getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const limited = deps.checkWriteLimit(user.id, "plans:create");
    if (!limited.allowed) {
      return rateLimitExceededResponse(limited.retryAfterSec);
    }

    let body: PostBody;
    try { body = (await req.json()) as PostBody; }
    catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

    const unknownKeyError = rejectUnknownCatalogPostKeys(body);
    if (unknownKeyError) {
      return NextResponse.json({ error: unknownKeyError }, { status: 400 });
    }

    const patientId = body.patientId?.trim();
    const treatmentProgramId = body.treatmentProgramId?.trim();
    const catalogAssignmentRequestId = body.catalogAssignmentRequestId?.trim();
    const assessmentId = body.assessmentId?.trim() || null;

    if (!patientId) return NextResponse.json({ error: "patientId is required." }, { status: 400 });
    if (!treatmentProgramId) {
      return NextResponse.json({ error: "treatmentProgramId is required." }, { status: 400 });
    }
    if (!catalogAssignmentRequestId) {
      return NextResponse.json({ error: "catalogAssignmentRequestId is required." }, { status: 400 });
    }

    if (!isUuidString(patientId)) {
      return NextResponse.json({ error: "patientId must be a valid UUID." }, { status: 400 });
    }
    if (!isUuidString(treatmentProgramId)) {
      return NextResponse.json({ error: "treatmentProgramId must be a valid UUID." }, { status: 400 });
    }
    if (!isUuidString(catalogAssignmentRequestId)) {
      return NextResponse.json({ error: "catalogAssignmentRequestId must be a valid UUID." }, { status: 400 });
    }
    if (assessmentId !== null && !isUuidString(assessmentId)) {
      return NextResponse.json({ error: "assessmentId must be a valid UUID." }, { status: 400 });
    }

    const sessionPrescriptions = parsePlanSessionPrescriptionsFromBody(body.sessions);
    if (!sessionPrescriptions.ok) {
      return NextResponse.json({ error: sessionPrescriptions.error }, { status: 400 });
    }

    const sessionPrescribedSides = toCatalogRpcSessionPrescribedSides(sessionPrescriptions.value);
    if (sessionPrescribedSides.length > 0) {
      const capability = await probePrescribedSideStorageCapability(deps.adminClient);
      if (!capability.ok) {
        console.error("[POST /api/plans/from-catalog-program] prescribed-side capability probe failed");
        return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: 500 });
      }
      if (!capability.available) {
        return serviceUnavailableResponse();
      }
    }

    // Explicit object literal, never a spread of `body` — extra fields
    // a caller sends (providerId, token, patientToken, sessions,
    // exercises, blocks, sourceTreatmentProgramId,
    // sourceProgramSessionId, ...) are present in the parsed body but
    // structurally cannot reach the wrapper or the RPC: only the five
    // named properties below are ever read from `body`, and this call
    // site names every argument explicitly. providerId always comes
    // from the authenticated session, never from the request body.
    try {
      const result = await deps.createPlan(deps.adminClient, {
        providerId: user.id,
        patientId,
        treatmentProgramId,
        assessmentId,
        catalogAssignmentRequestId,
        sessionPrescribedSides,
      });

      return NextResponse.json(
        {
          id: result.planId,
          sessions: result.sessionIds.map((id) => ({ id })),
          patient_token: result.patientToken,
          created: result.created,
        },
        { status: result.created ? 201 : 200 },
      );
    } catch (err) {
      if (err instanceof CreatePlanFromCatalogProgramError) {
        console.error("[POST /api/plans/from-catalog-program]", err.reason, err.message);
        if (err.reason === "prescribed_side_unavailable") {
          return serviceUnavailableResponse();
        }
        return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: ERROR_STATUS[err.reason] });
      }
      console.error("[POST /api/plans/from-catalog-program] unexpected error");
      return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: 500 });
    }
  };
}

// ── Real production dependencies ───────────────────────────────────────────────

async function buildRealDependencies(): Promise<CatalogPlanPostDependencies | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Route Handler */ }
      },
    },
  });
  const adminClient = createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    getAuthenticatedUser: async () => {
      const { data: { user }, error } = await sessionClient.auth.getUser();
      if (error || !user) return null;
      return { id: user.id };
    },
    adminClient,
    checkWriteLimit: checkClinicianWriteLimit,
    createPlan: createPlanFromCatalogProgram,
  };
}

// ── POST /api/plans/from-catalog-program ──────────────────────────────────────

/**
 * Atomically creates a treatment plan, its plan sessions, and a patient
 * access token from a published rehabilitation catalog program
 * (migration 018's create_plan_from_catalog_program() RPC).
 *
 * Accepts only patientId, treatmentProgramId, an optional assessmentId,
 * and a client-supplied catalogAssignmentRequestId (idempotency key),
 * each validated as a well-formed UUID before the RPC is ever called.
 * providerId is never accepted from the request body — it is derived
 * from the authenticated session, exactly like POST /api/plans. The
 * patient portal token is generated here in Node
 * (generateSecurePatientToken(), inside the wrapper) and is never
 * accepted from the client either.
 *
 * Response 201: { id, sessions: { id }[], patient_token, created: true }
 * Response 200: same shape, created: false — idempotent replay
 * Response 400: { error } — missing/malformed body fields
 * Response 401: { error } — unauthenticated
 * Response 404: { error } — patient/assessment ownership failure
 * Response 409: { error } — idempotency key reused for a different assignment
 * Response 422: { error } — source program not eligible for assignment
 * Response 500: { error } — sanitized; no SQL/internal detail returned
 */
export async function POST(req: NextRequest) {
  const deps = await buildRealDependencies();
  if (!deps) return serviceUnavailableResponse();
  return createCatalogPlanPostHandler(deps)(req);
}
