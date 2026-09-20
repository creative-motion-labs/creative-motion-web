import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateSecurePatientToken } from "../../lib/patient-access-token";
import { validatePatientOwnership } from "../../lib/validate-patient-ownership";
import {
  normalizeExercisesForStorage,
  type PrescribedExerciseV1,
} from "../../lib/exercise-resolve";
import {
  buildGuidedPlanSessionInsertRows,
  requiresPrescribedSideStorageCapability,
  validateGuidedPlanSessionPrescriptions,
} from "../../lib/clinical/clinical-prescribed-side";
import { probePrescribedSideStorageCapability } from "../../lib/clinical/clinical-prescribed-side-capability";
import type { StoredExercise } from "../../lib/exercise-prescription";
import {
  buildPlanProgramMetadata,
  type PlanProgramMetadata,
} from "../../lib/plan-program-metadata";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "../../lib/rate-limit";
import {
  ownershipErrorResponse,
  serviceUnavailableResponse,
} from "../../lib/api/safe-errors";
import type { PlanSessionsRow, TreatmentPlansRow } from "../../lib/supabase/database.types";

const PLAN_CREATE_ERROR = "Failed to create plan.";

// ── Shared types ───────────────────────────────────────────────────────────────

/** Structured metadata stored in treatment_plans.structured_data */
export type PlanStructuredData = {
  programId: string;
  programName: string;
  phase: string;
  phaseName: string;
  phaseGoal: string;
  sessionsPerWeek: number;
  assignedBy: string;
  phases?: unknown[]; // phase config used in the custom plan builder
} & PlanProgramMetadata;

/** Row from `public.plan_sessions` with typed exercises jsonb. */
export type PlanSessionRow = Omit<PlanSessionsRow, "exercises"> & {
  exercises: StoredExercise[];
};

/** Row from `public.treatment_plans` with typed structured_data and optional joins. */
export type PlanRow = Omit<TreatmentPlansRow, "structured_data"> & {
  structured_data: PlanStructuredData | null;
  /** Joined: sessions belonging to this plan */
  sessions?: PlanSessionRow[];
  /** Joined: active patient portal token */
  patient_token?: string | null;
};

// ── Client factory ─────────────────────────────────────────────────────────────

async function buildClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;
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
  const adminClient = svc
    ? createAdminClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })
    : sessionClient;
  return { sessionClient, adminClient };
}

/** Best-effort cleanup when a child insert fails after plan creation. */
async function rollbackPlanCreation(
  adminClient: SupabaseClient,
  planId: string,
): Promise<void> {
  await adminClient.from("patient_access_tokens").delete().eq("plan_id", planId);
  await adminClient.from("plan_sessions").delete().eq("plan_id", planId);
  await adminClient.from("treatment_plans").delete().eq("id", planId);
}

// ── POST /api/plans ────────────────────────────────────────────────────────────

type PostBody = {
  patientId: string;
  assessmentId?: string | null;
  title?: string;
  programId?: string;
  programName?: string;
  phase?: string;
  phaseName?: string;
  phaseGoal?: string;
  sessionsPerWeek?: number;
  totalWeeks?: number;
  clinicianNote?: string;
  phases?: unknown[];
  sessions?: {
    sessionNumber: number;
    title: string;
    exercises: (string | PrescribedExerciseV1)[];
    prescribedSide?: unknown;
  }[];
  assignedBy?: string;
  programTemplateId?: string;
  programGoal?: string;
  patientFriendlyGoal?: string;
  expectedResponse?: string;
  reviewCriteria?: string;
  safetyNotes?: string;
};

/**
 * Creates a treatment plan, plan sessions, and a patient access token.
 *
 * Response 201: PlanRow (with patient_token)
 * Response 400: { error }
 * Response 401: { error }
 * Response 404: { error } — patient not owned
 * Response 500: { error }
 */
