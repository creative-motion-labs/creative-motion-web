"use client";

import Link from "next/link";
import type { TimelineEvent, TimelineEventSeverity, TimelineEventType } from "@/app/lib/clinician/patient-timeline";
import {
  formatRelativeTimelineTime,
  formatTimelineTimestamp,
} from "@/app/lib/clinician/patient-timeline";

type PatientJourneyTimelineProps = {
  events: TimelineEvent[];
  patientName: string;
};

const DOT_STYLES: Record<TimelineEventSeverity, { border: string; bg: string }> = {
  info: { border: "#374151", bg: "#374151" },
  warning: { border: "#EF9F27", bg: "#EF9F27" },
  action: { border: "#1D9E75", bg: "#1D9E75" },
};

const LABEL_STYLES: Record<TimelineEventSeverity, string> = {
  info: "text-[#F9FAFB]",
  warning: "text-[#EF9F27]",
  action: "text-[#1D9E75]",
};

const TYPE_LABELS: Record<TimelineEventType, string> = {
  assessment_submitted: "Assessment",
  assessment_report_available: "Report",
  assessment_movement_captured: "Movement",
  plan_assigned: "Plan",
  session_completed: "Session",
  review_flag_raised: "Flag",
  review_completed: "Review",
};

function summarizeEvents(events: TimelineEvent[]) {
  const actionCount = events.filter((event) => event.severity === "action").length;
  const warningCount = events.filter((event) => event.severity === "warning").length;
  const latest = events[events.length - 1];
  return { actionCount, warningCount, latest };
}

export function PatientJourneyTimeline({ events, patientName }: PatientJourneyTimelineProps) {
  const { actionCount, warningCount, latest } = summarizeEvents(events);

  return (
    <section className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 scroll-mt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="text-[12px] font-medium text-[#F9FAFB]"
          >
            Rehabilitation Journey
          </h2>
          <p className="mt-1 text-[11px] text-white/35">
            Chronological record for {patientName}. Events are factual; clinical interpretation is yours.
          </p>
        </div>
        {events.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 text-[10px] text-white/45">
              {events.length} events
            </span>
            {actionCount > 0 ? (
              <span className="rounded-[5px] border border-[#1D9E75]/25 bg-[#1D9E75]/8 px-2.5 py-1 text-[10px] text-[#5DCAA5]">
                {actionCount} action
              </span>
            ) : null}
            {warningCount > 0 ? (
              <span className="rounded-[5px] border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] text-amber-200">
                {warningCount} flags
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {latest ? (
        <p className="mb-4 text-[11px] text-white/40">
          Latest: {latest.label}
          {latest.detail ? ` — ${latest.detail}` : ""} · {formatRelativeTimelineTime(latest.timestamp)}
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="text-[12px] italic text-[#6B7280]">
          No rehabilitation events recorded yet.
        </p>
      ) : (
        <div className="relative pl-6">
          <div
            className="absolute bottom-0 left-[7px] top-0 w-px bg-[#1E2D42]"
            aria-hidden
          />
          <ul className="space-y-0">
            {events.map((event, index) => {
              const severity: TimelineEventSeverity = event.severity ?? "info";
              const dot = DOT_STYLES[severity];
              const isLast = index === events.length - 1;
              const content = (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] text-[#6B7280]">
                      {formatTimelineTimestamp(event.timestamp)}
                    </p>
                    <span className="rounded-[4px] border border-[#1E2D42] bg-[#0B1220] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">
                      {TYPE_LABELS[event.type]}
                    </span>
                    <span className="text-[10px] text-white/25">
                      {formatRelativeTimelineTime(event.timestamp)}
                    </span>
                  </div>
                  <p className={`mt-0.5 text-[13px] font-medium ${LABEL_STYLES[severity]}`}>
                    {event.label}
                  </p>
                  {event.detail && (
                    <p className="mt-0.5 text-[11px] leading-[1.5] text-[#6B7280]">
                      {event.detail}
                    </p>
                  )}
                </>
              );

              return (
                <li
                  key={event.id}
                  className={`relative py-2.5 pl-4 ${
                    isLast ? "" : "border-b border-[#1E2D42]"
                  }`}
                  style={{ borderBottomWidth: isLast ? undefined : "0.5px" }}
                >
                  <span
                    className="absolute left-[-13px] top-[14px] h-2 w-2 rounded-full"
                    style={{
                      border: `2px solid ${dot.border}`,
                      backgroundColor: dot.bg,
                    }}
                    aria-hidden
                  />
                  {event.href ? (
                    <Link href={event.href} className="block transition hover:opacity-90">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
