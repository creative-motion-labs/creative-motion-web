/**
 * POST /api/upper-limb-motor-screen/remote-links
 *
 * Clinician creates a tokenized remote Upper Limb Motor Screen link.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateUpperLimbMotorScreenAssignment } from "@/app/lib/upper-limb-motor-screen/assignment-validation";
import {
  buildUpperLimbMotorScreenAssignmentInsert,
  insertUpperLimbMotorScreenAssignment,
} from "@/app/lib/upper-limb-motor-screen/assignment-persistence";
import { hashForwardReachAssignmentRequestSnapshot } from "@/app/lib/upper-limb-motor-screen/create-upper-limb-motor-screen-assignment";
import { buildForwardReachAssignmentRequestSnapshot } from "@/app/lib/upper-limb-motor-screen/assignment-request-payload";
import { buildLateralReachDemoAssignmentPayload } from "@/app/lib/upper-limb-motor-screen/lateral-reach-assignment-client";
import {
  generateRemoteUlmsToken,
  hashRemoteUlmsToken,
  remoteUlmsPatientAssessmentPath,
  remoteUlmsTokenExpiresAt,
} from "@/app/lib/upper-limb-motor-screen/remote-assessment-token";
import type { UpperLimbMotorScreenAssignment } from "@/app/lib/upper-limb-motor-screen/types";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
} from "@/app/lib/rate-limit";
import { ownershipErrorResponse, serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PostBody = {
  patientId?: unknown;
  testedSide?: unknown;
};

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return serviceUnavailableResponse();

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* Route Handler */
        }
      },
    },
  });
  const adminClient = createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError ?? !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limited = checkClinicianWriteLimit(user.id, "upper-limb-motor-screen:remote-links:create");
  if (!limited.allowed) return rateLimitExceededResponse(limited.retryAfterSec);

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
  if (!patientId || !UUID_RE.test(patientId)) {
    return NextResponse.json({ error: "patientId must be a valid UUID." }, { status: 400 });
  }

  const testedSide = body.testedSide === "left" ? "left" : "right";

  const ownership = await validatePatientOwnership(adminClient, patientId, user.id);
  if (!ownership.ok) return ownershipErrorResponse(ownership);

  const requestSnapshot = buildForwardReachAssignmentRequestSnapshot(
    buildLateralReachDemoAssignmentPayload(patientId, testedSide, "remote_supervised"),
  );
  const assignmentRequestId = crypto.randomUUID();
  const assignmentRequestPayloadHash = hashForwardReachAssignmentRequestSnapshot(requestSnapshot);
  const assignmentId = crypto.randomUUID();
  const now = new Date().toISOString();

  const candidate = {
    id: assignmentId,
    screenDefinitionId: requestSnapshot.screenDefinitionId,
    status: "assigned" as const,
    assignedAt: now,
    assignedBy: user.id,
    affectedSide: requestSnapshot.affectedSide,
    configuration: requestSnapshot.configuration,
    taskAssignmentGroups: requestSnapshot.taskAssignmentGroups,
  };

  const validation = validateUpperLimbMotorScreenAssignment(candidate);
  if (!validation.ok) {
    return NextResponse.json({ error: "Invalid assignment." }, { status: 400 });
  }

  const row = buildUpperLimbMotorScreenAssignmentInsert({
    providerId: user.id,
    patientId,
    assignment: validation.assignment,
    assignmentRequestId,
    assignmentRequestPayloadHash,
  });

  const inserted = await insertUpperLimbMotorScreenAssignment(adminClient, row);
  if (!inserted.ok) {
    return NextResponse.json({ error: "Failed to create remote assessment link." }, { status: inserted.httpStatus });
  }

  const token = generateRemoteUlmsToken();
  const expiresAt = remoteUlmsTokenExpiresAt();
  const tokenHash = hashRemoteUlmsToken(token);
  const remotePayload = {
    ...(inserted.row.assignment_payload as UpperLimbMotorScreenAssignment),
    configuration: {
      ...validation.assignment.configuration,
      deliveryMode: "remote_supervised",
    },
  };

  const { error: updateError } = await adminClient
    .from("upper_limb_motor_screen_assignments")
    .update({
      token_hash: tokenHash,
      token_expires_at: expiresAt,
      delivery_mode: "remote_supervised",
      assignment_payload: remotePayload,
    })
    .eq("id", inserted.row.id)
    .eq("provider_id", user.id);

  if (updateError) {
    console.error("[POST /api/upper-limb-motor-screen/remote-links] token update failed");
    return NextResponse.json({ error: "Failed to create remote assessment link." }, { status: 500 });
  }

  return NextResponse.json(
    {
      token,
      url: remoteUlmsPatientAssessmentPath(token),
      expiresAt,
      assignmentId: inserted.row.id,
    },
    { status: 201 },
  );
}
