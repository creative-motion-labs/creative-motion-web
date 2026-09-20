"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LegacyDemoGate } from "@/app/components/legacy/LegacyDemoGate";
import {
  getTreatmentPlan,
  getDemoPatientId,
  REHAB_PROGRAMS,
  type TreatmentPlan,
} from "../../lib/api/treatment-plans";
import { getExerciseDisplayName, type StoredExercise } from "../../lib/exercise-prescription";

// ── Exercise coaching cues ─────────────────────────────────────────────────────
const EXERCISE_CUES: Record<string, { sets: number; reps: number | string; rest: string; cue: string; cvTracked: boolean }> = {
  "Sit-to-Stand":          { sets: 2, reps: 12, rest: "60s", cue: "Lean forward, drive through both feet evenly. Avoid pulling on armrests.", cvTracked: true },
  "Mini Squat (0–45°)":    { sets: 3, reps: 15, rest: "60s", cue: "Keep knees aligned over second toe. Control descent — 3 seconds down.", cvTracked: true },
  "Mini Squat":            { sets: 3, reps: 15, rest: "60s", cue: "Keep knees aligned over second toe. Control descent — 3 seconds down.", cvTracked: true },
  "Single Leg Stance":     { sets: 3, reps: "30s", rest: "45s", cue: "Arms by side. Maintain level pelvis. Gaze fixed on a point ahead.", cvTracked: true },
  "Low Step-Up":           { sets: 3, reps: 10, rest: "60s", cue: "Use a 10 cm step. Drive through heel. Keep trunk upright. Do not push off back foot.", cvTracked: true },
  "Heel Raises":           { sets: 3, reps: 20, rest: "45s", cue: "Rise slowly through full range. Hold 1s at the top. Controlled descent.", cvTracked: false },
  "Countermovement Jump":  { sets: 3, reps: 8, rest: "90s", cue: "Land soft with knees tracking over toes. Focus on symmetrical loading.", cvTracked: true },
  "Forward Hops":          { sets: 3, reps: 10, rest: "90s", cue: "Push off from full foot. Soft landing, absorb through hips and knees.", cvTracked: true },
  "Lateral Bounds":        { sets: 3, reps: 10, rest: "90s", cue: "Bound laterally with control. Stick landing for 2 seconds before next rep.", cvTracked: true },
  "Deceleration Drill":    { sets: 3, reps: 6, rest: "120s", cue: "Approach at 70% effort. Decelerate in 2–3 steps. Stay low, wide base.", cvTracked: true },
  "Single-Leg Squat":      { sets: 3, reps: 10, rest: "75s", cue: "Control knee alignment throughout. Don't allow hip drop on standing leg.", cvTracked: true },
  "Agility Ladder":        { sets: 4, reps: "1 run", rest: "60s", cue: "Quick, light steps. Arms driving rhythm. Eyes forward.", cvTracked: false },
  "Change of Direction":   { sets: 4, reps: 8, rest: "90s", cue: "Plant outside foot, drive off inside edge. Keep centre of gravity low.", cvTracked: true },
  "Sport-Specific Drill":  { sets: 3, reps: 6, rest: "120s", cue: "Match your sport's movement pattern. Focus on quality over speed.", cvTracked: false },
  "Reactive Cutting":      { sets: 3, reps: 6, rest: "120s", cue: "React to signal, cut at 45° or 90°. Controlled, sharp deceleration.", cvTracked: true },
  "Treadmill Walk (10MWT)": { sets: 1, reps: "10m", rest: "—", cue: "Walk at comfortable pace. Keep head up and arms relaxed.", cvTracked: true },
  "Step Training":         { sets: 3, reps: 12, rest: "60s", cue: "Deliberate step height and placement. Lead with affected leg on ascent.", cvTracked: true },
  "Tandem Walk":           { sets: 3, reps: "10m", rest: "60s", cue: "Heel directly in front of toe. Arms out for balance if needed.", cvTracked: true },
  "Heel-to-Toe":           { sets: 3, reps: "10m", rest: "60s", cue: "Slow and controlled. Focus on heel strike, toe push-off.", cvTracked: true },
};

