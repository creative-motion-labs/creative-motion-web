import { requireAuthenticatedApprovedUser } from "@/app/lib/api/require-approved-provider";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { buildOpenAiHealthReport } from "@/app/lib/ai/openai-health";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health/openai
 * Clinician-only safe diagnostics — no key value, no PHI, no patient text.
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return serviceUnavailableResponse();
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        /* read-only */
      },
    },
  });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminClient = serviceKey
    ? createAdminClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : sessionClient;

  const auth = await requireAuthenticatedApprovedUser(sessionClient, adminClient);
  if (!auth.ok) return auth.response;

  const report = await buildOpenAiHealthReport();
  return NextResponse.json(report);
}
