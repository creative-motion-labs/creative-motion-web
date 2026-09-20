"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PatientSession } from "@/app/api/patient/plan/route";
import { CatalogSessionPlayer } from "@/app/components/patient/interactive-shoulder/CatalogSessionPlayer";
import {
  GUIDED_PRIMARY_BTN,
  GuidedSessionAlreadyCompleteScreen,
  GuidedSessionCompleteScreen,
  GuidedSessionShell,
} from "@/app/components/patient/session/PatientGuidedSessionFlow";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import { encodeSessionCoachNotes } from "@/app/lib/session-coach-metadata";
import {
  submitPatientSessionComplete,
} from "@/app/lib/patient-portal/catalog-session-playback";
import {
  shouldSubmitInteractiveShoulderOutcome,
  submitInteractiveShoulderOutcome,
} from "@/app/lib/patient-portal/interactive-shoulder-outcome-submission";
import type { InteractiveShoulderSessionCompletionSnapshot } from "@/app/lib/interactive-shoulder/orchestrator-cv-session-types";
import {
  guidedSessionUi,
  sessionExerciseFlowUi,
  sessionShellUi,
} from "@/app/lib/patient-portal-ui";
import { resolveCatalogSessionDisplay } from "@/app/lib/interactive-shoulder/resolve-catalog-session-display";

