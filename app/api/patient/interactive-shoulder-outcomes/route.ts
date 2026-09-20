/**
 * POST /api/patient/interactive-shoulder-outcomes (O2)
 *
 * Public endpoint — patient-portal token auth only, exactly like the
 * existing /api/patient/session-complete (no Supabase auth session,
 * service-role key server-side only). Reuses
 * resolvePatientPortalAccess/sessionBelongsToCurrentPlan unchanged for
 * ownership, and reuses every O1 persistence module unchanged
 * (fetchPlanSessionForOutcomeOwnership, resolvePrescribedSideForOutcome,
 * assembleInteractiveShoulderMovementOutcomeSnapshot,
 * buildInteractiveShoulderMovementOutcomeInsert,
 * insertInteractiveShoulderMovementOutcome,
 * toInteractiveShoulderMovementOutcomePublic) — no parallel persistence
 * model.
 *
 * Server-authoritative: providerId, patientId, planId, prescribedSide,
 * and id are NEVER read from the request body — only token +
 * planSessionId + the real runtime session facts (sessionState,
 * elapsed time, block results) are accepted at all. A body containing
 * any of those forbidden fields — or any field outside this route's
 * explicit allowlist, which is exactly O1's own allowlist
 * (movement-outcome-request-validation.ts) plus "token" — is rejected
 * outright with a generic 400 before any resolution, lookup, or
 * persistence work happens (rejectUnknownRequestKeys below), mirroring
 * the exact convention already used for
 * POST /api/upper-limb-motor-screen/assignments. providerId/patientId/
 * planId come from the resolved token; prescribedSide comes from the
 * plan_sessions row O1 fetches server-side. O1's assembler
 * independently rejects any sessionState other than "completed" —
 * this route adds no separate partial-session path.
 *
 * Fail-closed prescribed side: the real catalog patient session flow
 * (CatalogPatientSessionPlayback) always renders with
 * clinicalPrescribedSideRequired, so the runtime itself already
 * refuses to start without a resolved side. This route enforces the
 * same policy independently at the persistence boundary — a plan
 * session whose server-resolved prescribed_side is null is rejected
 * before assembly, never silently persisted with a null side.
 *
 * Feature-gated: RASQ_INTERACTIVE_SHOULDER_OUTCOME_SUBMISSION_V1 must
 * be exactly "true" (same strict-equality convention as
 * resolveAdaptiveDifficultyFeatureFlag) or this route returns 503 —
 * an honest "service unavailable", never a fake success while quietly
 * not persisting anything.
 *
 * Observability (O5): the two genuinely unexpected 5xx branches
 * (patient-access resolution's server_error path, and a persistence
 * insert failure) also call deps.recordServerFailure — safe metadata
 * only (a closed reason enum + numeric HTTP status), never a token,
 * id, request body, or outcome payload. See movement-outcome-
 * telemetry.ts. This does not change what either branch returns to
 * the caller, and does not add any retry.
 */
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  resolvePatientPortalAccess,
  sessionBelongsToCurrentPlan,
  type ResolvePatientPortalAccessResult,
} from "@/app/lib/patient-portal-access";
import { validateInteractiveShoulderMovementOutcomeRequest } from "@/app/lib/interactive-shoulder/movement-outcome-request-validation";
import { assembleInteractiveShoulderMovementOutcomeSnapshot } from "@/app/lib/interactive-shoulder/movement-outcome-assembler";
import {
  buildInteractiveShoulderMovementOutcomeInsert,
  fetchPlanSessionForOutcomeOwnership,
  insertInteractiveShoulderMovementOutcome,
  resolvePrescribedSideForOutcome,
  toInteractiveShoulderMovementOutcomePublic,
} from "@/app/lib/interactive-shoulder/movement-outcome-persistence";
import {
  checkPatientGeneralLimit,
  rateLimitExceededResponse,
  type RateLimitResult,
} from "@/app/lib/rate-limit";
import {
  API_ERRORS,
  invalidPatientTokenResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
} from "@/app/lib/api/safe-errors";
import {
  recordInteractiveShoulderOutcomeServerFailure,
  type InteractiveShoulderOutcomeServerFailureEvent,
} from "@/app/lib/interactive-shoulder/movement-outcome-telemetry";

