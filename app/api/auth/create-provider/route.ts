import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildProviderWriteClient,
  ensureProviderForUser,
  parseSafeProviderBody,
  updateProviderProfileForUser,
} from "../../../lib/auth/ensure-provider";
import {
  isClinicianWorkspaceAllowed,
  resolveClinicianAccessState,
} from "../../../lib/auth/provider-authorization";
import { serviceUnavailableResponse } from "../../../lib/api/safe-errors";

/**
 * POST /api/auth/create-provider
 *
 * Idempotent: ensures a providers row for the authenticated session user.
 * Uses session user.id only — never accepts provider_id from the body.
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return serviceUnavailableResponse();
  }

  const cookieStore = await cookies();

  const sessionClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Read-only context — ignore
        }
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = (await request.json()) as Record<string, unknown>;
  } catch {
    // Optional body — defaults from session metadata
  }

  const safeBody = parseSafeProviderBody(rawBody);

  const writeClient = buildProviderWriteClient(
    supabaseUrl,
    serviceRoleKey,
    sessionClient,
  );

  const access = await resolveClinicianAccessState(writeClient, user.id);
  if (!isClinicianWorkspaceAllowed(access)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden.", code: "provider_not_approved" },
      { status: 403 },
    );
  }

  const existing = await ensureProviderForUser(writeClient, user, safeBody);
  const result =
    existing.ok
      ? await updateProviderProfileForUser(writeClient, user, safeBody)
      : existing;

  if (!result.ok) {
    if (result.pending) {
      return NextResponse.json(
        { ok: false, pending: true, reason: result.reason },
        { status: 202 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Could not set up provider account." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    provider: result.provider,
  });
}
