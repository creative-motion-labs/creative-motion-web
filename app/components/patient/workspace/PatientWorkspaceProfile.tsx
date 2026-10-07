"use client";

import type { PatientPlanData } from "@/app/api/patient/plan/route";
import {
  resolveWorkspacePlanStatus,
  resolveWorkspaceProgramKind,
} from "@/app/lib/patient-workspace";
import {
  formatPortalDate,
  workspaceUi,
  type PatientPortalLanguage,
} from "@/app/lib/patient-portal-ui";

type Props = {
  plan: PatientPlanData;
  lang: PatientPortalLanguage;
  arClass: string;
  textDir: "ltr" | "rtl";
};

function planStatusLabel(
  status: ReturnType<typeof resolveWorkspacePlanStatus>,
  ui: ReturnType<typeof workspaceUi>,
): string {
  if (status === "preparing") return ui.planStatusPreparing;
  if (status === "complete") return ui.planStatusComplete;
  return ui.planStatusActive;
}

export function PatientWorkspaceProfile({ plan, lang, arClass, textDir }: Props) {
  const ui = workspaceUi(lang);
  const programKind = resolveWorkspaceProgramKind(plan);
  const homeLabel =
    programKind === "move_better" ? ui.performanceHome : ui.recoveryHome;
  const planStatus = resolveWorkspacePlanStatus(plan);
  const displayLanguage =
    plan.patientLanguage === "ar" || lang === "ar" ? ui.languageAr : ui.languageEn;

  return (
    <div className={`space-y-5 ${arClass}`} dir={textDir}>
      <header>
        <h1 className="rasq-page-title text-[#0A0F1A]">
          {ui.profileTitle}
        </h1>
        <p className="mt-1 text-[13px] text-[#6B7280]">{ui.profileSubtitle}</p>
      </header>

      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <dl className="space-y-4">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
              {ui.patientName}
            </dt>
            <dd className="mt-1 text-[16px] font-semibold text-[#0A0F1A]">{plan.patientName}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
              {ui.currentProgram}
            </dt>
            <dd className="mt-1 text-[15px] font-semibold text-[#374151]">
              {plan.planTitle || plan.programName}
            </dd>
            <dd className="mt-0.5 text-[12px] text-[#6B7280]">{homeLabel}</dd>
          </div>
          {plan.assignedBy ? (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
                {ui.providerClinic}
              </dt>
              <dd className="mt-1 text-[15px] font-semibold text-[#374151]" dir="ltr">
                {plan.assignedBy}
              </dd>
            </div>
          ) : null}
          {plan.assignedAt ? (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
                {ui.memberSince}
              </dt>
              <dd className="mt-1 text-[14px] text-[#374151]">
                {formatPortalDate(plan.assignedAt, lang)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
              {ui.planStatus}
            </dt>
            <dd className="mt-1 text-[14px] font-semibold text-[#1D9E75]">
              {planStatusLabel(planStatus, ui)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">
              {ui.languageLabel}
            </dt>
            <dd className="mt-1 text-[14px] text-[#374151]">{displayLanguage}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[10px] border border-[#D1E7DE] bg-[#F0FAF6] p-5">
        <p className="text-[13px] leading-relaxed text-[#374151]">{ui.secureLinkNote}</p>
      </section>

      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[13px] leading-relaxed text-[#6B7280]">{ui.supportNote}</p>
      </section>
    </div>
  );
}