const CREATE_ERROR = "Failed to save movement outcome.";
const PRESCRIBED_SIDE_REQUIRED_MESSAGE =
  "This session does not have a therapist-prescribed side on record.";

type RequestBody = {
  token?: unknown;
  planSessionId?: unknown;
  sessionState?: unknown;
  totalElapsedSeconds?: unknown;
  blocksCompleted?: unknown;
  blocksTotal?: unknown;
  blockResults?: unknown;
};

/** Same strict-equality convention as resolveAdaptiveDifficultyFeatureFlag. */
export function resolveInteractiveShoulderOutcomeSubmissionFeatureFlag(
  envValue: string | undefined,
): boolean {
  return envValue === "true";
}

/**
 * Exactly O1's own request allowlist (movement-outcome-request-validation.ts)
 * plus "token" — the one key this route adds beyond O1's contract, since O1
 * has no concept of an auth token. Nothing else is ever accepted: a body
 * carrying providerId/patientId/planId/prescribedSide/id, or any other
 * clinical-authority or ownership field, is rejected outright by
 * rejectUnknownRequestKeys below, before token extraction, before any
 * resolution or persistence work.
 */
const REQUEST_ALLOWED_KEYS = new Set([
  "token",
  "planSessionId",
  "sessionState",
  "totalElapsedSeconds",
  "blocksCompleted",
  "blocksTotal",
  "blockResults",
]);

/**
 * Fails closed on any field outside REQUEST_ALLOWED_KEYS. Returns a generic
 * message naming only the offending key, never why it is forbidden or what
 * it would have controlled — this must not reveal internal ownership
 * information to a caller probing the endpoint.
 */
function rejectUnknownRequestKeys(body: RequestBody): string | null {
  for (const key of Object.keys(body)) {
    if (!REQUEST_ALLOWED_KEYS.has(key)) {
      return `Unknown request field: ${key}.`;
    }
  }
  return null;
}

export type InteractiveShoulderOutcomeSubmissionDependencies = {
  featureEnabled: boolean;
  adminClient: SupabaseClient;
  checkWriteLimit: (req: NextRequest) => RateLimitResult;
  resolvePatientAccess: (
    admin: SupabaseClient,
    token: string,
  ) => Promise<ResolvePatientPortalAccessResult>;
  /** Observability only — see movement-outcome-telemetry.ts. Defaults to the real Sentry capture in production. */
  recordServerFailure: (event: InteractiveShoulderOutcomeServerFailureEvent) => void;
};

// ── Dependency-injected handler ────────────────────────────────────────────────

