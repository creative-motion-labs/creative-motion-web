"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { ResolvedExerciseView } from "@/app/lib/exercise-resolve";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import {
  formatExerciseProgress,
  guidedSessionUi,
  sessionExerciseFlowUi,
} from "@/app/lib/patient-portal-ui";
import { PatientSessionProgressStrip } from "@/app/components/patient/PatientExerciseSessionCard";

const CARD_SHADOW = "shadow-[0_8px_30px_rgba(10,15,26,0.06)]";

export const GUIDED_PRIMARY_BTN =
  "flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-[#1D9E75] text-[16px] font-bold text-white shadow-[0_10px_24px_rgba(29,158,117,0.35)] transition hover:bg-[#179165] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";

export const GUIDED_SECONDARY_BTN =
  "flex min-h-[48px] w-full items-center justify-center rounded-[14px] border border-[#E2E8E5] bg-white text-[15px] font-semibold text-[#374151] transition hover:bg-[#F9FAFB]";

type ShellProps = {
  lang: PatientExerciseLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  token: string;
  sessionTitle: string;
  children: ReactNode;
  exerciseIndex?: number;
  totalExercises?: number;
  showProgress?: boolean;
  footer?: ReactNode;
};

export function GuidedSessionShell({
  lang,
  arClass,
  textDir,
  token,
  sessionTitle,
  children,
  exerciseIndex,
  totalExercises,
  showProgress = false,
  footer,
}: ShellProps) {
  const ui = guidedSessionUi(lang);

  return (
    <div className={`space-y-6 pb-10 ${arClass}`} dir={textDir} lang={lang}>
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/patient/${token}`}
          className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-[#9CA3AF] transition hover:text-[#374151]"
        >
          {ui.backToDashboard}
        </Link>
      </div>

      <div>
        <h1
          className="text-[20px] font-bold leading-snug text-[#0A0F1A]"
        >
          {sessionTitle}
        </h1>
      </div>

      {showProgress &&
        exerciseIndex != null &&
        totalExercises != null &&
        totalExercises > 0 && (
          <PatientSessionProgressStrip
            lang={lang}
            exerciseIndex={exerciseIndex}
            total={totalExercises}
          />
        )}

      {children}

      {footer ? <div className="pt-2">{footer}</div> : null}
    </div>
  );
}

export function GuidedSessionStartScreen({
  lang,
  arClass,
  textDir,
  totalExercises,
  firstExerciseName,
  onBegin,
}: {
  lang: PatientExerciseLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  totalExercises: number;
  firstExerciseName: string;
  onBegin: () => void;
}) {
  const ui = guidedSessionUi(lang);
  const flowUi = sessionExerciseFlowUi(lang);

  return (
    <div className={`space-y-6 ${arClass}`} dir={textDir}>
      <section
        className={`-mx-2 overflow-hidden rounded-[24px] bg-gradient-to-br from-[#071612] via-[#0C3D32] to-[#1D9E75] px-6 py-8 text-white ${CARD_SHADOW}`}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
          {ui.startEyebrow}
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-white/90">{ui.startSubtitle}</p>
        <p className="mt-4 text-[13px] font-semibold text-[#B8F5DF]">
          {ui.exercisesReady(totalExercises)}
        </p>
      </section>

      <section className={`rounded-[20px] border border-[#E2E8E5] bg-white p-5 ${CARD_SHADOW}`}>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]">
          {ui.firstUpLabel}
        </p>
        <p className="mt-2 text-[18px] font-bold text-[#0A0F1A]">{firstExerciseName}</p>
        <p className="mt-3 text-[13px] leading-relaxed text-[#6B7280]">
          {flowUi.sessionOverviewBody}
        </p>
      </section>

      <p className="text-center text-[12px] leading-relaxed text-[#6B7280]">{ui.safetyReminder}</p>

      <button type="button" onClick={onBegin} className={GUIDED_PRIMARY_BTN}>
        {ui.beginSession}
      </button>
    </div>
  );
}

