"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CvReviewSummary } from "@/app/components/clinician/cv/CvReviewSummary";
import { getCvReadyExercises } from "@/app/lib/cv/cv-ready-exercises";
import {
  formatCvDuration,
  formatCvRecordedAt,
  formatCvSource,
  formatCvTrackingSignal,
} from "@/app/lib/cv/cv-metrics-display";
import type { CaptureQualityLevel } from "@/app/lib/cv/capture-quality";
import type { ProgressOutcomesBundle } from "@/app/lib/progress/progress-outcomes-bundle";
import {
  PROGRESS_OUTCOMES_CV_FOOTER,
  PROGRESS_OUTCOMES_SAFETY_BANNER,
  PROGRESS_OUTCOMES_SECTION_BADGES,
  PROGRESS_OUTCOMES_THERAPIST_REVIEW_LABEL,
  assessmentTypeDisplayLabel,
  mapProgressCvEvidenceToMetrics,
} from "@/app/lib/progress/progress-outcomes-bundle";
import { LongitudinalComparisonPanel } from "@/app/components/clinician/progress/LongitudinalComparisonPanel";
import { InteractiveShoulderOutcomesPanel } from "@/app/components/clinician/progress/InteractiveShoulderOutcomesPanel";
import {
  ADDITIONAL_CAMERA_OBSERVATIONS_DESCRIPTION,
  ADDITIONAL_CAMERA_OBSERVATIONS_TITLE,
  filterOutcomesHubSectionNav,
  INTERACTIVE_SHOULDER_SECTION_DESCRIPTION,
  shouldShowCameraObservationsSection,
  shouldShowCaptureReliabilitySection,
  shouldShowInteractiveShoulderEmptyState,
  TRACKING_CAPTURE_NOTES_DESCRIPTION,
  TRACKING_CAPTURE_NOTES_TITLE,
} from "@/app/lib/progress/progress-outcomes-hub-layout";

const QUALITY_BADGE_CLASS: Record<CaptureQualityLevel, string> = {
  high: "border-[#1D9E75]/35 bg-[#1D9E75]/12 text-[#5DCAA5]",
  medium: "border-[#EF9F27]/35 bg-[#EF9F27]/10 text-[#EF9F27]",
  low: "border-amber-500/35 bg-amber-500/10 text-amber-200",
};

const SECTION_NAV = [
  { id: "session-activity", label: "Session activity" },
  { id: "patient-reported-pain", label: "Patient-reported pain" },
  { id: "assessment-history", label: "Assessments" },
  { id: "interactive-shoulder-outcomes", label: "Interactive Shoulder" },
  { id: "camera-assisted-observation", label: "Camera-assisted observation" },
  { id: "technical-capture-reliability", label: "Capture reliability" },
] as const;

type ProgressOutcomesHubProps = {
  bundle: ProgressOutcomesBundle;
};

function SectionTypeBadge({ label }: { label: string }) {
  return (
    <span className="rounded-[4px] border border-[#1E2D42] bg-[#0B1220] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF]">
      {label}
    </span>
  );
}

function SectionShell({
  id,
  title,
  typeBadge,
  description,
  children,
}: {
  id: string;
  title: string;
  typeBadge: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6 scroll-mt-24"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[12px] font-medium text-[#F9FAFB]">{title}</h2>
        <SectionTypeBadge label={typeBadge} />
      </div>
      <p className="mb-4 mt-1 text-[11px] text-white/35">{description}</p>
      {children}
    </section>
  );
}

