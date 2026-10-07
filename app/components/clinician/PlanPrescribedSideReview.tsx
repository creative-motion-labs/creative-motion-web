"use client";

import {
  formatPrescribedSideForReview,
  isApplicableGuidedSession,
  type GuidedPlanSessionDraftInput,
} from "@/app/lib/clinical/clinical-prescribed-side-plan-draft";

type PlanPrescribedSideReviewProps = {
  sessions: readonly GuidedPlanSessionDraftInput[];
};

/** Review summary for prescribed sides before guided plan submission. */
export function PlanPrescribedSideReview({ sessions }: PlanPrescribedSideReviewProps) {
  const applicable = sessions.filter((session) => isApplicableGuidedSession(session));
  if (applicable.length === 0) return null;

  return (
    <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
        Prescribed treatment sides
      </p>
      <ul className="mt-2 space-y-1.5">
        {applicable.map((session) => (
          <li key={session.sessionNumber} className="flex flex-wrap items-baseline gap-2 text-sm text-white/80">
            <span className="font-semibold text-white">
              Session {session.sessionNumber}
              {session.title.trim() ? ` — ${session.title.trim()}` : ""}
            </span>
            <span className="text-white/45">·</span>
            <span>{formatPrescribedSideForReview(session.prescribedSide)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
