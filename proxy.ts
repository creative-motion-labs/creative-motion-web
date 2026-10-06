import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getProtectedRouteDecision,
  resolveProxyAuthed,
} from "./app/lib/proxy-auth";
import {
  isAccessStatusPublicPath,
  resolveClinicianGateRedirect,
} from "./app/lib/proxy-clinician-access";
import { resolveSafeReturnTo } from "./app/lib/auth/safe-return-to";
import {
  isPr313QaPath,
  isPr313QaPublicInCurrentRuntime,
  shouldBlockPr313QaInProduction,
} from "./app/lib/qa/pr313-production-guard";

/**
 * Public routes that never require a session.
 * Every other route is protected — unauthenticated visitors are sent to /login.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/pending-approval",
  "/access-unavailable",
  "/reset-password",
  "/update-password",
  // All FastAPI routes — FastAPI handles its own JWT auth (Bearer token).
  // Proxy must not intercept these or it returns HTML instead of JSON.
  "/api/v1/",
  // Supabase OAuth / Magic Link PKCE callback — must be public.
  "/api/auth/callback",
  // Patient portal APIs — token-validated server-side (service role); no Supabase session.
  "/api/patient/",
  // Remote assessment token APIs — token-validated server-side; no Supabase session.
  "/api/remote-assessments/",
  // Token-gated patient portal pages — access control is the URL token, not a provider session.
  "/patient/",
  // Patient-facing remote assessment link (sent via secure URL)
  "/assessment",
  // Next.js internals and static assets
  "/_next",
  "/favicon.ico",
  "/fonts",
  "/images",
  // Remote Upper-Limb Battery + booth prerecorded clips (public/); token patients have no session.
  "/audio/booth/",
  // Public RASQ interactive movement demo voice/SFX (public/); no login required.
  "/audio/demo/",
  // Optional lead capture after the public demo — rate-limited API; no Supabase session.
  "/api/public/",
];

const PUBLIC_PATHS = new Set([
  "/privacy",
  "/terms",
  "/intended-use",
  "/clinical-safety",
  // Slice 8A — public volunteer motion capture (in-memory only; exact path, not a prefix).
  "/volunteer/shoulder-abduction-reach",
  // Slice 8B.1 — volunteer research APIs (exact paths only; not a broad prefix).
  "/api/research/volunteer/sessions",
  "/api/research/volunteer/movement-sessions",
  "/api/research/volunteer/session/complete",
  "/api/research/volunteer/repetitions",
  // Ops readiness — env booleans + pilot table reachability only (no secrets).
  "/api/health/supabase",
  // Public RASQ interactive movement demo (computer vision + optional lead form).
  "/demo",
]);

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  if (
    isPr313QaPath(pathname) &&
    isPr313QaPublicInCurrentRuntime(process.env.NODE_ENV, process.env.VERCEL_ENV)
  ) {
    return true;
  }
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    shouldBlockPr313QaInProduction(
      pathname,
      process.env.NODE_ENV,
      process.env.VERCEL_ENV,
    )
  ) {
    return new NextResponse(null, { status: 404 });
  }

  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ── Supabase session refresh + auth check ──────────────────────────────────
  // When Supabase is configured, refresh session cookies on every request and
  // capture whether the caller has a valid Supabase session.
  // This is a no-op when env vars are not yet populated.
  let supabaseAuthed = false;
  let authUserId: string | null = null;

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    // IMPORTANT: no code between createServerClient and getUser().
    const { data: { user } } = await supabase.auth.getUser();
    supabaseAuthed = Boolean(user);
    authUserId = user?.id ?? null;
  }

  // cm_token may still be set for legacy FastAPI client calls, but proxy auth
  // relies on validated Supabase sessions (or dev-only bypass tokens below).
  const cmToken = request.cookies.get("cm_token")?.value;
  const authed = resolveProxyAuthed({
    supabaseAuthed,
    cmToken,
    nodeEnv: process.env.NODE_ENV,
  });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminClient =
    supabaseUrl && serviceRoleKey
      ? createAdminClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

  if (authed && authUserId && adminClient && isAccessStatusPublicPath(pathname)) {
    const gate = await resolveClinicianGateRedirect({
      pathname: "/clinician",
      authUserId,
      adminClient,
      cmToken,
      nodeEnv: process.env.NODE_ENV,
    });
    if (gate && gate !== pathname) {
      return NextResponse.redirect(new URL(gate, request.url));
    }
  }

  if (authed && authUserId && adminClient) {
    const gateRedirect = await resolveClinicianGateRedirect({
      pathname,
      authUserId,
      adminClient,
      cmToken,
      nodeEnv: process.env.NODE_ENV,
    });
    if (gateRedirect) {
      return NextResponse.redirect(new URL(gateRedirect, request.url));
    }
  }

  // Already authenticated — bounce away from auth pages to a safe destination
  if (authed && (pathname === "/login" || pathname === "/signup")) {
    if (authUserId && adminClient) {
      const gate = await resolveClinicianGateRedirect({
        pathname: "/clinician",
        authUserId,
        adminClient,
        cmToken,
        nodeEnv: process.env.NODE_ENV,
      });
      const dest = gate ?? "/clinician";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.redirect(new URL("/clinician", request.url));
  }

  const protectedDecision = getProtectedRouteDecision(pathname, authed, isPublic(pathname));
  if (protectedDecision === "json-401") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (protectedDecision === "redirect-login") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "returnTo",
      resolveSafeReturnTo(pathname, "/clinician"),
    );
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
