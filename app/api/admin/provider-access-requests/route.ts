import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isPlatformAdminUser,
  loadProviderAccessState,
  parsePlatformAdminAllowlist,
} from "@/app/lib/auth/provider-authorization";
import {
  buildProviderWriteClient,
  upsertApprovedProviderForUser,
} from "@/app/lib/auth/ensure-provider";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

type ReviewAction = "approve" | "reject" | "revoke";

async function requireAdminSession() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return { ok: false as const, response: serviceUnavailableResponse() };
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
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
    error,
  } = await sessionClient.auth.getUser();

  if (error || !user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const providerState = await loadProviderAccessState(adminClient, user.id);
  const allowlist = parsePlatformAdminAllowlist();
  if (!isPlatformAdminUser(user.id, providerState, allowlist)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    user,
    adminClient,
    supabaseUrl,
    serviceRoleKey,
    sessionClient,
  };
}

/**
 * GET /api/admin/provider-access-requests?status=pending
 */
export async function GET(request: NextRequest) {
  const adminSession = await requireAdminSession();
  if (!adminSession.ok) return adminSession.response;

  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  const allowed = new Set(["pending", "approved", "rejected", "revoked", "all"]);
  if (!allowed.has(status)) {
    return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
  }

  let query = adminSession.adminClient
    .from("provider_access_requests")
    .select(
      "id, auth_user_id, email, full_name, clinic_name, status, created_at, reviewed_at, reviewed_by",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Access request table not migrated." },
        { status: 503 },
      );
    }
    console.error("[admin/provider-access-requests] list failed");
    return NextResponse.json({ error: "Unable to list requests." }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}

/**
 * PATCH /api/admin/provider-access-requests
 * Body: { authUserId: string, action: approve|reject|revoke }
 */
export async function PATCH(request: NextRequest) {
  const adminSession = await requireAdminSession();
  if (!adminSession.ok) return adminSession.response;

  let body: { authUserId?: string; action?: ReviewAction };
  try {
    body = (await request.json()) as { authUserId?: string; action?: ReviewAction };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const authUserId = body.authUserId?.trim();
  const action = body.action;

  if (!authUserId || !action) {
    return NextResponse.json(
      { error: "authUserId and action are required." },
      { status: 400 },
    );
  }

  if (authUserId === adminSession.user.id) {
    return NextResponse.json({ error: "Self-approval is not allowed." }, { status: 403 });
  }

  if (!["approve", "reject", "revoke"].includes(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const { data: requestRow, error: fetchErr } = await adminSession.adminClient
    .from("provider_access_requests")
    .select("auth_user_id, email, full_name, clinic_name, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (fetchErr || !requestRow) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const writeClient = buildProviderWriteClient(
    adminSession.supabaseUrl,
    adminSession.serviceRoleKey,
    adminSession.sessionClient,
  );

  if (action === "approve") {
    const approvedUser = {
      id: authUserId,
      email: requestRow.email,
      app_metadata: {},
      user_metadata: {
        full_name: requestRow.full_name,
        clinic_name: requestRow.clinic_name,
      },
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
    } as import("@supabase/supabase-js").User;

    const upsert = await upsertApprovedProviderForUser(
      writeClient,
      approvedUser,
      {
        name: requestRow.full_name,
        clinic_name: requestRow.clinic_name,
        email: requestRow.email,
      },
      adminSession.user.id,
    );

    if (!upsert.ok) {
      return NextResponse.json(
        { error: "Could not provision approved provider." },
        { status: 500 },
      );
    }

    await adminSession.adminClient
      .from("provider_access_requests")
      .update({
        status: "approved",
        reviewed_at: now,
        reviewed_by: adminSession.user.id,
      })
      .eq("auth_user_id", authUserId);

    return NextResponse.json({ ok: true, status: "approved" });
  }

  const nextStatus = action === "reject" ? "rejected" : "revoked";

  await adminSession.adminClient
    .from("provider_access_requests")
    .update({
      status: nextStatus,
      reviewed_at: now,
      reviewed_by: adminSession.user.id,
    })
    .eq("auth_user_id", authUserId);

  await writeClient
    .from("providers")
    .update({
      approval_status: nextStatus,
      approved_at: null,
      approved_by: adminSession.user.id,
    })
    .eq("id", authUserId);

  return NextResponse.json({ ok: true, status: nextStatus });
}
