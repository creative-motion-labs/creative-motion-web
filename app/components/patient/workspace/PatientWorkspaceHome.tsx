"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PatientPlanData } from "@/app/api/patient/plan/route";
import type { SessionLogEntry } from "@/app/api/patient/logs/route";
import { friendlyEffortLabel } from "@/app/lib/patient-progress-portal";
import {
  resolvePatientHomeProgramTitle,
  resolvePatientHomeRehabFocus,
  resolvePatientHomeSessionDisplay,
  shouldShowPatientHomeExerciseCount,
} from "@/app/lib/patient-portal/resolve-patient-home-display";
import { buildWorkspaceHomePreview } from "@/app/lib/patient-workspace";
import {
  formatPortalDate,
  getPortalGreeting,
  workspaceUi,
  type PatientPortalLanguage,
} from "@/app/lib/patient-portal-ui";
import type { PatientMovementCheckView } from "@/app/lib/patient-movement-check";
import { PatientMovementCheckCard } from "@/app/components/patient/workspace/PatientMovementCheckCard";
import { PatientLifetimeSummaryCard } from "@/app/components/patient/PatientLifetimeSummaryCard";
import { PatientHomeProgressChartPreview } from "@/app/components/patient/workspace/PatientHomeProgressChartPreview";

type Props = {
  plan: PatientPlanData;
  logs: SessionLogEntry[];
  token: string;
  lang: PatientPortalLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
  movementCheck: PatientMovementCheckView | null;
};

const CARD_SHELL =
  "rounded-[16px] border border-[#E2E8E5] bg-white shadow-[0_1px_3px_rgba(10,15,26,0.04)]";
const CARD = `${CARD_SHELL} p-5`;
const CARD_ACCENT =
  "rounded-[16px] border-2 border-[#1D9E75]/25 bg-white p-5 shadow-[0_4px_20px_rgba(29,158,117,0.08)]";
const HOME_WIDTH = "mx-auto w-full max-w-2xl lg:max-w-3xl";
const EYEBROW_ACCENT = "rasq-eyebrow text-[#1D9E75]";
const EYEBROW_META = "rasq-eyebrow text-[#6B7280]";

