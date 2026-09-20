import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRemoteAssessmentLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import {
  fetchRemoteUlmsAssignmentByToken,
  readRemoteUlmsTestedSide,
} from "@/app/lib/upper-limb-motor-screen/remote-assignment-lookup";
import type { UpperLimbMotorScreenAssignment } from "@/app/lib/upper-limb-motor-screen/types";
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
 * GET /api/patient/assessment/[token]
 * Patient remote ULMS lookup — no auth, token only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const trimmed = token?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  }

  const limited = checkRemoteAssessmentLimit(req, trimmed, "ulms-lookup");
  if (!limited.allowed) {
    return rateLimitExceededResponse(limited.retryAfterSec);
  }

  const admin = adminClient();
  if (!admin) return serviceUnavailableResponse();

  const lookup = await fetchRemoteUlmsAssignmentByToken(admin, trimmed);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.message }, { status: lookup.httpStatus });
  }

  const assignmentPayload = lookup.assignment.assignment_payload as UpperLimbMotorScreenAssignment;
  const { data: patient } = await admin
    .from("patients")
    .select("full_name")
    .eq("id", lookup.assignment.patient_id)
    .maybeSingle<{ full_name: string }>();

  return NextResponse.json({
    assignmentId: lookup.assignment.id,
    testedSide: readRemoteUlmsTestedSide(assignmentPayload),
    status: lookup.assignment.status,
    expiresAt: lookup.assignment.token_expires_at,
    assessmentType: "upper_limb_motor_screen",
    patientFirstName: patient?.full_name?.split(/\s+/)[0] ?? null,
  });
}
