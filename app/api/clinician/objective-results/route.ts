/**
 * GET /api/clinician/objective-results?patientId=
 *
 * Read-only objective assessment series for the Patient Profile.
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
} from "@/app/lib/api/safe-errors";
import {
  OBJECTIVE_CV_EXERCISE_IDS,
  buildPatientObjectiveResults,
  type ObjectiveResultsViewModel,
} from "@/app/lib/progress/objective-assessment-series";

export type { ObjectiveResultsViewModel };

const CV_METRICS_LIMIT = 80;

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
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required." }, { status: 400 });
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.message }, { status: ownership.httpStatus });
  }

  type CvRow = {
    id: string;
    exercise_id: string;
    rep_count: number | null;
    session_duration_s: number | null;
    tracking_quality: string | null;
    source: string;
    recorded_at: string;
  };

  const { data: cvRows, error: cvErr } = await adminClient
    .from("cv_session_metrics")
    .select("id, exercise_id, rep_count, session_duration_s, tracking_quality, source, recorded_at")
    .eq("provider_id", user.id)
    .eq("patient_id", patientId)
    .in("exercise_id", [
      OBJECTIVE_CV_EXERCISE_IDS.tug,
      OBJECTIVE_CV_EXERCISE_IDS.sls,
      OBJECTIVE_CV_EXERCISE_IDS.sts,
    ])
    .eq("source", "assessment_movement")
    .order("recorded_at", { ascending: true })
    .limit(CV_METRICS_LIMIT)
    .returns<CvRow[]>();

  if (cvErr) {
    console.error("[GET /api/clinician/objective-results] cv metrics query failed");
    return genericServerErrorResponse();
  }

  type AssessmentRow = {
    id: string;
    type: string;
    created_at: string;
    structured_data: unknown;
  };

  const { data: assessmentRows, error: assessErr } = await adminClient
    .from("assessments")
    .select("id, type, created_at, structured_data")
    .eq("provider_id", user.id)
    .eq("patient_id", patientId)
    .eq("type", "upper_limb_motor_screen")
    .order("created_at", { ascending: true })
    .returns<AssessmentRow[]>();

  if (assessErr) {
    console.error("[GET /api/clinician/objective-results] assessments query failed");
    return genericServerErrorResponse();
  }

  const bundle = buildPatientObjectiveResults({
    patientId,
    cvMetrics: (cvRows ?? []).map((row) => ({
      id: row.id,
      exerciseId: row.exercise_id,
      repCount: row.rep_count,
      sessionDurationS: row.session_duration_s,
      trackingQuality: row.tracking_quality,
      source: row.source,
      recordedAt: row.recorded_at,
    })),
    batteryAssessments: (assessmentRows ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.created_at,
      structuredData: row.structured_data,
    })),
  });

  return NextResponse.json(bundle);
}
