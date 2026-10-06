import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
/**
 * POST /api/clinician/clinical-reviews
 *
 * Append-only acknowledgment of a computed clinical review flag.
 * Does not modify session_logs or treatment plans.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validatePatientOwnership } from "../../../lib/validate-patient-ownership";
import {
  API_ERRORS,
  genericServerErrorResponse,
  serviceUnavailableResponse,
  unableToCompleteResponse,
} from "../../../lib/api/safe-errors";
import {
  buildClinicalActionFromPlanData,
  clinicalActionNeedsTherapistReview,
} from "../../../lib/clinical-action-engine";
import {
  buildClinicalReviewTriggerKey,
  deriveMissedSessionsForReview,
  isUrgentClinicalReviewStatus,
  normalizeReviewNote,
  type UrgentClinicalReviewStatus,
} from "../../../lib/clinical-review";
import { parseSessionCoachNotes } from "../../../lib/session-coach-metadata";

type PostBody = {
  patientId?: string;
  planId?: string;
  sessionLogId?: string | null;
  actionStatus?: UrgentClinicalReviewStatus;
  reviewNote?: string;
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

export async function POST(req: NextRequest) {
  const clients = await buildClients();
  if (!clients) {
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
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patientId = body.patientId?.trim() ?? "";
  const planId = body.planId?.trim() ?? "";
  const actionStatus = body.actionStatus;

  if (!patientId) {
    return NextResponse.json({ error: "patientId is required." }, { status: 400 });
  }
  if (!planId) {
    return NextResponse.json({ error: "planId is required." }, { status: 400 });
  }
  if (!actionStatus || !isUrgentClinicalReviewStatus(actionStatus)) {
    return NextResponse.json({ error: "A valid urgent actionStatus is required." }, { status: 400 });
  }

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.message }, { status: ownership.httpStatus });
  }

  const { data: plan, error: planErr } = await adminClient
    .from("treatment_plans")
    .select("id, patient_id, provider_id")
    .eq("id", planId)
    .eq("patient_id", patientId)
    .eq("provider_id", user.id)
    .maybeSingle<{ id: string; patient_id: string; provider_id: string }>();

  if (planErr) {
    console.error("[POST /api/clinician/clinical-reviews] plan lookup failed:", planErr.message);
    return genericServerErrorResponse();
  }
  if (!plan) {
    return unableToCompleteResponse(404);
  }

  const { data: sessions } = await adminClient
    .from("plan_sessions")
    .select("status, session_number")
    .eq("plan_id", planId)
    .returns<{ status: string; session_number: number }[]>();

  const { data: planLogs } = await adminClient
    .from("session_logs")
    .select("id, effort_score, pain_score, notes, completed_at")
    .eq("plan_id", planId)
    .order("completed_at", { ascending: false })
    .returns<{
      id: string;
      effort_score: number | null;
      pain_score: number | null;
      notes: string | null;
      completed_at: string;
    }[]>();

  const latestLog = planLogs?.[0] ?? null;
  const missedSessionsCount = deriveMissedSessionsForReview(sessions ?? []);
  const clinicalAction = buildClinicalActionFromPlanData({
    latestLog,
    sessions: sessions ?? [],
    parseNotes: parseSessionCoachNotes,
    allLogs: [...(planLogs ?? [])].reverse(),
  });

  if (!clinicalActionNeedsTherapistReview(clinicalAction.status)) {
    return NextResponse.json(
      { error: "This plan does not currently require therapist review." },
      { status: 409 },
    );
  }

  if (clinicalAction.status !== actionStatus) {
    return NextResponse.json(
      { error: "actionStatus does not match the current computed clinical action." },
      { status: 409 },
    );
  }

  const triggerKey = buildClinicalReviewTriggerKey({
    planId,
    actionStatus: clinicalAction.status,
    latestSessionLogId: latestLog?.id ?? null,
    missedSessionsCount,
  });

  if (!triggerKey) {
    return NextResponse.json(
      { error: "Could not determine review trigger for the current clinical action." },
      { status: 409 },
    );
  }

  if (
    actionStatus !== "adherence_follow_up" &&
    body.sessionLogId?.trim() &&
    latestLog?.id &&
    body.sessionLogId.trim() !== latestLog.id
  ) {
    return NextResponse.json(
      { error: "sessionLogId does not match the latest session log for this plan." },
      { status: 409 },
    );
  }

  const reviewNote = normalizeReviewNote(body.reviewNote);
  const sessionLogIdForRow =
    actionStatus === "adherence_follow_up" ? null : (latestLog?.id ?? null);

  const { data: existing, error: existingErr } = await adminClient
    .from("clinical_review_acknowledgments")
    .select("reviewed_at")
    .eq("provider_id", user.id)
    .eq("trigger_key", triggerKey)
    .maybeSingle<{ reviewed_at: string }>();

  if (existingErr) {
    if (existingErr.code === "42P01") {
      console.error(
        "[POST /api/clinician/clinical-reviews] clinical_review_acknowledgments table missing",
      );
      return serviceUnavailableResponse();
    }
    console.error("[POST /api/clinician/clinical-reviews] existing lookup failed");
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ reviewed: true, reviewedAt: existing.reviewed_at });
  }

  const reviewedAt = new Date().toISOString();
  const { data: inserted, error: insertErr } = await adminClient
    .from("clinical_review_acknowledgments")
    .insert({
      provider_id: user.id,
      patient_id: patientId,
      plan_id: planId,
      session_log_id: sessionLogIdForRow,
      action_status: actionStatus,
      trigger_key: triggerKey,
      review_note: reviewNote,
      reviewed_by: user.id,
      reviewed_at: reviewedAt,
    })
    .select("reviewed_at")
    .single<{ reviewed_at: string }>();

  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: raced } = await adminClient
        .from("clinical_review_acknowledgments")
        .select("reviewed_at")
        .eq("provider_id", user.id)
        .eq("trigger_key", triggerKey)
        .maybeSingle<{ reviewed_at: string }>();
      if (raced) {
        return NextResponse.json({ reviewed: true, reviewedAt: raced.reviewed_at });
      }
    }
    if (insertErr.code === "42P01") {
      console.error(
        "[POST /api/clinician/clinical-reviews] clinical_review_acknowledgments table missing",
      );
      return serviceUnavailableResponse();
    }
    console.error("[POST /api/clinician/clinical-reviews] insert failed");
    return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
  }

  return NextResponse.json(
    { reviewed: true, reviewedAt: inserted?.reviewed_at ?? reviewedAt },
    { status: 201 },
  );
}
