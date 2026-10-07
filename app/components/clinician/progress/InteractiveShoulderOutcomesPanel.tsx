"use client";

import { formatCvDuration, formatCvRecordedAt } from "@/app/lib/cv/cv-metrics-display";
import { formatPrescribedSideForReview } from "@/app/lib/clinical/clinical-prescribed-side-plan-draft";
import { InteractiveShoulderClinicianProgressCharts } from "@/app/components/clinician/progress/InteractiveShoulderClinicianProgressCharts";
import type { ProgressOutcomesPainPoint } from "@/app/lib/progress/progress-outcomes-bundle";
import {
  describeRecordedBlockResults,
} from "@/app/lib/progress/progress-outcomes-bundle";
import type {
  InteractiveShoulderOutcomeBlockDisplayCategory,
  InteractiveShoulderOutcomeBlockReport,
  InteractiveShoulderOutcomeReportEntry,
} from "@/app/lib/progress/progress-outcomes-bundle";
import {
  buildBlockDetailsMetrics,
  buildTechnicalObservationMetrics,
  formatRecordedBlockDuration,
  hasTechnicalObservationsForBlock,
  isInstructionalPhaseBlock,
  RECORDED_BLOCK_DETAILS_COMPENSATION_FOOTNOTE,
  RECORDED_BLOCK_DETAILS_CTA,
  RECORDED_BLOCK_DETAILS_SUBTITLE,
  RECORDED_BLOCK_DETAILS_TITLE,
  shouldShowBlockDetailsCompensationFootnote,
  TECHNICAL_OBSERVATIONS_LABEL,
  type BlockDetailMetric,
} from "@/app/lib/progress/interactive-shoulder-block-details-display";
import {
  getInteractiveShoulderTrackingNotes,
  hasInteractiveShoulderTrackingNotes,
  INTERACTIVE_SHOULDER_TRACKING_NOTES_TITLE,
} from "@/app/lib/progress/interactive-shoulder-report-layout";
import { INTERACTIVE_SHOULDER_TRACKING_NOTES_FRAMING } from "@/app/lib/progress/progress-outcomes-hub-layout";
import {
  MOTION_PROFILE_HEADING,
  PEAK_HIP_SHOULDER_ELBOW_ANGLE_LABEL,
  RECORDED_SESSION_OBSERVATION_HEADING,
  buildBlockMotionProfile,
  buildRecordedSessionObservation,
  buildSessionMotionSnapshot,
  hasMotionAnalysisContent,
  isActiveExerciseBlock,
} from "@/app/lib/progress/interactive-shoulder-motion-analysis";

type InteractiveShoulderOutcomesPanelProps = {
  outcomes: InteractiveShoulderOutcomeReportEntry[];
  chartOutcomes?: InteractiveShoulderOutcomeReportEntry[];
  painTrend?: ProgressOutcomesPainPoint[];
  chartPainTrend?: ProgressOutcomesPainPoint[];
};

const CATEGORY_FALLBACK_LABELS: Record<InteractiveShoulderOutcomeBlockDisplayCategory, string> = {
  target: "Target reach block",
  pattern: "Movement pattern block",
  instructional: "Instructional phase",
  unknown: "Session block",
};

function formatBlockTitle(block: InteractiveShoulderOutcomeBlockReport): string {
  return block.title ?? CATEGORY_FALLBACK_LABELS[block.displayCategory];
}

function SectionHeading({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5DCAA5]/85">{children}</p>
  );
}

function Stat({
  label,
  value,
  helper,
  subdued = false,
}: {
  label: string;
  value: string;
  helper?: string;
  subdued?: boolean;
}) {
  return (
    <div
      className={`rounded-[6px] border border-[#1E2D42] px-3 py-2 ${
        subdued ? "bg-[#0B1220]/40" : "bg-[#0B1220]"
      }`}
    >
      <p className={`text-[9px] uppercase tracking-wider ${subdued ? "text-white/28" : "text-white/35"}`}>
        {label}
      </p>
      <p className={`mt-0.5 text-[12px] font-medium ${subdued ? "text-white/55" : "text-white/85"}`}>
        {value}
      </p>
      {helper ? (
        <p className="mt-1 text-[9px] leading-relaxed text-white/35">{helper}</p>
      ) : null}
    </div>
  );
}

function SnapshotMetric({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className="mt-1 text-[20px] font-semibold leading-none tracking-tight text-[#F9FAFB]">{value}</p>
      {helper ? (
        <p className="mt-2 text-[9px] leading-relaxed text-white/35">{helper}</p>
      ) : null}
    </div>
  );
}