export function GuidedSessionExerciseHero({
  lang,
  arClass,
  textDir,
  exerciseIndex,
  total,
  view,
}: {
  lang: PatientExerciseLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  exerciseIndex: number;
  total: number;
  view: ResolvedExerciseView;
}) {
  const ui = guidedSessionUi(lang);
  const flowUi = sessionExerciseFlowUi(lang);

  const doseValue = (v: number | string | undefined) =>
    v != null && String(v).trim() !== "" ? String(v) : flowUi.doseNotSet;

  const durationDisplay =
    view.durationSec != null
      ? flowUi.durationSeconds(view.durationSec)
      : flowUi.doseNotSet;

  const stats = [
    { label: flowUi.doseSets, value: doseValue(view.sets) },
    { label: flowUi.doseReps, value: doseValue(view.reps) },
    { label: flowUi.doseDuration, value: durationDisplay },
  ].filter((item) => item.value !== flowUi.doseNotSet);

  return (
    <section
      className={`space-y-4 rounded-[20px] border border-[#E2E8E5] bg-white p-5 ${CARD_SHADOW} ${arClass}`}
      dir={textDir}
    >
      <div className="rounded-[12px] bg-[#0A0F1A] px-4 py-2.5 text-center">
        <p className="text-[13px] font-bold tracking-wide text-white">
          {formatExerciseProgress(lang, exerciseIndex + 1, total)}
        </p>
      </div>

      <div>
        <h2
          className="text-[22px] font-bold leading-snug text-[#0A0F1A]"
        >
          {view.name}
        </h2>
        {view.doseLabel ? (
          <p
            className="mt-1.5 text-[13px] font-semibold text-[#1D9E75]"
            style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
          >
            {view.doseLabel}
          </p>
        ) : null}
      </div>

      {stats.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {stats.map((item) => (
            <div
              key={item.label}
              className="rounded-[10px] bg-[#F8FAF9] px-2.5 py-2 text-center"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                {item.label}
              </p>
              <p
                className="mt-0.5 text-[15px] font-bold text-[#0A0F1A]"
                style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-[12px] border border-[#D1E7DE] bg-[#F0FAF6] px-4 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#1D9E75]">
          {ui.yourInstructions}
        </p>
        <p className="mt-2 text-[14px] leading-relaxed text-[#374151]">
          {view.patientInstructions}
        </p>
      </div>
    </section>
  );
}

export function GuidedSessionRestScreen({
  lang,
  arClass,
  textDir,
  restSeconds,
  restPhaseKey,
  nextExerciseName,
  nextExerciseIndex,
  totalExercises,
  onContinue,
}: {
  lang: PatientExerciseLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  restSeconds: number | null;
  /** Resets countdown when entering a new rest step */
  restPhaseKey: string;
  nextExerciseName: string;
  nextExerciseIndex: number;
  totalExercises: number;
  onContinue: () => void;
}) {
  const ui = guidedSessionUi(lang);
  const hasCountdown = restSeconds != null && restSeconds > 0;
  const [secondsLeft, setSecondsLeft] = useState(() =>
    hasCountdown ? Math.max(0, Math.floor(restSeconds!)) : 0,
  );

  useEffect(() => {
    if (!hasCountdown) {
      setSecondsLeft(0);
      return;
    }

    const start = Math.max(0, Math.floor(restSeconds!));
    setSecondsLeft(start);

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current <= 0 ? 0 : current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [hasCountdown, restSeconds, restPhaseKey]);

  return (
    <div className={`space-y-6 ${arClass}`} dir={textDir}>
      <section
        className={`rounded-[24px] border border-[#D1E7DE] bg-gradient-to-br from-[#F0FAF6] to-white px-6 py-8 text-center ${CARD_SHADOW}`}
      >
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#E8F8F2] text-[28px]"
          aria-hidden
        >
          ☕
        </div>
        <h2
          className="mt-4 text-[24px] font-bold text-[#0A0F1A]"
        >
          {ui.restTitle}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[#6B7280]">{ui.restSubtitle}</p>

        {hasCountdown ? (
          <div className="mt-5" aria-live="polite" aria-atomic="true">
            {secondsLeft > 0 ? (
              <p
                className="text-[40px] font-bold leading-tight text-[#1D9E75]"
              >
                {ui.restCountdownSeconds(secondsLeft)}
              </p>
            ) : (
              <p className="text-[18px] font-semibold text-[#1D9E75]">{ui.restReadyForNext}</p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[14px] font-semibold text-[#1D9E75]">{ui.restDefaultHint}</p>
        )}

        <p className="mt-3 text-[13px] text-[#9CA3AF]">{ui.restTakeYourTime}</p>
      </section>

      <section
        className={`rounded-[20px] border-2 border-[#D1E7DE] bg-white p-5 ${CARD_SHADOW}`}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">
          {ui.nextExercisePreview}
        </p>
        <p className="mt-1.5 text-[12px] font-semibold text-[#1D9E75]">
          {formatExerciseProgress(lang, nextExerciseIndex + 1, totalExercises)}
        </p>
        <p className="mt-2 text-[20px] font-bold leading-snug text-[#0A0F1A]">
          {nextExerciseName}
        </p>
      </section>

      <button type="button" onClick={onContinue} className={GUIDED_PRIMARY_BTN}>
        {ui.continueToNext}
      </button>
    </div>
  );
}

export function GuidedSessionCompleteScreen({
  lang,
  arClass,
  textDir,
  token,
  sessionTitle,
  exercisesCompleted,
  effortScore,
  painAfter,
  effortLabel,
  painLabel,
  onViewProgress,
  hideExerciseCount = false,
}: {
  lang: PatientExerciseLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  token: string;
  sessionTitle: string;
  exercisesCompleted: number;
  effortScore: number;
  painAfter: number;
  effortLabel: string;
  painLabel: string;
  onViewProgress?: boolean;
  hideExerciseCount?: boolean;
}) {
  const ui = guidedSessionUi(lang);

  return (
    <div
      className={`flex min-h-[60vh] flex-col items-center justify-center gap-6 px-2 pb-10 text-center ${arClass}`}
      dir={textDir}
    >
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#E8F8F2] to-[#B8F5DF] text-[32px] text-[#1D9E75] shadow-[0_8px_24px_rgba(29,158,117,0.2)]"
        aria-hidden
      >
        ✓
      </div>

      <div className="max-w-sm">
        <h2
          className="text-[28px] font-bold text-[#0A0F1A]"
        >
          {ui.sessionCompleteTitle}
        </h2>
        <p className="mt-2 text-[16px] font-semibold text-[#374151]">{sessionTitle}</p>
        <p className="mt-3 text-[15px] text-[#6B7280]">{ui.greatWork}</p>

        <div className="mt-5 rounded-[16px] border border-[#D1E7DE] bg-[#F0FAF6] px-5 py-4">
          {!hideExerciseCount ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]">
              {ui.exercisesCompletedCount(exercisesCompleted)}
            </p>
          ) : null}
          <p className={`text-[13px] text-[#6B7280] ${hideExerciseCount ? "" : "mt-1"}`}>
            {ui.sessionCompleteBody}
          </p>
        </div>

        <div className="mx-auto mt-4 grid max-w-xs grid-cols-2 gap-2">
          <div className="rounded-[12px] border border-[#E2E8E5] bg-white px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
              {effortLabel}
            </p>
            <p className="mt-0.5 text-[16px] font-bold text-[#374151]">{effortScore}/10</p>
          </div>
          <div className="rounded-[12px] border border-[#E2E8E5] bg-white px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
              {painLabel}
            </p>
            <p className="mt-0.5 text-[16px] font-bold text-[#374151]">{painAfter}/10</p>
          </div>
        </div>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Link href={`/patient/${token}`} className={GUIDED_PRIMARY_BTN}>
          {ui.backToDashboard}
        </Link>
        {onViewProgress !== false && (
          <Link href={`/patient/${token}/progress`} className={GUIDED_SECONDARY_BTN}>
            {ui.viewProgress}
          </Link>
        )}
      </div>
    </div>
  );
}

export function GuidedSessionAlreadyCompleteScreen({
  lang,
  arClass,
  textDir,
  token,
  sessionTitle,
  totalExercises,
  completedLabel,
  hideExerciseCount = false,
}: {
  lang: PatientExerciseLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  token: string;
  sessionTitle: string;
  totalExercises: number;
  completedLabel: string | null;
  hideExerciseCount?: boolean;
}) {
  const ui = guidedSessionUi(lang);

  return (
    <div
      className={`flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 pb-10 text-center ${arClass}`}
      dir={textDir}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E8F5F1] text-[28px] text-[#1D9E75]">
        ✓
      </div>
      <div>
        <h2 className="text-[24px] font-bold text-[#0A0F1A]">{ui.sessionCompleteTitle}</h2>
        <p className="mt-2 text-[16px] font-semibold text-[#374151]">{sessionTitle}</p>
        <p className="mt-3 text-[14px] text-[#6B7280]">
          {!hideExerciseCount ? ui.exercisesCompletedCount(totalExercises) : null}
          {!hideExerciseCount && completedLabel ? " · " : null}
          {completedLabel ?? ""}
        </p>
      </div>
      <Link href={`/patient/${token}`} className={`${GUIDED_PRIMARY_BTN} max-w-xs`}>
        {ui.backToDashboard}
      </Link>
    </div>
  );
}

export type { ResolvedExerciseView };
