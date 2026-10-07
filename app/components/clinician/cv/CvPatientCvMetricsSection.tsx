"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CvReviewSummary } from "@/app/components/clinician/cv/CvReviewSummary";
import { getCvReadyExercises } from "@/app/lib/cv/cv-ready-exercises";
import { useCvSessionMetrics } from "@/app/hooks/useCvSessionMetrics";

const PATIENT_CV_FETCH_LIMIT = 20;
const PATIENT_CV_DISPLAY_MAX = 10;

type CvPatientCvMetricsSectionProps = {
  patientId: string;
};

export function CvPatientCvMetricsSection({ patientId }: CvPatientCvMetricsSectionProps) {
  const exerciseNameById = useMemo(
    () =>
      Object.fromEntries(
        getCvReadyExercises().map((exercise) => [exercise.exerciseId, exercise.nameEn]),
      ),
    [],
  );

  const { metrics, loading, error, demoNotice } = useCvSessionMetrics({
    patientId,
    limit: PATIENT_CV_FETCH_LIMIT,
  });

  return (
    <div className="space-y-6">
      {demoNotice ? (
        <p className="rounded-[8px] border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200/90">
          {demoNotice}
        </p>
      ) : null}
      <CvReviewSummary
        metrics={metrics}
        exerciseNameById={exerciseNameById}
        loading={loading}
        error={error}
        variant="patient-profile"
        maxSessions={PATIENT_CV_DISPLAY_MAX}
      />
      <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">
          Interactive session outcomes
        </p>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          Interactive Shoulder and other structured session reports are reviewed on the Outcomes hub
          (separate from CV movement tracking sessions above).
        </p>
        <Link
          href={`/clinician/patients/${patientId}/outcomes`}
          className="mt-3 inline-flex rounded-[7px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-3.5 py-2 text-xs font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/14"
        >
          Open Outcomes hub →
        </Link>
      </section>
    </div>
  );
}
