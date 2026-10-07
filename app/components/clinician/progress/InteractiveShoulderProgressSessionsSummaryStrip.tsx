import { formatCvRecordedAt } from "@/app/lib/cv/cv-metrics-display";
import type { InteractiveShoulderProgressSessionsSummary } from "@/app/lib/progress/interactive-shoulder-progress-charts";
import { PROGRESS_OVER_SESSIONS_SUMMARY_HELPER } from "@/app/lib/progress/interactive-shoulder-progress-charts";

type InteractiveShoulderProgressSessionsSummaryStripProps = {
  summary: InteractiveShoulderProgressSessionsSummary;
};

export function InteractiveShoulderProgressSessionsSummaryStrip({
  summary,
}: InteractiveShoulderProgressSessionsSummaryStripProps) {
  const latestSessionLabel = summary.latestSessionAt
    ? formatCvRecordedAt(summary.latestSessionAt)
    : "—";

  return (
    <div className="border-b border-[#1E2D42]/50 bg-[#0B1220]/25 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-white/40">
        <p>
          <span className="font-medium text-white/45">Recorded sessions:</span>{" "}
          <span
            className="font-semibold text-white/70"
            style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
          >
            {summary.recordedSessions}
          </span>
        </p>
        <p>
          <span className="font-medium text-white/45">Latest session:</span>{" "}
          <span className="font-medium text-white/60">{latestSessionLabel}</span>
        </p>
        {summary.treatedSideLabel != null ? (
          <p>
            <span className="font-medium text-white/45">Treated side:</span>{" "}
            <span
              className="font-semibold tracking-[0.08em] text-white/65"
              style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
            >
              {summary.treatedSideLabel}
            </span>
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-white/28">{PROGRESS_OVER_SESSIONS_SUMMARY_HELPER}</p>
    </div>
  );
}
