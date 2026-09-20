/**
 * GET /api/patient/plan?token=...
 *
 * Public endpoint — no Supabase auth session required.
 * Uses service role key server-side only.
 * Returns safe plan data; NEVER includes provider_id.
 * Token is validated but never logged.
 */
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkPatientGeneralLimit,
  rateLimitExceededResponse,
} from "../../../lib/rate-limit";
import {
  API_ERRORS,
  genericServerErrorResponse,
  invalidPatientTokenResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
} from "../../../lib/api/safe-errors";
import {
  fetchPlanSessionsForPatientPortal,
  type FetchPlanSessionsResult,
  type PlanSessionRow,
} from "./plan-session-query";
import { parseStoredExercises, type PrescribedExerciseV1 } from "../../../lib/exercise-resolve";
import { getAssessmentLanguage, type AssessmentLanguage } from "../../../lib/assessment-payload";
import {
  extractPlanProgramMetadata,
  resolvePatientRehabFocus,
} from "../../../lib/plan-program-metadata";
import {
  fetchPatientLifetimeSummary,
  type PatientLifetimeSummary,
} from "../../../lib/patient-lifetime-summary";
import { resolvePatientPortalAccess } from "../../../lib/patient-portal-access";
import {
  loadCatalogSessionForPlayback,
  LoadCatalogSessionForPlaybackError,
} from "../../../lib/rehab-programs/load-catalog-session-for-playback";
import type { ProgramSession } from "../../../lib/rehab-programs/rehab-program-types";
import {
  serializeClinicalPrescribedSideFromDb,
  type ClinicalPrescribedSide,
} from "../../../lib/clinical/clinical-prescribed-side";

// Re-export for portal consumers
export type { PatientLifetimeSummary };

// ── Public types (imported by patient portal pages) ────────────────────────────

export type PatientSession = {
  id: string;
  sessionNumber: number;
  title: string;
  /** Normalized prescriptions; legacy string plans resolved at read time. */
  exercises: PrescribedExerciseV1[];
  /** DB status values — portal pages map these to display states */
  status: "upcoming" | "today" | "completed" | "skipped";
  scheduledAt?: string | null;
  completedAt?: string | null;
  /**
   * Present only for a session sourced from the persisted rehabilitation
   * catalog (plan_sessions.source_program_session_id, migration 017).
   * Absent (not present as a key at all) for every legacy/non-catalog
   * session — additive, backward-compatible: existing consumers that
   * don't know this field exists see no shape change whatsoever.
   * `null` (present, but null) specifically means this session IS
   * catalog-sourced but its runtime data failed to load — the rest of
   * the plan response still returns successfully either way. This is
   * read-only runtime data (a ProgramSession, from
   * rehab-program-runtime-adapter.ts's own input contract) — nothing in
   * this route calls toSessionDefinition() or renders it.
   */
  catalogSession?: ProgramSession | null;
  /**
   * Therapist-authored unilateral treatment side stored on plan_sessions.
   * Read-only; sourced from the database, never from patient input.
   */
  prescribedSide: ClinicalPrescribedSide | null;
};

export type PatientPlanData = {
  patientName: string;
  /** Derived from latest assessment language; defaults to English */
  patientLanguage: AssessmentLanguage;
  diagnosis: string | null;
  planId: string;
  planTitle: string;
  programName: string;
  phaseName: string;
  phaseGoal: string;
  /** Patient-facing rehab focus (from program metadata or safe fallback) */
  patientRehabFocus: string;
  /** Explicit patient-friendly goal from plan metadata, if set by clinician */
  patientFriendlyGoal: string | null;
  /** Pilot template id when plan was created from a program template */
  programTemplateId: string | null;
  sessionsPerWeek: number;
  totalWeeks: number | null;
  /** Clinician note visible to the patient */
  clinicianNotes: string;
  assignedBy: string;
  assignedAt: string;
  sessions: PatientSession[];
  /** Aggregate counts across all plans for this patient (no historical details). */
  lifetimeSummary: PatientLifetimeSummary;
  // provider_id is intentionally excluded
};

// ── Service client (server-side only) ─────────────────────────────────────────

function buildAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Catalog session runtime data (additive) ────────────────────────────────────

type SessionForCatalogLookup = {
  id: string;
  source_program_session_id: string | null;
};

/**
 * For every session with a non-null source_program_session_id, loads
 * its catalog runtime data independently and concurrently — a failure
 * loading one session's data must never block another session's, and
 * is always caught here rather than propagating. Read-only: this never
 * writes anything, and never calls toSessionDefinition() or touches
 * SessionOrchestrator — that wiring is a later, separate step. Failure
 * context is logged server-side as structured JSON (planSessionId,
 * sourceProgramSessionId, the loader's own stable reason) — never the
 * raw underlying database error text, and never any patient-identifying
 * data.
 *
 * Exported standalone (not inlined into GET) so this merge/failure-
 * isolation behavior has direct, dependency-injected test coverage
 * without needing to mock the rest of this route's token/patient/
 * assessment/lifetime-summary flow.
 */
