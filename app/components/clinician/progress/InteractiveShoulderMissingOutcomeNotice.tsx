import {
  COMPLETED_WITHOUT_OUTCOME_TITLE,
  describeCompletedWithoutOutcomeNotice,
} from "@/app/lib/progress/interactive-shoulder-missing-outcomes";

/**
 * Tells the clinician that a completed session has no saved movement outcome. Renders
 * nothing when every completed session has one. Separate from the CV movement-report empty
 * state, which concerns a different data source.
 */
export function InteractiveShoulderMissingOutcomeNotice({ count }: { count: number }) {
  const message = describeCompletedWithoutOutcomeNotice(count);
  if (!message) return null;

  return (
    <div
      role="note"
      data-testid="completed-without-outcome-notice"
      className="mb-4 rounded-[8px] border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200/80">
        {COMPLETED_WITHOUT_OUTCOME_TITLE}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-white/60">{message}</p>
    </div>
  );
}
