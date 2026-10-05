import Link from "next/link";
import { ClinicianSectionDetailsToggle } from "@/app/components/clinician/patient-profile/ClinicianSectionDetailsToggle";
import { AssessmentMovementSummaryPanel } from "@/app/components/clinician/cv/AssessmentMovementSummaryPanel";
import { GaitInterpretationSection } from "@/app/components/clinician/cv/GaitInterpretationSection";
import { MotionAnalysisReportPanel } from "@/app/components/clinician/cv/MotionAnalysisReportPanel";
import { dedupeCvMetricsByPlanSessionExercise } from "@/app/lib/cv/cv-metrics-dedupe";
import {
  CV_CAMERA_VISIBILITY_HELPER,
  CV_CLINICIAN_DISCLAIMER,
  CV_REP_COUNT_FOOTER,
  cvDurationMetricLabel,
  cvRepMetricLabel,
  formatCvDuration,
  formatCvMovementDetected,
  formatCvPrototypeLabel,
  formatCvRecordedAt,
  formatCvSource,
  formatCvTrackingQuality,
  formatCvTrackingSignal,
  sortCvMetricsForPatientProfile,
  summarizeCvSources,
  totalCvRepsRecorded,
  type CvSessionMetricPublic,
} from "@/app/lib/cv/cv-metrics-display";
import {
  buildMotionAnalysisReport,
  hasDisplayableMotionAnalysisReport,
  motionAnalysisInputFromCvMetric,
} from "@/app/lib/cv/motion-analysis-report";
import { buildAssessmentMovementSummary } from "@/app/lib/cv/assessment-movement-summary";
import { buildGaitAssistiveInterpretation } from "@/app/lib/cv/gait-interpretation";
import { isGaitAssessmentExerciseId } from "@/app/lib/cv/gait-assessment-exercise-ids";

type CvReviewVariant = "lab" | "patient-profile";

type CvReviewSummaryProps = {
  metrics: CvSessionMetricPublic[];
  exerciseNameById: Record<string, string>;
  loading?: boolean;
  error?: boolean;
  showPatientLinks?: boolean;
  maxSessions?: number;
  variant?: CvReviewVariant;
};

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[10px] uppercase tracking-[0.06em] text-[#6B7280]">{label}</dt>
      <dd className="text-xs text-[#F9FAFB] sm:text-right">{value}</dd>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const label = formatCvSource(source);
  const isPatientSession = source === "patient_session";
  return (
    <span
      className={`rounded-[5px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        isPatientSession
          ? "border-[#1D9E75]/35 bg-[#1D9E75]/12 text-[#5DCAA5]"
          : "border-[#1E2D42] bg-[#0F1825] text-[#9CA3AF]"
      }`}
    >
      {label}
    </span>
  );
}

function PrototypeLabel({ version }: { version: string | null | undefined }) {
  return (
    <span className="rounded-[4px] border border-[#1E2D42] bg-[#0B1220] px-2 py-0.5 text-[10px] text-[#6B7280]">
      {formatCvPrototypeLabel(version)}
    </span>
  );
}

