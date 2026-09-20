import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRemoteAssessmentLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import { validateRemoteUpperLimbBatterySubmitRequest } from "@/app/lib/remote-upper-limb-battery/battery-request-validation";
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
 * POST /api/patient/assessment/[token]/battery-results
 * Patient remote upper-limb battery submit — no auth, token only.
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

  const limited = checkRemoteAssessmentLimit(req, trimmed, "ulms-battery-submit");
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

  const validation = validateRemoteUpperLimbBatterySubmitRequest(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Invalid battery result.", reason: validation.reason, detail: validation.detail },
      { status: 400 },
    );
  }

  if (validation.input.assignmentId !== lookup.assignment.id) {
    return NextResponse.json({ error: "Assignment mismatch." }, { status: 400 });
  }

  const completedAt = new Date().toISOString();
  const { data: assessment, error: assessmentInsertError } = await admin
    .from("assessments")
    .insert({
      patient_id: lookup.assignment.patient_id,
      provider_id: lookup.assignment.provider_id,
      type: "upper_limb_motor_screen",
      structured_data: {
        schemaVersion: 1,
        assignmentId: lookup.assignment.id,
        deliveryMode: "remote_supervised",
        completedAt,
        remoteUpperLimbBattery: validation.input.battery,
      },
      status: "completed",
      mode: "remote",
      selected_tests: [],
    })
    .select("id")
    .single();

  if (assessmentInsertError) {
    console.error("[POST /api/patient/assessment/[token]/battery-results] insert failed:", assessmentInsertError);
    return NextResponse.json({ error: "Failed to save assessment." }, { status: 500 });
  }

  const { error: assignmentUpdateError } = await admin
    .from("upper_limb_motor_screen_assignments")
    .update({ status: "completed", updated_at: completedAt })
    .eq("id", lookup.assignment.id)
    .eq("provider_id", lookup.assignment.provider_id);

  if (assignmentUpdateError) {
    console.error(
      "[POST /api/patient/assessment/[token]/battery-results] assignment status update failed",
    );
  }

  return NextResponse.json({ assessmentId: assessment?.id ?? null }, { status: 201 });
}
