import { ProgressSessionBarChart } from "@/app/components/clinician/progress/ProgressSessionBarChart";
import { usePatientInteractiveShoulderProgress } from "@/app/hooks/usePatientInteractiveShoulderProgress";
import {
  buildPatientProgressChartSeries,
  buildPatientShoulderProgressPointsFromSessions,
  PATIENT_PROGRESS_OVER_TIME_SUBTITLE,
  PATIENT_PROGRESS_OVER_TIME_TITLE,
  shouldShowInteractiveShoulderProgressCharts,
  SINGLE_SESSION_CHART_EMPTY_STATE,
  toProgressChartPointLabels,
} from "@/app/lib/progress/interactive-shoulder-progress-charts";

type InteractiveShoulderPatientProgressChartsProps = {
  token: string;
};

export function InteractiveShoulderPatientProgressCharts({
  token,
}: InteractiveShoulderPatientProgressChartsProps) {
  const { progress } = usePatientInteractiveShoulderProgress(token);
  const points = buildPatientShoulderProgressPointsFromSessions(progress?.sessions ?? []);

  if (points.length === 0) return null;

  if (!shouldShowInteractiveShoulderProgressCharts(points.length)) {
    return (
      <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#374151]">
          {PATIENT_PROGRESS_OVER_TIME_TITLE}
        </p>
        <p className="mt-2 text-[13px] text-[#6B7280]">{SINGLE_SESSION_CHART_EMPTY_STATE}</p>
      </section>
    );
  }

  const pointLabels = toProgressChartPointLabels(points);
  const series = buildPatientProgressChartSeries(points);

  return (
    <section className="rounded-[10px] border border-[#E2E8E5] bg-white p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#1D9E75]">
        {PATIENT_PROGRESS_OVER_TIME_TITLE}
      </p>
      <p className="mt-1 text-[12px] text-[#6B7280]">{PATIENT_PROGRESS_OVER_TIME_SUBTITLE}</p>
      <p className="mt-3 text-[13px] font-semibold text-[#374151]">
        {points.length} session{points.length === 1 ? "" : "s"} completed
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
