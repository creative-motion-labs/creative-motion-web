import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRemoteAssessmentLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import { assembleUpperLimbMotorScreenSessionResult } from "@/app/lib/upper-limb-motor-screen/session-result-assembler";
import {
  buildUpperLimbMotorScreenSessionResultInsert,
  insertUpperLimbMotorScreenSessionResult,
  toUpperLimbMotorScreenSessionResultPublic,
} from "@/app/lib/upper-limb-motor-screen/session-result-persistence";
import { validateUpperLimbMotorScreenSessionResultRequest } from "@/app/lib/upper-limb-motor-screen/session-result-request-validation";
import { fetchRemoteUlmsAssignmentByToken } from "@/app/lib/upper-limb-motor-screen/remote-assignment-lookup";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/patient/assessment/[token]/session-results
 * Patient remote ULMS result submit — no auth, token only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const trimmed = token?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  }

  const limited = checkRemoteAssessmentLimit(req, trimmed, "ulms-submit");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  const admin = adminClient();
  if (!admin) return serviceUnavailableResponse();

  const lookup = await fetchRemoteUlmsAssignmentByToken(admin, trimmed);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.message }, { status: lookup.httpStatus });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = validateUpperLimbMotorScreenSessionResultRequest(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Invalid session result.", reason: validation.reason, detail: validation.detail },
      { status: 400 },
    );
  }

  if (validation.input.assignmentId !== lookup.assignment.id) {
    return NextResponse.json({ error: "Assignment mismatch." }, { status: 400 });
  }

  let result;
  try {
    result = assembleUpperLimbMotorScreenSessionResult({
      id: crypto.randomUUID(),
      status: "computed",
      ...validation.input,
    });
  } catch (err) {
    console.error("[POST /api/patient/assessment/[token]/session-results] assembly failed:", err);
    return NextResponse.json({ error: "Failed to save observation." }, { status: 500 });
  }

  const row = buildUpperLimbMotorScreenSessionResultInsert({
    providerId: lookup.assignment.provider_id,
    patientId: lookup.assignment.patient_id,
    result,
  });

  const inserted = await insertUpperLimbMotorScreenSessionResult(admin, row);
  if (!inserted.ok) {
    return NextResponse.json({ error: "Failed to save observation." }, { status: inserted.httpStatus });
  }

  const completedAt = new Date().toISOString();
  const { error: assignmentUpdateError } = await admin
    .from("upper_limb_motor_screen_assignments")
    .update({ status: "completed", updated_at: completedAt })
    .eq("id", lookup.assignment.id)
    .eq("provider_id", lookup.assignment.provider_id);

  if (assignmentUpdateError) {
    console.error(
      "[POST /api/patient/assessment/[token]/session-results] assignment status update failed",
    );
  }

  const attempt = validation.input.attempts[0];
  const { data: assessment, error: assessmentInsertError } = await admin
    .from("assessments")
    .insert({
      patient_id: lookup.assignment.patient_id,
      provider_id: lookup.assignment.provider_id,
      type: "upper_limb_motor_screen",
      structured_data: {
        schemaVersion: 1,
        assignmentId: lookup.assignment.id,
        sessionResultId: inserted.row.id,
        testedSide: attempt?.testedSide ?? null,
        completionState: attempt?.completionState ?? null,
        trackingQualitySummary: attempt?.trackingQualitySummary ?? null,
        deliveryMode: "remote_supervised",
        completedAt,
      },
      status: "completed",
      mode: "remote",
      selected_tests: [],
    })
    .select("id")
    .single();

  if (assessmentInsertError) {
    console.warn(
      "[POST /api/patient/assessment/[token]/session-results] assessment mirror insert failed",
    );
  }

  const publicResult = toUpperLimbMotorScreenSessionResultPublic(inserted.row);
  return NextResponse.json(
    {
      ...publicResult,
      assessmentId: assessment?.id ?? null,
    },
    { status: 201 },
  );
}
