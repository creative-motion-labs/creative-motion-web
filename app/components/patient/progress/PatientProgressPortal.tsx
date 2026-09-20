"use client";

import Link from "next/link";
import type { PatientPlanData } from "@/app/api/patient/plan/route";
import type { SessionLogEntry } from "@/app/api/patient/logs/route";
import {
  buildPatientProgressPortalView,
  friendlyEffortLabel,
  type PatientProgressPortalView,
} from "@/app/lib/patient-progress-portal";
import { computeMotivationStats } from "@/app/lib/patient-motivation";
import {
  formatPortalDate,
  progressPortalV1Ui,
  type PatientPortalLanguage,
} from "@/app/lib/patient-portal-ui";
import { PatientLifetimeSummaryCard } from "@/app/components/patient/PatientLifetimeSummaryCard";
import { InteractiveShoulderPatientProgressCharts } from "@/app/components/patient/progress/InteractiveShoulderPatientProgressCharts";

type PatientProgressPortalProps = {
  plan: PatientPlanData;
  logs: SessionLogEntry[];
  token: string;
  lang: PatientPortalLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
};

function progressLabel(
  view: PatientProgressPortalView,
  ui: ReturnType<typeof progressPortalV1Ui>,
): string {
  return view.programKind === "move_better"
    ? ui.performanceProgress
    : ui.recoveryProgress;
}

