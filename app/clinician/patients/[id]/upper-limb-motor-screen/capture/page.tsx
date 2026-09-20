"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UpperLimbLateralReachCaptureSession } from "@/app/components/clinician/upper-limb-motor-screen/UpperLimbLateralReachCaptureSession";
import { UpperLimbSessionResultReview } from "@/app/components/clinician/upper-limb-motor-screen/UpperLimbSessionResultReview";
import { isUuidPatientId } from "@/app/lib/api/patient-id-utils";
import type { PatientRow } from "@/app/lib/validate-patient-ownership";
import {
  createLateralReachAssignmentSubmitter,
  UPPER_LIMB_MOTOR_SCREEN_ASSESSMENT_HREF,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-assignment-client";
import { buildLateralReachSessionResultRequest } from "@/app/lib/upper-limb-motor-screen/map-lateral-reach-attempt-to-session-result";
import { submitUpperLimbSessionResult } from "@/app/lib/upper-limb-motor-screen/session-result-submit-client";
import type { UpperLimbMotorScreenSessionResultPublic } from "@/app/lib/upper-limb-motor-screen/session-result-persistence";
import type {
  UpperLimbMovementAttemptResult,
  UpperLimbSide,
} from "@/app/lib/upper-limb-motor-screen/types";

export default function UpperLimbLateralReachCapturePage() {
  const params = useParams();
  const patientId = String(params.id || "");

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  const [patientError, setPatientError] = useState(false);

  const [testedSide, setTestedSide] = useState<UpperLimbSide>("right");
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);

  const [attempt, setAttempt] = useState<UpperLimbMovementAttemptResult | null>(null);
  const [savedResult, setSavedResult] = useState<UpperLimbMotorScreenSessionResultPublic | null>(
    null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const assignmentSubmitterRef = useRef(createLateralReachAssignmentSubmitter());
  const assignmentIdRef = useRef<string | null>(null);

  useEffect(() => {
    assignmentIdRef.current = assignmentId;
  }, [assignmentId]);

  useEffect(() => {
    if (!patientId) {
      setPatientError(true);
      setLoadingPatient(false);
      return;
    }

    setLoadingPatient(true);
    setPatientError(false);
    void fetch(`/api/patients/${encodeURIComponent(patientId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) {
          setPatient(null);
          setPatientError(true);
          return;
        }
        if (!response.ok) {
          setPatientError(true);
          return;
        }
        setPatient((await response.json()) as PatientRow);
      })
      .catch(() => {
        setPatientError(true);
      })
      .finally(() => {
        setLoadingPatient(false);
      });
  }, [patientId]);

  const ensureAssignment = useCallback(async () => {
    if (!isUuidPatientId(patientId) || assignmentIdRef.current || assignmentLoading) return;
    setAssignmentLoading(true);
    setAssignmentError(null);

    const result = await assignmentSubmitterRef.current.submit(patientId, testedSide);
    if (!result.ok) {
      setAssignmentError(result.message);
      setAssignmentLoading(false);
      return;
    }

    assignmentIdRef.current = result.assignment.id;
    setAssignmentId(result.assignment.id);
    setAssignmentLoading(false);
  }, [assignmentLoading, patientId, testedSide]);

  const handleAttemptComplete = useCallback(
    async (completedAttempt: UpperLimbMovementAttemptResult) => {
      setAttempt(completedAttempt);

      const activeAssignmentId = assignmentIdRef.current;
      if (!activeAssignmentId) {
        setSaveError("Assignment was not ready. Refresh and try again.");
        return;
      }

      setSaving(true);
      setSaveError(null);

      const request = buildLateralReachSessionResultRequest(activeAssignmentId, completedAttempt);
      const submitResult = await submitUpperLimbSessionResult(request);
      if (!submitResult.ok) {
        setSaveError(submitResult.message);
        setSaving(false);
        return;
      }

      setSavedResult(submitResult.result);
      setSaving(false);
    },
    [],
  );

  const sideLocked = assignmentId !== null || assignmentLoading;

  const pageTitle = useMemo(
    () => (attempt ? "Review lateral reach observation" : "Lateral reach live capture"),
    [attempt],
  );

  if (!isUuidPatientId(patientId)) {
    return (
      <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href={UPPER_LIMB_MOTOR_SCREEN_ASSESSMENT_HREF}
            className="text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
          >
            ← Upper Limb Motor Screen
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-white">Upper Limb Motor Screen</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            Live capture is available for clinician-owned Supabase patient records. Legacy demo
            patients cannot use this workflow yet.
          </p>
        </div>
      </main>
    );
  }

  if (loadingPatient) {
    return (
      <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
        <div className="mx-auto max-w-3xl text-sm text-white/45">Loading patient context…</div>
      </main>
    );
  }

  if (patientError || !patient) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href={UPPER_LIMB_MOTOR_SCREEN_ASSESSMENT_HREF}
          className="text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
        >
          ← Upper Limb Motor Screen
        </Link>

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          RASQ · Upper Limb Motor Screen
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">{pageTitle}</h1>
        <p className="mt-2 text-sm text-white/45">
          Patient: {patient.full_name}
        </p>

        {assignmentLoading ? (
          <p className="mt-4 text-sm text-white/45">Preparing observation assignment…</p>
        ) : null}
        {assignmentError ? (
          <div className="mt-4 rounded-[10px] border border-rose-400/20 bg-rose-400/5 px-4 py-3">
            <p className="text-sm text-rose-200">{assignmentError}</p>
            <button
              type="button"
              onClick={() => void ensureAssignment()}
              className="mt-3 rounded-[7px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white"
            >
              Retry assignment
            </button>
          </div>
        ) : null}

        {!attempt ? (
          <>
            <section className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
              <h2 className="text-sm font-bold text-white">Tested side</h2>
              <p className="mt-1 text-xs text-white/40">
                Select which arm will be observed during lateral reach.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(["right", "left"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    disabled={sideLocked}
                    onClick={() => setTestedSide(side)}
                    className={`rounded-[7px] px-4 py-2 text-xs font-semibold capitalize transition ${
                      testedSide === side
                        ? "bg-[#1D9E75] text-white"
                        : "border border-[#1E2D42] bg-[#0B1220] text-white/60 hover:text-white"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {side}
                  </button>
                ))}
                {!assignmentId ? (
                  <button
                    type="button"
                    disabled={assignmentLoading}
                    onClick={() => void ensureAssignment()}
                    className="rounded-[7px] bg-[#1D9E75] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#178f68] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {assignmentLoading ? "Preparing…" : "Prepare observation"}
                  </button>
                ) : (
                  <span className="text-xs text-[#5DCAA5]">Observation assignment ready</span>
                )}
              </div>
            </section>

            <UpperLimbLateralReachCaptureSession
              testedSide={testedSide}
              disabled={!assignmentId || Boolean(assignmentError)}
              onAttemptComplete={(completedAttempt) => {
                void handleAttemptComplete(completedAttempt);
              }}
            />
          </>
        ) : (
          <UpperLimbSessionResultReview
            patientId={patient.id}
            patientName={patient.full_name}
            attempt={attempt}
            savedResult={savedResult}
            saveError={saveError}
            saving={saving}
          />
        )}

      </div>
    </main>
  );
}
