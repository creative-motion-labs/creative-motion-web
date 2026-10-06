import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolvePostLoginDestination } from "@/app/lib/auth/post-login-redirect";
import { ensurePendingAccessRequestFromAuthUser } from "@/app/lib/auth/provider-access-request";
import { serviceUnavailableResponse } from "@/app/lib/api/safe-errors";

/**
 * GET /api/auth/post-login-destination?returnTo=...&default=/clinician
 */
export async function GET(request: NextRequest) {
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
    error,
  } = await sessionClient.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await ensurePendingAccessRequestFromAuthUser(adminClient, user);

  const returnTo = request.nextUrl.searchParams.get("returnTo");
  const roleDefault =
    request.nextUrl.searchParams.get("default") ?? "/clinician";

  const resolved = await resolvePostLoginDestination({
    adminClient,
    authUserId: user.id,
    returnToRaw: returnTo,
    roleDefaultRedirect: roleDefault,
  });

  return NextResponse.json({
    path: resolved.path,
    access: resolved.access.kind,
  });
}