function EmptyState({
  message,
  children,
}: {
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[7px] border border-dashed border-[#1E2D42] bg-[#0B1220]/60 px-4 py-3">
      <p className="text-[12px] text-[#6B7280]">{message}</p>
      {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

function EmptyLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex rounded-[6px] border border-[#1E2D42] bg-[#0F1825] px-3 py-1.5 text-xs font-semibold text-white/65 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]"
    >
      {children}
    </Link>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2">
      <p className="text-[10px] text-white/35">{label}</p>
      <p
        className="mt-0.5 text-sm font-semibold text-[#5DCAA5]"
        style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
      >
        {value}
      </p>
    </div>
  );
}

function hubIsFullyEmpty(bundle: ProgressOutcomesBundle): boolean {
  return (
    !bundle.adherence &&
    bundle.painTrend.length === 0 &&
    bundle.assessments.length === 0 &&
    bundle.cvEvidence.length === 0 &&
    bundle.captureQualityHistory.length === 0 &&
    shouldShowInteractiveShoulderEmptyState(
      bundle.interactiveShoulderOutcomes.length,
      bundle.interactiveShoulderChartOutcomes.length,
    )
  );
}

export function ProgressOutcomesHub({ bundle }: ProgressOutcomesHubProps) {
  const exerciseNameById = Object.fromEntries(
    getCvReadyExercises().map((exercise) => [exercise.exerciseId, exercise.nameEn]),
  );

  const lastSessionAt =
    bundle.painTrend.length > 0
      ? bundle.painTrend[bundle.painTrend.length - 1]?.completedAt
      : null;

  const profileHref = `/clinician/patients/${bundle.patientId}`;
  const planHref = `${profileHref}#rehabilitation-plan`;
  const newAssessmentHref = `/clinician/assessment/new?patientId=${encodeURIComponent(bundle.patientId)}`;
  const newPlanHref = `/clinician/plans/new?patientId=${encodeURIComponent(bundle.patientId)}`;
  const reportBase = `/clinician/assessment/report?patientId=${encodeURIComponent(bundle.patientId)}`;

  const cvReviewMetrics = useMemo(
    () => mapProgressCvEvidenceToMetrics(bundle.cvEvidence, bundle.patientId),
    [bundle.cvEvidence, bundle.patientId],
  );

  const fullyEmpty = hubIsFullyEmpty(bundle);
  const showCameraObservations = shouldShowCameraObservationsSection(bundle.cvEvidence.length);
  const showCaptureReliability = shouldShowCaptureReliabilitySection(bundle.captureQualityHistory.length);
  const visibleSectionNav = filterOutcomesHubSectionNav(
    SECTION_NAV,
    bundle.cvEvidence.length,
    bundle.captureQualityHistory.length,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[8px] border border-amber-400/25 bg-amber-400/8 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-200/90">
          {PROGRESS_OUTCOMES_THERAPIST_REVIEW_LABEL}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/70">
          {PROGRESS_OUTCOMES_SAFETY_BANNER}
        </p>
      </div>

      <LongitudinalComparisonPanel bundle={bundle} />

      <nav
        aria-label="Outcomes hub sections"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {visibleSectionNav.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="shrink-0 rounded-[5px] border border-[#1E2D42] bg-[#0B1220] px-2.5 py-1 text-[11px] font-semibold text-white/45 transition hover:border-[#1D9E75]/25 hover:text-[#5DCAA5]"
          >
            {item.label}
          </a>
        ))}
      </nav>

      {fullyEmpty ? (
        <EmptyState message="No outcomes data recorded yet for this patient. Patient-reported trends and derived observations will appear here as assessments, sessions, and optional camera-assisted exercises are completed. Therapist interpretation required.">
          <EmptyLink href={profileHref}>Open patient chart</EmptyLink>
          <EmptyLink href={newAssessmentHref}>Record assessment</EmptyLink>
          <EmptyLink href="/clinician/results">Results queue</EmptyLink>
          <EmptyLink href="/clinician/assessments">Assessment Center</EmptyLink>
        </EmptyState>
      ) : null}

      <SectionShell
        id="session-activity"
        title="Session activity"
        typeBadge={PROGRESS_OUTCOMES_SECTION_BADGES.sessionActivity}
        description="Plan adherence counts from completed plan sessions. Factual activity only — therapist interpretation required."
      >
        {bundle.adherence ? (
          <div className="space-y-4">
            {bundle.planTitle && (
              <p className="text-[12px] text-white/55">
                Plan: <span className="font-semibold text-white/80">{bundle.planTitle}</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile
                label="Sessions completed"
                value={`${bundle.adherence.completed} / ${bundle.adherence.total}`}
              />
              <MetricTile label="Adherence" value={`${bundle.adherence.progressPct}%`} />
              <MetricTile label="Logged sessions" value={String(bundle.painTrend.length)} />
              <MetricTile
                label="Last session logged"
                value={lastSessionAt ? formatCvRecordedAt(lastSessionAt) : "—"}
              />
            </div>
            <Link
              href={planHref}
              className="inline-flex text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
            >
              View plan &amp; sessions →
            </Link>
          </div>
        ) : (
          <EmptyState message="No treatment plan on file. Session activity appears when a plan is assigned.">
            <EmptyLink href={planHref}>Open treatment plan</EmptyLink>
            <EmptyLink href={newPlanHref}>Create plan</EmptyLink>
          </EmptyState>
        )}
      </SectionShell>

      <SectionShell
        id="patient-reported-pain"
        title="Patient-reported pain"
        typeBadge={PROGRESS_OUTCOMES_SECTION_BADGES.patientReportedPain}
        description="Patient-reported trends from session check-ins. Not a clinical score — therapist interpretation required."
      >
        {bundle.painTrend.length === 0 ? (
          <EmptyState message="No patient-reported pain entries yet. This table fills after the patient completes session check-ins.">
            <EmptyLink href={planHref}>View plan &amp; sessions</EmptyLink>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#1E2D42] text-[10px] uppercase tracking-[0.06em] text-[#6B7280]">
                  <th className="pb-2 pr-3 font-semibold">Date</th>
                  <th className="pb-2 pr-3 font-semibold">Session</th>
                  <th className="pb-2 pr-3 font-semibold">Patient-reported pain before</th>
                  <th className="pb-2 pr-3 font-semibold">Patient-reported pain after</th>
                  <th className="pb-2 font-semibold">Patient-reported effort</th>
                </tr>
              </thead>
              <tbody>
                {bundle.painTrend.map((row) => (
                  <tr
                    key={row.sessionLogId}
                    className="border-b border-[#1E2D42]/60 last:border-0"
                  >
                    <td className="py-2.5 pr-3 text-white/70">
                      {formatCvRecordedAt(row.completedAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-white/70">
                      {row.sessionNumber != null ? `#${row.sessionNumber}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-white/80">
                      {row.painBefore != null ? `${row.painBefore}/10` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-white/80">
                      {row.painAfter != null ? `${row.painAfter}/10` : "—"}
                    </td>
                    <td className="py-2.5 text-white/80">
                      {row.effortScore != null ? `${row.effortScore}/10` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      <SectionShell
        id="assessment-history"
        title="Assessment history"
        typeBadge={PROGRESS_OUTCOMES_SECTION_BADGES.assessmentHistory}
        description="Submitted assessments for this patient. Derived observations from intake data — therapist interpretation required."
      >
        {bundle.assessments.length === 0 ? (
          <EmptyState message="No assessments on file. Derived observations from intake appear here after an assessment is submitted.">
            <EmptyLink href={newAssessmentHref}>Record assessment</EmptyLink>
            <EmptyLink href="/clinician/assessments">Assessment Center</EmptyLink>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[#1E2D42]">
            {bundle.assessments.map((row) => (
              <li
                key={row.assessmentId}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#F9FAFB]">
                    {assessmentTypeDisplayLabel(row.assessmentType)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#6B7280]">
                    {formatCvRecordedAt(row.submittedAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55">
                    {row.painAtRest && (
                      <span>Patient-reported pain at rest: {row.painAtRest}</span>
                    )}
                    {row.painOnMovement && (
                      <span>Patient-reported pain on movement: {row.painOnMovement}</span>
                    )}
                    {row.bodyRegion && <span>Body region: {row.bodyRegion}</span>}
                  </div>
                </div>
                <Link
                  href={`${reportBase}&assessmentId=${encodeURIComponent(row.assessmentId)}`}
                  className="shrink-0 text-xs font-semibold text-[#5DCAA5] transition hover:text-[#1D9E75]"
                >
                  Open report →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      <SectionShell
        id="interactive-shoulder-outcomes"
        title="Interactive Shoulder — movement outcomes"
        typeBadge={PROGRESS_OUTCOMES_SECTION_BADGES.interactiveShoulderOutcomes}
        description={INTERACTIVE_SHOULDER_SECTION_DESCRIPTION}
      >
        {shouldShowInteractiveShoulderEmptyState(
          bundle.interactiveShoulderOutcomes.length,
          bundle.interactiveShoulderChartOutcomes.length,
        ) ? (
          <EmptyState message="No Interactive Shoulder movement outcomes recorded yet. A record appears here after the patient completes an Interactive Shoulder session." />
        ) : (
          <InteractiveShoulderOutcomesPanel
            outcomes={bundle.interactiveShoulderOutcomes}
            chartOutcomes={bundle.interactiveShoulderChartOutcomes}
            painTrend={bundle.painTrend}
            chartPainTrend={bundle.interactiveShoulderChartPainTrend}
          />
        )}
      </SectionShell>

      {showCameraObservations ? (
      <SectionShell
        id="camera-assisted-observation"
        title={ADDITIONAL_CAMERA_OBSERVATIONS_TITLE}
        typeBadge={PROGRESS_OUTCOMES_SECTION_BADGES.cameraObservation}
        description={ADDITIONAL_CAMERA_OBSERVATIONS_DESCRIPTION}
      >
          <div className="space-y-3">
            <ul className="divide-y divide-[#1E2D42]">
              {bundle.cvEvidence.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#F9FAFB]">
                      {exerciseNameById[row.exerciseId] ?? row.exerciseId}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[#6B7280]">
                      {formatCvRecordedAt(row.recordedAt)} · {formatCvSource(row.source)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55">
                      <span>Duration: {formatCvDuration(row.sessionDurationS)}</span>
                      <span>Reps: {row.repCount != null ? String(row.repCount) : "—"}</span>
                      <span>Tracking: {formatCvTrackingSignal(row.trackingQuality)}</span>
                      <span>Movement detected: {row.movementDetected ? "Yes" : "No"}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[10px] leading-relaxed text-[#6B7280]">
              {PROGRESS_OUTCOMES_CV_FOOTER}
            </p>
            <div className="mt-5 border-t border-[#1E2D42] pt-5">
              <p className="mb-3 text-[11px] font-semibold text-white/50">
                Motion review summary — therapist interpretation required
              </p>
              <CvReviewSummary
                metrics={cvReviewMetrics}
                exerciseNameById={exerciseNameById}
                variant="patient-profile"
                maxSessions={5}
              />
            </div>
          </div>
      </SectionShell>
      ) : null}

      {showCaptureReliability ? (
      <SectionShell
        id="technical-capture-reliability"
        title={TRACKING_CAPTURE_NOTES_TITLE}
        typeBadge={PROGRESS_OUTCOMES_SECTION_BADGES.captureReliability}
        description={TRACKING_CAPTURE_NOTES_DESCRIPTION}
      >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#1E2D42] text-[10px] uppercase tracking-[0.06em] text-[#6B7280]">
                  <th className="pb-2 pr-3 font-semibold">Date</th>
                  <th className="pb-2 pr-3 font-semibold">Exercise</th>
                  <th className="pb-2 pr-3 font-semibold">Technical reliability</th>
                  <th className="pb-2 font-semibold">Retest</th>
                </tr>
              </thead>
              <tbody>
                {bundle.captureQualityHistory.map((row) => (
                  <tr
                    key={row.cvMetricId}
                    className="border-b border-[#1E2D42]/60 last:border-0"
                  >
                    <td className="py-2.5 pr-3 text-white/70">
                      {formatCvRecordedAt(row.recordedAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-white/80">
                      {exerciseNameById[row.exerciseId] ?? row.exerciseId}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded-[4px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${QUALITY_BADGE_CLASS[row.qualityLevel]}`}
                      >
                        {row.qualityLevel}
                      </span>
                    </td>
                    <td className="py-2.5 text-white/80">
                      {row.retestRecommended ? "Suggested" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </SectionShell>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-[#1E2D42] pt-4">
        <EmptyLink href={profileHref}>Patient chart</EmptyLink>
        <EmptyLink href="/clinician/results">Results queue</EmptyLink>
        <EmptyLink href="/clinician/assessments">Assessment Center</EmptyLink>
      </div>
    </div>
  );
}
