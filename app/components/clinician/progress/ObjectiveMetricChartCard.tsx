"use client";

import Link from "next/link";
import { ObjectiveMetricTrendChart } from "@/app/components/clinician/progress/ObjectiveMetricTrendChart";
import type { ObjectiveMetricSeries } from "@/app/lib/progress/objective-assessment-series";
import {
  formatObjectiveChange,
  formatObjectiveDate,
  formatObjectiveQuality,
  formatObjectiveValue,
} from "@/app/lib/progress/objective-assessment-series";

type ObjectiveMetricChartCardProps = {
  series: ObjectiveMetricSeries;
};

export function ObjectiveMetricChartCard({ series }: ObjectiveMetricChartCardProps) {
  const changeLabel = formatObjectiveChange(series.change, series.unit);
  const showChart = series.points.length >= 2;

  return (
    <article className="rounded-[10px] border border-[#1E2D42] bg-[#0B1220] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={series.workspaceHref}
            className="text-sm font-semibold text-white transition hover:text-[#5DCAA5]"
          >
            {series.assessmentTitle}
          </Link>
          <p className="mt-1 text-xs text-white/45">
            {series.metricLabel} · {series.unit}
          </p>
        </div>
        <Link
          href={series.workspaceHref}
          className="rounded-[6px] border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-3 py-1.5 text-[11px] font-semibold text-[#5DCAA5] transition hover:bg-[#1D9E75]/16"
        >
          View Results
        </Link>
      </div>

      <Link href={series.workspaceHref} className="mt-4 block rounded-[8px] border border-[#1E2D42] bg-[#0F1825] px-3 py-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Latest</p>
            <p className="mt-1 font-mono text-lg font-bold text-white">
              {formatObjectiveValue(series.latest.value, series.unit)}
            </p>
            <p className="mt-0.5 text-[11px] text-white/40">{formatObjectiveDate(series.latest.recordedAt)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Baseline</p>
            <p className="mt-1 font-mono text-sm font-semibold text-white/80">
              {formatObjectiveValue(series.baseline.value, series.unit)}
            </p>
            <p className="mt-0.5 text-[11px] text-white/40">{formatObjectiveDate(series.baseline.recordedAt)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Change</p>
            <p className="mt-1 text-sm text-white/75">{changeLabel ?? "Not comparable yet"}</p>
            <p className="mt-0.5 text-[11px] text-white/40">{formatObjectiveQuality(series.latest.quality)}</p>
          </div>
        </div>
      </Link>

      {showChart ? (
        <div className="mt-4">
          <ObjectiveMetricTrendChart series={series} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/35">
          One measurement on file. A trend chart will appear after a comparable reassessment.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-white/35">{series.directionCopy}</p>
    </article>
  );
}
