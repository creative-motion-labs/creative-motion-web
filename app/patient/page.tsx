"use client";

/**
 * LEGACY / DEMO patient portal — not the MVP token-based flow.
 * Uses in-memory mock data from app/lib/api/treatment-plans.ts.
 * Real patients must use the secure link: /patient/[token] (patient_access_tokens).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { LegacyDemoGate } from "@/app/components/legacy/LegacyDemoGate";
import {
  getTreatmentPlan,
  getAdherence,
  getDemoPatientId,
  REHAB_PROGRAMS,
  type TreatmentPlan,
  type Adherence,
} from "../lib/api/treatment-plans";

// ── Static placeholder data ────────────────────────────────────────────────────
const PATIENT_NAME = "Sarah";

const NEXT_APPOINTMENT = {
  date: "Thursday, 22 May",
  time: "4:00 PM",
  type: "Video Consultation",
  clinician: "Dr. James Mitchell",
};

const LATEST_RESULT = {
  metric: "Knee Bend",
  value: "108°",
  trend: "+12° since last",
  note: "Leg balance improving — 74% symmetry achieved.",
};

// ── Arc progress ring — minimal teal ─────────────────────────────────────────
function ProgressRing({ pct, size = 64 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} stroke="#e4ece8" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} stroke="#1D9E75" fill="none"
        strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
    </svg>
  );
}

function phaseNumber(phaseId: string): number {
  const match = phaseId.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

// ── Today's session card — compact premium ────────────────────────────────────
function TodaySessionCard({
  plan,
  exercises,
}: {
  plan: TreatmentPlan;
  exercises: string[];
}) {
  const next = plan.sessions.find((s) => s.status !== "completed");
  if (!next) return null;

  return (
    <div className="rounded-[10px] border border-[#d0e8de] bg-[#E8F5F1] p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]/70">
        Today&apos;s Recovery Session
      </p>
      <h3 className="mt-1.5 text-base font-bold text-[#0f2e22]">{next.title}</h3>
      <p className="text-sm text-[#4a7060]">{plan.phaseName}</p>

      <div className="mt-3 flex items-center gap-4 text-sm text-[#6b9080]">
        <span className="flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          ~{next.estimatedMinutes} min
        </span>
        <span className="flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
          Session {next.sessionNumber} of {plan.totalSessions}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {exercises.slice(0, 3).map((ex) => (
          <span key={ex} className="rounded-[5px] border border-[#1D9E75]/20 bg-white px-2.5 py-1 text-[11px] font-medium text-[#1D9E75]">
            {ex}
          </span>
        ))}
        {exercises.length > 3 && (
          <span className="text-[11px] text-[#6b9080]">+{exercises.length - 3} more</span>
        )}
      </div>

      <Link
        href="/patient/sessions"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[8px] bg-[#1D9E75] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#179165]"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
        </svg>
        Start Session
      </Link>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PatientDashboard() {
  return (
    <LegacyDemoGate>
      <PatientDashboardContent />
    </LegacyDemoGate>
  );
}

function PatientDashboardContent() {
  const [patientId] = useState<number>(() => getDemoPatientId());
  const [plan, setPlan]           = useState<TreatmentPlan | null>(null);
  const [adherence, setAdherence] = useState<Adherence | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([getTreatmentPlan(patientId), getAdherence(patientId)]).then(
      ([p, a]) => { setPlan(p); setAdherence(a); }
    ).finally(() => setLoading(false));
  }, [patientId]);

  const program           = plan ? REHAB_PROGRAMS.find((p) => p.id === plan.programId) : null;
  const phase             = program?.phases.find((ph) => ph.id === plan?.phase);
  const todayExercises    = phase?.exercises.slice(0, 6) ?? [];
  const sessionsCompleted = adherence?.sessionsCompleted ?? 0;
  const totalSessions     = plan?.totalSessions ?? 0;
  const progressPct       = totalSessions > 0 ? Math.round((sessionsCompleted / totalSessions) * 100) : 0;
  const currentPhaseNum   = plan ? phaseNumber(plan.phase) : 1;
  const hasNext           = plan?.sessions.some((s) => s.status !== "completed") ?? false;

  // Motivational subtitle based on progress
  const subtitle = !plan
    ? "Your recovery plan is being prepared."
    : progressPct === 0
    ? "Ready for today's first session?"
    : progressPct < 50
    ? "Great start — keep the momentum going."
    : progressPct < 80
    ? "Strong progress — you're more than halfway there."
    : "Outstanding progress — the finish line is close.";

  return (
    <main className="font-ui-en min-h-screen bg-[#F4F6F5]">

      {/* Legacy route notice */}
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center">
        <p className="text-sm font-medium text-amber-900">
          Please use the secure patient link sent by your therapist.
        </p>
        <p className="mt-0.5 text-xs text-amber-800/80">
          This page is a legacy demo preview — not connected to your live rehabilitation plan.
        </p>
      </div>

      {/* ── Hero ── */}
      <div className="border-b border-[#e4ece8] bg-white px-6 py-7">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b9080]">RASQ · Patient portal</p>
              <h1
                className="mt-2 text-2xl font-bold text-[#0f2e22] sm:text-3xl"
              >
                Welcome back, {PATIENT_NAME}
              </h1>
              <p className="mt-1 text-sm text-[#4a7060]">{subtitle}</p>

              {plan && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1D9E75]" />
                  <span className="text-xs font-semibold text-[#1D9E75]">
                    {plan.programName} · {plan.phaseName}
                  </span>
                  <span className="text-white/25">·</span>
                  <span className="text-xs text-[#6b9080]">Managed by {plan.assignedBy}</span>
                </div>
              )}
            </div>

            {/* Progress chip */}
            {plan && (
              <div className="flex items-center gap-3 rounded-[10px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-3">
                <div className="relative">
                  <ProgressRing pct={progressPct} size={56} />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#1D9E75]">
                    {progressPct}%
                  </span>
                </div>
                <div>
                  <p className="text-[11px] text-[#6b9080]">Program progress</p>
                  <p className="text-sm font-bold text-[#0f2e22]">{sessionsCompleted} / {totalSessions} sessions</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-3">

          {/* Primary — today's session */}
          <div className="flex flex-col gap-4 lg:col-span-2">

            {/* Session card or empty state */}
            {loading ? (
              <div className="rounded-[10px] border border-[#e4ece8] bg-white p-6">
                <div className="h-4 w-48 animate-pulse rounded bg-[#e4ece8]" />
                <div className="mt-3 h-3 w-32 animate-pulse rounded bg-[#e4ece8]" />
              </div>
            ) : plan && hasNext ? (
              <TodaySessionCard plan={plan} exercises={todayExercises} />
            ) : plan ? (
              <div className="rounded-[10px] border border-[#e4ece8] bg-white p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#E8F5F1]">
                  <svg className="h-6 w-6 text-[#1D9E75]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-[#0f2e22]">All sessions completed</p>
                <p className="mt-1 text-xs text-[#6b9080]">Your therapist will assign the next phase soon.</p>
              </div>
            ) : (
              <div className="rounded-[10px] border border-[#e4ece8] bg-white p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#E8F5F1]">
                  <svg className="h-6 w-6 text-[#1D9E75]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-[#0f2e22]">Your recovery plan is being prepared</p>
                <p className="mt-1 text-xs text-[#6b9080]">Your clinician will assign your program after your assessment.</p>
              </div>
            )}

            {/* Metric stats row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: "Sessions Done",
                  value: loading ? "…" : `${sessionsCompleted}`,
                  sub: totalSessions > 0 ? `of ${totalSessions}` : "no plan",
                  mono: true,
                },
                {
                  label: "Current Phase",
                  value: loading ? "…" : plan ? `${currentPhaseNum} of 4` : "—",
                  sub: "active phase",
                  mono: false,
                },
                {
                  label: "Last Result",
                  value: "108°",
                  sub: LATEST_RESULT.metric,
                  mono: true,
                },
                {
                  label: "Next Appointment",
                  value: "Thu",
                  sub: "22 May · 4:00 PM",
                  mono: false,
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded-[10px] border border-[#e4ece8] bg-white px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#6b9080]">{stat.label}</p>
                  <p
                    className="mt-1.5 text-xl font-bold text-[#0f2e22]"
                    style={stat.mono ? { fontFamily: "var(--font-ibm-plex-mono, monospace)" } : {}}
                  >
                    {stat.value}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#9db0a3]">{stat.sub}</p>
                </div>
              ))}
            </div>

            {/* Phase roadmap strip */}
            {plan && (
              <div className="rounded-[10px] border border-[#e4ece8] bg-white p-5">
                <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[#6b9080]">Recovery phases</p>
                <div className="grid grid-cols-4 gap-2">
                  {["Movement Control", "Strength & Balance", "Dynamic Control", "Return to Sport"].map((name, i) => {
                    const phNum = i + 1;
                    const state = phNum < currentPhaseNum ? "done" : phNum === currentPhaseNum ? "active" : "future";
                    return (
                      <div key={name} className={`rounded-[8px] p-3 text-center ${
                        state === "done"   ? "bg-[#E8F5F1] border border-[#d0e8de]" :
                        state === "active" ? "bg-[#1D9E75] border border-[#1D9E75]" :
                        "bg-[#F4F6F5] border border-[#e4ece8]"
                      }`}>
                        <p className={`text-xs font-bold ${state === "active" ? "text-white" : state === "done" ? "text-[#1D9E75]" : "text-[#9db0a3]"}`}>
                          Phase {phNum}
                        </p>
                        <p className={`mt-0.5 text-[10px] leading-4 ${state === "active" ? "text-white/80" : state === "done" ? "text-[#4a7060]" : "text-[#9db0a3]"}`}>
                          {name.split(" ")[0]}
                        </p>
                        {state === "done" && (
                          <svg className="mx-auto mt-1 h-3 w-3 text-[#1D9E75]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">

            {/* Next appointment */}
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700/70">Upcoming</p>
              </div>
              <p className="mt-2.5 text-base font-bold text-[#0f2e22]">{NEXT_APPOINTMENT.date}</p>
              <p className="text-sm text-amber-700">{NEXT_APPOINTMENT.time} · {NEXT_APPOINTMENT.type}</p>
              <p className="mt-1 text-xs text-[#6b9080]">{NEXT_APPOINTMENT.clinician}</p>
              <Link
                href="/patient/appointments"
                className="mt-4 flex w-full items-center justify-center rounded-[7px] border border-amber-300 bg-white px-3 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
              >
                View Appointment →
              </Link>
            </div>

            {/* Latest result */}
            <div className="rounded-[10px] border border-[#e4ece8] bg-white p-5">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-[#6b9080]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                </svg>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b9080]">Latest result</p>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p
                    className="text-2xl font-bold text-[#1D9E75]"
                    style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                  >
                    {LATEST_RESULT.value}
                  </p>
                  <p className="text-xs text-[#6b9080]">{LATEST_RESULT.metric}</p>
                </div>
                <span className="rounded-[5px] bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  {LATEST_RESULT.trend}
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#6b9080]">{LATEST_RESULT.note}</p>
              <Link href="/patient/results" className="mt-4 block text-center text-xs font-semibold text-[#1D9E75] hover:text-[#0D6B4F]">
                Full results →
              </Link>
            </div>

            {/* Quick nav */}
            <div className="rounded-[10px] border border-[#e4ece8] bg-white p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#6b9080]">Quick access</p>
              <div className="space-y-1">
                {[
                  { href: "/patient/plan", label: "Recovery Plan" },
                  { href: "/patient/progress", label: "My Progress" },
                  { href: "/patient/results", label: "Results" },
                  { href: "/patient/appointments", label: "Appointments" },
                ].map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center justify-between rounded-[6px] px-3 py-2 text-sm font-medium text-[#4a7060] transition hover:bg-[#E8F5F1] hover:text-[#0f2e22]"
                  >
                    {label}
                    <svg className="h-3.5 w-3.5 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
