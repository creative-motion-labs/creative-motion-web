"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RasqDemoPlatformEntryCta } from "@/app/components/rasq-demo/RasqDemoPlatformEntryCta";
import { TrustFooter } from "../components/trust/TrustFooter";
import { loginClinician } from "../lib/api";
import {
  CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE,
  isLegacyClinicianFastApiLoginAllowed,
  resolveClinicianLoginBackend,
  resolveClinicianLoginSupabaseError,
} from "../lib/auth/clinician-login-errors";
import { ensureProviderProfile } from "../lib/auth/ensure-provider-client";
import { resolveSafeAuthRedirectPath } from "../lib/auth/safe-redirect";
import { setupDevAuthSession } from "../lib/dev-auth";
import { createClient as createSupabaseClient } from "../lib/supabase/browser";

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// ── Role config ────────────────────────────────────────────────────────────────

type Role = "clinician" | "admin";

interface RoleConfig {
  title: string;
  subtitle: string;
  badge: string;
  defaultRedirect: string;
}

const ROLE_CONFIG: Record<Role, RoleConfig> = {
  clinician: {
    title:           "Provider Access",
    subtitle:        "Manage patients, assessments, reports, treatment plans, and rehabilitation progress.",
    badge:           "Provider workspace",
    defaultRedirect: "/clinician",
  },
  admin: {
    title:           "Admin Access",
    subtitle:        "Manage clinic operations, providers, patients, and system assignments.",
    badge:           "Admin workspace",
    defaultRedirect: "/admin",
  },
};

function resolveRole(raw: string | null): Role {
  if (raw === "admin") return "admin";
  return "clinician";
}

