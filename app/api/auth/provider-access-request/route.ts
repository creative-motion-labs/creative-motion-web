import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { parseSafeProviderBody } from "@/app/lib/auth/ensure-provider";
import { upsertPendingProviderAccessRequest } from "@/app/lib/auth/provider-access-request";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

type AccessRequestBody = {
  name?: string;
  clinic_name?: string | null;
  email?: string;
  role?: unknown;
  approval_status?: unknown;
};

/**
 * POST /api/auth/provider-access-request
 * Records a pilot access request — does not grant clinician authorization.
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
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
          /* read-only */
        }
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let raw: AccessRequestBody = {};
  try {
    raw = (await request.json()) as AccessRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (raw.role !== undefined || raw.approval_status !== undefined) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const safe = parseSafeProviderBody(raw as Record<string, unknown>);

  const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existingProvider } = await admin
    .from("providers")
    .select("id, approval_status")
    .eq("id", user.id)
    .maybeSingle<{ id: string; approval_status: string }>();

  if (existingProvider?.approval_status === "approved") {
    return NextResponse.json(
      { ok: true, alreadyApproved: true },
      { status: 200 },
    );
  }

  const upsert = await upsertPendingProviderAccessRequest(admin, user, safe);

  if (!upsert.ok) {
    if (upsert.code === "table_missing") {
      return NextResponse.json(
        { error: "Access requests are not available yet." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Could not submit access request." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, status: "pending" }, { status: 201 });
}
