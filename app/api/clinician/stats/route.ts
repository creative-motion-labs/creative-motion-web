/**
 * GET /api/clinician/stats
 *
 * Supabase-backed aggregate metrics for the clinician dashboard.
 * Returns counts only — no patient names or IDs.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchClinicianStats } from "@/app/lib/clinician/clinician-stats";
import { demoFallbackIfUnavailable } from "../../../lib/api/demo-fallback-server";
import { getDemoDashboardStats } from "@/app/lib/demo/local-demo-fallback";
import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";

async function buildClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* read-only */
        }
      },
    },
  });
  const adminClient = svc
    ? createAdminClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } })
    : sessionClient;
  return { sessionClient, adminClient };
}

export async function GET(_req: NextRequest) {
  const clients = await buildClients();
  const demo = demoFallbackIfUnavailable(clients, getDemoDashboardStats());
  if (demo) return demo;
  const { sessionClient, adminClient } = clients!;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const stats = await fetchClinicianStats(adminClient, user.id);
  return NextResponse.json(stats);
}