// ── Login form ─────────────────────────────────────────────────────────────────

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const urlRole  = resolveRole(searchParams.get("role"));
  const returnTo = searchParams.get("returnTo");

  const [role, setRole]         = useState<Role>(urlRole);
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const cfg = ROLE_CONFIG[role];
  // Internal paths only — external/protocol-relative/script URLs fall back to the role default.
  const redirectDest = resolveSafeAuthRedirectPath(returnTo, cfg.defaultRedirect);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const loginBackend = resolveClinicianLoginBackend({
        supabaseConfigured: SUPABASE_CONFIGURED,
        nodeEnv: process.env.NODE_ENV,
      });

      if (loginBackend.kind === "fail_closed") {
        setError(loginBackend.message);
        return;
      }

      // ── Primary: Supabase Auth ───────────────────────────────────────────
      // Used for all new accounts created via /signup.
      if (loginBackend.kind === "use_supabase") {
        const supabase = createSupabaseClient();
        const { error: sbError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

        if (!sbError) {
          // Repair missing providers row from auth metadata before clinician entry
          await ensureProviderProfile({
            email: email.trim().toLowerCase(),
          });
          router.push(redirectDest);
          router.refresh();
          return;
        }

        const decision = resolveClinicianLoginSupabaseError({
          supabaseConfigured: true,
          errorMessage: sbError.message,
          errorCode: sbError.code,
          nodeEnv: process.env.NODE_ENV,
        });

        if (decision.kind === "show_message") {
          setError(decision.message);
          return;
        }

        if (decision.kind === "invalid_credentials") {
          setError(CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE);
          return;
        }

        if (
          decision.kind === "legacy_fastapi_fallback" &&
          isLegacyClinicianFastApiLoginAllowed({
            supabaseConfigured: true,
            nodeEnv: process.env.NODE_ENV,
          })
        ) {
          await loginClinician(email.trim(), password);
          router.push(redirectDest);
          router.refresh();
          return;
        }

        setError(CLINICIAN_LOGIN_INVALID_CREDENTIALS_MESSAGE);
        return;
      }

      // ── Fallback: FastAPI JWT (local dev only when Supabase is not configured) ──
      // Production clinician routes require a Supabase session; cm_token is not accepted by the proxy.
      await loginClinician(email.trim(), password);
      router.push(redirectDest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleDevBypass() {
    if (process.env.NODE_ENV !== "development") {
      setError("Dev bypass is only available in development mode.");
      return;
    }
    setupDevAuthSession();
    router.push(redirectDest);
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#080E14] px-6 py-16 text-white">
      {/* Subtle teal ambient — single, soft, not glowy */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(29,158,117,0.06) 0%, transparent 70%)" }} />

      <div className="relative w-full max-w-sm">

        {/* Back to home */}
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-1.5 text-sm font-medium text-white/35 transition hover:text-white/65">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            <span className="font-bold tracking-[-0.03em]">RASQ</span>
          </Link>
          <span className="rounded-[5px] border border-[#1E2D42] bg-[#0F1825] px-2.5 py-1 text-[11px] font-semibold text-white/40">
            {cfg.badge}
          </span>
        </div>

        {/* Card — flat, no blur */}
        <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-7">

          {/* Role switcher */}
          <div className="mb-7 flex rounded-[7px] border border-[#1E2D42] bg-[#0B1220] p-0.5">
            {(["clinician", "admin"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 rounded-[6px] py-2.5 text-sm font-bold transition ${
                  role === r
                    ? "bg-[#1D9E75] text-white"
                    : "text-white/35 hover:text-white/60"
                }`}
              >
                {r === "clinician" ? "Provider" : "Admin"}
              </button>
            ))}
          </div>

          {/* Header */}
          <div className="mb-7">
            <h1 className="text-xl font-bold text-white">{cfg.title}</h1>
            <p className="mt-1.5 text-sm leading-6 text-white/45">{cfg.subtitle}</p>
          </div>

          {/* Fields */}
          <div
            className="space-y-4"
            onKeyDown={(e) => { if (e.key === "Enter") void handleLogin(); }}
          >
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/35">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@clinic.com"
                autoComplete="email"
                className="w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/40 focus:bg-[#0d1c14]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/35">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                className="w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/40 focus:bg-[#0d1c14]"
              />
              {SUPABASE_CONFIGURED && (
                <div className="mt-1.5 text-right">
                  <Link
                    href="/reset-password"
                    className="text-[11px] text-[#6B7280] transition hover:text-[#9CA3AF]"
                  >
                    Forgot your password?
                  </Link>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-[7px] border border-rose-400/20 bg-rose-400/8 px-3.5 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            {/* Primary CTA */}
            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={loading}
              className="w-full rounded-[7px] bg-[#1D9E75] py-3.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Signing in…" : `Sign in as ${role === "clinician" ? "Provider" : "Admin"}`}
            </button>

            {/* Dev bypass */}
            {process.env.NODE_ENV === "development" && (
              <button
                type="button"
                onClick={handleDevBypass}
                className="w-full rounded-[7px] border border-amber-400/20 bg-amber-400/6 py-3 text-sm font-semibold text-amber-300/80 transition hover:border-amber-400/30 hover:text-amber-300"
              >
                Dev bypass → {redirectDest}
              </button>
            )}

            <p className="pt-1 text-center text-sm text-white/30">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-white/55 transition hover:text-white">
                Sign up
              </Link>
            </p>

            {process.env.NODE_ENV === "development" && (
              <p className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5 text-center text-[11px] leading-5 text-white/20">
                Local dev: API on <code className="text-white/35">:8000</code> · PostgreSQL in{" "}
                <code className="text-white/35">backend/.env</code>
              </p>
            )}
          </div>
        </div>

        <RasqDemoPlatformEntryCta variant="login" />

        <p className="mt-4 text-center text-xs text-white/15">
          RASQ by Creative Motion Lab · Secure · Built for clinical workflows
        </p>
        <TrustFooter variant="dark" className="mt-2 border-none" />
      </div>
    </main>
  );
}

// ── Page wrapper ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#080E14]">
          <p className="text-sm text-white/30">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
