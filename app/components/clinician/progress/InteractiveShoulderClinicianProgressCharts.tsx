import { ProgressSessionBarChart } from "@/app/components/clinician/progress/ProgressSessionBarChart";
import { InteractiveShoulderProgressSessionsSummaryStrip } from "@/app/components/clinician/progress/InteractiveShoulderProgressSessionsSummaryStrip";
import type { ProgressOutcomesPainPoint } from "@/app/lib/progress/progress-outcomes-bundle";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import {
  buildClinicianProgressChartSeries,
  buildInteractiveShoulderProgressSessionsSummary,
  buildInteractiveShoulderSessionChartPoints,
  PROGRESS_OVER_SESSIONS_REVIEW_NOTE,
  PROGRESS_OVER_SESSIONS_TITLE,
  shouldShowInteractiveShoulderProgressCharts,
  SINGLE_SESSION_CHART_EMPTY_STATE,
  toProgressChartPointLabels,
} from "@/app/lib/progress/interactive-shoulder-progress-charts";

type InteractiveShoulderClinicianProgressChartsProps = {
  outcomes: InteractiveShoulderOutcomeReportEntry[];
  painTrend?: ProgressOutcomesPainPoint[];
};

export function InteractiveShoulderClinicianProgressCharts({
  outcomes,
  painTrend = [],
}: InteractiveShoulderClinicianProgressChartsProps) {
  if (outcomes.length === 0) return null;

  if (!shouldShowInteractiveShoulderProgressCharts(outcomes.length)) {
    return (
      <div className="mb-4 rounded-[8px] border border-[#1E2D42]/50 bg-[#0B1220]/30 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
          {PROGRESS_OVER_SESSIONS_TITLE}
        </p>
        <p className="mt-1 text-[10px] text-white/35">{SINGLE_SESSION_CHART_EMPTY_STATE}</p>
      </div>
    );
  }

  const points = buildInteractiveShoulderSessionChartPoints(outcomes, painTrend);
  const pointLabels = toProgressChartPointLabels(points);
  const series = buildClinicianProgressChartSeries(points);
  if (series.length === 0) return null;

  const summary = buildInteractiveShoulderProgressSessionsSummary(outcomes);

  return (
    <div className="mb-5 overflow-hidden rounded-[10px] border border-[#1E2D42]/70 bg-[#080E18]">
      <div className="border-b border-[#1E2D42]/60 px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#F9FAFB]">
          {PROGRESS_OVER_SESSIONS_TITLE}
        </p>
        <p className="mt-1 text-[10px] text-white/40">{PROGRESS_OVER_SESSIONS_REVIEW_NOTE}</p>
      </div>
      <InteractiveShoulderProgressSessionsSummaryStrip summary={summary} />
      <div className="grid gap-3 px-5 py-5 lg:grid-cols-2">
        {series.map((chartSeries) => (
          <ProgressSessionBarChart
            key={chartSeries.id}
            pointLabels={pointLabels}
            series={chartSeries}
            variant="clinician"
          />
        ))}
      </div>
    </div>
  );
}
