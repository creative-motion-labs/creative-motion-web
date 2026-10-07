"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { PatientSession } from "@/app/api/patient/plan/route";
import type { SessionCompleteResponse } from "@/app/api/patient/session-complete/route";
import { usePatientLanguage, usePatientPlan } from "@/app/components/patient/PatientLanguageProvider";
import { encodeSessionCoachNotes } from "@/app/lib/session-coach-metadata";
import { resolveExerciseView } from "@/app/lib/exercise-resolve";
import {
  PatientExerciseSessionCard,
  type ExerciseCardStep,
} from "@/app/components/patient/PatientExerciseSessionCard";
import { CatalogPatientSessionPlayback } from "@/app/components/patient/session/CatalogPatientSessionPlayback";
import {
  GUIDED_PRIMARY_BTN,
  GuidedSessionAlreadyCompleteScreen,
  GuidedSessionCompleteScreen,
  GuidedSessionExerciseHero,
  GuidedSessionRestScreen,
  GuidedSessionShell,
  GuidedSessionStartScreen,
} from "@/app/components/patient/session/PatientGuidedSessionFlow";
import { isCatalogPlaybackSession } from "@/app/lib/patient-portal/catalog-session-playback";
import { useCvSessionCapture } from "@/app/hooks/useCvSessionCapture";
import {
  planHomeUi,
  cvSessionCapturePatientMessage,
  cvSessionCaptureSavingMessage,
  guidedSessionUi,
  sessionExerciseFlowUi,
  sessionExerciseUi,
  sessionFocusUi,
  sessionShellUi,
} from "@/app/lib/patient-portal-ui";

type SessionPhase = "start" | "exercise" | "rest" | "wrapup";