export function PatientProgressPortal({
  plan,
  logs,
  token,
  lang,
  arClass,
  textDir,
}: PatientProgressPortalProps) {
  const ui = progressPortalV1Ui(lang);
  const stats = computeMotivationStats(plan.sessions, logs);
  const view = buildPatientProgressPortalView(plan, logs, stats, lang);
  const firstName = plan.patientName.split(" ")[0] || plan.patientName;
  const programLabel = progressLabel(view, ui);
  const friendlyGoal = plan.patientFriendlyGoal?.trim() || plan.patientRehabFocus?.trim();

  return (
    <div className={`space-y-5 ${arClass}`} dir={textDir}>
      {/* 1 — Progress Hero */}
      <section className="overflow-hidden rounded-[12px] border border-[#D1E7DE] bg-gradient-to-br from-[#F0FAF6] to-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]">
          {ui.pageTitle}
        </p>
        <h1 className="rasq-page-title mt-2 text-[#0A0F1A]">
          {ui.progressHeroGreeting(firstName)}
        </h1>
        <p className="mt-1 text-[14px] font-semibold text-[#374151]">
          {plan.planTitle || plan.programName}
        </p>
        <p className="mt-3 text-[12px] text-[#6B7280]">{ui.pageSubtitle}</p>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[#374151]">{programLabel}</span>
            <span className="font-data text-[12px] font-bold text-[#1D9E75]">
              {view.progressPercent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8E5]">
            <div
              className="h-full rounded-full bg-[#1D9E75] transition-all"
              style={{ width: `${view.progressPercent}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[#9CA3AF]">
            {view.completedSessions}/{view.totalSessions} {ui.sessionsStat.toLowerCase()}
            {view.currentWeek != null && view.totalWeeks != null
              ? ` · ${ui.weekOfProgram(view.currentWeek, view.totalWeeks)}`
              : null}
          </p>
        </div>
      </section>

      <PatientLifetimeSummaryCard
        summary={plan.lifetimeSummary}
        lang={lang}
        textDir={textDir}
        arClass={arClass}
      />

      <InteractiveShoulderPatientProgressCharts token={token} />

      {/* 2 — Quick Stats */}
      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
          {ui.quickStatsTitle}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: ui.sessionsStat,
              value: `${view.completedSessions}/${view.totalSessions}`,
            },
            {
              label: ui.completionStat,
              value: `${view.progressPercent}%`,
            },
            {
              label: ui.activeDaysStat,
              value: String(view.activeDaysLast7),
            },
            {
              label: ui.effortStat,
              value:
                view.averageEffort != null
                  ? friendlyEffortLabel(Math.round(view.averageEffort), lang)
                  : ui.effortNotYet,
              small: true,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-[8px] border border-[#E2E8E5] bg-[#F9FAFB] px-3 py-2.5"
            >
              <p
                className={`font-bold text-[#1D9E75] ${
                  stat.small ? "text-[13px]" : "font-data text-[18px]"
                }`}
              >
                {stat.value}
              </p>
              <p className="mt-0.5 text-[10px] font-semibold text-[#6B7280]">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3 — Active Program Card */}
      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#1D9E75]">
          {ui.activeProgramTitle}
        </p>
        <p className="mt-2 text-[16px] font-bold text-[#0A0F1A]">
          {plan.planTitle || plan.programName}
        </p>
        {friendlyGoal ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[#374151]">{friendlyGoal}</p>
        ) : null}
        <p className="mt-2 text-[12px] text-[#6B7280]">{ui.activeProgramSubtitle}</p>
        {view.nextSession ? (
          <div className="mt-4 rounded-[8px] border border-[#D1E7DE] bg-[#F0FAF6] px-3.5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#1D9E75]">
              {ui.nextSessionLabel}
            </p>
            <p className="mt-1 text-[14px] font-semibold text-[#0A0F1A]">
              {view.nextSession.title}
            </p>
            <Link
              href={`/patient/${token}/session/${view.nextSession.id}`}
              className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-[7px] bg-[#1D9E75] px-4 text-[14px] font-semibold text-white transition hover:bg-[#179165]"
            >
              {ui.startNextSession}
            </Link>
          </div>
        ) : null}
      </section>

      {/* 4 — Exercise Highlights */}
      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
          {ui.exerciseHighlightsTitle}
        </p>
        {view.exerciseHighlights.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6B7280]">{ui.exerciseHighlightsEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {view.exerciseHighlights.map((item) => (
              <li
                key={item.exerciseId}
                className="flex items-center justify-between gap-3 rounded-[8px] border border-[#E2E8E5] bg-[#F9FAFB] px-3.5 py-2.5"
              >
                <span className="text-[14px] font-semibold text-[#374151]">{item.name}</span>
                <span className="text-[11px] font-medium text-[#6B7280]">
                  {ui.practicedInSessions(item.sessionCount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5 — Achievements */}
      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
          {ui.achievementsTitle}
        </p>
        <p className="mt-1 text-[12px] text-[#6B7280]">{ui.achievementsSubtitle}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {view.achievements.map((badge) => (
            <span
              key={badge.id}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                badge.earned
                  ? "border border-[#D1E7DE] bg-[#F0FAF6] text-[#1D9E75]"
                  : "border border-[#E2E8E5] bg-[#F9FAFB] text-[#9CA3AF]"
              }`}
              title={badge.earned ? undefined : ui.achievementLocked}
            >
              {badge.earned ? "✓ " : ""}
              {badge.title}
            </span>
          ))}
        </div>
      </section>

      {/* 6 — Recent Sessions */}
      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
          {ui.recentSessionsTitle}
        </p>
        {view.recentSessions.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6B7280]">{ui.recentSessionsEmpty}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {view.recentSessions.map((row) => (
              <div
                key={row.sessionId}
                className="rounded-[8px] border border-[#E2E8E5] bg-[#F9FAFB] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold text-[#374151]">{row.title}</p>
                    {row.completedAt ? (
                      <p className="mt-1 text-[11px] text-[#9CA3AF]">
                        {formatPortalDate(row.completedAt, lang)}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-[#E8F5F1] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D9E75]">
                    ✓
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {row.comfortLabel ? (
                    <div className="rounded-[6px] border border-[#E2E8E5] bg-white px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                        {ui.howYouFelt}
                      </p>
                      <p className="mt-0.5 text-[13px] font-medium text-[#374151]">
                        {row.comfortLabel}
                      </p>
                    </div>
                  ) : null}
                  {row.effortLabel ? (
                    <div className="rounded-[6px] border border-[#E2E8E5] bg-white px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                        {ui.yourEffort}
                      </p>
                      <p className="mt-0.5 text-[13px] font-medium text-[#374151]">
                        {row.effortLabel}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="rounded-[8px] border border-[#E2E8E5] bg-[#F9FAFB] px-3.5 py-3 text-[12px] leading-relaxed text-[#6B7280]">
        {ui.safetyFooter}
      </p>
    </div>
  );
}
