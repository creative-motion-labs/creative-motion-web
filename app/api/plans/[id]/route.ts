import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { PlanRow, PlanSessionRow } from "../route";
import { serviceUnavailableResponse } from "../../../lib/api/safe-errors";

// ── Client factory ─────────────────────────────────────────────────────────────

async function buildClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;
  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Route Handler */ }
      },
    },
  });
  const adminClient = svc
    ? createAdminClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })
    : sessionClient;
  return { sessionClient, adminClient };
}

// ── GET /api/plans/[id] ────────────────────────────────────────────────────────

/**
 * Returns a single plan with its sessions and token.
 * Only accessible to the owning provider.
 *
 * Response 200: PlanRow
 * Response 401: { error }
 * Response 404: { error } — not found or wrong provider
 * Response 500: { error }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planId } = await params;
  if (!planId?.trim()) return NextResponse.json({ error: "Plan ID is required." }, { status: 400 });

  const clients = await buildClients();
  if (!clients) return serviceUnavailableResponse();
  const { sessionClient, adminClient } = clients;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const { data: plan, error: planErr } = await adminClient
    .from("treatment_plans")
    .select("*")
    .eq("id", planId)
    .eq("provider_id", user.id)
    .single();

  if (planErr ?? !plan) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }

  const { data: sessions } = await adminClient
    .from("plan_sessions")
    .select("*")
    .eq("plan_id", planId)
    .order("session_number", { ascending: true });

  const { data: tokenRow } = await adminClient
    .from("patient_access_tokens")
    .select("token")
    .eq("plan_id", planId)
    .limit(1)
    .maybeSingle();

  const result: PlanRow = {
    ...(plan as PlanRow),
    sessions:      (sessions ?? []) as PlanSessionRow[],
    patient_token: (tokenRow as { token: string } | null)?.token ?? null,
  };

  return NextResponse.json(result);
}