type ExStatus = "done" | "pending";

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number | string;
  rest: string;
  cue: string;
  status: ExStatus;
  cvTracked: boolean;
}

function buildExercises(exerciseItems: StoredExercise[]): Exercise[] {
  return exerciseItems.map((item, i) => {
    const name = getExerciseDisplayName(item);
    const cue = EXERCISE_CUES[name] ?? {
      sets: 3, reps: 10, rest: "60s",
      cue: "Follow your clinician's instructions for this exercise.",
      cvTracked: false,
    };
    return { id: `ex-${i}`, name, status: "pending" as ExStatus, ...cue };
  });
}

// ── Exercise card — light, premium ────────────────────────────────────────────
function ExerciseCard({ ex, index }: { ex: Exercise; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`overflow-hidden rounded-[10px] border transition ${
      ex.status === "done"
        ? "border-[#d0e8de] bg-[#E8F5F1] opacity-60"
        : "border-[#e4ece8] bg-white hover:border-[#1D9E75]/30"
    }`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        {/* Step number / check */}
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          ex.status === "done"
            ? "bg-[#1D9E75] text-white"
            : "border border-[#d8e4de] bg-[#F4F6F5] text-[#6b9080]"
        }`}>
          {ex.status === "done" ? (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${ex.status === "done" ? "text-[#1D9E75]" : "text-[#0f2e22]"}`}>
              {ex.name}
            </span>
            {ex.cvTracked && (
              <span className="rounded-[4px] bg-[#E8F5F1] px-2 py-0.5 text-[10px] font-semibold text-[#1D9E75]">
                CV Tracked
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-[#6b9080]">
            {ex.sets} sets × {ex.reps} · Rest {ex.rest}
          </p>
        </div>

        <svg
          className={`h-4 w-4 shrink-0 text-[#9db0a3] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[#e4ece8] bg-[#F4F6F5] px-5 pb-4 pt-3">
          <p className="text-sm leading-6 text-[#4a7060]">{ex.cue}</p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PatientPlanPage() {
  return (
    <LegacyDemoGate>
      <PatientPlanPageContent />
    </LegacyDemoGate>
  );
}

function PatientPlanPageContent() {
  const [patientId] = useState<number>(() => getDemoPatientId());
  const [plan, setPlan] = useState<TreatmentPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTreatmentPlan(patientId).then(setPlan).finally(() => setLoading(false));
  }, [patientId]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F4F6F5]">
        <p className="text-sm text-[#6b9080]">Loading your recovery plan…</p>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="font-ui-en min-h-screen bg-[#F4F6F5]">
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center">
          <p className="text-sm font-medium text-amber-900">
            ⚠️ This is a demo page for illustration only. If you are a patient, please use the secure link provided by your clinic.
          </p>
        </div>
        <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">← Dashboard</Link>
          <h1 className="mt-1.5 text-xl font-bold text-[#0f2e22]">My Plan</h1>
        </div>
        <section className="mx-auto max-w-lg px-6 py-20 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[10px] border border-[#e4ece8] bg-white">
            <svg className="h-6 w-6 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#0f2e22]">Your recovery plan is being prepared</h2>
          <p className="mt-2 text-sm leading-6 text-[#6b9080]">
            Your clinician will assign your program after your assessment. It will appear here as soon as it&apos;s ready.
          </p>
          <Link href="/patient" className="mt-7 inline-flex rounded-[8px] border border-[#e4ece8] bg-white px-5 py-2.5 text-sm font-semibold text-[#4a7060] transition hover:bg-[#E8F5F1]">
            ← Dashboard
          </Link>
        </section>
      </main>
    );
  }

  const program   = REHAB_PROGRAMS.find((p) => p.id === plan.programId);
  const phase     = program?.phases.find((ph) => ph.id === plan.phase);
  const exercises = buildExercises(phase?.exercises ?? plan.sessions[0]?.exercises ?? []);
  const done      = exercises.filter((e) => e.status === "done").length;
  const total     = exercises.length;
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0;
  const completedSessions = plan.sessions.filter((s) => s.status === "completed").length;

  return (
    <main className="font-ui-en min-h-screen bg-[#F4F6F5]">

      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center">
        <p className="text-sm font-medium text-amber-900">
          ⚠️ This is a demo page for illustration only. If you are a patient, please use the secure link provided by your clinic.
        </p>
      </div>

      {/* Page header */}
      <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">
            ← Dashboard
          </Link>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="rounded-[5px] bg-[#E8F5F1] px-2.5 py-1 text-[11px] font-bold text-[#1D9E75]">
                {plan.programName}
              </span>
              <h1
                className="mt-2 text-xl font-bold text-[#0f2e22]"
              >
                {plan.phaseName}
              </h1>
              {plan.phaseGoal && (
                <p className="mt-0.5 text-sm text-[#4a7060]">{plan.phaseGoal}</p>
              )}
            </div>

            <div className="flex items-center gap-5 rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-3 text-center">
              <div>
                <p className="text-xl font-bold text-[#0f2e22]" style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
                  {completedSessions}/{plan.totalSessions}
                </p>
                <p className="text-[11px] text-[#6b9080]">sessions done</p>
              </div>
              <div className="h-8 w-px bg-[#e4ece8]" />
              <div>
                <p className="text-xl font-bold text-[#0f2e22]">{plan.sessionsPerWeek}×</p>
                <p className="text-[11px] text-[#6b9080]">per week</p>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="text-[#6b9080]">Plan progress</span>
              <span className="font-semibold text-[#1D9E75]">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e4ece8]">
              <div className="h-full bg-[#1D9E75] transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Exercise list */}
      <section className="mx-auto max-w-3xl px-6 py-7">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#0f2e22]">Today&apos;s Exercises</h2>
            <p className="mt-0.5 text-sm text-[#6b9080]">
              Tap an exercise to see coaching cues.{" "}
              <Link href="/patient/sessions" className="font-semibold text-[#1D9E75] hover:text-[#0D6B4F]">
                Go to Sessions →
              </Link>
            </p>
          </div>
          <span className="rounded-[5px] border border-[#e4ece8] bg-white px-2.5 py-1 text-xs font-semibold text-[#6b9080]">
            {total} exercises
          </span>
        </div>

        <div className="space-y-2">
          {exercises.map((ex, i) => <ExerciseCard key={ex.id} ex={ex} index={i} />)}
        </div>

        {/* Clinician notes */}
        {plan.clinicianNotes && (
          <div className="mt-6 rounded-[10px] border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700/70">Clinician note</p>
            </div>
            <p className="mt-2.5 text-sm leading-6 text-amber-900">{plan.clinicianNotes}</p>
          </div>
        )}

        {/* Phase 1 safety guidelines */}
        {plan.phase === "phase-1" && (
          <div className="mt-4 rounded-[10px] border border-[#e4ece8] bg-white p-5">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#6b9080]">
              Safety guidelines
            </p>
            <ul className="space-y-2">
              {[
                "Keep knee bend below 45° on all squatting movements.",
                "Stop if you feel sharp knee pain — contact your clinician.",
                "Ensure good lighting and clear background for camera-tracked exercises.",
              ].map((note) => (
                <li key={note} className="flex items-start gap-2.5 text-sm leading-6 text-[#4a7060]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-7 text-center text-xs text-[#9db0a3]">
          Plan by {plan.assignedBy} · Assigned {new Date(plan.assignedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </section>
    </main>
  );
}
