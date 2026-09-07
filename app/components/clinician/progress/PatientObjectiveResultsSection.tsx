"use client";

import Link from "next/link";
import { ObjectiveMetricChartCard } from "@/app/components/clinician/progress/ObjectiveMetricChartCard";
import { usePatientObjectiveResults } from "@/app/hooks/usePatientObjectiveResults";
import {
  OBJECTIVE_RESULTS_DISCLAIMER,
  OBJECTIVE_RESULTS_EMPTY_BODY,
  OBJECTIVE_RESULTS_EMPTY_TITLE,
  OBJECTIVE_RESULTS_SECTION_TITLE,
  formatObjectiveChange,
  formatObjectiveDate,
  formatObjectiveQuality,
  formatObjectiveValue,
} from "@/app/lib/progress/objective-assessment-series";

type PatientObjectiveResultsSectionProps = {
  patientId: string;
};

export function PatientObjectiveResultsSection({
  patientId,
}: PatientObjectiveResultsSectionProps) {
  const { model, loading, error } = usePatientObjectiveResults(patientId);
  const series = model?.series ?? [];
  const latest = model?.latestEvent ?? null;

  return (
    <section
      id="progress-objective-results"
      className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 scroll-mt-6"
    >
      <h2 className="text-lg font-bold text-white">{OBJECTIVE_RESULTS_SECTION_TITLE}</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/35">{OBJECTIVE_RESULTS_DISCLAIMER}</p>

      {loading ? (
        <p className="mt-4 text-sm text-white/40">Loading objective results…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-rose-300">Could not load objective results.</p>
      ) : series.length === 0 ? (
        <div className="mt-5 rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-8 text-center">
          <p className="text-sm font-medium text-white/70">{OBJECTIVE_RESULTS_EMPTY_TITLE}</p>
          <p className="mt-2 text-xs leading-relaxed text-white/40">{OBJECTIVE_RESULTS_EMPTY_BODY}</p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {latest ? (
            <div className="rounded-[8px] border border-[#1D9E75]/20 bg-[#1D9E75]/6 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#5DCAA5]">
                    Latest objective assessment
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">{latest.assessmentTitle}</p>
                  <p className="mt-0.5 text-xs text-white/45">
                    {formatObjectiveDate(latest.recordedAt)} · {formatObjectiveQuality(latest.quality)}
                  </p>
                </div>
                <Link
                  href={latest.workspaceHref}
                  className="rounded-[6px] bg-[#1D9E75] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#179165]"
                >
                  View full results
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {latest.results.map((result) => (
                  <span
                    key={result.seriesId}
                    className="rounded-[6px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1.5 text-xs text-white/75"
                  >
                    {result.metricLabel}: {formatObjectiveValue(result.value, result.unit)}
                    {formatObjectiveChange(result.change, result.unit)
                      ? ` · ${formatObjectiveChange(result.change, result.unit)}`
                      : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4">
            {series.map((item) => (
              <ObjectiveMetricChartCard key={item.seriesId} series={item} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
