/**
 * GET /api/clinician/progress-outcomes?patientId=UUID&planId=UUID
 *
 * Read-only Progress & Outcomes bundle for clinician hub.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import {
  genericServerErrorResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
} from "@/app/lib/api/safe-errors";
import { resolveCurrentAndPreviousPlans } from "@/app/lib/clinician/resolve-current-plan";
import {
  buildProgressOutcomesBundle,
  type ProgressOutcomesBundle,
} from "@/app/lib/progress/progress-outcomes-bundle";
import { fetchInteractiveShoulderOutcomesForPatient } from "@/app/lib/interactive-shoulder/movement-outcome-persistence";
import { filterInteractiveShoulderOutcomeRowsToPlan } from "@/app/lib/progress/interactive-shoulder-patient-progress";

export type { ProgressOutcomesBundle };

const CV_METRICS_LIMIT = 50;

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

export async function GET(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const {
    data: { user },
    error: authErr,
  } = await sessionClient.auth.getUser();
  if (authErr ?? !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const patientId = new URL(req.url).searchParams.get("patientId")?.trim() ?? "";
  const planIdParam = new URL(req.url).searchParams.get("planId")?.trim() ?? "";

  if (!patientId) {
    return NextResponse.json({ error: "patientId is required." }, { status: 400 });
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.message }, { status: ownership.httpStatus });
  }

  const { data: patient, error: patientErr } = await adminClient
    .from("patients")
    .select("id, full_name")
    .eq("id", patientId)
    .eq("provider_id", user.id)
    .maybeSingle<{ id: string; full_name: string }>();

  if (patientErr) {
    console.error("[GET /api/clinician/progress-outcomes] patient lookup failed");
    return genericServerErrorResponse();
  }
  if (!patient) {
    return unableToCompleteResponse(404);
  }

  let planId: string | null = null;
  let planTitle: string | null = null;
  let sessionsCompleted = 0;
  let totalSessions = 0;

  if (planIdParam) {
    const { data: plan, error: planErr } = await adminClient
      .from("treatment_plans")
      .select("id, title")
      .eq("id", planIdParam)
      .eq("patient_id", patientId)
      .eq("provider_id", user.id)
      .maybeSingle<{ id: string; title: string }>();

    if (planErr) {
      console.error("[GET /api/clinician/progress-outcomes] plan lookup failed");
      return genericServerErrorResponse();
    }
    if (!plan) {
      return unableToCompleteResponse(404);
    }
    planId = plan.id;
    planTitle = plan.title;
  } else {
    type PlanPickRow = {
      id: string;
      title: string;
      status: string;
      created_at: string;
    };

    const { data: planRows, error: planErr } = await adminClient
      .from("treatment_plans")
      .select("id, title, status, created_at")
      .eq("patient_id", patientId)
      .eq("provider_id", user.id)
      .order("created_at", { ascending: false })
      .returns<PlanPickRow[]>();

    if (planErr) {
      console.error("[GET /api/clinician/progress-outcomes] plan lookup failed");
      return genericServerErrorResponse();
    }

    const { currentPlan } = resolveCurrentAndPreviousPlans(planRows ?? []);
    if (currentPlan) {
      planId = currentPlan.id;
      planTitle = currentPlan.title;
    }
  }

  if (planId) {
    const { data: sessions } = await adminClient
      .from("plan_sessions")
      .select("status")
      .eq("plan_id", planId)
      .returns<{ status: string }[]>();

    totalSessions = sessions?.length ?? 0;
    sessionsCompleted = (sessions ?? []).filter((s) => s.status === "completed").length;
  }

  type LogRow = {
    id: string;
    plan_session_id: string | null;
    effort_score: number | null;
    pain_score: number | null;
    notes: string | null;
    completed_at: string;
  };

  let sessionLogsQuery = adminClient
    .from("session_logs")
    .select("id, plan_session_id, effort_score, pain_score, notes, completed_at")
    .eq("patient_id", patientId)
    .eq("provider_id", user.id)
    .order("completed_at", { ascending: true });

  if (planId) {
    sessionLogsQuery = sessionLogsQuery.eq("plan_id", planId);
  }

  const { data: sessionLogs, error: logsErr } = await sessionLogsQuery.returns<LogRow[]>();

  if (logsErr) {
    console.error("[GET /api/clinician/progress-outcomes] session logs query failed");
    return genericServerErrorResponse();
  }

  const sessionIds = [
    ...new Set(
      (sessionLogs ?? [])
        .map((log) => log.plan_session_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const sessionNumberById = new Map<string, number>();
  if (sessionIds.length > 0) {
    const { data: sessionRows } = await adminClient
      .from("plan_sessions")
      .select("id, session_number")
      .in("id", sessionIds)
      .returns<{ id: string; session_number: number }[]>();

    (sessionRows ?? []).forEach((row) => {
      sessionNumberById.set(row.id, row.session_number);
    });
  }

  type AssessmentRow = {
    id: string;
    patient_id: string;
    type: string;
    created_at: string;
    structured_data: unknown;
  };

  const { data: assessmentRows, error: assessErr } = await adminClient
    .from("assessments")
    .select("id, patient_id, type, created_at, structured_data")
    .eq("provider_id", user.id)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .returns<AssessmentRow[]>();

  if (assessErr) {
    console.error("[GET /api/clinician/progress-outcomes] assessments query failed");
    return genericServerErrorResponse();
  }

  type CvRow = {
    id: string;
    exercise_id: string;
    rep_count: number | null;
    session_duration_s: number | null;
    tracking_quality: string | null;
    movement_detected: boolean;
    source: string;
    recorded_at: string;
    plan_session_id: string | null;
    motion_quality: Record<string, unknown> | null;
  };

  const { data: cvRows, error: cvErr } = await adminClient
    .from("cv_session_metrics")
    .select(
      "id, exercise_id, rep_count, session_duration_s, tracking_quality, movement_detected, source, recorded_at, plan_session_id, motion_quality",
    )
    .eq("provider_id", user.id)
    .eq("patient_id", patientId)
    .order("recorded_at", { ascending: false })
    .limit(CV_METRICS_LIMIT)
    .returns<CvRow[]>();

  if (cvErr) {
    console.error("[GET /api/clinician/progress-outcomes] cv metrics query failed");
    return genericServerErrorResponse();
  }

  // Longitudinal Interactive Shoulder charts use all outcomes for this
  // patient/provider. Current-plan session cards keep their own scope.
  const outcomesResult = await fetchInteractiveShoulderOutcomesForPatient(adminClient, {
    providerId: user.id,
    patientId,
    planId: null,
  });
  if (!outcomesResult.ok) {
    console.error("[GET /api/clinician/progress-outcomes] interactive shoulder outcomes query failed");
    return genericServerErrorResponse();
  }

  const interactiveShoulderOutcomeRows = filterInteractiveShoulderOutcomeRowsToPlan(
    outcomesResult.rows,
    planId,
  );
  const interactiveShoulderChartOutcomeRows = outcomesResult.rows;

  const chartPlanSessionIds = [
    ...new Set(
      interactiveShoulderChartOutcomeRows
        .map((row) => row.plan_session_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  let interactiveShoulderChartSessionLogs: LogRow[] = [];
  const interactiveShoulderChartSessionNumberById = new Map<string, number>();

  if (chartPlanSessionIds.length > 0) {
    const { data: chartLogs, error: chartLogsErr } = await adminClient
      .from("session_logs")
      .select("id, plan_session_id, effort_score, pain_score, notes, completed_at")
      .eq("patient_id", patientId)
      .eq("provider_id", user.id)
      .in("plan_session_id", chartPlanSessionIds)
      .order("completed_at", { ascending: true })
      .returns<LogRow[]>();

    if (chartLogsErr) {
      console.error("[GET /api/clinician/progress-outcomes] chart session logs query failed");
      return genericServerErrorResponse();
    }

    interactiveShoulderChartSessionLogs = chartLogs ?? [];

    const { data: chartSessionRows } = await adminClient
      .from("plan_sessions")
      .select("id, session_number")
      .in("id", chartPlanSessionIds)
      .returns<{ id: string; session_number: number }[]>();

    (chartSessionRows ?? []).forEach((row) => {
      interactiveShoulderChartSessionNumberById.set(row.id, row.session_number);
    });
  }

  const bundle = buildProgressOutcomesBundle({
    patientId,
    patientName: patient.full_name,
    planId,
    planTitle,
    sessionsCompleted,
    totalSessions,
    sessionLogs: sessionLogs ?? [],
    sessionNumberById,
    assessmentRows: assessmentRows ?? [],
    cvMetricRows: cvRows ?? [],
    interactiveShoulderOutcomeRows,
    interactiveShoulderChartOutcomeRows,
    interactiveShoulderChartSessionLogs,
    interactiveShoulderChartSessionNumberById,
  });

  return NextResponse.json(bundle);
}
