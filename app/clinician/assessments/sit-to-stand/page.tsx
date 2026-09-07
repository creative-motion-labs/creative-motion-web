"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { CvReviewSummary } from "@/app/components/clinician/cv/CvReviewSummary";
import { readOptionalPatientIdParam } from "@/app/lib/api/patient-id-utils";
import { getCvReadyExercises } from "@/app/lib/cv/cv-ready-exercises";
import { useCvSessionMetrics } from "@/app/hooks/useCvSessionMetrics";

const STS_EXERCISE_ID = "sit-to-stand";
const FETCH_LIMIT = 50;
const DISPLAY_MAX = 10;

function SitToStandAssessmentReviewPage() {
  const searchParams = useSearchParams();
  const scopedPatientId = readOptionalPatientIdParam(searchParams);

  const exerciseNameById = useMemo(
    () =>
      Object.fromEntries(
        getCvReadyExercises().map((exercise) => [exercise.exerciseId, exercise.nameEn]),
      ),
    [],
  );

  const { metrics, loading, error } = useCvSessionMetrics({
    patientId: scopedPatientId,
    limit: FETCH_LIMIT,
    exerciseIds: [STS_EXERCISE_ID],
    dedupePatientSessions: false,
  });

  const hasPatientLinkedSessions = metrics.some((row) => Boolean(row.patientId));

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
          RASQ · Sit-to-Stand assessment
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Sit-to-Stand motion evidence</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
          Review recorded sit-to-stand sessions from patient portal captures and linked plan
          activity. Observations support therapist review only.
        </p>

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
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            Derived movement metrics reflect camera and tracking reliability. They are not
            diagnostic and do not replace clinical examination.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/clinician/results"
            className="rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:border-[#1D9E75]/25 hover:text-white"
          >
            Open Results queue
          </Link>
        </div>

        <CvReviewSummary
          metrics={metrics}
          exerciseNameById={exerciseNameById}
          loading={loading}
          error={error}
          showPatientLinks={hasPatientLinkedSessions}
          maxSessions={DISPLAY_MAX}
        />
      </div>
    </div>
  );
}

export default function SitToStandAssessmentReviewPageRoute() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0B1220] px-6 py-16 text-white">
          <p className="text-center text-sm text-white/50">Loading Sit-to-Stand…</p>
        </main>
      }
    >
      <SitToStandAssessmentReviewPage />
    </Suspense>
  );
}
