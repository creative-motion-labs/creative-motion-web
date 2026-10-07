"use client";

import Link from "next/link";
import { useState } from "react";
import { LegacyDemoGate } from "@/app/components/legacy/LegacyDemoGate";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AssessmentResult {
  id: string;
  date: string;
  assessmentType: string;
  phase: string;
  clinician: string;
  overallScore: number;
  scoreLabel: "Good" | "Moderate" | "Needs Attention";
  metrics: { label: string; value: string; unit: string; change: string | null; changeUp: boolean }[];
  therapistNote: string;
  recommendation: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const RESULTS: AssessmentResult[] = [
  {
    id: "r1",
    date: "14 May 2026",
    assessmentType: "Phase 2 Progress Assessment",
    phase: "Phase 2 — Strength & Balance",
    clinician: "Dr. James Mitchell",
    overallScore: 74,
    scoreLabel: "Good",
    metrics: [
      { label: "Knee Bend",     value: "108", unit: "°",    change: "+12°", changeUp: true  },
      { label: "Leg Balance",   value: "74",  unit: "%",    change: "+8%",  changeUp: true  },
      { label: "Balance Hold",  value: "18",  unit: "s",    change: "+5s",  changeUp: true  },
      { label: "Pain Level",    value: "1",   unit: "/10",  change: "−1",   changeUp: true  },
      { label: "Leg Strength",  value: "68",  unit: "%",    change: "+11%", changeUp: true  },
    ],
    therapistNote:
      "Sarah is progressing well through Phase 2. Load symmetry has improved significantly. Single-leg stance endurance is within expected range for this stage. Recommend continuing current plan with increased resistance on step-ups from week 3.",
    recommendation: "Continue Phase 2. Add resistance band for step-ups. Review in 2 weeks.",
  },
  {
    id: "r2",
    date: "2 May 2026",
    assessmentType: "Phase 1 Completion Assessment",
    phase: "Phase 1 — Movement Control",
    clinician: "Dr. James Mitchell",
    overallScore: 91,
    scoreLabel: "Good",
    metrics: [
      { label: "Knee Bend",          value: "96",  unit: "°",  change: "+24°",  changeUp: true },
      { label: "Pain Level",         value: "1",   unit: "/10",change: "−3",    changeUp: true },
      { label: "Sit-to-Stand Speed", value: "2.1", unit: "s",  change: "−0.8s", changeUp: true },
      { label: "Swelling",           value: "None",unit: "",   change: null,    changeUp: true },
    ],
    therapistNote:
      "Phase 1 successfully completed. Full pain-free ROM restored for functional range. Movement quality excellent on sit-to-stand. Cleared to progress to Phase 2 strength work.",
    recommendation: "Phase 1 cleared. Advancing to Phase 2 — Strength & Balance.",
  },
];

const SCORE_STYLE: Record<AssessmentResult["scoreLabel"], { bg: string; text: string }> = {
  "Good":              { bg: "bg-emerald-50 border-emerald-200",  text: "text-emerald-700" },
  "Moderate":          { bg: "bg-amber-50 border-amber-200",      text: "text-amber-700"   },
  "Needs Attention":   { bg: "bg-rose-50 border-rose-200",        text: "text-rose-700"    },
};

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ result }: { result: AssessmentResult }) {
  const [expanded, setExpanded] = useState(result.id === "r1");
  const score = SCORE_STYLE[result.scoreLabel];

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e4ece8] bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition hover:bg-[#F4F6F5]"
      >
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#9db0a3]">{result.date}</span>
            <span className="text-[#d8e4de]">·</span>
            <span className="text-xs text-[#9db0a3]">{result.clinician}</span>
          </div>
          <h3 className="mt-1.5 text-base font-bold text-[#0f2e22]">{result.assessmentType}</h3>
          <p className="mt-0.5 text-sm text-[#6b9080]">{result.phase}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-xl font-bold text-[#0f2e22]" style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
              {result.overallScore}
            </p>
            <p className="text-[11px] text-[#9db0a3]">score</p>
          </div>
          <span className={`rounded-[5px] border px-2.5 py-1 text-[11px] font-semibold ${score.bg} ${score.text}`}>
            {result.scoreLabel}
          </span>
          <svg
            className={`h-4 w-4 text-[#9db0a3] transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#e4ece8] px-5 pb-5 pt-4">
          {/* Metrics */}
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.metrics.map((m) => (
              <div key={m.label} className="rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-3">
                <p className="text-[11px] text-[#6b9080]">{m.label}</p>
                <p className="mt-1 text-xl font-bold text-[#0f2e22]" style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
                  {m.value}
                  <span className="ml-0.5 text-sm font-normal text-[#9db0a3]">{m.unit}</span>
                </p>
                {m.change && (
                  <p className={`mt-0.5 text-xs font-semibold ${m.changeUp ? "text-emerald-600" : "text-rose-600"}`}>
                    {m.change} since last
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Therapist note */}
          <div className="mb-3 rounded-[8px] border border-[#d0e8de] bg-[#E8F5F1] p-4">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]/70">
              Therapist note
            </p>
            <p className="text-sm leading-6 text-[#4a7060]">{result.therapistNote}</p>
          </div>

          {/* Recommendation */}
          <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700/70">
              Your therapist&apos;s advice
            </p>
            <p className="text-sm text-amber-900">{result.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PatientResultsPage() {
  return (
    <LegacyDemoGate>
      <PatientResultsPageContent />
    </LegacyDemoGate>
  );
}

function PatientResultsPageContent() {
  return (
    <main className="font-ui-en min-h-screen bg-[#F4F6F5]">

      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center">
        <p className="text-sm font-medium text-amber-900">
          ⚠️ This is a demo page for illustration only. If you are a patient, please use the secure link provided by your clinic.
        </p>
      </div>

      {/* Page header */}
      <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">← Dashboard</Link>

          <h1
            className="mt-2 text-xl font-bold text-[#0f2e22]"
          >
            My Results
          </h1>
          <p className="mt-0.5 text-sm text-[#6b9080]">
            Your assessment outcomes, therapist notes, and guidance in clear language.
          </p>
        </div>
      </div>

      {/* Latest snapshot */}
      <div className="mx-auto max-w-4xl px-6 py-5">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#9db0a3]">
          Latest assessment — 14 May 2026
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Knee Bend",    value: "108°",  sub: "Target: 130°",    trend: "+12°",  up: true  },
            { label: "Leg Balance",  value: "74%",   sub: "Target: ≥90%",    trend: "+8%",   up: true  },
            { label: "Balance Hold", value: "18s",   sub: "Single leg",      trend: "+5s",   up: true  },
            { label: "Pain Level",   value: "1/10",  sub: "Lower is better", trend: "−1",    up: true  },
          ].map(({ label, value, sub, trend, up }) => (
            <div key={label} className="rounded-[10px] border border-[#e4ece8] bg-white px-4 py-4">
              <p className="text-[11px] text-[#6b9080]">{label}</p>
              <p
                className="mt-1.5 text-2xl font-bold text-[#0f2e22]"
                style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
              >
                {value}
              </p>
              <p className="mt-0.5 text-[11px] text-[#9db0a3]">{sub}</p>
              <p className={`mt-1 text-xs font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{trend}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Results history */}
      <div className="mx-auto max-w-4xl px-6 pb-14">
        <h2 className="mb-4 text-sm font-bold text-[#0f2e22]">Assessment History</h2>
        <div className="space-y-3">
          {RESULTS.map((r) => <ResultCard key={r.id} result={r} />)}
        </div>

        <p className="mt-8 text-center text-xs text-[#9db0a3]">
          Results are shared by your clinical team. Contact your therapist with any questions.
        </p>
      </div>
    </main>
  );
}
