"use client";

import type { RasqDemoMovementAnalysisSummary } from "@/app/lib/rasq-demo/demo-movement-summary";

type RasqDemoMovementAnalysisSummaryProps = {
  summary: RasqDemoMovementAnalysisSummary;
};

function MetricRow({ label, value }: { label: string; value: RasqDemoMovementAnalysisSummary["targetsReached"] }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[#E2E8F0] py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between">
      <dt className="text-sm font-medium text-[#334155]">{label}</dt>
      <dd
        className={`text-sm ${value.available ? "font-semibold text-[#0F172A]" : "text-[#64748B] italic"}`}
      >
        {value.display}
      </dd>
    </div>
  );
}

export function RasqDemoMovementAnalysisSummaryPanel({ summary }: RasqDemoMovementAnalysisSummaryProps) {
  return (
    <section aria-labelledby="rasq-demo-analysis-heading">
      <h2 id="rasq-demo-analysis-heading" className="text-lg font-semibold text-[#0F172A]">
        Movement Analysis Summary
      </h2>
      <p className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        {summary.demonstrationDisclaimer}
      </p>
      <p className="mt-2 text-sm font-medium text-[#334155]">Demonstration measurements</p>
      <p className="mt-1 text-sm text-[#64748B]">
        For demonstration purposes only — not a medical diagnosis.
      </p>
      <dl className="mt-4 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-4">
        <MetricRow
          label="Session duration"
          value={{
            available: true,
            display: `${summary.sessionDurationSeconds} seconds`,
          }}
        />
        <MetricRow label="Targets reached (session)" value={summary.targetsReached} />
        <MetricRow label="Targets completed (Reach block)" value={summary.reachTargetsCompleted} />
        <MetricRow label="Average target time" value={summary.reachAverageTargetTime} />
        <MetricRow label="Targets per minute" value={summary.reachTargetsPerMinute} />
        <MetricRow label="Target completion rate" value={summary.reachTargetCompletionRate} />
        <MetricRow label="PNF repetitions completed" value={summary.pnfRepetitionsCompleted} />
        <MetricRow label="Tracking quality" value={summary.trackingQuality} />
        <MetricRow label="Movement smoothness" value={summary.movementSmoothness} />
      </dl>
    </section>
  );
}
