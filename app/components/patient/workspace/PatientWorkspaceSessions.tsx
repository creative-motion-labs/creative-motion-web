"use client";

import Link from "next/link";
import type { PatientPlanData } from "@/app/api/patient/plan/route";
import type { SessionLogEntry } from "@/app/api/patient/logs/route";
import { resolveWorkspaceSessionStatus } from "@/app/lib/patient-workspace";
import {
  formatPortalDate,
  formatSessionDisplayTitle,
  workspaceUi,
  type PatientPortalLanguage,
} from "@/app/lib/patient-portal-ui";

type Props = {
  plan: PatientPlanData;
  logs: SessionLogEntry[];
  token: string;
  lang: PatientPortalLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
};

function StatusBadge({
  status,
  ui,
}: {
  status: ReturnType<typeof resolveWorkspaceSessionStatus>;
  ui: ReturnType<typeof workspaceUi>;
}) {
  if (status === "completed") {
    return (
      <span className="shrink-0 rounded-[6px] bg-[#E8F5F1] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#085041]">
        {ui.sessionStatusCompleted}
      </span>
    );
  }
  if (status === "next") {
    return (
      <span className="shrink-0 rounded-[6px] bg-[#1D9E75] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
        {ui.sessionStatusNext}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-[6px] border border-[#E2E8E5] bg-[#F4F6F5] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF]">
      {ui.sessionStatusLocked}
    </span>
  );
}

export function PatientWorkspaceSessions({
  plan,
  logs,
  token,
  lang,
  arClass,
  textDir,
}: Props) {
  const ui = workspaceUi(lang);
  const completed = plan.sessions.filter((s) => s.status === "completed").length;
  const total = plan.sessions.length;
  const lastLog = logs[0];

  if (total === 0) {
    return (
      <div className={`space-y-5 ${arClass}`} dir={textDir}>
        <header>
          <h1 className="text-[22px] font-bold text-[#0A0F1A]">{ui.sessionsPageTitle}</h1>
          <p className="mt-1 text-[13px] text-[#6B7280]">{ui.preparingSchedule}</p>
        </header>
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${arClass}`} dir={textDir}>
      <header>
        <h1 className="rasq-page-title text-[#0A0F1A]">
          {ui.sessionsPageTitle}
        </h1>
        <p className="mt-1 text-[13px] text-[#6B7280]">{ui.sessionsPageSubtitle}</p>
      </header>

      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
          {ui.sessionHistorySummary}
        </p>
        <p className="mt-2 text-[15px] font-semibold text-[#0A0F1A]">
          {ui.sessionHistoryCount(completed, total)}
        </p>
        {lastLog?.completedAt ? (
          <p className="mt-1 text-[12px] text-[#6B7280]">
            {lang === "ar" ? "آخر جلسة:" : "Last session:"}{" "}
            {formatPortalDate(lastLog.completedAt, lang)}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        {plan.sessions.map((session) => {
          const status = resolveWorkspaceSessionStatus(plan.sessions, session);
          const canStart = status === "next";
          const title = formatSessionDisplayTitle(session.sessionNumber, session.title, lang);

          const row = (
            <div
              className={`rounded-[10px] border bg-white p-4 ${
                status === "next"
                  ? "border-[#D1E7DE] bg-[#F0FAF6]"
                  : status === "locked"
                    ? "border-[#E2E8E5] opacity-75"
                    : "border-[#E2E8E5]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold text-[#0A0F1A]">{title}</p>
                  <p className="mt-1 text-[12px] text-[#6B7280]">
                    {session.exercises.length}{" "}
                    {lang === "ar"
                      ? session.exercises.length === 1
                        ? "تمرين"
                        : "تمارين"
                      : `exercise${session.exercises.length === 1 ? "" : "s"}`}
                  </p>
                  {session.completedAt ? (
                    <p className="mt-1 text-[11px] text-[#9CA3AF]">
                      {formatPortalDate(session.completedAt, lang)}
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={status} ui={ui} />
              </div>
              {canStart ? (
                <Link
                  href={`/patient/${token}/session/${session.id}`}
                  className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-[7px] bg-[#1D9E75] px-4 text-[14px] font-semibold text-white transition hover:bg-[#179165]"
                >
                  {ui.startSession}
                </Link>
              ) : null}
            </div>
          );

          return <div key={session.id}>{row}</div>;
        })}
      </section>
    </div>
  );
}
