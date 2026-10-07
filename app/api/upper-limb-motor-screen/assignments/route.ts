/**
 * POST /api/upper-limb-motor-screen/assignments
 *
 * Creates an Upper-Limb Motor Screen assignment. Server-authoritative
 * for id, status ("assigned" only — no status transitions in this
 * slice), assignedAt, assignedBy, and provider_id; patient ownership
 * is verified before any write. assignment_payload is the exact,
 * validated domain object (validateUpperLimbMotorScreenAssignment,
 * unchanged) — never a client-shaped object written directly.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateUpperLimbMotorScreenAssignment } from "@/app/lib/upper-limb-motor-screen/assignment-validation";
import {
  buildUpperLimbMotorScreenAssignmentInsert,
  insertUpperLimbMotorScreenAssignment,
  toUpperLimbMotorScreenAssignmentPublic,
} from "@/app/lib/upper-limb-motor-screen/assignment-persistence";
import { hashForwardReachAssignmentRequestSnapshot } from "@/app/lib/upper-limb-motor-screen/create-upper-limb-motor-screen-assignment";
import {
  buildForwardReachAssignmentRequestSnapshot,
  type ForwardReachAssignmentRequestSnapshotInput,
} from "@/app/lib/upper-limb-motor-screen/assignment-request-payload";
import { validatePatientOwnership } from "@/app/lib/validate-patient-ownership";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
  type RateLimitResult,
} from "@/app/lib/rate-limit";
import { ownershipErrorResponse, serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

const CREATE_ERROR = "Failed to create assignment.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PostBody = {
  patientId?: unknown;
  screenDefinitionId?: unknown;
  affectedSide?: unknown;
  configuration?: unknown;
  taskAssignmentGroups?: unknown;
  assignmentRequestId?: unknown;
};

const POST_ALLOWED_KEYS = new Set([
  "patientId",
  "screenDefinitionId",
  "affectedSide",
  "configuration",
  "taskAssignmentGroups",
  "assignmentRequestId",
]);

function rejectUnknownPostKeys(body: PostBody): string | null {
  for (const key of Object.keys(body)) {
    if (!POST_ALLOWED_KEYS.has(key)) {
      return `Unknown request field: ${key}.`;
    }
  }
  return null;
}

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export type UpperLimbAssignmentPostDependencies = {
  /** Resolves the authenticated caller, or null if unauthenticated. */
  getAuthenticatedUser: () => Promise<{ id: string } | null>;
  /** Service-role client used for ownership lookup and the insert. */
  adminClient: SupabaseClient;
  checkWriteLimit: (providerId: string, route: string) => RateLimitResult;
  generateId: () => string;
  now: () => string;
};

export function createUpperLimbAssignmentPostHandler(deps: UpperLimbAssignmentPostDependencies) {
  return async function handlePost(req: NextRequest): Promise<NextResponse> {
    const user = await deps.getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const limited = deps.checkWriteLimit(user.id, "upper-limb-motor-screen:assignments:create");
    if (!limited.allowed) return rateLimitExceededResponse(limited.retryAfterSec);

    let body: PostBody;
    try {
      body = (await req.json()) as PostBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const unknownKeyError = rejectUnknownPostKeys(body);
    if (unknownKeyError) {
      return NextResponse.json({ error: unknownKeyError }, { status: 400 });
    }

    const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
    if (!patientId) {
      return NextResponse.json({ error: "patientId is required." }, { status: 400 });
    }
    if (!UUID_RE.test(patientId)) {
      return NextResponse.json({ error: "patientId must be a valid UUID." }, { status: 400 });
    }

    const assignmentRequestIdRaw =
      typeof body.assignmentRequestId === "string" ? body.assignmentRequestId.trim() : "";
    const assignmentRequestId = assignmentRequestIdRaw || null;
    if (assignmentRequestId !== null && !isUuidString(assignmentRequestId)) {
      return NextResponse.json({ error: "assignmentRequestId must be a valid UUID." }, { status: 400 });
    }

    const ownership = await validatePatientOwnership(deps.adminClient, patientId, user.id);
    if (!ownership.ok) return ownershipErrorResponse(ownership);

    const candidate = {
      id: deps.generateId(),
      screenDefinitionId: body.screenDefinitionId,
      status: "assigned",
      assignedAt: deps.now(),
      assignedBy: user.id,
      affectedSide: body.affectedSide,
      configuration: body.configuration,
      taskAssignmentGroups: body.taskAssignmentGroups,
    };

    const validation = validateUpperLimbMotorScreenAssignment(candidate);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Invalid assignment.", reason: validation.reason, detail: validation.detail },
        { status: 400 },
      );
    }

    const requestSnapshot = buildForwardReachAssignmentRequestSnapshot({
      patientId,
      screenDefinitionId:
        validation.assignment.screenDefinitionId as ForwardReachAssignmentRequestSnapshotInput["screenDefinitionId"],
      affectedSide: validation.assignment.affectedSide,
      configuration: validation.assignment.configuration,
      taskAssignmentGroups:
        validation.assignment.taskAssignmentGroups as ForwardReachAssignmentRequestSnapshotInput["taskAssignmentGroups"],
    });

    const assignmentRequestPayloadHash = assignmentRequestId
      ? hashForwardReachAssignmentRequestSnapshot(requestSnapshot)
      : null;

    const row = buildUpperLimbMotorScreenAssignmentInsert({
      providerId: user.id,
      patientId,
      assignment: validation.assignment,
      assignmentRequestId,
      assignmentRequestPayloadHash,
    });

    const result = await insertUpperLimbMotorScreenAssignment(deps.adminClient, row);
    if (!result.ok) {
      if (result.httpStatus >= 500) {
        console.error("[POST /api/upper-limb-motor-screen/assignments]", result.message);
      }
      return NextResponse.json({ error: CREATE_ERROR }, { status: result.httpStatus });
    }

    const status = result.created ? 201 : 200;
    return NextResponse.json(
      toUpperLimbMotorScreenAssignmentPublic(result.row, result.created),
      { status },
    );
  };
}

async function buildRealDependencies(): Promise<UpperLimbAssignmentPostDependencies | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return null;

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

  return {
    getAuthenticatedUser: async () => {
      const {
        data: { user },
        error,
      } = await sessionClient.auth.getUser();
      if (error || !user) return null;
      return { id: user.id };
    },
    adminClient,
    checkWriteLimit: checkClinicianWriteLimit,
    generateId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const deps = await buildRealDependencies();
  if (!deps) return serviceUnavailableResponse();
  return createUpperLimbAssignmentPostHandler(deps)(req);
}