export function createInteractiveShoulderOutcomeSubmissionHandler(
  deps: InteractiveShoulderOutcomeSubmissionDependencies,
) {
  return async function handlePost(req: NextRequest): Promise<NextResponse> {
    if (!deps.featureEnabled) {
      return serviceUnavailableResponse();
    }

    const limited = deps.checkWriteLimit(req);
    if (!limited.allowed) return rateLimitExceededResponse(limited.retryAfterSec);

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // Fail closed before any resolution, lookup, or persistence work: a body
    // containing providerId/patientId/planId/prescribedSide/id, or any other
    // field this route does not explicitly accept, is rejected outright.
    const unknownKeyError = rejectUnknownRequestKeys(body);
    if (unknownKeyError) {
      return NextResponse.json({ error: unknownKeyError }, { status: 400 });
    }

    const tokenValue = typeof body.token === "string" ? body.token.trim() : "";
    if (!tokenValue) {
      return NextResponse.json({ error: "Token is required." }, { status: 400 });
    }

    // Movement-outcome content only — token is never part of this contract,
    // and providerId/patientId/planId/prescribedSide are rejected by this
    // validator if present at all (see movement-outcome-request-validation.ts).
    const validation = validateInteractiveShoulderMovementOutcomeRequest({
      planSessionId: body.planSessionId,
      sessionState: body.sessionState,
      totalElapsedSeconds: body.totalElapsedSeconds,
      blocksCompleted: body.blocksCompleted,
      blocksTotal: body.blocksTotal,
      blockResults: body.blockResults,
    });
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Invalid movement outcome.", reason: validation.reason, detail: validation.detail },
        { status: 400 },
      );
    }

    const resolved = await deps.resolvePatientAccess(deps.adminClient, tokenValue);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_token") return invalidPatientTokenResponse(req);
      if (resolved.reason === "plan_not_found") return unableToCompleteResponse(404);
      // resolved.reason === "server_error" here — the one genuinely
      // unexpected branch of this check, not a routine auth rejection.
      deps.recordServerFailure({ reason: "patient_access_resolution_failed", httpStatus: 500 });
      return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
    }
    const { access } = resolved;

    const planSessionResult = await fetchPlanSessionForOutcomeOwnership(deps.adminClient, {
      planSessionId: validation.input.planSessionId,
      providerId: access.providerId,
    });
    if (!planSessionResult.ok) {
      return NextResponse.json(
        { error: planSessionResult.message },
        { status: planSessionResult.httpStatus },
      );
    }
    const { planSession } = planSessionResult;

    // Defense in depth beyond the provider_id scope already enforced above:
    // the plan session must belong to this exact token's patient and
    // currently-resolved plan, not merely to the same provider.
    if (
      planSession.patient_id !== access.patientId ||
      !sessionBelongsToCurrentPlan(planSession.plan_id, access.currentPlanId)
    ) {
      return unableToCompleteResponse(404);
    }

    const prescribedSide = resolvePrescribedSideForOutcome(planSession);
    if (prescribedSide === null) {
      return NextResponse.json(
        { error: PRESCRIBED_SIDE_REQUIRED_MESSAGE, reason: "prescribed_side_required" },
        { status: 400 },
      );
    }

    const assembled = assembleInteractiveShoulderMovementOutcomeSnapshot({
      planSessionId: validation.input.planSessionId,
      prescribedSide,
      sessionState: validation.input.sessionState,
      totalElapsedSeconds: validation.input.totalElapsedSeconds,
      blocksCompleted: validation.input.blocksCompleted,
      blocksTotal: validation.input.blocksTotal,
      blockResults: validation.input.blockResults,
    });
    if (!assembled.ok) {
      return NextResponse.json(
        {
          error: "Session is not eligible for a movement outcome.",
          reason: assembled.reason,
          detail: assembled.detail,
        },
        { status: 400 },
      );
    }

    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession,
      snapshot: assembled.snapshot,
    });

    const inserted = await insertInteractiveShoulderMovementOutcome(deps.adminClient, row);
    if (!inserted.ok) {
      if (inserted.httpStatus >= 500) {
        console.error("[POST /api/patient/interactive-shoulder-outcomes]", inserted.message);
        deps.recordServerFailure({ reason: "persistence_insert_failed", httpStatus: inserted.httpStatus });
      }
      return NextResponse.json({ error: CREATE_ERROR }, { status: inserted.httpStatus });
    }

    const status = inserted.created ? 201 : 200;
    return NextResponse.json(
      toInteractiveShoulderMovementOutcomePublic(inserted.row, inserted.created),
      { status },
    );
  };
}

// ── Real production dependencies ───────────────────────────────────────────────

async function buildRealDependencies(): Promise<InteractiveShoulderOutcomeSubmissionDependencies | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;

  // No Supabase auth session for this route — patient-portal token auth
  // only, exactly matching /api/patient/session-complete's buildAdminClient.
  const adminClient = createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    featureEnabled: resolveInteractiveShoulderOutcomeSubmissionFeatureFlag(
      process.env.RASQ_INTERACTIVE_SHOULDER_OUTCOME_SUBMISSION_V1,
    ),
    adminClient,
    checkWriteLimit: (req) => checkPatientGeneralLimit(req, "interactive-shoulder-outcomes"),
    resolvePatientAccess: resolvePatientPortalAccess,
    recordServerFailure: recordInteractiveShoulderOutcomeServerFailure,
  };
}

// ── POST /api/patient/interactive-shoulder-outcomes ─────────────────────────────

export async function POST(req: NextRequest) {
  const deps = await buildRealDependencies();
  if (!deps) return serviceUnavailableResponse();
  return createInteractiveShoulderOutcomeSubmissionHandler(deps)(req);
}
