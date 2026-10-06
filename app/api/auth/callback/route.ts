import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolvePostLoginDestination } from "@/app/lib/auth/post-login-redirect";
import { resolveSafeReturnTo } from "@/app/lib/auth/safe-return-to";

/**
 * Supabase OAuth / Magic Link / PKCE callback handler.
 *
 * Exchanges the code for a session, then redirects based on provider approval.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextRaw = searchParams.get("next") ?? "/clinician/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey || !serviceRoleKey) {
    return NextResponse.redirect(`${origin}/login?error=supabase_not_configured`);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Ignore — will be handled by middleware on next request
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession error");
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const resolved = await resolvePostLoginDestination({
    adminClient,
    authUserId: user.id,
    returnToRaw: nextRaw,
    roleDefaultRedirect: "/clinician/dashboard",
  });

  const path = resolved.path.startsWith("/")
    ? resolved.path
    : resolveSafeReturnTo(nextRaw, "/clinician/dashboard");

  return NextResponse.redirect(`${origin}${path}`);
}