type CatalogPhase = "start" | "playback" | "cameraDeclined" | "wrapup";

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
            className={`flex h-[48px] min-w-[44px] flex-1 items-center justify-center rounded-[10px] border text-[13px] font-semibold transition ${
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

export function CatalogPatientSessionPlayback({
  token,
  session,
  patientLanguage,
  textDir,
  arClass,
  onPlanRefresh,
}: {
  token: string;
  session: PatientSession;
  patientLanguage: PatientExerciseLanguage;
  textDir: "ltr" | "rtl";
  arClass: string;
  onPlanRefresh: () => Promise<boolean | void>;
}) {
  const [phase, setPhase] = useState<CatalogPhase>("start");
  const [effortScore, setEffortScore] = useState<number | null>(null);
  const [painAfter, setPainAfter] = useState<number | null>(null);
  const [patientNote, setPatientNote] = useState("");
  const [completing, setCompleting] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<{
    effortScore: number;
    painAfter: number;
  } | null>(null);
  const cvSessionCompleteRef = useRef(false);
  const submitStartedRef = useRef(false);
  /**
   * Independent of cvSessionCompleteRef/submitStartedRef above — the
   * clinical movement-outcome submission (O2) and the patient-reported
   * completion submission must never gate, overwrite, or impersonate
   * each other. "submitted" is set only on a genuine success or an
   * idempotent-replay response from the server; a failure leaves it at
   * "idle" so a future call (not built in this slice) could safely
   * retry without ever double-submitting a success.
   */
  const movementOutcomeSubmissionRef = useRef<"idle" | "submitting" | "submitted">("idle");

  const shellUi = sessionShellUi(patientLanguage);
  const guidedUi = guidedSessionUi(patientLanguage);
  const flowUi = sessionExerciseFlowUi(patientLanguage);
  const catalogSession = session.catalogSession ?? null;
  const sessionDisplay = resolveCatalogSessionDisplay(
    patientLanguage,
    catalogSession?.id,
    session.title,
    catalogSession?.goal,
  );

  // Reset-on-prop-change effect, matching the established suppression
  // convention already used elsewhere in this codebase for this exact
  // rule (e.g. app/clinician/motor-screen-lab/page.tsx) — pre-existing
  // pattern, unrelated to the O2 addition below beyond the one new ref reset.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPhase("start");
    setEffortScore(null);
    setPainAfter(null);
    setPatientNote("");
    setCompleting(false);
    setSaveFailed(false);
    setCompleted(false);
    setCompletionSummary(null);
    cvSessionCompleteRef.current = false;
    submitStartedRef.current = false;
    movementOutcomeSubmissionRef.current = "idle";
  }, [token, session.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Interactive Shoulder is camera-dependent — there is no non-camera
   * fallback experience. Declining camera consent must not leave the
   * "Skip camera" button silently doing nothing (it previously had no
   * `onSkipped` handler at all): show a clear, honest stop state instead.
   * "Try again" simply returns to "start", which re-mounts
   * CatalogSessionPlayer fresh on the next Begin click, giving the
   * patient another chance at the consent screen.
   */
  const handleCameraSkipped = useCallback(() => {
    setPhase("cameraDeclined");
  }, []);

  const handleCatalogSessionComplete = useCallback(
    (snapshot: InteractiveShoulderSessionCompletionSnapshot) => {
      if (cvSessionCompleteRef.current) return;
      cvSessionCompleteRef.current = true;
      setPhase("wrapup");

      // Fire-and-forget, independent of the patient-reported completion
      // flow below: this never blocks or gates the wrap-up UI, and the
      // wrap-up UI never waits on or reflects this submission's outcome.
      // A poor network connection or a disabled feature flag must not
      // interrupt the patient's own session-complete flow.
      if (shouldSubmitInteractiveShoulderOutcome(movementOutcomeSubmissionRef.current)) {
        movementOutcomeSubmissionRef.current = "submitting";
        void submitInteractiveShoulderOutcome({
          token,
          planSessionId: session.id,
          snapshot,
        }).then((result) => {
          movementOutcomeSubmissionRef.current = result.ok ? "submitted" : "idle";
        });
      }
    },
    [token, session.id],
  );

  const handleSubmitSession = useCallback(async () => {
    if (effortScore === null || painAfter === null) return;
    if (completing || completed || submitStartedRef.current) return;

    submitStartedRef.current = true;
    setCompleting(true);
    setSaveFailed(false);

    const notes = encodeSessionCoachNotes({
      painBefore: null,
      safetyConcern: false,
      patientNote: patientNote.trim() || null,
    });

    try {
      const result = await submitPatientSessionComplete({
        token,
        sessionId: session.id,
        effortScore,
        painScore: painAfter,
        exercisesCompleted: 0,
        notes,
      });

      if (!result.ok) {
        setSaveFailed(true);
        setCompleting(false);
        submitStartedRef.current = false;
        return;
      }

      setCompleted(true);
      setCompletionSummary({ effortScore, painAfter });
      await onPlanRefresh();
    } catch {
      setSaveFailed(true);
      setCompleting(false);
      submitStartedRef.current = false;
    }
  }, [
    completed,
    completing,
    effortScore,
    onPlanRefresh,
    painAfter,
    patientNote,
    session.id,
    token,
  ]);

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
        sessionTitle={sessionDisplay.title}
        totalExercises={0}
        completedLabel={completedLabel}
        hideExerciseCount
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
        sessionTitle={sessionDisplay.title}
        exercisesCompleted={0}
        effortScore={completionSummary.effortScore}
        painAfter={completionSummary.painAfter}
        effortLabel={shellUi.effort}
        painLabel={shellUi.painAfterLabel}
        hideExerciseCount
      />
    );
  }

  if (phase === "start") {
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={sessionDisplay.title}
      >
        <div className={`space-y-6 ${arClass}`} dir={textDir}>
          <section className="rounded-[20px] border border-[#E2E8E5] bg-white p-5 shadow-[0_8px_30px_rgba(10,15,26,0.06)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]">
              {guidedUi.startEyebrow}
            </p>
            {sessionDisplay.goal ? (
              <p className="mt-3 text-[14px] leading-relaxed text-[#6B7280]">{sessionDisplay.goal}</p>
            ) : (
              <p className="mt-3 text-[14px] leading-relaxed text-[#6B7280]">
                {flowUi.sessionOverviewBody}
              </p>
            )}
          </section>
          <p className="text-center text-[12px] leading-relaxed text-[#6B7280]">
            {guidedUi.safetyReminder}
          </p>
          <button
            type="button"
            onClick={() => setPhase("playback")}
            className={GUIDED_PRIMARY_BTN}
          >
            {guidedUi.beginSession}
          </button>
        </div>
      </GuidedSessionShell>
    );
  }

  if (phase === "cameraDeclined") {
    return (
      <GuidedSessionShell
        lang={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        token={token}
        sessionTitle={sessionDisplay.title}
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
            onClick={() => setPhase("start")}
            className={GUIDED_PRIMARY_BTN}
          >
            {guidedUi.cameraRequiredRetry}
          </button>
        </div>
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
        sessionTitle={sessionDisplay.title}
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
              htmlFor="catalog-patient-note"
              className="mb-2 block text-[14px] font-semibold text-[#374151]"
            >
              {shellUi.optionalNoteLabel}
            </label>
            <textarea
              id="catalog-patient-note"
              value={patientNote}
              onChange={(e) => setPatientNote(e.target.value)}
              rows={3}
              placeholder={shellUi.optionalNotePlaceholder}
              className="w-full resize-none rounded-[10px] border border-[#E2E8E5] bg-[#F9FAFB] px-3 py-2.5 text-[14px] text-[#374151] placeholder:text-[#9CA3AF] focus:border-[#1D9E75]/50 focus:outline-none"
            />
          </div>

          {saveFailed ? (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[13px] text-rose-600">{shellUi.saveError}</p>
            </div>
          ) : null}

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

  return (
    <GuidedSessionShell
      lang={patientLanguage}
      arClass={arClass}
      textDir={textDir}
      token={token}
      sessionTitle={sessionDisplay.title}
    >
      <CatalogSessionPlayer
        key={`${session.id}:${session.prescribedSide ?? "none"}`}
        programSession={catalogSession}
        language={patientLanguage}
        arClass={arClass}
        textDir={textDir}
        prescribedSide={session.prescribedSide}
        clinicalPrescribedSideRequired
        onSessionComplete={handleCatalogSessionComplete}
        onSkipped={handleCameraSkipped}
      />
    </GuidedSessionShell>
  );
}