export async function loadCatalogSessionsById(
  admin: Parameters<typeof loadCatalogSessionForPlayback>[0],
  sessions: readonly SessionForCatalogLookup[],
): Promise<Map<string, ProgramSession | null>> {
  const catalogSessionById = new Map<string, ProgramSession | null>();
  await Promise.all(
    sessions
      .filter((s): s is SessionForCatalogLookup & { source_program_session_id: string } =>
        !!s.source_program_session_id,
      )
      .map(async (s) => {
        try {
          const catalogSession = await loadCatalogSessionForPlayback(
            admin,
            s.source_program_session_id,
          );
          catalogSessionById.set(s.id, catalogSession);
        } catch (err) {
          const reason =
            err instanceof LoadCatalogSessionForPlaybackError ? err.reason : "unexpected";
          console.error(
            "[GET /api/patient/plan] catalog session load failed",
            JSON.stringify({
              planSessionId: s.id,
              sourceProgramSessionId: s.source_program_session_id,
              reason,
            }),
          );
          catalogSessionById.set(s.id, null);
        }
      }),
  );
  return catalogSessionById;
}

export function mapPlanSessionRowsToPatientSessions(
  sessions: readonly PlanSessionRow[],
  catalogSessionById: Map<string, ProgramSession | null>,
): PatientSession[] {
  return sessions.map((s) => ({
    id:            s.id,
    sessionNumber: s.session_number,
    title:         s.title,
    exercises:     parseStoredExercises(s.exercises),
    status:        s.status as PatientSession["status"],
    scheduledAt:   s.scheduled_at,
    completedAt:   s.completed_at,
    prescribedSide: serializeClinicalPrescribedSideFromDb(s.prescribed_side),
    ...(s.source_program_session_id
      ? { catalogSession: catalogSessionById.get(s.id) ?? null }
      : {}),
  }));
}

export function handlePlanSessionQueryResult(
  sessionFetch: FetchPlanSessionsResult,
):
  | { ok: true; sessions: PlanSessionRow[] }
  | { ok: false; response: NextResponse } {
  if (sessionFetch.ok) {
    return { ok: true, sessions: sessionFetch.sessions };
  }

  console.error(
    "[GET /api/patient/plan] plan_sessions query failed",
    JSON.stringify({
      errorCode: sessionFetch.errorCode,
      queryMode: sessionFetch.queryMode,
      reason: sessionFetch.reason,
    }),
  );
  return { ok: false, response: genericServerErrorResponse() };
}

// ── GET /api/patient/plan?token=... ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const general = checkPatientGeneralLimit(req, "plan");
  if (!general.allowed) {
    return rateLimitExceededResponse(general.retryAfterSec);
  }

  const tokenValue = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!tokenValue) {
    return NextResponse.json({ error: "Token is required." }, { status: 400 });
  }

  const admin = buildAdminClient();
  if (!admin) {
    return serviceUnavailableResponse();
  }

  const resolved = await resolvePatientPortalAccess(admin, tokenValue);
  if (!resolved.ok) {
    if (resolved.reason === "invalid_token") {
      return invalidPatientTokenResponse(req);
    }
    if (resolved.reason === "plan_not_found") {
      return unableToCompleteResponse(404);
    }
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  const { access } = resolved;
  const plan = access.currentPlan;

  const lifetimeSummaryPromise = fetchPatientLifetimeSummary(admin, {
    patientId: access.patientId,
    providerId: access.providerId,
  });

  const sessionFetch = await fetchPlanSessionsForPatientPortal(admin, access.currentPlanId);
  const handledSessions = handlePlanSessionQueryResult(sessionFetch);
  if (!handledSessions.ok) {
    return handledSessions.response;
  }

  const sessions = handledSessions.sessions;
  const catalogSessionById = await loadCatalogSessionsById(admin, sessions);

  // 4 — Fetch safe patient fields only
  type PatientRow = { diagnosis: string | null };
  const { data: patientRow } = await admin
    .from("patients")
    .select("diagnosis")
    .eq("id", access.patientId)
    .maybeSingle<PatientRow>();

  // 5 — Latest assessment language (no schema change; read existing structured_data)
  type AssessmentLangRow = { structured_data: unknown };
  const { data: latestAssessment } = await admin
    .from("assessments")
    .select("structured_data")
    .eq("patient_id", access.patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<AssessmentLangRow>();

  const patientLanguage = getAssessmentLanguage(latestAssessment?.structured_data) ?? "en";

  const lifetimeSummary = await lifetimeSummaryPromise;

  const sd = plan.structured_data;
  const programMeta = extractPlanProgramMetadata(sd);

  const result: PatientPlanData = {
    patientName:     access.patientName,
    patientLanguage,
    diagnosis:       patientRow?.diagnosis ?? null,
    planId:          plan.id,
    planTitle:       plan.title,
    programName:     sd?.programName ?? plan.title ?? "Rehabilitation Plan",
    phaseName:       sd?.phaseName ?? "Phase 1",
    phaseGoal:       sd?.phaseGoal ?? "",
    patientRehabFocus: resolvePatientRehabFocus(sd, sd?.phaseGoal, patientLanguage),
    patientFriendlyGoal: programMeta.patientFriendlyGoal ?? null,
    programTemplateId: programMeta.programTemplateId ?? null,
    sessionsPerWeek: sd?.sessionsPerWeek ?? 3,
    totalWeeks:      plan.total_weeks ?? null,
    clinicianNotes:  plan.clinician_note ?? "",
    assignedBy:      sd?.assignedBy ?? "Your therapist",
    assignedAt:      plan.created_at,
    sessions: mapPlanSessionRowsToPatientSessions(sessions, catalogSessionById),
    lifetimeSummary,
  };

  return NextResponse.json(result);
}
