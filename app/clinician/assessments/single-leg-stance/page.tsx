"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AssessmentCaptureReviewLayout } from "@/app/components/clinician/assessments/AssessmentCaptureReviewLayout";
import {
  AssessmentCvCaptureSession,
  createSingleLegStanceCaptureDetector,
  mapSingleLegStanceStartError,
} from "@/app/components/clinician/assessments/AssessmentCvCaptureSession";
import { getCvReadyExercises } from "@/app/lib/cv/cv-ready-exercises";
import { SINGLE_LEG_STANCE_SHELL } from "@/app/lib/clinician/assessment-module-shells";
import { readOptionalPatientIdParam } from "@/app/lib/api/patient-id-utils";
import type { StanceLeg } from "@/app/lib/cv/single-leg-stance-detector";
import { useCvSessionMetrics } from "@/app/hooks/useCvSessionMetrics";

const SLS_EXERCISE_ID = "single-leg-stance";
const FETCH_LIMIT = 50;

const SLS_INSTRUCTIONS = [
  "Frame the patient from the side with hips, knees, and ankles visible.",
  "Ask the patient to lift the opposite foot and hold single-leg stance.",
  "Stop when the hold ends or the patient puts the foot down.",
] as const;

function SingleLegStanceAssessmentPage() {
  const searchParams = useSearchParams();
  const scopedPatientId = readOptionalPatientIdParam(searchParams);
  const [stanceLeg, setStanceLeg] = useState<StanceLeg>("left");

  const exerciseNameById = useMemo(
    () =>
      Object.fromEntries(
        getCvReadyExercises().map((exercise) => [exercise.exerciseId, exercise.nameEn]),
      ),
    [],
  );

  const { metrics, loading, error, refresh } = useCvSessionMetrics({
    patientId: scopedPatientId,
    limit: FETCH_LIMIT,
    exerciseIds: [SLS_EXERCISE_ID],
    dedupePatientSessions: false,
  });

  const createDetector = useCallback(
    (onSnapshot: Parameters<typeof createSingleLegStanceCaptureDetector>[1]) =>
      createSingleLegStanceCaptureDetector(stanceLeg, onSnapshot),
    [stanceLeg],
  );

  const hasPatientLinkedSessions = metrics.some((row) => Boolean(row.patientId));

  return (
    <AssessmentCaptureReviewLayout
      config={SINGLE_LEG_STANCE_SHELL}
      metrics={metrics}
      loading={loading}
      error={error}
      exerciseNameById={exerciseNameById}
      hasPatientLinkedSessions={hasPatientLinkedSessions}
      scopedPatientId={scopedPatientId}
      captureSection={
        <AssessmentCvCaptureSession
          title="Single-leg stance capture"
          instructions={[...SLS_INSTRUCTIONS]}
          primaryMetricLabel="Hold duration"
          primaryMetricSource="sessionSeconds"
          consentIntro="Camera access is used to observe single-leg stance hold time. No balance score is assigned."
          createDetector={createDetector}
          onSessionSaved={() => void refresh()}
          startButtonLabel="Start stance observation"
          durationLabel="Task duration"
          mapStartError={mapSingleLegStanceStartError}
          preCapture={
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="text-xs text-white/45">Stance leg:</span>
              {(["left", "right"] as const).map((leg) => (
                <button
                  key={leg}
                  type="button"
                  disabled={loading}
                  onClick={() => setStanceLeg(leg)}
                  className={`rounded-[6px] px-3 py-1.5 text-xs font-semibold transition ${
                    stanceLeg === leg
                      ? "bg-[#1D9E75] text-white"
                      : "border border-[#1E2D42] text-white/55 hover:text-white"
                  }`}
                >
                  {leg === "left" ? "Left" : "Right"}
                </button>
              ))}
            </div>
          }
        />
      }
    />
  );
}

export default function SingleLegStanceAssessmentPageRoute() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0B1220] px-6 py-16 text-white">
          <p className="text-center text-sm text-white/50">Loading Single-Leg Stance…</p>
        </main>
      }
    >
      <SingleLegStanceAssessmentPage />
    </Suspense>
  );
}
