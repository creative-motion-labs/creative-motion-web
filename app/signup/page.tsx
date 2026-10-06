"use client";

import Link from "next/link";
import { useState } from "react";
import { submitProviderAccessInterest } from "../lib/auth/provider-access-interest-client";

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
  required,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/35">
        {label}
        {required ? <span className="text-[#5DCAA5]/80"> *</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#1D9E75]/50 focus:bg-[#0d1c14] transition-colors"
      />
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [practice, setPractice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    setError("");

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setLoading(true);
    try {
      const result = await submitProviderAccessInterest({
        email,
        fullName: name,
        clinicName: practice,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Unable to submit your request right now. Please try again later.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#080E14] px-6 py-16 text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(29,158,117,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm">
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
            Provider access
          </span>
        </div>

        <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-7">
          {submitted ? (
            <div className="space-y-4">
              <div className="rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-4 py-4">
                <h1
                  className="text-lg font-bold text-[#5DCAA5]"
                  style={{ fontFamily: "var(--rasq-font-display, sans-serif)" }}
                >
                  Thank you for your interest in RASQ.
                </h1>
                <p className="mt-2 text-sm leading-6 text-white/50">
                  We&apos;ve received your request and our team will contact you regarding provider
                  access.
                </p>
                <p className="mt-4 text-sm">
                  <Link
                    href="/login"
                    className="font-semibold text-[#5DCAA5] underline underline-offset-2"
                  >
                    Already have access? Sign in
                  </Link>
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1
                  className="text-xl font-bold text-white"
                  style={{ fontFamily: "var(--rasq-font-display, sans-serif)" }}
                >
                  Request provider access
                </h1>
                <p className="mt-1.5 text-sm leading-6 text-white/40">
                  Share your details and our team will follow up about clinician workspace access.
                </p>
              </div>

              <div
                className="space-y-4"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit();
                }}
              >
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@clinic.com"
                  autoComplete="email"
                  required
                />
                <Field
                  label="Full name"
                  value={name}
                  onChange={setName}
                  placeholder="Dr. Sarah Ahmed"
                  autoComplete="name"
                />
                <Field
                  label="Practice / clinic name"
                  value={practice}
                  onChange={setPractice}
                  placeholder="City Rehabilitation Centre"
                  autoComplete="organization"
                />

                {error ? (
                  <div className="rounded-[7px] border border-rose-400/20 bg-rose-400/8 px-3.5 py-3 text-sm text-rose-300">
                    {error}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                  className="w-full rounded-[7px] bg-[#1D9E75] py-3.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Submitting…" : "Request Provider Access"}
                </button>

                <p className="pt-1 text-center text-sm text-white/30">
                  Already have access?{" "}
                  <Link
                    href="/login"
                    className="font-semibold text-white/55 transition hover:text-white"
                  >
                    Sign in
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/15">
          RASQ by Creative Motion Lab · Rehabilitation, precisely.
        </p>
      </div>
    </main>
  );
}
