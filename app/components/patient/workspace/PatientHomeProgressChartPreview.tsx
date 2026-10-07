"use client";

import Link from "next/link";
import { ProgressSessionBarChart } from "@/app/components/clinician/progress/ProgressSessionBarChart";
import { usePatientInteractiveShoulderProgress } from "@/app/hooks/usePatientInteractiveShoulderProgress";
import type { PatientPortalLanguage } from "@/app/lib/patient-portal-ui";
import { workspaceUi } from "@/app/lib/patient-portal-ui";
import {
  buildPatientProgressChartSeries,
  buildPatientShoulderProgressPointsFromSessions,
  shouldShowInteractiveShoulderProgressCharts,
  toProgressChartDateLabels,
} from "@/app/lib/progress/interactive-shoulder-progress-charts";

type PatientHomeProgressChartPreviewProps = {
  token: string;
  lang: PatientPortalLanguage;
};

const CARD =
  "rounded-[16px] border border-[#E2E8E5] bg-white p-5 shadow-[0_1px_3px_rgba(10,15,26,0.04)]";

export function PatientHomeProgressChartPreview({
  token,
  lang,
}: PatientHomeProgressChartPreviewProps) {
  const ui = workspaceUi(lang);
  const { progress, isLoading } = usePatientInteractiveShoulderProgress(token);
  const points = buildPatientShoulderProgressPointsFromSessions(progress?.sessions ?? []);

  if (isLoading || points.length === 0) return null;

  if (!shouldShowInteractiveShoulderProgressCharts(points.length)) {
    return (
      <section className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="rasq-card-title text-[#0A0F1A]">{ui.homeProgressTitle}</h2>
            <p className="rasq-meta mt-1">{ui.homeProgressSubtitle}</p>
          </div>
          <Link
            href={`/patient/${token}/progress`}
            className="shrink-0 text-[12px] font-semibold text-[#1D9E75] hover:text-[#179165]"
          >
            {ui.homeProgressViewLink}
          </Link>
        </div>
        <p className="mt-4 text-[13px] text-[#6B7280]">{ui.homeProgressSingleSessionNote}</p>
      </section>
    );
  }

  const pointLabels = toProgressChartDateLabels(points, lang);
  const series = buildPatientProgressChartSeries(points, lang);

  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="rasq-card-title text-[#0A0F1A]">{ui.homeProgressTitle}</h2>
          <p className="rasq-meta mt-1">{ui.homeProgressSubtitle}</p>
        </div>
        <Link
          href={`/patient/${token}/progress`}
          className="shrink-0 text-[12px] font-semibold text-[#1D9E75] hover:text-[#179165]"
        >
          {ui.homeProgressViewLink}
        </Link>
      </div>

      <div className="mt-4 flex w-full flex-col gap-3">
        {series.map((chartSeries) => (
          <ProgressSessionBarChart
            key={chartSeries.id}
            pointLabels={pointLabels}
            series={chartSeries}
            variant="patient"
          />
        ))}
      </div>
    </section>
  );
}