function PainScale({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number | null;
  onChange: (n: number) => void;
  min?: number;
}) {
  const options = Array.from({ length: 11 - min }, (_, i) => i + min);
  return (
    <div className="rounded-[16px] border border-[#E2E8E5] bg-white p-5 shadow-[0_4px_16px_rgba(10,15,26,0.04)]">
      <p className="mb-3 text-[14px] font-semibold text-[#374151]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex h-[44px] min-w-[40px] flex-1 items-center justify-center rounded-[10px] border text-[13px] font-semibold transition ${
              value === n
                ? "border-[#1D9E75] bg-[#1D9E75] text-white"
                : "border-[#E2E8E5] bg-[#F4F6F5] text-[#374151] hover:border-[#1D9E75]/40"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SessionPlayerPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const sessionId = String(params.sessionId ?? "");

  const [session, setSession] = useState<PatientSession | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { plan, isPlanLoading, refreshPlan } = usePatientPlan();
  const { language: patientLanguage, isArabic, textDir, arClass } = usePatientLanguage();
  const [phase, setPhase] = useState<SessionPhase>("start");
  const [exerciseStep, setExerciseStep] = useState<ExerciseCardStep>("preview");
  /**
   * True once the patient has declined camera on the Interactive Shoulder consent
   * screen. Interactive Shoulder is camera-dependent — there is no non-camera fallback
   * — so this drives the same honest "Camera access is required" stop state the catalog
   * playback route already shows, rather than continuing the exercise without a camera.
   */
  const [cameraDeclined, setCameraDeclined] = useState(false);
  const [setsCompleted, setSetsCompleted] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [effortScore, setEffortScore] = useState<number | null>(null);
  const [painAfter, setPainAfter] = useState<number | null>(null);
  const [patientNote, setPatientNote] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<{
    effortScore: number;
    painAfter: number;
    exercisesCompleted: number;
  } | null>(null);
  const [cvSaveNotice, setCvSaveNotice] = useState<string | null>(null);

  const {
    isCvEligible,
    onMetricsUpdate,
    markSkipped,
    registerMetricsFlush,
    registerStsPilotBeforeSave,
    registerStsPilotRecordFlush,
    registerCaptureConsentGetter,
    saveCvMetrics,
    resetCapture,
  } = useCvSessionCapture({
    token,
    planSessionId: sessionId,
    exerciseId: session?.exercises[exerciseIndex]
      ? resolveExerciseView(session.exercises[exerciseIndex], {
          language: patientLanguage,
        }).exerciseId
      : undefined,
  });

  useEffect(() => {
    resetCapture();
    setCvSaveNotice(null);
    setCameraDeclined(false);
  }, [exerciseIndex, resetCapture]);

  useEffect(() => {
    setPhase("start");
    setExerciseStep("preview");
    setSetsCompleted(0);
    setExerciseIndex(0);
    setEffortScore(null);
    setPainAfter(null);
    setPatientNote("");
    setCompleted(false);
    setCompletionSummary(null);
    setCompleteError("");
    setCompleting(false);
    setCvSaveNotice(null);
    setCameraDeclined(false);
    resetCapture();
  }, [token, sessionId, resetCapture]);

  useEffect(() => {
    if (!token || isPlanLoading) return;
    if (plan === null) {
      setNotFound(true);
      return;
    }
    if (!plan) return;

    const s = plan.sessions.find((x) => x.id === sessionId);
    if (!s) {
      setNotFound(true);
      return;
    }
    setSession(s);
    setNotFound(false);
  }, [token, sessionId, plan, isPlanLoading]);

  if (notFound) {
    const shellUi = sessionShellUi(patientLanguage);
    const guidedUi = guidedSessionUi(patientLanguage);
    return (
      <div className={`flex min-h-[50vh] items-center justify-center ${arClass}`} dir={textDir}>
        <div className="text-center">
          <p className="text-[14px] font-semibold text-[#374151]">{shellUi.sessionNotFound}</p>
          <Link
            href={`/patient/${token}`}
            className="mt-4 inline-block text-[13px] font-semibold text-[#1D9E75]"
          >
            {guidedUi.backToDashboard}
          </Link>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className={`text-[13px] text-[#9CA3AF] ${arClass}`}>
          {planHomeUi(patientLanguage).loading}
        </p>
      </div>
    );
  }

  if (isCatalogPlaybackSession(session)) {
    return (
      <CatalogPatientSessionPlayback
        token={token}
        session={session}
        patientLanguage={patientLanguage}
        textDir={textDir}
        arClass={arClass}
        onPlanRefresh={refreshPlan}
      />
    );
  }

  const exercises = session.exercises;
  const total = exercises.length;
  const isLast = exerciseIndex === total - 1;
  const current = exercises[exerciseIndex];
  const nextExercise = !isLast ? exercises[exerciseIndex + 1] : null;
  const flowUi = sessionExerciseFlowUi(patientLanguage);
  const shellUi = sessionShellUi(patientLanguage);
  const guidedUi = guidedSessionUi(patientLanguage);
  const focusUi = sessionFocusUi(patientLanguage);
  const currentView = current
    ? resolveExerciseView(current, { language: patientLanguage })
    : null;
  const firstExerciseView = exercises[0]
    ? resolveExerciseView(exercises[0], { language: patientLanguage })
    : null;
  const nextExerciseView = nextExercise
    ? resolveExerciseView(nextExercise, { language: patientLanguage })
    : null;

  function handleBeginSession() {
    setExerciseIndex(0);
    setExerciseStep("preview");
    setSetsCompleted(0);
    setPhase("exercise");
  }

  /**
   * "Skip camera" on the Interactive Shoulder consent screen.
   *
   * `markSkipped` alone was the bug: it sets the capture hook's `cvStatus` to
   * "skipped", and this route never reads `cvStatus` — it is not even destructured
   * from the hook — so the click produced no visible change whatsoever and the button
   * read as dead. It is still called here, so the capture status stays correct; what is
   * new is the stop state the patient can actually see.
   */
  function handleCvSkipped() {
    markSkipped();
    setCameraDeclined(true);
  }

  function handleStartExercise() {
    setCvSaveNotice(null);
    setExerciseStep("active");
    setSetsCompleted(0);
  }

  function handleCompleteSet() {
    const maxSets = currentView?.sets ?? 0;
    if (maxSets > 0) {
      setSetsCompleted((n) => Math.min(n + 1, maxSets));
    }
  }

  async function handleCompleteExercise() {
    if (isCvEligible) {
      setCvSaveNotice(cvSessionCaptureSavingMessage(patientLanguage));
      const result = await saveCvMetrics();
      setCvSaveNotice(
        cvSessionCapturePatientMessage(patientLanguage, result, currentView?.exerciseId),
      );
    } else {
      setCvSaveNotice(null);
    }
    setExerciseStep("done");
  }

  function handleProceedFromExercise() {
    setCvSaveNotice(null);
    if (!isLast) {
      setPhase("rest");
      return;
    }
    setPhase("wrapup");
  }

  function handleRestContinue() {
    setExerciseIndex((i) => i + 1);
    setExerciseStep("preview");
    setSetsCompleted(0);
    setPhase("exercise");
  }

  async function handleSubmitSession() {
    if (effortScore === null || painAfter === null) return;
    if (completing || completed) return;

    setCompleting(true);
    setCompleteError("");

    const notes = encodeSessionCoachNotes({
      painBefore: null,
      safetyConcern: false,
      patientNote: patientNote.trim() || null,
    });

    try {
      const res = await fetch("/api/patient/session-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          sessionId,
          effortScore,
          painScore: painAfter,
          exercisesCompleted: total,
          notes,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as SessionCompleteResponse & {
        error?: string;
      };

      if (!res.ok) {
        throw new Error(
          body.error ?? `Session could not be saved (${res.status}). Please try again.`,
        );
      }

      setCompleted(true);
      setCompletionSummary({
        effortScore,
        painAfter,
        exercisesCompleted: total,
      });
      await refreshPlan();
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : shellUi.saveError);
      setCompleting(false);
    }
  }

  if (session.status === "completed" && !completed) {
    const completedLabel = session.completedAt
      ? new Date(session.completedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

    return (
      <GuidedSessionAlreadyCompleteScreen
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
        totalExercises={total}
        completedLabel={completedLabel}
      />
    );
  }

  if (completed && completionSummary) {
    return (
      <GuidedSessionCompleteScreen
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
        exercisesCompleted={completionSummary.exercisesCompleted}
        effortScore={completionSummary.effortScore}
        painAfter={completionSummary.painAfter}
        effortLabel={shellUi.effort}
        painLabel={shellUi.painAfterLabel}
      />
    );
  }

  if (completed) {
    return (
      <GuidedSessionCompleteScreen
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
        exercisesCompleted={total}
        effortScore={effortScore ?? 0}
        painAfter={painAfter ?? 0}
        effortLabel={shellUi.effort}
        painLabel={shellUi.painAfterLabel}
      />
    );
  }

  if (phase === "start" && total === 0) {
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
      >
        <p className="text-[14px] text-[#6B7280]">
          {patientLanguage === "ar"
            ? "لا توجد تمارين في هذه الجلسة بعد."
            : "No exercises in this session yet."}
        </p>
        <Link
          href={`/patient/${token}`}
          className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-[14px] bg-[#1D9E75] px-5 text-[15px] font-bold text-white"
        >
          {guidedUi.backToDashboard}
        </Link>
      </GuidedSessionShell>
    );
  }

  if (phase === "start" && firstExerciseView) {
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
      >
        <GuidedSessionStartScreen
          lang={patientLanguage}
          arClass={arClass}
          textDir={textDir}
          totalExercises={total}
          firstExerciseName={firstExerciseView.name}
          onBegin={handleBeginSession}
        />
      </GuidedSessionShell>
    );
  }

  if (phase === "rest" && nextExerciseView) {
    const restSeconds = currentView?.restSec ?? null;
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
        exerciseIndex={exerciseIndex}
        totalExercises={total}
        showProgress
      >
        <GuidedSessionRestScreen
          lang={patientLanguage}
          arClass={arClass}
          textDir={textDir}
          restSeconds={restSeconds}
          restPhaseKey={`${sessionId}-${exerciseIndex}`}
          nextExerciseName={nextExerciseView.name}
          nextExerciseIndex={exerciseIndex + 1}
          totalExercises={total}
          onContinue={handleRestContinue}
        />
      </GuidedSessionShell>
    );
  }

  if (phase === "wrapup") {
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
        exerciseIndex={total - 1}
        totalExercises={total}
        showProgress
      >
        <div className="space-y-6 pb-4">
          <div className="rounded-[20px] border border-[#D1E7DE] bg-[#F0FAF6] px-5 py-6 text-center">
            <p className="text-[18px] font-bold text-[#0A0F1A]">{flowUi.sessionWrapUpTitle}</p>
            <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
              {guidedUi.greatWork} {flowUi.takeYourTime}
            </p>
          </div>

          <PainScale
            label={shellUi.effortQuestion}
            value={effortScore}
            onChange={setEffortScore}
            min={1}
          />

          <PainScale label={shellUi.painAfter} value={painAfter} onChange={setPainAfter} />

          <div className="rounded-[16px] border border-[#E2E8E5] bg-white p-5">
            <label
              htmlFor="patient-note"
              className="mb-2 block text-[14px] font-semibold text-[#374151]"
            >
              {shellUi.optionalNoteLabel}
            </label>
            <textarea
              id="patient-note"
              value={patientNote}
              onChange={(e) => setPatientNote(e.target.value)}
              rows={3}
              placeholder={shellUi.optionalNotePlaceholder}
              className="w-full resize-none rounded-[10px] border border-[#E2E8E5] bg-[#F9FAFB] px-3 py-2.5 text-[14px] text-[#374151] placeholder:text-[#9CA3AF] focus:border-[#1D9E75]/50 focus:outline-none"
            />
          </div>

          {completeError && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[13px] text-rose-600">{completeError}</p>
            </div>
          )}

          {(effortScore === null || painAfter === null) && (
            <p className="text-center text-[12px] text-[#6B7280]">{shellUi.finishHint}</p>
          )}

          <button
            type="button"
            onClick={handleSubmitSession}
            disabled={effortScore === null || painAfter === null || completing}
            className={GUIDED_PRIMARY_BTN}
          >
            {completing ? shellUi.saving : shellUi.completeSession}
          </button>
        </div>
      </GuidedSessionShell>
    );
  }

  if (!currentView) {
    const exerciseUi = sessionExerciseUi(patientLanguage);
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
      >
        <p className="text-[13px] text-[#374151]">{exerciseUi.exerciseFallback}</p>
      </GuidedSessionShell>
    );
  }

  /**
   * Camera declined — the same stop state the catalog playback route shows, using the
   * same strings, so both routes behave identically no matter which one a session's
   * catalog provenance happens to select.
   *
   * "Try again" returns to the session start, matching the catalog route's own retry.
   * The step is reset alongside it because the Interactive Shoulder session renders
   * only at step "active": clearing it is what guarantees nothing is left initialising
   * a camera behind this screen.
   */
  if (cameraDeclined) {
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={session.title}
      >
        <div className={`space-y-6 ${arClass}`} dir={textDir}>
          <section className="rounded-[20px] border border-[#E2E8E5] bg-white p-5 shadow-[0_8px_30px_rgba(10,15,26,0.06)]">
            <p className="text-[18px] font-bold text-[#0A0F1A]">{guidedUi.cameraRequiredTitle}</p>
            <p className="mt-3 text-[13px] leading-relaxed text-[#6B7280]">
              {guidedUi.cameraRequiredBody}
            </p>
          </section>
          <button
            type="button"
            onClick={() => {
              setCameraDeclined(false);
              setExerciseStep("preview");
              setPhase("start");
            }}
            className={GUIDED_PRIMARY_BTN}
          >
            {guidedUi.cameraRequiredRetry}
          </button>
        </div>
      </GuidedSessionShell>
    );
  }

  return (
    <GuidedSessionShell
      lang={patientLanguage}
      arClass={arClass}
      textDir={textDir}
      token={token}
      sessionTitle={session.title}
      exerciseIndex={exerciseIndex}
      totalExercises={total}
      showProgress
    >
      <GuidedSessionExerciseHero
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        exerciseIndex={exerciseIndex}
        total={total}
        view={currentView}
      />

      <p className={`rounded-[12px] border border-[#D1E7DE] bg-[#F0FAF6] px-4 py-3 text-[12px] leading-relaxed text-[#374151] ${arClass}`}>
        {sessionExerciseUi(patientLanguage).safetyBanner}
      </p>

      <PatientExerciseSessionCard
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        isArabic={isArabic}
        exerciseIndex={exerciseIndex}
        totalExercises={total}
        view={currentView}
        step={exerciseStep}
        setsCompleted={setsCompleted}
        prescribedSide={session.prescribedSide}
        onStartExercise={handleStartExercise}
        onCompleteSet={handleCompleteSet}
        onCompleteExercise={handleCompleteExercise}
        onCvMetricsUpdate={onMetricsUpdate}
        onCvSkipped={handleCvSkipped}
        onRegisterCvMetricsFlush={registerMetricsFlush}
        onRegisterStsPilotBeforeSave={registerStsPilotBeforeSave}
        onRegisterStsPilotRecordFlush={registerStsPilotRecordFlush}
        onRegisterCaptureConsent={registerCaptureConsentGetter}
        showTopProgress={false}
      />

      {exerciseStep === "done" && cvSaveNotice && (
        <p
          className={`rounded-[12px] border border-[#D1E7DE] bg-[#F0FAF6] px-4 py-3 text-center text-[13px] leading-relaxed text-[#374151] ${arClass}`}
          role="status"
        >
          {cvSaveNotice}
        </p>
      )}

      {exerciseStep === "done" && (
        <button type="button" onClick={handleProceedFromExercise} className={GUIDED_PRIMARY_BTN}>
          {!isLast ? guidedUi.proceedToRest : guidedUi.proceedToFinish}
        </button>
      )}

      <p className={`pb-2 text-center text-[11px] italic text-[#9CA3AF] ${arClass}`}>
        {focusUi.exerciseSafetyReminder}
      </p>
    </GuidedSessionShell>
  );
}
