import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
/**
 * POST /api/cv/session-metrics — persist derived CV metrics (Model C)
 * GET  /api/cv/session-metrics — list recent derived metrics for authenticated provider
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import {
  API_ERRORS,
  genericServerErrorResponse,
  ownershipErrorResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
} from "@/app/lib/api/safe-errors";
import { demoFallbackIfUnavailable } from "@/app/lib/api/demo-fallback-server";
import {
  getDemoCvSaveResponse,
  getDemoCvSessionMetrics,
} from "@/app/lib/demo/local-demo-fallback";

const FORBIDDEN_BODY_KEYS = new Set([
  "video",
  "image",
  "frame",
  "frames",
  "blob",
  "landmarks",
  "poseLandmarks",
  "rawLandmarks",
  "bodyCoordinates",
  "patientName",
  "phone",
  "nationalId",
  "diagnosis",
  "movementQuality",
  "romEstimate",
  "symmetryScore",
  "riskFlag",
]);

const TRACKING_QUALITIES = new Set(["good", "fair", "poor", "unknown"]);
const SOURCES = new Set(["cv_lab", "patient_session", "assessment_movement"]);

type PostBody = {
  patientId?: string;
  planId?: string;
  planSessionId?: string;
  exerciseId?: string;
  repCount?: number;
  sessionDurationS?: number;
  trackingQuality?: string;
  movementDetected?: boolean;
  framesWithPose?: number;
  framesTotal?: number;
  source?: string;
};

type CvMetricRow = {
  id: string;
  exercise_id: string;
  rep_count: number | null;
  session_duration_s: number | null;
  tracking_quality: string | null;
  movement_detected: boolean;
  frames_with_pose: number | null;
  frames_total: number | null;
  source: string;
  prototype_version: string;
  recorded_at: string;
  patient_id: string | null;
  plan_id: string | null;
  plan_session_id: string | null;
  motion_quality: Record<string, unknown> | null;
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

function rejectForbiddenKeys(body: Record<string, unknown>): NextResponse | null {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
    }
  }
  return null;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function toPublicMetric(row: CvMetricRow) {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    repCount: row.rep_count,
    sessionDurationS: row.session_duration_s,
    trackingQuality: row.tracking_quality,
    movementDetected: row.movement_detected,
    framesWithPose: row.frames_with_pose,
    framesTotal: row.frames_total,
    source: row.source,
    prototypeVersion: row.prototype_version,
    recordedAt: row.recorded_at,
    patientId: row.patient_id,
    planId: row.plan_id,
    planSessionId: row.plan_session_id,
    motionQuality: row.motion_quality ?? null,
  };
}

export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
    const demo = demoFallbackIfUnavailable(null, getDemoCvSaveResponse());
    if (demo) return demo;
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }

  const forbidden = rejectForbiddenKeys(body as Record<string, unknown>);
  if (forbidden) return forbidden;

  const exerciseId = body.exerciseId?.trim() ?? "";
  if (!exerciseId) {
    return NextResponse.json({ error: "exerciseId is required." }, { status: 400 });
  }

  const trackingQuality = body.trackingQuality?.trim();
  if (trackingQuality && !TRACKING_QUALITIES.has(trackingQuality)) {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }

  const source = body.source?.trim() || "cv_lab";
  if (!SOURCES.has(source)) {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }

  if (body.repCount !== undefined && !isNonNegativeInt(body.repCount)) {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }
  if (body.sessionDurationS !== undefined && !isNonNegativeInt(body.sessionDurationS)) {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }
  if (body.framesWithPose !== undefined && !isNonNegativeInt(body.framesWithPose)) {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }
  if (body.framesTotal !== undefined && !isNonNegativeInt(body.framesTotal)) {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }
  if (body.movementDetected !== undefined && typeof body.movementDetected !== "boolean") {
    return NextResponse.json({ error: API_ERRORS.UNABLE }, { status: 400 });
  }

  const patientId = body.patientId?.trim() || null;
  const planId = body.planId?.trim() || null;
  const planSessionId = body.planSessionId?.trim() || null;

  if (patientId) {
    const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
    if (!ownership.ok) {
      return ownershipErrorResponse(ownership);
    }
  }

  if (planId) {
    const { data: plan, error: planErr } = await adminClient
      .from("treatment_plans")
      .select("id")
      .eq("id", planId)
      .eq("provider_id", user.id)
      .maybeSingle<{ id: string }>();

    if (planErr) {
      console.error("[POST /api/cv/session-metrics] plan lookup failed:", planErr.message);
      return genericServerErrorResponse();
    }
    if (!plan) {
      return unableToCompleteResponse(404);
    }
  }

  if (planSessionId) {
    const { data: planSession, error: sessionErr } = await adminClient
      .from("plan_sessions")
      .select("id, provider_id")
      .eq("id", planSessionId)
      .eq("provider_id", user.id)
      .maybeSingle<{ id: string; provider_id: string }>();

    if (sessionErr) {
      console.error("[POST /api/cv/session-metrics] plan session lookup failed:", sessionErr.message);
      return genericServerErrorResponse();
    }
    if (!planSession) {
      return unableToCompleteResponse(404);
    }
  }

  const { data: inserted, error: insertErr } = await adminClient
    .from("cv_session_metrics")
    .insert({
      provider_id: user.id,
      patient_id: patientId,
      plan_id: planId,
      plan_session_id: planSessionId,
      exercise_id: exerciseId,
      rep_count: body.repCount ?? null,
      session_duration_s: body.sessionDurationS ?? null,
      tracking_quality: trackingQuality ?? null,
      movement_detected: body.movementDetected ?? false,
      frames_with_pose: body.framesWithPose ?? null,
      frames_total: body.framesTotal ?? null,
      source,
      prototype_version: "0.1",
    })
    .select("id, recorded_at")
    .single<{ id: string; recorded_at: string }>();

  if (insertErr) {
    console.error("[POST /api/cv/session-metrics] insert failed:", insertErr.message);
    return genericServerErrorResponse();
  }

  return NextResponse.json({
    saved: true,
    id: inserted.id,
    recordedAt: inserted.recorded_at,
  });
}

export async function GET(req: NextRequest) {
  const clients = await buildClients();
  const { searchParams } = req.nextUrl;
  const patientId = searchParams.get("patientId")?.trim() || null;

  if (!clients) {
    const demo = demoFallbackIfUnavailable(null, {
      metrics: getDemoCvSessionMetrics(patientId),
    });
    if (demo) return demo;
    return serviceUnavailableResponse();
  }
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const planId = searchParams.get("planId")?.trim() || null;
  const planSessionId = searchParams.get("planSessionId")?.trim() || null;

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

  if (patientId) {
    const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
    if (!ownership.ok) {
      return ownershipErrorResponse(ownership);
    }
  }

  if (planId) {
    const { data: plan, error: planErr } = await adminClient
      .from("treatment_plans")
      .select("id")
      .eq("id", planId)
      .eq("provider_id", user.id)
      .maybeSingle<{ id: string }>();

    if (planErr) {
      console.error("[GET /api/cv/session-metrics] plan lookup failed:", planErr.message);
      return genericServerErrorResponse();
    }
    if (!plan) {
      return unableToCompleteResponse(404);
    }
  }

  if (planSessionId) {
    const { data: planSession, error: sessionErr } = await adminClient
      .from("plan_sessions")
      .select("id")
      .eq("id", planSessionId)
      .eq("provider_id", user.id)
      .maybeSingle<{ id: string }>();

    if (sessionErr) {
      console.error("[GET /api/cv/session-metrics] plan session lookup failed:", sessionErr.message);
      return genericServerErrorResponse();
    }
    if (!planSession) {
      return unableToCompleteResponse(404);
    }
  }

  let query = adminClient
    .from("cv_session_metrics")
    .select(
      "id, exercise_id, rep_count, session_duration_s, tracking_quality, movement_detected, frames_with_pose, frames_total, source, prototype_version, recorded_at, patient_id, plan_id, plan_session_id, motion_quality",
    )
    .eq("provider_id", user.id)
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (patientId) query = query.eq("patient_id", patientId);
  if (planId) query = query.eq("plan_id", planId);
  if (planSessionId) query = query.eq("plan_session_id", planSessionId);

  const { data, error } = await query.returns<CvMetricRow[]>();

  if (error) {
    console.error("[GET /api/cv/session-metrics] query failed:", error.message);
    return genericServerErrorResponse();
  }

  return NextResponse.json({
    metrics: (data ?? []).map(toPublicMetric),
  });
}
