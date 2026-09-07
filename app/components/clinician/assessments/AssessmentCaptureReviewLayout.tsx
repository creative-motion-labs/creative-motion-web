"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CvReviewSummary } from "@/app/components/clinician/cv/CvReviewSummary";
import type { AssessmentModuleShellConfig } from "@/app/lib/clinician/assessment-module-shells";
import type { CvSessionMetricPublic } from "@/app/lib/cv/cv-metrics-display";

type Props = {
  config: AssessmentModuleShellConfig;
  captureSection: ReactNode;
  metrics: CvSessionMetricPublic[];
  loading: boolean;
  error: boolean;
  exerciseNameById: Record<string, string>;
  hasPatientLinkedSessions: boolean;
  maxSessions?: number;
  scopedPatientId?: string;
  emptyStateOverride?: {
    title: string;
    body: string;
  };
};

export function AssessmentCaptureReviewLayout({
  config,
  captureSection,
  metrics,
  loading,
  error,
  exerciseNameById,
  hasPatientLinkedSessions,
  maxSessions = 10,
  scopedPatientId,
  emptyStateOverride,
}: Props) {
  const showEmpty = !loading && !error && metrics.length === 0;
  const emptyTitle = emptyStateOverride?.title ?? "No observations captured yet";
  const emptyBody =
    emptyStateOverride?.body ??
    "Use the capture section above to record a bounded task pass for therapist review.";

  return (
    <div className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/clinician/assessments"
          className="inline-flex text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
        >
          ← Assessment Center
        </Link>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          {config.eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">{config.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">{config.description}</p>

        {scopedPatientId ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#1D9E75]/20 bg-[#1D9E75]/8 px-3 py-2.5">
            <p className="text-xs text-[#5DCAA5]">Showing this patient&apos;s saved results only.</p>
            <Link
              href={`/clinician/patients/${scopedPatientId}`}
              className="text-xs font-semibold text-[#5DCAA5] hover:text-white"
            >
              ← Patient profile
            </Link>
          </div>
        ) : null}

        <div className="mt-5 rounded-[10px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/90">
            Therapist review required
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/55">{config.safetyDetail}</p>
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-bold text-white">Capture observation</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/40">
            Run a bounded assessment pass. Observations are saved below for therapist review.
          </p>
          <div className="mt-4">{captureSection}</div>
        </section>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/clinician/results"
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:border-[#1D9E75]/25 hover:text-white"
          >
            Open Results queue
          </Link>
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-bold text-white">{config.observationsSectionTitle}</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/40">
            Saved assessment movement sessions appear here after capture.
          </p>

          {loading ? (
            <p className="mt-4 text-xs text-[#6B7280]">Loading observations…</p>
          ) : error ? (
            <p className="mt-4 text-xs text-rose-300">
              Could not load observations. Try again later.
            </p>
          ) : showEmpty ? (
            <div className="mt-4 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] px-4 py-8 text-center">
              <p className="text-sm font-medium text-[#9CA3AF]">{emptyTitle}</p>
              <p className="mt-2 text-xs leading-relaxed text-[#6B7280]">{emptyBody}</p>
            </div>
          ) : (
            <CvReviewSummary
              metrics={metrics}
              exerciseNameById={exerciseNameById}
              loading={false}
              error={false}
              showPatientLinks={hasPatientLinkedSessions}
              maxSessions={maxSessions}
            />
          )}
        </section>

        <section className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/35">
            Review guidance
          </h2>
          <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-white/45">
            {config.reviewGuidance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
