/**
 * GET /api/clinician/results
 *
 * Supabase-backed rehabilitation progress for the authenticated provider.
 * One card per treatment plan (not legacy FastAPI results).
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildClinicalActionFromPlanData,
  clinicalActionNeedsTherapistReview,
  type ClinicalActionResult,
} from "../../../lib/clinical-action-engine";
import {
  formatPainResponse,
  parseSessionCoachNotes,
} from "../../../lib/session-coach-metadata";
import {
  deriveMissedSessionsForReview,
  resolveClinicalReviewState,
  type ClinicalReviewAckRow,
} from "../../../lib/clinical-review";
import {
  buildPatientAssessmentSnapshots,
  pickPreferredAssessment,
  type AssessmentSnapshot,
} from "../../../lib/assessment-snapshot";
import { demoFallbackIfUnavailable } from "../../../lib/api/demo-fallback-server";
import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { getDemoClinicianResults } from "@/app/lib/demo/local-demo-fallback";

export type ClinicianResultStatus = "pending_review" | "active" | "completed";

export type ClinicianResultCard = {
  planId: string;
  patientId: string;
  patientName: string;
  planTitle: string;
  programName: string;
  sessionsCompleted: number;
  totalSessions: number;
  progressPct: number;
  latestEffortScore: number | null;
  latestPainScore: number | null;
  latestPainBeforeScore: number | null;
  latestPainResponse: string | null;
  safetyConcernReported: boolean;
  needsReview: boolean;
  clinicalAction: ClinicalActionResult;
  latestPatientNote: string | null;
  lastCompletedAt: string | null;
  status: ClinicianResultStatus;
  /** Latest preferred assessment for clinical report links (per patient). */
  latestAssessmentId: string | null;
  latestAssessmentType: string | null;
  latestSessionLogId: string | null;
  planSessionId: string | null;
  clinicalReviewTriggerKey: string | null;
  reviewAcknowledged: boolean;
  reviewedAt: string | null;
};

export type ClinicianResultsResponse = {
  cards: ClinicianResultCard[];
  patientAssessments: AssessmentSnapshot[];
  demoMode?: boolean;
  demoNotice?: string;
};

type AssessmentPickRow = {
  id: string;
  patient_id: string;
  type: string;
  created_at: string;
  structured_data: unknown;
};

async function buildClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* read-only */
        }
      },
    },
  });
  const adminClient = svc
    ? createAdminClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })
    : sessionClient;
  return { sessionClient, adminClient };
}

function deriveStatus(completed: number, total: number): ClinicianResultStatus {
  if (total > 0 && completed >= total) return "completed";
  if (completed > 0) return "active";
  return "pending_review";
}

