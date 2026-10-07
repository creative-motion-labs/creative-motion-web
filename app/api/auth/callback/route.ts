import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildProviderWriteClient,
  ensureProviderForUser,
} from "../../../lib/auth/ensure-provider";
import { resolveSafeAuthRedirectPath } from "../../../lib/auth/safe-redirect";

/**
 * Supabase OAuth / Magic Link / PKCE callback handler.
 *
 * Exchanges the code for a session, ensures a providers row exists,
 * then redirects to the intended destination.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = resolveSafeAuthRedirectPath(searchParams.get("next"), "/clinician/dashboard");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
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

  const writeClient = buildProviderWriteClient(
    supabaseUrl,
    serviceRoleKey,
    supabase,
  );

  const providerResult = await ensureProviderForUser(writeClient, user);

  if (!providerResult.ok) {
    console.error("[auth/callback] provider setup failed");
    return NextResponse.redirect(`${origin}/login?error=provider_setup_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
