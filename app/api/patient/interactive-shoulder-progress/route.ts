/**
 * GET /api/patient/interactive-shoulder-progress?token=...
 *
 * Patient-safe longitudinal Interactive Shoulder progress across all
 * treatment plans for the resolved patient/provider scope.
 */
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkPatientGeneralLimit,
  rateLimitExceededResponse,
  type RateLimitResult,
} from "@/app/lib/rate-limit";
import {
  API_ERRORS,
  genericServerErrorResponse,
  invalidPatientTokenResponse,
  serviceUnavailableResponse,
} from "@/app/lib/api/safe-errors";
import {
  resolvePatientPortalAccess,
  type ResolvePatientPortalAccessResult,
} from "@/app/lib/patient-portal-access";
import { fetchInteractiveShoulderOutcomesForPatient } from "@/app/lib/interactive-shoulder/movement-outcome-persistence";
import {
  buildPatientInteractiveShoulderProgressSessions,
  type PatientInteractiveShoulderProgressResponse,
} from "@/app/lib/progress/interactive-shoulder-patient-progress";

export type { PatientInteractiveShoulderProgressResponse };

export type InteractiveShoulderProgressDependencies = {
  adminClient: SupabaseClient;
  checkReadLimit: (req: NextRequest) => RateLimitResult;
  resolvePatientAccess: (
    admin: SupabaseClient,
    token: string,
  ) => Promise<ResolvePatientPortalAccessResult>;
};

type SessionLogRow = {
  plan_session_id: string | null;
  pain_score: number | null;
  effort_score: number | null;
  completed_at: string;
};

export function createInteractiveShoulderProgressHandler(
  deps: InteractiveShoulderProgressDependencies,
) {
  return async function handleGet(req: NextRequest): Promise<NextResponse> {
    const general = deps.checkReadLimit(req);
    if (!general.allowed) {
      return rateLimitExceededResponse(general.retryAfterSec);
    }

    const tokenValue = new URL(req.url).searchParams.get("token")?.trim() ?? "";
    if (!tokenValue) {
      return NextResponse.json({ error: "Token is required." }, { status: 400 });
    }

    const resolved = await deps.resolvePatientAccess(deps.adminClient, tokenValue);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_token") {
        return invalidPatientTokenResponse(req);
      }
      if (resolved.reason === "plan_not_found") {
        return NextResponse.json({ sessions: [] } satisfies PatientInteractiveShoulderProgressResponse);
      }
      return NextResponse.json({ error: API_ERRORS.GENERIC }, { status: 500 });
    }

    const { patientId, providerId } = resolved.access;

    const outcomesResult = await fetchInteractiveShoulderOutcomesForPatient(deps.adminClient, {
      providerId,
      patientId,
      planId: null,
    });
    if (!outcomesResult.ok) {
      return genericServerErrorResponse();
    }

    const planSessionIds = [
      ...new Set(
        outcomesResult.rows
          .map((row) => row.plan_session_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    let logs: SessionLogRow[] = [];
    if (planSessionIds.length > 0) {
      const { data, error } = await deps.adminClient
        .from("session_logs")
        .select("plan_session_id, pain_score, effort_score, completed_at")
        .eq("patient_id", patientId)
        .eq("provider_id", providerId)
        .in("plan_session_id", planSessionIds)
        .returns<SessionLogRow[]>();

      if (error) {
        console.error("[GET /api/patient/interactive-shoulder-progress] session_logs query failed");
        return genericServerErrorResponse();
      }

      logs = data ?? [];
    }

    const result: PatientInteractiveShoulderProgressResponse = {
      sessions: buildPatientInteractiveShoulderProgressSessions(outcomesResult.rows, logs),
    };

    return NextResponse.json(result);
  };
}

function buildAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(req: NextRequest) {
  const admin = buildAdminClient();
  if (!admin) {
    return serviceUnavailableResponse();
  }

  return createInteractiveShoulderProgressHandler({
    adminClient: admin,
    checkReadLimit: (request) => checkPatientGeneralLimit(request, "interactive-shoulder-progress"),
    resolvePatientAccess: resolvePatientPortalAccess,
  })(req);
}