export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) return serviceUnavailableResponse();
  const { sessionClient, adminClient } = clients;

  const { data: { user }, error: authErr } = await sessionClient.auth.getUser();
  if (authErr ?? !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const limited = checkClinicianWriteLimit(user.id, "plans:create");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  let body: PostBody;
  try { body = (await req.json()) as PostBody; }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const patientId = body.patientId?.trim();
  if (!patientId) return NextResponse.json({ error: "patientId is required." }, { status: 400 });

  // Verify ownership
  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  let prescribedSideBySessionNumber = new Map<number, "left" | "right">();
  if (body.sessions && body.sessions.length > 0) {
    const prescriptionValidation = validateGuidedPlanSessionPrescriptions(body.sessions);
    if (!prescriptionValidation.ok) {
      return NextResponse.json({ error: prescriptionValidation.error }, { status: 400 });
    }
    prescribedSideBySessionNumber = prescriptionValidation.prescribedSideBySessionNumber;

    if (requiresPrescribedSideStorageCapability(prescribedSideBySessionNumber)) {
      const capability = await probePrescribedSideStorageCapability(adminClient);
      if (!capability.ok) {
        console.error("[POST /api/plans] prescribed-side capability probe failed");
        return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: 500 });
      }
      if (!capability.available) {
        return serviceUnavailableResponse();
      }
    }
  }

  const programMetadata = buildPlanProgramMetadata({
    programTemplateId:
      body.programTemplateId ??
      (body.programId && body.programId !== "custom" ? body.programId : undefined),
    programGoal: body.programGoal ?? body.phaseGoal,
    patientFriendlyGoal: body.patientFriendlyGoal,
    expectedResponse: body.expectedResponse,
    reviewCriteria: body.reviewCriteria,
    safetyNotes: body.safetyNotes,
  });

  const structuredData: PlanStructuredData = {
    programId:       body.programId ?? "custom",
    programName:     body.programName ?? body.title ?? "Custom Plan",
    phase:           body.phase ?? "phase-1",
    phaseName:       body.phaseName ?? "Phase 1",
    phaseGoal:       body.phaseGoal ?? "",
    sessionsPerWeek: body.sessionsPerWeek ?? 3,
    assignedBy:      body.assignedBy ?? "Clinician",
    phases:          body.phases,
    ...programMetadata,
  };

  // Insert treatment plan
  const { data: plan, error: planErr } = await adminClient
    .from("treatment_plans")
    .insert({
      provider_id:     user.id,
      patient_id:      patientId,
      assessment_id:   body.assessmentId ?? null,
      title:           body.title ?? body.programName ?? "Treatment Plan",
      structured_data: structuredData,
      status:          "active",
      total_weeks:     body.totalWeeks ?? Math.max(1, Math.ceil((body.sessions?.length ?? 6) / (body.sessionsPerWeek ?? 3))),
      current_week:    1,
      clinician_note:  body.clinicianNote?.trim() ?? null,
    })
    .select()
    .single();

  if (planErr) {
    console.error("[POST /api/plans] plan insert failed");
    return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: 500 });
  }

  const planId = (plan as PlanRow).id;

  const { data: patientRow } = await adminClient
    .from("patients")
    .select("full_name")
    .eq("id", patientId)
    .single();
  const patientName: string = (patientRow as { full_name: string } | null)?.full_name ?? "Patient";

  // Insert plan sessions (when provided)
  if (body.sessions && body.sessions.length > 0) {
    const sessionRows = buildGuidedPlanSessionInsertRows({
      planId,
      providerId: user.id,
      patientId,
      sessions: body.sessions.map((session) => ({
        sessionNumber: session.sessionNumber,
        title: session.title,
        exercises: normalizeExercisesForStorage(session.exercises),
      })),
      prescribedSideBySessionNumber,
    });

    const { error: sessErr } = await adminClient.from("plan_sessions").insert(sessionRows);
    if (sessErr) {
      console.error("[POST /api/plans] sessions insert failed");
      await rollbackPlanCreation(adminClient, planId);
      return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: 500 });
    }
  }

  const token = generateSecurePatientToken();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const { error: tokenErr } = await adminClient.from("patient_access_tokens").insert({
    provider_id:  user.id,
    patient_id:   patientId,
    patient_name: patientName,
    plan_id:      planId,
    token,
    expires_at:   expiresAt,
  });

  if (tokenErr) {
    console.error("[POST /api/plans] token insert failed");
    await rollbackPlanCreation(adminClient, planId);
    return NextResponse.json({ error: PLAN_CREATE_ERROR }, { status: 500 });
  }

  const { data: sessions } = await adminClient
    .from("plan_sessions")
    .select("*")
    .eq("plan_id", planId)
    .order("session_number", { ascending: true });

  const result: PlanRow = {
    ...(plan as PlanRow),
    sessions: (sessions ?? []) as PlanSessionRow[],
    patient_token: token,
  };

  return NextResponse.json(result, { status: 201 });
}

// ── GET /api/plans?patientId=UUID ──────────────────────────────────────────────

/**
 * Returns all active treatment plans for a patient, newest first.
 * Each plan includes its sessions and the active patient portal token.
 *
 * Response 200: PlanRow[]
 * Response 400: { error }
 * Response 401: { error }
 * Response 404: { error } — patient not owned
 * Response 500: { error }
 */
export async function GET(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) return serviceUnavailableResponse();
  const { sessionClient, adminClient } = clients;

  const { data: { user }, error: authErr } = await sessionClient.auth.getUser();
  if (authErr ?? !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const patientId = new URL(req.url).searchParams.get("patientId")?.trim();
  if (!patientId) return NextResponse.json({ error: "patientId is required." }, { status: 400 });

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  // Fetch plans
  const { data: plans, error: plansErr } = await adminClient
    .from("treatment_plans")
    .select("*")
    .eq("patient_id", patientId)
    .eq("provider_id", user.id)
    .order("created_at", { ascending: false });

  if (plansErr) {
    console.error("[GET /api/plans] query failed:", plansErr.message);
    return NextResponse.json({ error: "Failed to load plans." }, { status: 500 });
  }

  if (!plans || plans.length === 0) return NextResponse.json([]);

  const planIds = plans.map((p: PlanRow) => p.id);

  // Fetch sessions for all plans
  const { data: allSessions } = await adminClient
    .from("plan_sessions")
    .select("*")
    .in("plan_id", planIds)
    .order("session_number", { ascending: true });

  // Fetch active tokens for all plans
  const { data: tokens } = await adminClient
    .from("patient_access_tokens")
    .select("plan_id, token")
    .in("plan_id", planIds);

  const sessionsByPlan = new Map<string, PlanSessionRow[]>();
  (allSessions ?? []).forEach((s: PlanSessionRow) => {
    const arr = sessionsByPlan.get(s.plan_id) ?? [];
    arr.push(s);
    sessionsByPlan.set(s.plan_id, arr);
  });

  const tokenByPlan = new Map<string, string>();
  (tokens ?? []).forEach((t: { plan_id: string; token: string }) => {
    tokenByPlan.set(t.plan_id, t.token);
  });

  const result: PlanRow[] = plans.map((p: PlanRow) => ({
    ...p,
    sessions:      sessionsByPlan.get(p.id) ?? [],
    patient_token: tokenByPlan.get(p.id) ?? null,
  }));

  return NextResponse.json(result);
}