function MotionAnalysisSection({ entry }: { entry: InteractiveShoulderOutcomeReportEntry }) {
  if (!hasMotionAnalysisContent(entry)) return null;

  const snapshot = buildSessionMotionSnapshot(entry);
  const observation = buildRecordedSessionObservation(entry);
  const profiles = entry.blocks
    .filter(isActiveExerciseBlock)
    .map((block) => ({ block, lines: buildBlockMotionProfile(block) }))
    .filter((profile) => profile.lines.length > 0);

  return (
    <div className="mb-5 overflow-hidden rounded-[10px] border border-[#1E2D42]/70 bg-[#080E18]">
      <div className="border-b border-[#1E2D42]/60 px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#F9FAFB]">Motion analysis</p>
        <p className="mt-1 text-[10px] text-white/40">For therapist review</p>
      </div>

      <div className="space-y-5 px-5 py-5">
        {snapshot.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {snapshot.map((metric) => (
              <SnapshotMetric
                key={metric.label}
                label={metric.label}
                value={metric.value}
                helper={metric.helper}
              />
            ))}
          </div>
        ) : null}

        {observation ? (
          <div className="space-y-2 border-t border-[#1E2D42]/50 pt-5">
            <SectionHeading>{RECORDED_SESSION_OBSERVATION_HEADING}</SectionHeading>
            <p className="max-w-3xl text-[12px] leading-relaxed text-white/70">{observation}</p>
          </div>
        ) : null}

        {profiles.length > 0 ? (
          <div className="space-y-3 border-t border-[#1E2D42]/50 pt-5">
            <SectionHeading>{MOTION_PROFILE_HEADING}</SectionHeading>
            <div className="space-y-4">
              {profiles.map(({ block, lines }) => (
                <div key={block.blockId} className="min-w-0">
                  <p className="text-[12px] font-semibold text-[#F9FAFB]">{formatBlockTitle(block)}</p>
                  <ul className="mt-2 space-y-1">
                    {lines.map((line) => (
                      <li
                        key={`${block.blockId}-${line.label}`}
                        className={`flex flex-wrap items-baseline gap-x-2 text-[11px] ${
                          line.secondary ? "text-white/40" : "text-white/65"
                        }`}
                      >
                        <span className={line.secondary ? "text-white/30" : "text-white/45"}>
                          {line.label}:
                        </span>
                        <span className={line.secondary ? "font-normal" : "font-medium text-white/80"}>
                          {line.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompactDetailMetric({ metric }: { metric: BlockDetailMetric }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.1em] text-white/35">{metric.label}</p>
      <p className="mt-0.5 text-[12px] font-medium text-white/80">{metric.value}</p>
      {metric.helper ? (
        <p className="mt-1 text-[9px] leading-relaxed text-white/30">{metric.helper}</p>
      ) : null}
    </div>
  );
}

function TechnicalObservationsSubsection({ block }: { block: InteractiveShoulderOutcomeBlockReport }) {
  const metrics = buildTechnicalObservationMetrics(block);
  if (metrics.length === 0) return null;

  return (
    <details className="mt-3 rounded-[6px] border border-[#1E2D42]/40 bg-[#0B1220]/30 px-3 py-2">
      <summary className="cursor-pointer list-none text-[10px] font-medium uppercase tracking-[0.12em] text-white/35 marker:content-none [&::-webkit-details-marker]:hidden">
        {TECHNICAL_OBSERVATIONS_LABEL}
      </summary>
      <div className="mt-2 space-y-2 border-t border-[#1E2D42]/40 pt-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="text-[10px] text-white/45">
            <span className="text-white/30">{metric.label}:</span>{" "}
            <span className="font-medium text-white/55">{metric.value}</span>
            {metric.helper ? (
              <p className="mt-1 text-[9px] leading-relaxed text-white/28">{metric.helper}</p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function InstructionalPhaseRow({ block }: { block: InteractiveShoulderOutcomeBlockReport }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px]">
      <span className="font-medium text-white/65">{formatBlockTitle(block)}</span>
      <span className="text-white/40">
        Completed · {formatRecordedBlockDuration(block.durationSeconds)}
      </span>
    </div>
  );
}

function TrackingCaptureNotesSection({ entry }: { entry: InteractiveShoulderOutcomeReportEntry }) {
  if (!hasInteractiveShoulderTrackingNotes(entry)) return null;

  const notes = getInteractiveShoulderTrackingNotes(entry);

  return (
    <div className="mt-4 space-y-2 border-t border-[#1E2D42]/50 pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
        {INTERACTIVE_SHOULDER_TRACKING_NOTES_TITLE}
      </p>
      <p className="text-[9px] leading-relaxed text-white/30">
        {INTERACTIVE_SHOULDER_TRACKING_NOTES_FRAMING}
      </p>
      <ul className="space-y-1.5">
        {notes.map((note) => (
          <li key={note} className="text-[11px] text-white/55">
            {note}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordedBlockDetailRow({
  block,
  index,
}: {
  block: InteractiveShoulderOutcomeBlockReport;
  index: number;
}) {
  if (isInstructionalPhaseBlock(block)) {
    return (
      <div className={index > 0 ? "border-t border-[#1E2D42]/50 pt-3" : undefined}>
        <InstructionalPhaseRow block={block} />
      </div>
    );
  }

  const metrics = buildBlockDetailsMetrics(block);

  return (
    <div className={index > 0 ? "border-t border-[#1E2D42]/50 pt-4" : undefined}>
      <p className="text-[12px] font-semibold text-[#F9FAFB]">{formatBlockTitle(block)}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <CompactDetailMetric key={`${block.blockId}-${metric.label}`} metric={metric} />
        ))}
      </div>
      {hasTechnicalObservationsForBlock(block) ? (
        <TechnicalObservationsSubsection block={block} />
      ) : null}
    </div>
  );
}

function RecordedBlockDetailsSection({
  blocks,
}: {
  blocks: InteractiveShoulderOutcomeBlockReport[];
}) {
  const showCompensationFootnote = shouldShowBlockDetailsCompensationFootnote(blocks);

  return (
    <details className="group mt-1">
      <summary className="cursor-pointer list-none rounded-[7px] border border-[#1E2D42]/70 bg-[#0B1220]/40 px-4 py-3 text-[11px] font-medium text-[#5DCAA5]/90 transition hover:border-[#1E2D42] hover:bg-[#0B1220]/70 marker:content-none [&::-webkit-details-marker]:hidden">
        {RECORDED_BLOCK_DETAILS_CTA}
      </summary>
      <div className="mt-4 space-y-4 rounded-[8px] border border-[#1E2D42]/50 bg-[#080E18]/60 px-4 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
            {RECORDED_BLOCK_DETAILS_TITLE}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-white/40">
            {RECORDED_BLOCK_DETAILS_SUBTITLE}
          </p>
        </div>
        <div className="space-y-4">
          {blocks.map((block, index) => (
            <RecordedBlockDetailRow
              key={`${block.blockId}-${index}`}
              block={block}
              index={index}
            />
          ))}
        </div>
        {showCompensationFootnote ? (
          <p className="border-t border-[#1E2D42]/40 pt-3 text-[9px] leading-relaxed text-white/35">
            {RECORDED_BLOCK_DETAILS_COMPENSATION_FOOTNOTE}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function OutcomeEntryCard({ entry }: { entry: InteractiveShoulderOutcomeReportEntry }) {
  return (
    <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-[#F9FAFB]">{formatCvRecordedAt(entry.createdAt)}</p>
          <p className="mt-0.5 text-[10px] text-[#6B7280]">
            Treatment side: {formatPrescribedSideForReview(entry.prescribedSide)}
          </p>
        </div>
        <span className="inline-flex items-center rounded-[5px] border border-[#1D9E75]/35 bg-[#1D9E75]/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5DCAA5]">
          Completed
        </span>
      </div>

      <div className="mb-5 space-y-3">
        <SectionHeading>Session summary</SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Session duration" value={formatCvDuration(entry.totalElapsedSeconds)} />
          <Stat
            label="Blocks completed"
            value={`${entry.blocksCompleted}/${entry.blocksTotal}`}
          />
          <Stat label="Block data" value={describeRecordedBlockResults(entry)} />
        </div>
      </div>

      {!entry.recognizedSchemaVersion ? (
        <p className="mb-4 text-[10px] text-amber-300/80">
          This session was recorded with a data version this view does not fully recognize. Some fields
          may be unavailable.
        </p>
      ) : null}

      <MotionAnalysisSection entry={entry} />

      {entry.blocks.length > 0 ? (
        <RecordedBlockDetailsSection blocks={entry.blocks} />
      ) : (
        <p className="text-[11px] text-white/45">No block-level movement data recorded for this session.</p>
      )}

      <TrackingCaptureNotesSection entry={entry} />
    </div>
  );
}

export function InteractiveShoulderOutcomesPanel({
  outcomes,
  chartOutcomes,
  painTrend = [],
  chartPainTrend,
}: InteractiveShoulderOutcomesPanelProps) {
  const longitudinalOutcomes = chartOutcomes ?? outcomes;
  const longitudinalPainTrend = chartPainTrend ?? painTrend;

  return (
    <div className="space-y-4">
      <InteractiveShoulderClinicianProgressCharts
        outcomes={longitudinalOutcomes}
        painTrend={longitudinalPainTrend}
      />
      {outcomes.map((entry) => (
        <OutcomeEntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