function SessionReviewCard({
  row,
  exerciseName,
  showPatientLink,
  profileMode,
}: {
  row: CvSessionMetricPublic;
  exerciseName: string;
  showPatientLink: boolean;
  profileMode: boolean;
}) {
  const highlightPatient = profileMode && row.source === "patient_session";
  const isGaitSession = isGaitAssessmentExerciseId(row.exerciseId);
  const isAssessmentCapture = row.source === "assessment_movement";
  const gaitInterpretation =
    isGaitSession && !isAssessmentCapture ? buildGaitAssistiveInterpretation(row) : null;
  const assessmentSummary = buildAssessmentMovementSummary(row);
  const motionReport = buildMotionAnalysisReport(motionAnalysisInputFromCvMetric(row));
  const showMotionReport =
    !isGaitSession && !isAssessmentCapture && hasDisplayableMotionAnalysisReport(motionReport);
  const showAssessmentSummary = isAssessmentCapture && assessmentSummary != null;

  return (
    <article
      className={`rounded-[8px] border bg-[#0B1220] p-4 ${
        highlightPatient ? "border-[#1D9E75]/30" : "border-[#1E2D42]"
      }`}
      style={{ borderWidth: "0.5px" }}
    >
      {profileMode ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SourceBadge source={row.source} />
          <PrototypeLabel version={row.prototypeVersion} />
          {highlightPatient ? (
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#5DCAA5]">
              Portal capture
            </span>
          ) : null}
        </div>
      ) : null}

      <dl className="space-y-2.5">
        {profileMode ? (
          <MetricRow label="Date/time" value={formatCvRecordedAt(row.recordedAt)} />
        ) : null}
        <MetricRow label="Exercise" value={exerciseName} />
        {cvRepMetricLabel(row.exerciseId) ? (
          <MetricRow
            label={cvRepMetricLabel(row.exerciseId)!}
            value={row.repCount != null ? String(row.repCount) : "—"}
          />
        ) : null}
        <MetricRow
          label={cvDurationMetricLabel(row.exerciseId)}
          value={formatCvDuration(row.sessionDurationS)}
        />
        <MetricRow
          label={profileMode ? "Tracking signal" : "Tracking quality"}
          value={
            profileMode
              ? formatCvTrackingSignal(row.trackingQuality)
              : formatCvTrackingQuality(row.trackingQuality)
          }
        />
        <MetricRow
          label="Movement detected"
          value={formatCvMovementDetected(row.movementDetected)}
        />
        {!profileMode ? (
          <>
            <MetricRow label="Recorded" value={formatCvRecordedAt(row.recordedAt)} />
            <MetricRow label="Source" value={formatCvSource(row.source)} />
          </>
        ) : null}
      </dl>
      {gaitInterpretation ? (
        <GaitInterpretationSection interpretation={gaitInterpretation} />
      ) : null}
      {showAssessmentSummary && assessmentSummary ? (
        <AssessmentMovementSummaryPanel summary={assessmentSummary} />
      ) : null}
      {showMotionReport ? <MotionAnalysisReportPanel report={motionReport} /> : null}
      {showPatientLink && row.patientId ? (
        <Link
          href={`/clinician/patients/${row.patientId}`}
          className="mt-3 inline-flex text-[11px] font-semibold text-[#5DCAA5] hover:text-[#1D9E75]"
        >
          Open patient profile →
        </Link>
      ) : null}
    </article>
  );
}

