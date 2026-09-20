"use client";

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
} from "../../lib/api/treatment-plans";

// ── Helpers ────────────────────────────────────────────────────────────────────
function phaseNumber(phaseId: string): number {
  const m = phaseId.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

// ── Mini bar chart column ──────────────────────────────────────────────────────
function WeekBar({ completed, target, label }: { completed: number; target: number; label: string }) {
  const pct = Math.round((completed / Math.max(target, 1)) * 100);
  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="relative flex w-full max-w-[44px] flex-col-reverse" style={{ height: 64 }}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-[#d8e4de]" />
        <div
          className="w-full rounded-t-[4px] bg-[#1D9E75] transition-all"
          style={{ height: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-[#9db0a3]">{label}</p>
      <p className="text-xs font-bold text-[#0f2e22]">{completed}/{target}</p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function PatientProgressPage() {
  return (
    <LegacyDemoGate>
      <PatientProgressPageContent />
    </LegacyDemoGate>
  );
}

function PatientProgressPageContent() {
  const [patientId] = useState<number>(() => getDemoPatientId());
  const [plan, setPlan] = useState<TreatmentPlan | null>(null);
  const [adherence, setAdherence] = useState<Adherence | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getTreatmentPlan(patientId), getAdherence(patientId)])
      .then(([p, a]) => { setPlan(p); setAdherence(a); })
      .finally(() => setLoading(false));
  }, [patientId]);

  const program           = plan ? REHAB_PROGRAMS.find((p) => p.id === plan.programId) : null;
  const currentPhaseNum   = plan ? phaseNumber(plan.phase) : 0;
  const totalPhases       = program?.phases.length ?? 4;
  const sessionsCompleted = adherence?.sessionsCompleted ?? 0;
  const totalSessions     = plan?.totalSessions ?? 0;
  const overallPct        = totalSessions > 0 ? Math.round((sessionsCompleted / totalSessions) * 100) : 0;
  const weeklyData        = adherence?.weeklyCompletions ?? [];

  return (
    <main className="font-ui-en min-h-screen bg-[#F4F6F5]">

      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center">
        <p className="text-sm font-medium text-amber-900">
          ⚠️ This is a demo page for illustration only. If you are a patient, please use the secure link provided by your clinic.
        </p>
      </div>

      {/* Page header */}
      <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
        <div className="mx-auto max-w-5xl">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">← Dashboard</Link>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1
                className="text-xl font-bold text-[#0f2e22]"
              >
                My Progress
              </h1>
              <p className="mt-0.5 text-sm text-[#6b9080]">
                {plan
                  ? `${plan.programName} · ${plan.phaseName}`
                  : "Your progress will appear here once a plan is assigned."}
              </p>
            </div>
          </div>

          {/* Summary stats */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Overall Progress", value: loading ? "…" : `${overallPct}%`, mono: true },
              { label: "Sessions Done",    value: loading ? "…" : `${sessionsCompleted}/${totalSessions}`, mono: true },
              { label: "Current Phase",    value: loading ? "…" : plan ? `${currentPhaseNum}/${totalPhases}` : "—", mono: false },
              { label: "Adherence",        value: loading ? "…" : adherence ? `${adherence.adherenceRatePct}%` : "—", mono: true },
            ].map(({ label, value, mono }) => (
              <div key={label} className="rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-3">
                <p className="text-[11px] text-[#6b9080]">{label}</p>
                <p
                  className="mt-1 text-xl font-bold text-[#0f2e22]"
                  style={mono ? { fontFamily: "var(--font-ibm-plex-mono, monospace)" } : {}}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-sm text-[#9db0a3]">Loading your progress…</p>
        </div>
      )}

      {/* No plan */}
      {!loading && !plan && (
        <section className="mx-auto max-w-lg px-6 py-20 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[10px] border border-[#e4ece8] bg-white">
            <svg className="h-6 w-6 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#0f2e22]">No progress tracked yet</h2>
          <p className="mt-2 text-sm leading-6 text-[#6b9080]">
            Your progress will appear here once your clinician assigns a rehabilitation program and you begin your sessions.
          </p>
          <Link href="/patient/sessions" className="mt-7 inline-flex rounded-[8px] border border-[#e4ece8] bg-white px-5 py-2.5 text-sm font-semibold text-[#4a7060] transition hover:bg-[#E8F5F1]">
            ← Sessions
          </Link>
        </section>
      )}

      {/* Progress content */}
      {!loading && plan && (
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="grid gap-5 lg:grid-cols-3">

            {/* Phase roadmap */}
            <div className="lg:col-span-1">
              <h2 className="mb-3 text-sm font-bold text-[#0f2e22]">Recovery Phases</h2>
              <div className="space-y-2.5">
                {(program?.phases ?? []).map((ph, i) => {
                  const phNum = i + 1;
                  const isActive = phNum === currentPhaseNum;
                  const isDone   = phNum < currentPhaseNum;
                  const isLocked = phNum > currentPhaseNum;

                  const perPhase     = Math.ceil(plan.totalSessions / (program?.phases.length ?? 1));
                  const start        = i * perPhase;
                  const phaseSessions = plan.sessions.filter((_, idx) => idx >= start && idx < start + perPhase);
                  const phCompleted  = phaseSessions.filter((s) => s.status === "completed").length;
                  const phTotal      = phaseSessions.length;

                  return (
                    <div
                      key={ph.id}
                      className={`rounded-[10px] border p-4 ${
                        isDone   ? "border-[#d0e8de] bg-[#E8F5F1]" :
                        isActive ? "border-[#1D9E75] bg-white" :
                        "border-[#e4ece8] bg-[#F4F6F5] opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          isDone   ? "bg-[#1D9E75] text-white" :
                          isActive ? "bg-[#1D9E75] text-white" :
                          "border border-[#d8e4de] bg-[#F4F6F5] text-[#9db0a3]"
                        }`}>
                          {isDone ? (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : phNum}
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${isLocked ? "text-[#9db0a3]" : "text-[#0f2e22]"}`}>
                            {ph.name.split("—")[1]?.trim() ?? ph.name}
                          </p>
                          <p className="text-[11px] text-[#9db0a3]">
                            {isActive ? `${phCompleted}/${phTotal} sessions` : isDone ? "Complete" : `${ph.defaultSessions} sessions`}
                          </p>
                        </div>
                        {isActive && (
                          <span className="rounded-[4px] bg-[#1D9E75] px-2 py-0.5 text-[10px] font-bold text-white">Active</span>
                        )}
                      </div>

                      {isActive && phTotal > 0 && (
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-[11px] text-[#9db0a3]">
                            <span>Phase progress</span>
                            <span>{phTotal > 0 ? Math.round((phCompleted / phTotal) * 100) : 0}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#e4ece8]">
                            <div className="h-full bg-[#1D9E75] transition-all" style={{ width: `${phTotal > 0 ? (phCompleted / phTotal) * 100 : 0}%` }} />
                          </div>
                        </div>
                      )}

                      {ph.goal && isActive && (
                        <p className="mt-2.5 border-t border-[#e4ece8] pt-2.5 text-xs leading-5 text-[#4a7060]">{ph.goal}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-5 lg:col-span-2">

              {/* Weekly sessions chart */}
              {weeklyData.length > 0 && (
                <div className="rounded-[10px] border border-[#e4ece8] bg-white p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#0f2e22]">Weekly Sessions</h2>
                    <div className="flex items-center gap-3 text-[11px] text-[#9db0a3]">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-4 rounded-sm bg-[#1D9E75]" /> Done
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-px w-4 border-t border-dashed border-[#9db0a3]" /> Target
                      </span>
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    {weeklyData.map((w) => (
                      <WeekBar key={w.week} completed={w.completed} target={w.target} label={w.week} />
                    ))}
                  </div>
                </div>
              )}

              {/* Session progress */}
              <div className="rounded-[10px] border border-[#e4ece8] bg-white p-5">
                <h2 className="mb-4 text-sm font-bold text-[#0f2e22]">Session Progress</h2>
                <div className="mb-4 grid grid-cols-3 gap-3">
                  {[
                    { label: "Done",        value: plan.sessions.filter((s) => s.status === "completed").length,   bg: "bg-emerald-50 border-emerald-200",  text: "text-emerald-700" },
                    { label: "In Progress", value: plan.sessions.filter((s) => s.status === "in-progress").length, bg: "bg-blue-50 border-blue-200",         text: "text-blue-700"    },
                    { label: "Remaining",   value: plan.sessions.filter((s) => s.status === "ready").length,       bg: "bg-[#F4F6F5] border-[#e4ece8]",      text: "text-[#0f2e22]"  },
                  ].map(({ label, value, bg, text }) => (
                    <div key={label} className={`rounded-[8px] border p-4 text-center ${bg}`}>
                      <p className={`text-2xl font-bold ${text}`} style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
                        {value}
                      </p>
                      <p className="mt-1 text-[11px] text-[#6b9080]">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Mini session list */}
                <div className="space-y-2">
                  {plan.sessions.slice(0, 8).map((s) => (
                    <div key={s.id} className="flex items-center gap-3">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${
                        s.status === "completed"  ? "bg-emerald-500" :
                        s.status === "in-progress" ? "bg-[#1D9E75]" :
                        "bg-[#d8e4de]"
                      }`} />
                      <span className="flex-1 text-xs text-[#4a7060]">Session {s.sessionNumber} — {s.title}</span>
                      {s.completedAt && (
                        <span className="text-[10px] text-[#9db0a3]">
                          {new Date(s.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  ))}
                  {plan.sessions.length > 8 && (
                    <p className="pl-5 text-xs text-[#9db0a3]">+{plan.sessions.length - 8} more sessions</p>
                  )}
                </div>

                <Link
                  href="/patient/sessions"
                  className="mt-5 flex w-full items-center justify-center rounded-[8px] bg-[#1D9E75] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165]"
                >
                  Continue Sessions →
                </Link>
              </div>

              {/* Therapist notes */}
              {plan.clinicianNotes && (
                <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-5">
                  <h2 className="mb-2.5 text-sm font-bold text-amber-900">Therapist Note</h2>
                  <p className="text-sm leading-6 text-amber-800">{plan.clinicianNotes}</p>
                  <p className="mt-3 text-[11px] text-amber-700/60">
                    By {plan.assignedBy} · {new Date(plan.assignedAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
