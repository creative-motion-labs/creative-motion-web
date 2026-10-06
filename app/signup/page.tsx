"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerClinician } from "../lib/api";
import { submitProviderAccessRequest } from "../lib/auth/ensure-provider-client";
import { createClient as createSupabaseClient } from "../lib/supabase/browser";

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/* ─── Arc mark (self-contained, no external dependency) ─────────────────── */
function ArcMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M10 2C5.582 2 2 5.582 2 10s3.582 8 8 8" stroke="#1D9E75" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 5.5C7.515 5.5 5.5 7.515 5.5 10S7.515 14.5 10 14.5" stroke="#5DCAA5" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.5" fill="#1D9E75" />
    </svg>
  );
}

/* ─── Field ──────────────────────────────────────────────────────────────── */
function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/35">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/50 focus:bg-[#0d1c14] transition-colors"
      />
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function SignupPage() {
  const router = useRouter();

  const [name,         setName]         = useState("");
  const [email,        setEmail]        = useState("");
  const [practice,     setPractice]     = useState("");
  const [password,     setPassword]     = useState("");
  const [confirm,      setConfirm]      = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [registrationReceived, setRegistrationReceived] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  async function handleSignup() {
    setError("");

    if (!name.trim())         return setError("Full name is required.");
    if (!email.trim())        return setError("Email is required.");
    if (password.length < 6)  return setError("Password must be at least 6 characters.");
    if (password !== confirm)  return setError("Passwords do not match.");

    setLoading(true);
    try {
      if (SUPABASE_CONFIGURED) {
        // ── Supabase Auth signup ─────────────────────────────────────────
        const supabase = createSupabaseClient();
        const { data, error: sbError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            // Store display metadata in user_metadata (visible to the provider)
            data: {
              full_name: name.trim(),
              clinic_name: practice.trim() || null,
            },
          },
        });

        if (sbError) {
          setError(sbError.message);
          return;
        }

        if (data.session) {
          await submitProviderAccessRequest({
            name: name.trim(),
            clinic_name: practice.trim() || null,
            email: email.trim().toLowerCase(),
          });
        } else {
          setNeedsEmailConfirmation(true);
        }

        setRegistrationReceived(true);
      } else {
        // ── FastAPI fallback (pre-Supabase accounts) ─────────────────────
        await registerClinician({
          full_name: name.trim(),
          email:     email.trim().toLowerCase(),
          password,
        });

        if (practice.trim()) {
          localStorage.setItem("cm_practice_name", practice.trim());
        }

        router.push("/login?registered=1");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#080E14] px-6 py-16 text-white">
      {/* Subtle teal ambient */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(29,158,117,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm">

        {/* Top bar */}
        <div className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium text-white/35 transition hover:text-white/65"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            <ArcMark size={16} />
            <span
              className="font-bold tracking-[-0.03em]"
              style={{ fontFamily: "var(--rasq-font-display, sans-serif)" }}
            >
              RASQ
            </span>
          </Link>
            <span className="rounded-[5px] border border-[#1E2D42] bg-[#0F1825] px-2.5 py-1 text-[11px] font-semibold text-white/35">
            Request access
          </span>
        </div>

        {/* Card */}
        <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-7">

          {/* Header */}
          <div className="mb-7">
            <h1
              className="text-xl font-bold text-white"
              style={{ fontFamily: "var(--rasq-font-display, sans-serif)" }}
            >
              Request access to RASQ
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-white/40">
              Submit your details for pilot review. Clinician workspace access is granted
              after approval.
            </p>
          </div>

          {registrationReceived ? (
            <div className="space-y-4">
              <div className="rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-4 py-4">
                <p className="text-sm font-semibold text-[#5DCAA5]">Registration Received</p>
                <p className="mt-2 text-sm leading-6 text-white/50">
                  Thank you for your interest in RASQ. Your registration request has been
                  received and is pending review. Our team will contact you regarding access.
                </p>
                {needsEmailConfirmation && (
                  <p className="mt-3 text-sm leading-6 text-white/45">
                    If email confirmation is required, please check your inbox for{" "}
                    <span className="font-semibold text-white/70">{email}</span> before signing in.
                  </p>
                )}
                <p className="mt-4 text-sm">
                  <Link href="/login" className="font-semibold text-[#5DCAA5] underline underline-offset-2">
                    Return to sign in
                  </Link>
                </p>
              </div>
            </div>
          ) : null}

          {!registrationReceived && (
          <div
            className="space-y-4"
            onKeyDown={(e) => { if (e.key === "Enter") void handleSignup(); }}
          >
            <Field
              label="Full name"
              value={name}
              onChange={setName}
              placeholder="Dr. Sarah Ahmed"
              autoComplete="name"
            />
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@clinic.com"
              autoComplete="email"
            />
            <Field
              label="Practice / clinic name"
              value={practice}
              onChange={setPractice}
              placeholder="City Rehabilitation Centre"
              autoComplete="organization"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
            <Field
              label="Confirm password"
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="Repeat password"
              autoComplete="new-password"
            />

            {error && (
              <div className="rounded-[7px] border border-rose-400/20 bg-rose-400/8 px-3.5 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSignup()}
              disabled={loading}
              className="w-full rounded-[7px] bg-[#1D9E75] py-3.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Submitting request…" : "Request access"}
            </button>

            <p className="pt-1 text-center text-sm text-white/30">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-semibold text-white/55 transition hover:text-white"
              >
                Sign in
              </Link>
            </p>
          </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/15">
          RASQ by Creative Motion Lab · Rehabilitation, precisely.
        </p>
      </div>
    </main>
  );
}