export async function GET(_req: NextRequest) {
  const clients = await buildClients();
  const demo = demoFallbackIfUnavailable(clients, getDemoClinicianResults());
  if (demo) return demo;
  const { sessionClient, adminClient } = clients!;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  type PatientRow = { id: string; full_name: string };
  const { data: patients, error: patientsErr } = await adminClient
    .from("patients")
    .select("id, full_name")
    .eq("provider_id", user.id)
    .returns<PatientRow[]>();

  if (patientsErr) {
    console.error("[GET /api/clinician/results] patients query failed");
    return NextResponse.json({ error: "Failed to load results." }, { status: 500 });
  }

  const patientMap = new Map((patients ?? []).map((p) => [p.id, p.full_name]));
  if (patientMap.size === 0) {
    return NextResponse.json({
      cards: [],
      patientAssessments: [],
    } satisfies ClinicianResultsResponse);
  }

  type PlanRow = {
    id: string;
    patient_id: string;
    title: string;
    structured_data: { programName?: string } | null;
    status: string;
    created_at: string;
  };

  const { data: plans, error: plansErr } = await adminClient
    .from("treatment_plans")
    .select("id, patient_id, title, structured_data, status, created_at")
    .eq("provider_id", user.id)
    .order("created_at", { ascending: false })
    .returns<PlanRow[]>();

  if (plansErr) {
    console.error("[GET /api/clinician/results] plans query failed");
    return NextResponse.json({ error: "Failed to load results." }, { status: 500 });
  }

  if (!plans?.length) {
    return NextResponse.json({
      cards: [],
      patientAssessments: [],
    } satisfies ClinicianResultsResponse);
  }

  const planIds = plans.map((p) => p.id);

  type SessionRow = { plan_id: string; status: string; session_number: number };
  const { data: sessions } = await adminClient
    .from("plan_sessions")
    .select("plan_id, status, session_number")
    .in("plan_id", planIds)
    .returns<SessionRow[]>();

  type LogRow = {
    id: string;
    plan_id: string;
    plan_session_id: string | null;
    effort_score: number | null;
    pain_score: number | null;
    notes: string | null;
    completed_at: string;
  };
  const { data: logs } = await adminClient
    .from("session_logs")
    .select("id, plan_id, plan_session_id, effort_score, pain_score, notes, completed_at")
    .in("plan_id", planIds)
    .order("completed_at", { ascending: false })
    .returns<LogRow[]>();

  const sessionsByPlan = new Map<string, SessionRow[]>();
  (sessions ?? []).forEach((s) => {
    const arr = sessionsByPlan.get(s.plan_id) ?? [];
    arr.push(s);
    sessionsByPlan.set(s.plan_id, arr);
  });

  const latestLogByPlan = new Map<string, LogRow>();
  const logsByPlan = new Map<string, LogRow[]>();
  (logs ?? []).forEach((log) => {
    if (!latestLogByPlan.has(log.plan_id)) {
      latestLogByPlan.set(log.plan_id, log);
    }
    const arr = logsByPlan.get(log.plan_id) ?? [];
    arr.push(log);
    logsByPlan.set(log.plan_id, arr);
  });

  const patientIds = [...new Set(plans.map((p) => p.patient_id))];
  const assessmentsByPatient = new Map<string, AssessmentPickRow[]>();

  if (patientIds.length > 0) {
    const { data: assessmentRows, error: assessErr } = await adminClient
      .from("assessments")
      .select("id, patient_id, type, created_at, structured_data")
      .eq("provider_id", user.id)
      .in("patient_id", patientIds)
      .order("created_at", { ascending: false })
      .returns<AssessmentPickRow[]>();

    if (assessErr) {
      console.error("[GET /api/clinician/results] assessments query failed");
    } else {
      (assessmentRows ?? []).forEach((a) => {
        const arr = assessmentsByPatient.get(a.patient_id) ?? [];
        arr.push(a);
        assessmentsByPatient.set(a.patient_id, arr);
      });
    }
  }

  const latestAssessmentByPatient = new Map<string, AssessmentPickRow | null>();
  patientIds.forEach((pid) => {
    latestAssessmentByPatient.set(
      pid,
      pickPreferredAssessment(assessmentsByPatient.get(pid) ?? []),
    );
  });

  const acknowledgmentsByTriggerKey = new Map<string, ClinicalReviewAckRow>();
  const { data: ackRows, error: ackErr } = await adminClient
    .from("clinical_review_acknowledgments")
    .select("trigger_key, reviewed_at")
    .eq("provider_id", user.id)
    .in("plan_id", planIds)
    .returns<ClinicalReviewAckRow[]>();

  if (ackErr) {
    if (ackErr.code !== "42P01") {
      console.error("[GET /api/clinician/results] acknowledgments query failed");
    }
  } else {
    (ackRows ?? []).forEach((row) => {
      acknowledgmentsByTriggerKey.set(row.trigger_key, row);
    });
  }

  const cards: ClinicianResultCard[] = plans.map((plan) => {
    const planSessions = sessionsByPlan.get(plan.id) ?? [];
    const total = planSessions.length;
    const completed = planSessions.filter((s) => s.status === "completed").length;
    const latest = latestLogByPlan.get(plan.id);
    const preferredAssessment = latestAssessmentByPatient.get(plan.patient_id) ?? null;
    const coachMeta = parseSessionCoachNotes(latest?.notes);
    const painAfter = latest?.pain_score ?? null;
    const planLogs = logsByPlan.get(plan.id) ?? [];
    const clinicalAction = buildClinicalActionFromPlanData({
      latestLog: latest,
      sessions: planSessions.map((s) => ({
        status: s.status,
        session_number: s.session_number,
      })),
      parseNotes: parseSessionCoachNotes,
      allLogs: [...planLogs].reverse(),
    });

    const missedSessionsCount = deriveMissedSessionsForReview(
      planSessions.map((s) => ({
        status: s.status,
        session_number: s.session_number,
      })),
    );
    const reviewState = resolveClinicalReviewState({
      planId: plan.id,
      actionStatus: clinicalAction.status,
      latestSessionLogId: latest?.id ?? null,
      missedSessionsCount,
      acknowledgmentsByTriggerKey,
    });

    return {
      planId: plan.id,
      patientId: plan.patient_id,
      patientName: patientMap.get(plan.patient_id) ?? "Patient",
      planTitle: plan.title,
      programName: plan.structured_data?.programName ?? plan.title,
      sessionsCompleted: completed,
      totalSessions: total,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      latestEffortScore: latest?.effort_score ?? null,
      latestPainScore: painAfter,
      latestPainBeforeScore: coachMeta.painBefore,
      latestPainResponse: formatPainResponse(coachMeta.painBefore, painAfter),
      safetyConcernReported: coachMeta.safetyConcern,
      needsReview: clinicalActionNeedsTherapistReview(clinicalAction.status),
      clinicalAction,
      latestPatientNote: coachMeta.patientNote,
      lastCompletedAt: latest?.completed_at ?? null,
      status: deriveStatus(completed, total),
      latestAssessmentId: preferredAssessment?.id ?? null,
      latestAssessmentType: preferredAssessment?.type ?? null,
      latestSessionLogId: latest?.id ?? null,
      planSessionId: latest?.plan_session_id ?? null,
      clinicalReviewTriggerKey: reviewState.clinicalReviewTriggerKey,
      reviewAcknowledged: reviewState.reviewAcknowledged,
      reviewedAt: reviewState.reviewedAt,
    };
  });

  const patientAssessments = buildPatientAssessmentSnapshots(
    patientIds.flatMap((pid) => assessmentsByPatient.get(pid) ?? []),
  );

  return NextResponse.json({
    cards,
    patientAssessments,
  } satisfies ClinicianResultsResponse);
}