function PatientProfileSummaryCard({ metrics }: { metrics: CvSessionMetricPublic[] }) {
  const mostRecent = metrics.reduce<string | null>((latest, row) => {
    if (!latest) return row.recordedAt;
    return new Date(row.recordedAt) > new Date(latest) ? row.recordedAt : latest;
  }, null);

  return (
    <div
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {[
        { label: "Total CV sessions", value: String(metrics.length) },
        { label: "Total reps recorded", value: String(totalCvRepsRecorded(metrics)) },
        {
          label: "Most recent session",
          value: mostRecent ? formatCvRecordedAt(mostRecent) : "—",
        },
        { label: "Sources in list", value: summarizeCvSources(metrics) },
      ].map(({ label, value }) => (
        <div
          key={label}
          className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] px-3 py-2.5"
          style={{ borderWidth: "0.5px" }}
        >
          <p className="text-[10px] uppercase tracking-[0.06em] text-[#6B7280]">{label}</p>
          <p
            className="mt-1 text-sm font-semibold text-[#F9FAFB]"
            style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function LabCvReviewSummary({
  metrics,
  exerciseNameById,
  loading,
  error,
  showPatientLinks,
  maxSessions,
}: CvReviewSummaryProps) {
  const reviewMetrics = metrics.slice(0, maxSessions ?? 5);

  return (
    <section className="mt-8">
      <p className="text-[10px] uppercase tracking-[0.06em] text-[#9CA3AF]">CV Review Summary</p>
      <p className="mb-2 mt-1 text-[11px] font-medium text-[#9CA3AF]">For clinician review</p>

      <div
        className="mb-4 rounded-[8px] border border-[#1E2D42] bg-[#0F1825] px-4 py-3"
        style={{ borderWidth: "0.5px" }}
      >
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[#6B7280]">
          <li>Derived movement metrics only</li>
          <li>Not clinically validated</li>
          <li>No video or body coordinates stored</li>
        </ul>
        <p className="mt-2 text-[10px] italic text-[#EF9F27]">
          Displayed values are recorded outputs from the CV prototype. They are not a clinical
          assessment and must not be used alone for treatment decisions.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-[#6B7280]">Loading review summary…</p>
      ) : error ? (
        <p className="text-xs text-rose-300">Could not load CV review summary.</p>
      ) : reviewMetrics.length === 0 ? (
        <p className="rounded-[8px] border border-[#1E2D42] bg-[#0F1825] px-4 py-6 text-center text-xs text-[#6B7280]">
          No saved CV sessions yet. Complete a session above to review derived metrics here.
        </p>
      ) : (
        <div className="space-y-3">
          {reviewMetrics.map((row, index) => (
            <div key={row.id}>
              {index === 0 ? (
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#1D9E75]">
                  Latest session
                </p>
              ) : null}
              <SessionReviewCard
                row={row}
                exerciseName={exerciseNameById[row.exerciseId] ?? row.exerciseId}
                showPatientLink={showPatientLinks ?? false}
                profileMode={false}
              />
            </div>
          ))}
          {metrics.length > (maxSessions ?? 5) ? (
            <p className="text-[11px] text-[#6B7280]">
              Showing {maxSessions ?? 5} of {metrics.length} recent sessions. See the table below for
              the full list.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PatientProfileCvReview({
  metrics,
  exerciseNameById,
  maxSessions,
}: {
  metrics: CvSessionMetricPublic[];
  exerciseNameById: Record<string, string>;
  maxSessions: number;
}) {
  const sorted = sortCvMetricsForPatientProfile(dedupeCvMetricsByPlanSessionExercise(metrics));
  const patientSessionRows = sorted.filter((r) => r.source === "patient_session");
  const displayMetrics = sorted.slice(0, maxSessions);
  const hasPatientSessions = patientSessionRows.length > 0;

  return (
    <section
      id="movement-tracking-sessions"
      className="scroll-mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-6"
    >
      <h2 className="text-lg font-bold text-white">Movement tracking sessions</h2>
      <p className="mt-2 text-[11px] leading-relaxed text-[#9CA3AF]">{CV_CLINICIAN_DISCLAIMER}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#6B7280]">
        {CV_CAMERA_VISIBILITY_HELPER}
      </p>

      <PatientProfileSummaryCard metrics={metrics} />

      {hasPatientSessions ? (
        <p className="mb-3 text-[11px] font-medium text-[#5DCAA5]">
          {patientSessionRows.length} patient portal session
          {patientSessionRows.length === 1 ? "" : "s"} listed first for review.
        </p>
      ) : null}

      {displayMetrics.length > 0 ? (
        <ClinicianSectionDetailsToggle summaryLabel="View details">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">
            Recent sessions
          </p>
          <div className="space-y-3">
            {displayMetrics.map((row, index) => (
              <div key={row.id}>
                {index === 0 ? (
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#1D9E75]">
                    Latest in list
                  </p>
                ) : null}
                <SessionReviewCard
                  row={row}
                  exerciseName={exerciseNameById[row.exerciseId] ?? row.exerciseId}
                  showPatientLink={false}
                  profileMode
                />
              </div>
            ))}
          </div>
          {metrics.length > maxSessions ? (
            <p className="text-[11px] text-[#6B7280]">
              Showing {maxSessions} of {metrics.length} saved sessions for this patient.
            </p>
          ) : null}
        </ClinicianSectionDetailsToggle>
      ) : null}

      <p className="mt-4 border-t border-[#1E2D42] pt-3 text-[11px] leading-relaxed text-[#6B7280]">
        {CV_REP_COUNT_FOOTER}
      </p>
    </section>
  );
}

export function CvReviewSummary({
  metrics,
  exerciseNameById,
  loading = false,
  error = false,
  showPatientLinks = false,
  maxSessions = 5,
  variant = "lab",
}: CvReviewSummaryProps) {
  if (variant === "patient-profile") {
    if (loading || error || metrics.length === 0) {
      return null;
    }
    return (
      <PatientProfileCvReview
        metrics={metrics}
        exerciseNameById={exerciseNameById}
        maxSessions={maxSessions}
      />
    );
  }

  return (
    <LabCvReviewSummary
      metrics={metrics}
      exerciseNameById={exerciseNameById}
      loading={loading}
      error={error}
      showPatientLinks={showPatientLinks}
      maxSessions={maxSessions}
      variant="lab"
    />
  );
}
