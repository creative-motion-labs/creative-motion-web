"use client";

/**
 * LEGACY / DEMO sessions list — not the MVP token-based patient portal.
 * Uses in-memory mock data from app/lib/api/treatment-plans.ts.
 * Real patients must use the secure link: /patient/[token]/session/[sessionId].
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LegacyDemoGate } from "@/app/components/legacy/LegacyDemoGate";
import {
  getTreatmentPlan,
  updateSessionStatus,
  getDemoPatientId,
  type TreatmentPlan,
  type PlanSession,
} from "../../lib/api/treatment-plans";
import { getExerciseDisplayName } from "../../lib/exercise-prescription";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionKind = "camera-cv" | "ai-guided" | "xr";
type SessionStatus = PlanSession["status"];

interface AssignedSession {
  id: string;
  title: string;
  kind: SessionKind;
  program: string;
  phase: string;
  sessionNumber: number;
  totalSessions: number;
  estimatedMinutes: number;
  exercises: string[];
  status: PlanSession["status"];
  completedDate?: string;
  launchHref: string | null;
}

function mapPlanToSessions(plan: TreatmentPlan): AssignedSession[] {
  return plan.sessions.map((s) => ({
    id: s.id,
    title: s.title,
    kind: "camera-cv",
    program: plan.programName,
    phase: plan.phaseName,
    sessionNumber: s.sessionNumber,
    totalSessions: plan.totalSessions,
    estimatedMinutes: s.estimatedMinutes,
    exercises: s.exercises.map(getExerciseDisplayName),
    status: s.status,
    completedDate: s.completedAt
      ? new Date(s.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : undefined,
    launchHref: s.status !== "completed" ? `/sessions/acl?phase=${plan.phase}&session=${s.id}` : null,
  }));
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<SessionStatus, { bg: string; text: string; label: string }> = {
  "in-progress": { bg: "bg-blue-50 border-blue-200",  text: "text-blue-700",  label: "In Progress" },
  "ready":       { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Ready"       },
  "completed":   { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", label: "Completed" },
};

// ── Session card — light, premium ──────────────────────────────────────────────
function SessionCard({
  session,
  onStart,
  isStarting,
}: {
  session: AssignedSession;
  onStart?: (id: string, status: PlanSession["status"]) => void;
  isStarting?: boolean;
}) {
  const isActive = session.status !== "completed";
  const badge    = STATUS_BADGE[session.status];

  return (
    <div className={`overflow-hidden rounded-[10px] border transition ${
      isActive
        ? "border-[#e4ece8] bg-white hover:border-[#1D9E75]/30"
        : "border-[#e4ece8] bg-[#F4F6F5] opacity-70"
    }`}>
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-[5px] border px-2.5 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                {badge.label}
              </span>
              <span className="text-[11px] text-[#9db0a3]">{session.program}</span>
            </div>
            <h3 className={`mt-2 text-base font-bold ${isActive ? "text-[#0f2e22]" : "text-[#6b9080]"}`}>
              {session.title}
            </h3>
            <p className="mt-0.5 text-sm text-[#6b9080]">{session.phase}</p>
          </div>

          {/* Session number */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5]">
            <span className="text-xs font-bold text-[#6b9080]">{session.sessionNumber}</span>
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex items-center gap-4 text-xs text-[#6b9080]">
          <span className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            ~{session.estimatedMinutes} min
          </span>
          <span className="h-3 w-px bg-[#e4ece8]" />
          <span>Session {session.sessionNumber} of {session.totalSessions}</span>
          {session.completedDate && (
            <>
              <span className="h-3 w-px bg-[#e4ece8]" />
              <span className="font-medium text-emerald-600">{session.completedDate}</span>
            </>
          )}
        </div>

        {/* In-progress progress bar */}
        {session.status === "in-progress" && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-[#9db0a3]">
              <span>Session progress</span>
              <span>Resuming from exercise 2</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e4ece8]">
              <div className="h-full w-2/5 bg-[#1D9E75] transition-all" />
            </div>
          </div>
        )}

        {/* Exercise chips */}
        {isActive && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {session.exercises.map((ex) => (
              <span key={ex} className="rounded-[5px] border border-[#e4ece8] bg-[#F4F6F5] px-2.5 py-1 text-[11px] text-[#4a7060]">
                {ex}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* CTA */}
      {session.status === "completed" ? (
        <div className="border-t border-[#e4ece8] px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-[#6b9080]">
            <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Completed {session.completedDate}
          </div>
        </div>
      ) : (
        <div className="border-t border-[#e4ece8] px-5 py-3">
          <button
            type="button"
            disabled={isStarting}
            onClick={() => onStart?.(session.id, session.status)}
            className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-[#1D9E75] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#179165] disabled:opacity-60"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
            {isStarting ? "Starting…" : session.status === "in-progress" ? "Resume Session" : "Start Session"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function PatientSessionsPage() {
  return (
    <LegacyDemoGate>
      <PatientSessionsPageContent />
    </LegacyDemoGate>
  );
}

function PatientSessionsPageContent() {
  const router = useRouter();
  const [patientId] = useState<number>(() => getDemoPatientId());
  const [plan, setPlan] = useState<TreatmentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    getTreatmentPlan(patientId).then(setPlan).finally(() => setLoading(false));
  }, [patientId]);

  async function handleStartSession(sessionId: string, currentStatus: PlanSession["status"]) {
    if (currentStatus === "completed" || !plan) return;
    setStarting(sessionId);
    try {
      await updateSessionStatus(patientId, sessionId, "in-progress");
      router.push(
        `/sessions/acl?phase=${encodeURIComponent(plan.phase)}&session=${encodeURIComponent(sessionId)}&patientId=${patientId}`,
      );
    } catch {
      setStarting(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F4F6F5]">
        <p className="text-sm text-[#6b9080]">Loading your sessions…</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="font-ui-en min-h-screen bg-[#F4F6F5]">
        <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">← Dashboard</Link>
          <h1 className="mt-1.5 text-xl font-bold text-[#0f2e22]">Sessions</h1>
        </div>
        <section className="mx-auto max-w-lg px-6 py-20 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[10px] border border-[#e4ece8] bg-white">
            <svg className="h-6 w-6 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#0f2e22]">Your first session is being prepared</h2>
          <p className="mt-2 text-sm leading-6 text-[#6b9080]">
            Your therapist is setting up your personalised session queue. Check back soon.
          </p>
          <Link href="/patient" className="mt-7 inline-flex rounded-[8px] border border-[#e4ece8] bg-white px-5 py-2.5 text-sm font-semibold text-[#4a7060] transition hover:bg-[#E8F5F1]">
            ← Dashboard
          </Link>
        </section>
      </main>
    );
  }

  const SESSIONS   = mapPlanToSessions(plan);
  const inProgress = SESSIONS.filter((s) => s.status === "in-progress");
  const ready      = SESSIONS.filter((s) => s.status === "ready");
  const completed  = SESSIONS.filter((s) => s.status === "completed");

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

      {/* Page header */}
      <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
        <div className="mx-auto max-w-5xl">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">← Dashboard</Link>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1
                className="text-xl font-bold text-[#0f2e22]"
              >
                Sessions
              </h1>
              <p className="mt-0.5 text-sm text-[#6b9080]">
                Start or resume whenever you&apos;re ready — no fixed schedule required.
              </p>
            </div>

            {/* Queue stats */}
            <div className="flex shrink-0 items-center gap-3">
              {[
                { value: inProgress.length + ready.length, label: "Remaining",  color: "text-[#0f2e22]"   },
                { value: completed.length,                  label: "Completed",  color: "text-emerald-600" },
                { value: plan.totalSessions,                label: "Total",      color: "text-[#6b9080]"  },
              ].map(({ value, label, color }) => (
                <div key={label} className="rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-2.5 text-center">
                  <p className={`text-lg font-bold ${color}`} style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
                    {value}
                  </p>
                  <p className="text-[11px] text-[#9db0a3]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-8">

        {/* In Progress */}
        {inProgress.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#1D9E75]" />
              <h2 className="text-sm font-bold text-[#0f2e22]">In Progress</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {inProgress.map((s) => (
                <SessionCard key={s.id} session={s} onStart={handleStartSession} isStarting={starting === s.id} />
              ))}
            </div>
          </section>
        )}

        {/* Up Next */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#0f2e22]">Up Next</h2>
            {ready.length > 0 && (
              <span className="rounded-[5px] bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                {ready.length} session{ready.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {ready.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {ready.map((s) => (
                <SessionCard key={s.id} session={s} onStart={handleStartSession} isStarting={starting === s.id} />
              ))}
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#e4ece8] bg-white px-8 py-10 text-center">
              <p className="text-sm font-semibold text-[#4a7060]">All caught up</p>
              <p className="mt-1.5 text-xs text-[#9db0a3]">
                Your therapist will assign new sessions as you progress through your program.
              </p>
            </div>
          )}
        </section>

        {/* Completed */}
        {completed.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-bold text-[#9db0a3]">Completed</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {completed.map((s) => (
                <SessionCard key={s.id} session={s} onStart={handleStartSession} />
              ))}
            </div>
          </section>
        )}

        {/* Appointments cross-link */}
        <div className="flex items-center justify-between rounded-[10px] border border-[#e4ece8] bg-white px-5 py-4">
          <div>
            <p className="text-sm font-medium text-[#4a7060]">Looking for your scheduled consultations?</p>
            <p className="mt-0.5 text-xs text-[#9db0a3]">Video calls and clinic visits are in Appointments.</p>
          </div>
          <Link
            href="/patient/appointments"
            className="shrink-0 rounded-[7px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-2 text-xs font-semibold text-[#4a7060] transition hover:bg-[#E8F5F1] hover:text-[#1D9E75]"
          >
            Appointments →
          </Link>
        </div>
      </div>
    </main>
  );
}