export function PatientWorkspaceHome({
  plan,
  logs,
  token,
  lang,
  arClass,
  textDir,
  movementCheck,
}: Props) {
  const ui = workspaceUi(lang);
  const preview = buildWorkspaceHomePreview(plan, logs, lang);
  const firstName = plan.patientName.split(" ")[0] || plan.patientName;
  const programName = resolvePatientHomeProgramTitle(plan, lang);
  const isPerformance = preview.programKind === "move_better";
  const homeTitle = isPerformance ? ui.performanceHome : ui.recoveryHome;
  const heroTagline = isPerformance ? ui.heroPerformanceTagline : ui.heroRecoveryTagline;
  const canStart =
    preview.stats.todayStatus === "ready" && preview.stats.nextSessionId != null;
  const sessionsRemaining = Math.max(preview.totalCount - preview.completedCount, 0);
  const nextSessionDisplay = preview.nextSession
    ? resolvePatientHomeSessionDisplay(preview.nextSession, plan, lang)
    : null;

  if (preview.totalCount === 0) {
    return (
      <div className={`${HOME_WIDTH} space-y-5 ${arClass}`} dir={textDir}>
        <HeroEmpty
          homeTitle={homeTitle}
          greeting={`${getPortalGreeting(lang)}, ${firstName}`}
          tagline={heroTagline}
        />
        <section className={`${CARD} text-center`}>
          <p className="rasq-card-title text-[#0A0F1A]">{ui.preparingSchedule}</p>
          <p className="rasq-body mt-2 text-[#6B7280]">{ui.noSessionsYet}</p>
        </section>
        <PatientLifetimeSummaryCard
          summary={plan.lifetimeSummary}
          lang={lang}
          textDir={textDir}
          arClass={arClass}
        />
        {plan.assignedBy ? (
          <ProviderCard assignedBy={plan.assignedBy} program={programName} ui={ui} />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${HOME_WIDTH} space-y-5 ${arClass}`} dir={textDir}>
      <HeroSection
        homeTitle={homeTitle}
        greeting={ui.homeGreeting(firstName)}
        tagline={heroTagline}
        programName={programName}
        progressPercent={preview.progressPercent}
        completedCount={preview.completedCount}
        totalCount={preview.totalCount}
        progressLabel={ui.programProgressLabel}
        sessionsLeftLabel={ui.sessionsLeft(sessionsRemaining)}
      />

      {preview.nextSession && nextSessionDisplay ? (
        <NextSessionCard
          sessionLabel={
            preview.stats.todayStatus === "completed_today"
              ? ui.todaySession
              : ui.nextSession
          }
          title={nextSessionDisplay.title}
          context={nextSessionDisplay.context}
          durationLabel={nextSessionDisplay.durationLabel}
          exerciseCountLabel={
            shouldShowPatientHomeExerciseCount(preview.nextSession)
              ? ui.exerciseCountLabel(preview.nextSession.exercises.length)
              : null
          }
          statusLabel={
            canStart ? ui.nextSessionStatusReady : ui.nextSessionStatusDoneToday
          }
          therapistContextLabel={ui.nextSessionTherapistContext}
          completedLabel={ui.sessionHistoryCount(
            preview.completedCount,
            preview.totalCount,
          )}
          canStart={canStart}
          startHref={
            canStart && preview.stats.nextSessionId
              ? `/patient/${token}/session/${preview.stats.nextSessionId}`
              : null
          }
          startLabel={ui.startSessionCta}
        />
      ) : null}

      <QuickStatsGrid
        stats={[
          {
            label: ui.statSessions,
            value: `${preview.completedCount}/${preview.totalCount}`,
          },
          {
            label: ui.statActiveDays,
            value: String(preview.view.activeDaysLast7),
          },
          {
            label: ui.statCompletion,
            value: `${preview.progressPercent}%`,
          },
          {
            label: ui.statEffort,
            value:
              preview.view.averageEffort != null
                ? friendlyEffortLabel(Math.round(preview.view.averageEffort), lang)
                : "—",
            compact: true,
          },
        ]}
      />

      <PatientHomeProgressChartPreview token={token} lang={lang} />

      <PatientLifetimeSummaryCard
        summary={plan.lifetimeSummary}
        lang={lang}
        textDir={textDir}
        arClass={arClass}
      />

      <WeeklyActivityStrip
        title={ui.weeklyActivityTitle}
        subtitle={ui.weeklyActivitySubtitle}
        days={preview.weeklyActivity}
      />

      <SectionCard
        title={ui.achievementsPreview}
        actionHref={`/patient/${token}/progress`}
        actionLabel={ui.viewAchievements}
      >
        <div className="-mx-1 flex gap-2 overflow-x-auto pb-1">
          {preview.view.achievements.map((badge) => (
            <span
              key={badge.id}
              className={`inline-flex shrink-0 items-center rounded-full px-3.5 py-2 text-[13px] font-semibold ${
                badge.earned
                  ? "bg-[#EEF7F3] text-[#085041]"
                  : "bg-[#F3F4F6] text-[#9CA3AF]"
              }`}
            >
              {badge.earned ? "✓ " : "○ "}
              {badge.title}
            </span>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={ui.recentActivityPreview}
        actionHref={`/patient/${token}/progress`}
        actionLabel={ui.viewRecentSessions}
      >
        {preview.view.recentSessions.length === 0 ? (
          <p className="text-[14px] text-[#6B7280]">{ui.recentEmptyFriendly}</p>
        ) : (
          <ul className="space-y-2">
            {preview.view.recentSessions.slice(0, 3).map((row) => {
              const session = plan.sessions.find((s) => s.id === row.sessionId);
              const title = session
                ? resolvePatientHomeSessionDisplay(session, plan, lang).title
                : row.title;

              return (
                <li
                  key={row.sessionId}
                  className="flex items-center gap-3 rounded-[12px] bg-[#F8FAF9] px-3.5 py-3"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E8F8F2] text-[13px] font-bold text-[#1D9E75]"
                    aria-hidden
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[#0A0F1A]">
                      {title}
                    </p>
                    {row.completedAt ? (
                      <p className="rasq-meta text-[#6B7280]">
                        {formatPortalDate(row.completedAt, lang)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <Link
        href={`/patient/${token}/progress`}
        className={`block ${CARD} transition hover:border-[#CFE8DD]`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={EYEBROW_META}>{ui.progressSummary}</p>
            <p className="font-data mt-1 text-[20px] font-bold text-[#0A0F1A]">
              {preview.progressPercent}%
            </p>
          </div>
          <span className="text-[13px] font-semibold text-[#1D9E75]">
            {ui.viewFullProgress} →
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#EEF2F0]">
          <div
            className="h-full rounded-full bg-[#1D9E75] transition-all"
            style={{ width: `${preview.progressPercent}%` }}
          />
        </div>
      </Link>

      <PatientMovementCheckCard
        view={movementCheck}
        lang={lang}
        arClass={arClass}
        textDir={textDir}
      />

      {plan.assignedBy ? (
        <ProviderCard assignedBy={plan.assignedBy} program={programName} ui={ui} />
      ) : null}

      <div className="pb-2 text-center">
        <Link
          href={`/patient/${token}/sessions`}
          className="text-[14px] font-semibold text-[#1D9E75] hover:text-[#179165]"
        >
          {ui.viewAllSessions} →
        </Link>
      </div>
    </div>
  );
}

function HeroSection({
  homeTitle,
  greeting,
  tagline,
  programName,
  progressPercent,
  completedCount,
  totalCount,
  progressLabel,
  sessionsLeftLabel,
}: {
  homeTitle: string;
  greeting: string;
  tagline: string;
  programName: string;
  progressPercent: number;
  completedCount: number;
  totalCount: number;
  progressLabel: string;
  sessionsLeftLabel: string;
}) {
  return (
    <section className={`${CARD_SHELL} overflow-hidden`}>
      <div className="border-b border-[#EEF2F0] bg-[#FAFCFB] px-5 py-4">
        <p className={EYEBROW_ACCENT}>{homeTitle}</p>
        <h1 className="rasq-page-title mt-2 text-[#0A0F1A]">{greeting}</h1>
        <p className="rasq-body mt-2 max-w-prose text-[#6B7280]">{tagline}</p>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className={EYEBROW_META}>{progressLabel}</p>
            <p className="rasq-card-title mt-1 text-[#0A0F1A]">{programName}</p>
            <p className="rasq-meta mt-2">
              {completedCount}/{totalCount} · {sessionsLeftLabel}
            </p>
          </div>
          <p
            className="font-data shrink-0 text-[28px] font-bold leading-none text-[#1D9E75] sm:text-[30px]"
            aria-label={`${progressPercent}%`}
          >
            {progressPercent}%
          </p>
        </div>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#EEF2F0]">
          <div
            className="h-full rounded-full bg-[#1D9E75] transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </section>
  );
}

function HeroEmpty({
  homeTitle,
  greeting,
  tagline,
}: {
  homeTitle: string;
  greeting: string;
  tagline: string;
}) {
  return (
    <section className={`${CARD_SHELL} px-5 py-6`}>
      <p className={EYEBROW_ACCENT}>{homeTitle}</p>
      <h1 className="rasq-page-title mt-2 text-[#0A0F1A]">{greeting}</h1>
      <p className="rasq-body mt-2 text-[#6B7280]">{tagline}</p>
    </section>
  );
}

function NextSessionCard({
  sessionLabel,
  title,
  context,
  durationLabel,
  exerciseCountLabel,
  statusLabel,
  therapistContextLabel,
  completedLabel,
  canStart,
  startHref,
  startLabel,
}: {
  sessionLabel: string;
  title: string;
  context: string | null;
  durationLabel: string | null;
  exerciseCountLabel: string | null;
  statusLabel: string;
  therapistContextLabel: string;
  completedLabel: string;
  canStart: boolean;
  startHref: string | null;
  startLabel: string;
}) {
  return (
    <section className={CARD_ACCENT}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={EYEBROW_ACCENT}>{sessionLabel}</p>
        <span className="rounded-full bg-[#EEF7F3] px-2.5 py-0.5 text-[12px] font-semibold text-[#085041]">
          {statusLabel}
        </span>
      </div>

      <h2 className="rasq-section-title mt-3 text-[#0A0F1A]">{title}</h2>

      {context ? (
        <p className="rasq-body mt-2 text-[#4B5563]">{context}</p>
      ) : null}

      <div className="rasq-meta mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {exerciseCountLabel ? <span>{exerciseCountLabel}</span> : null}
        {durationLabel ? <span>{durationLabel}</span> : null}
        <span>{therapistContextLabel}</span>
      </div>

      <p className="rasq-meta mt-3 text-[#6B7280]">{completedLabel}</p>

      {canStart && startHref ? (
        <Link
          href={startHref}
          className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-[12px] bg-[#1D9E75] px-4 text-[16px] font-bold text-white transition hover:bg-[#179165] active:scale-[0.99]"
        >
          {startLabel}
        </Link>
      ) : null}
    </section>
  );
}

function WeeklyActivityStrip({
  title,
  subtitle,
  days,
}: {
  title: string;
  subtitle: string;
  days: ReturnType<typeof buildWorkspaceHomePreview>["weeklyActivity"];
}) {
  return (
    <section className={CARD}>
      <p className={EYEBROW_META}>{title}</p>
      <p className="rasq-card-title mt-1 text-[#0A0F1A]">{subtitle}</p>
      <div className="mt-3 flex items-end justify-between gap-1.5 sm:gap-2">
        {days.map((day, index) => (
          <div key={`${day.label}-${index}`} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={`w-full max-w-[2rem] rounded-full transition-all ${
                day.active ? "bg-[#1D9E75]" : "bg-[#E8EEEC]"
              } ${day.isToday ? "h-12 ring-2 ring-[#1D9E75]/20 ring-offset-1" : day.active ? "h-10" : "h-6"}`}
              aria-label={day.active ? "Active day" : "Inactive day"}
            />
            <span
              className={`text-[12px] font-semibold ${
                day.isToday ? "text-[#1D9E75]" : "text-[#6B7280]"
              }`}
            >
              {day.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuickStatsGrid({
  stats,
}: {
  stats: {
    label: string;
    value: string;
    compact?: boolean;
  }[];
}) {
  return (
    <section className={CARD}>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-[#EEF2F0] sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white px-3 py-3.5 sm:px-4">
            <p
              className={`font-bold text-[#0A0F1A] ${
                stat.compact
                  ? "text-[14px] leading-snug"
                  : "font-data text-[20px] leading-none sm:text-[22px]"
              }`}
            >
              {stat.value}
            </p>
            <p className="rasq-meta mt-1.5 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionCard({
  title,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  actionHref: string;
  actionLabel: string;
  children: ReactNode;
}) {
  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className={EYEBROW_META}>{title}</p>
        <Link href={actionHref} className="text-[13px] font-semibold text-[#1D9E75]">
          {actionLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

function ProviderCard({
  assignedBy,
  program,
  ui,
}: {
  assignedBy: string;
  program: string;
  ui: ReturnType<typeof workspaceUi>;
}) {
  return (
    <section className={CARD}>
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF7F3] text-[16px]"
          aria-hidden
        >
          🏥
        </span>
        <div className="min-w-0">
          <p className={EYEBROW_META}>{ui.providerClinic}</p>
          <p className="rasq-card-title mt-1 text-[#0A0F1A]" dir="ltr">
            {assignedBy}
          </p>
          <p className="rasq-meta mt-0.5">{ui.providerCardSubtitle}</p>
          <p className="mt-1 truncate text-[13px] font-medium text-[#1D9E75]">{program}</p>
        </div>
      </div>
    </section>
  );
}
