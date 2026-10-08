import { ProgressSessionBarChart } from "@/app/components/clinician/progress/ProgressSessionBarChart";
import { InteractiveShoulderProgressSessionsSummaryStrip } from "@/app/components/clinician/progress/InteractiveShoulderProgressSessionsSummaryStrip";
import type { ProgressOutcomesPainPoint } from "@/app/lib/progress/progress-outcomes-bundle";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import {
  BASELINE_NEEDS_SECOND_SESSION_NOTE,
  BASELINE_NOT_A_TREND_NOTE,
  BASELINE_SESSION_TITLE,
  buildBaselineSessionMetrics,
  buildClinicianProgressChartSeries,
  buildInteractiveShoulderProgressSessionsSummary,
  buildInteractiveShoulderSessionChartPoints,
  describeComparableSelection,
  PROGRESS_OVER_SESSIONS_REVIEW_NOTE,
  PROGRESS_OVER_SESSIONS_TITLE,
  selectComparableOutcomes,
  shouldShowInteractiveShoulderProgressCharts,
  SINGLE_SESSION_CHART_EMPTY_STATE,
  toProgressChartDatedPointLabels,
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

  // Only sessions that measure the same thing (same treated side, same session design) may
  // share a trend line. Others are counted and disclosed below, never silently merged.
  const selection = selectComparableOutcomes(outcomes);
  const comparable = selection.comparable;
  const selectionNote = describeComparableSelection(selection);

  if (!shouldShowInteractiveShoulderProgressCharts(comparable.length)) {
    // One comparable session: a labelled baseline -- values only, no line, no claim of change.
    const baselineMetrics =
      comparable.length === 1 ? buildBaselineSessionMetrics(comparable[0]!, painTrend) : [];

    return (
      <div
        className="mb-4 rounded-[8px] border border-[#1E2D42]/50 bg-[#0B1220]/30 px-4 py-3"
        data-testid="progress-baseline"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
          {PROGRESS_OVER_SESSIONS_TITLE}
        </p>
        {comparable.length === 1 ? (
          <>
            <p className="mt-2 text-[11px] font-semibold text-white/65">{BASELINE_SESSION_TITLE}</p>
            {baselineMetrics.length > 0 ? (
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {baselineMetrics.map((metric) => (
                  <div key={metric.id}>
                    <dt className="text-[10px] font-medium text-white/45">{metric.label}</dt>
                    <dd
                      className="text-[13px] font-semibold text-white/80"
                      style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                    >
                      {metric.value}
                    </dd>
                    {metric.helper ? (
                      <p className="text-[9px] leading-relaxed text-white/30">{metric.helper}</p>
                    ) : null}
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="mt-3 text-[10px] text-white/45">{BASELINE_NEEDS_SECOND_SESSION_NOTE}</p>
            <p className="mt-1 text-[10px] text-white/30">{BASELINE_NOT_A_TREND_NOTE}</p>
          </>
        ) : (
          <p className="mt-1 text-[10px] text-white/35">{SINGLE_SESSION_CHART_EMPTY_STATE}</p>
        )}
        {selectionNote ? <p className="mt-2 text-[10px] text-white/40">{selectionNote}</p> : null}
      </div>
    );
  }

  const points = buildInteractiveShoulderSessionChartPoints(comparable, painTrend);
  const pointLabels = toProgressChartDatedPointLabels(points);
  const series = buildClinicianProgressChartSeries(points);
  if (series.length === 0) return null;

  const summary = buildInteractiveShoulderProgressSessionsSummary(comparable);

  return (
    <div className="mb-5 overflow-hidden rounded-[10px] border border-[#1E2D42]/70 bg-[#080E18]">
      <div className="border-b border-[#1E2D42]/60 px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#F9FAFB]">
          {PROGRESS_OVER_SESSIONS_TITLE}
        </p>
        <p className="mt-1 text-[10px] text-white/40">{PROGRESS_OVER_SESSIONS_REVIEW_NOTE}</p>
      </div>
      <InteractiveShoulderProgressSessionsSummaryStrip summary={summary} />
      {selectionNote ? (
        <p className="border-b border-[#1E2D42]/50 px-5 py-2 text-[10px] text-white/45">
          {selectionNote}
        </p>
      ) : null}
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
