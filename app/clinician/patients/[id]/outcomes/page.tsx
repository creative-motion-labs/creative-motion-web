"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProgressOutcomesHub } from "@/app/components/clinician/progress/ProgressOutcomesHub";
import type { ProgressOutcomesBundle } from "@/app/lib/progress/progress-outcomes-bundle";
import { formatInteractiveShoulderOutcomeSummary } from "@/app/lib/progress/progress-outcomes-hub-layout";

function OutcomesLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-16 animate-pulse rounded-[8px] border border-[#1E2D42] bg-[#0F1825]" />
      <div className="h-10 animate-pulse rounded-[8px] border border-[#1E2D42] bg-[#0F1825]" />
      <div className="h-40 animate-pulse rounded-[10px] border border-[#1E2D42] bg-[#0F1825]" />
      <div className="h-40 animate-pulse rounded-[10px] border border-[#1E2D42] bg-[#0F1825]" />
    </div>
  );
}

function HeaderNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 text-xs font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]"
    >
      {children}
    </Link>
  );
}

export default function PatientOutcomesPage() {
  const params = useParams();
  const patientId = String(params.id || "");

  const [bundle, setBundle] = useState<ProgressOutcomesBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!patientId) {
      setError("Missing patient id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/clinician/progress-outcomes?patientId=${encodeURIComponent(patientId)}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not load progress and outcomes.");
        setBundle(null);
        return;
      }
      const data = (await res.json()) as ProgressOutcomesBundle;
      setBundle(data);
    } catch {
      setError("Could not load progress and outcomes.");
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const profileHref = `/clinician/patients/${patientId}`;

  const summaryLine = useMemo(() => {
    if (!bundle) return null;
    const parts = [
      `${bundle.painTrend.length} logged session${bundle.painTrend.length === 1 ? "" : "s"}`,
      `${bundle.assessments.length} assessment${bundle.assessments.length === 1 ? "" : "s"}`,
      formatInteractiveShoulderOutcomeSummary(
        bundle.interactiveShoulderOutcomes.length,
        bundle.interactiveShoulderChartOutcomes.length,
      ),
      `${bundle.cvEvidence.length} camera session${bundle.cvEvidence.length === 1 ? "" : "s"}`,
    ];
    return parts.join(" · ");
  }, [bundle]);

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <Link
          href={profileHref}
          className="mb-3 flex items-center gap-1.5 text-sm text-white/35 transition hover:text-white/65"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Patient chart
        </Link>

        <div className="mb-4 flex flex-wrap gap-2">
          <HeaderNavLink href={profileHref}>Patient chart</HeaderNavLink>
          <HeaderNavLink href="/clinician/results">Results queue</HeaderNavLink>
          <HeaderNavLink href="/clinician/assessments">Assessment Center</HeaderNavLink>
        </div>

        <div className="mb-7">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
            RASQ · Progress &amp; outcomes
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">
            {bundle?.patientName ?? "Progress & outcomes"}
          </h1>
          <p className="mt-1 text-xs text-white/45">
            Read-only clinician hub — patient-reported trends and derived observations. Therapist
            interpretation required.
          </p>
          {summaryLine && !loading ? (
            <p className="mt-2 text-[11px] font-medium text-white/35">{summaryLine}</p>
          ) : null}
        </div>

        {loading ? (
          <OutcomesLoadingSkeleton />
        ) : error ? (
          <div className="rounded-[8px] border border-rose-400/25 bg-rose-400/8 px-4 py-3">
            <p className="text-sm text-rose-200/90">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs font-semibold text-[#5DCAA5] hover:text-[#1D9E75]"
            >
              Retry
            </button>
          </div>
        ) : bundle ? (
          <ProgressOutcomesHub bundle={bundle} />
        ) : null}
      </div>
    </main>
  );
}
