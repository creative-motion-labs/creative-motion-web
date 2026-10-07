/**
 * POST /api/upper-limb-motor-screen/session-results/[id]/finalize
 *
 * Flips a computed Upper-Limb Motor Screen session result to
 * finalized. Status-only: the DB patch is always exactly
 * {status: "finalized"} — result_payload and every typed projection
 * are never touched here. 019's enforce_ul_session_result_immutability
 * trigger performs the actual payload.status sync and independently
 * rejects any other change; this route must never attempt to send
 * more than the status flip.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  finalizeUpperLimbMotorScreenSessionResult,
  toUpperLimbMotorScreenSessionResultPublic,
} from "@/app/lib/upper-limb-motor-screen/session-result-persistence";
import {
  checkClinicianWriteLimit,
  rateLimitExceededResponse,
  type RateLimitResult,
} from "@/app/lib/rate-limit";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

export type UpperLimbSessionResultFinalizeDependencies = {
  getAuthenticatedUser: () => Promise<{ id: string } | null>;
  adminClient: SupabaseClient;
  checkWriteLimit: (providerId: string, route: string) => RateLimitResult;
};

// ── Dependency-injected handler ────────────────────────────────────────────────

export function createUpperLimbSessionResultFinalizeHandler(
  deps: UpperLimbSessionResultFinalizeDependencies,
) {
  return async function handleFinalize(
    _req: NextRequest,
    sessionResultId: string,
  ): Promise<NextResponse> {
    const user = await deps.getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const limited = deps.checkWriteLimit(
      user.id,
      "upper-limb-motor-screen:session-results:finalize",
    );
    if (!limited.allowed) return rateLimitExceededResponse(limited.retryAfterSec);

    if (!sessionResultId.trim()) {
      return NextResponse.json({ error: "Session result id is required." }, { status: 400 });
    }

    const result = await finalizeUpperLimbMotorScreenSessionResult(deps.adminClient, {
      sessionResultId,
      providerId: user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    }

    return NextResponse.json(toUpperLimbMotorScreenSessionResultPublic(result.row));
  };
}

// ── Real production dependencies ───────────────────────────────────────────────

async function buildRealDependencies(): Promise<UpperLimbSessionResultFinalizeDependencies | null> {
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
  };
}

// ── POST /api/upper-limb-motor-screen/session-results/[id]/finalize ────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deps = await buildRealDependencies();
  if (!deps) return serviceUnavailableResponse();
  const { id } = await params;
  return createUpperLimbSessionResultFinalizeHandler(deps)(req, id);
}
