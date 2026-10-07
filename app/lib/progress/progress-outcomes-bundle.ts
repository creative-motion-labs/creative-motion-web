/**
 * Progress & Outcomes Hub v1 — read-only clinician view model from existing data.
 * Patient-reported trends and derived observations only; therapist interpretation required.
 */

import type { AssessmentPickInput } from "@/app/lib/assessment-snapshot";
import { extractAssessmentSnapshot } from "@/app/lib/assessment-snapshot";
import {
  buildCaptureQualityHistory,
  type CaptureQualityHistoryEntry,
} from "@/app/lib/progress/extract-capture-quality-history";
import { parseSessionCoachNotes } from "@/app/lib/session-coach-metadata";
import type { CvSessionMetricPublic } from "@/app/lib/cv/cv-metrics-display";
import { buildInteractiveShoulderOutcomeReportEntries } from "@/app/lib/interactive-shoulder/movement-outcome-report";
export { describeRecordedBlockResults } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/interactive-shoulder/movement-outcome-report";
import type { InteractiveShoulderOutcomeReportRow } from "@/app/lib/interactive-shoulder/movement-outcome-persistence";

export type {
  InteractiveShoulderOutcomeReportEntry,
  InteractiveShoulderOutcomeBlockReport,
  InteractiveShoulderOutcomeBlockDisplayCategory,
} from "@/app/lib/interactive-shoulder/movement-outcome-report";

export const PROGRESS_OUTCOMES_SAFETY_BANNER =
  "Trends are patient-reported or derived observations and require therapist interpretation.";

export const PROGRESS_OUTCOMES_THERAPIST_REVIEW_LABEL = "Therapist interpretation required";

/** Hub-only CV footer — no prohibited wording; not shared with global CV disclaimer. */
export const PROGRESS_OUTCOMES_CV_FOOTER =
  "Optional experimental assist. Camera-assisted observations are derived movement metrics only. Therapist interpretation required. No video or body coordinates stored.";

export const PROGRESS_OUTCOMES_SECTION_BADGES = {
  sessionActivity: "Activity record",
  patientReportedPain: "Patient-reported trend",
  assessmentHistory: "Derived observation",
  cameraObservation: "Camera-assisted observation",
  captureReliability: "Technical capture reliability only",
  interactiveShoulderOutcomes: "Session-derived movement data",
} as const;

export const INTERACTIVE_SHOULDER_OUTCOMES_REVIEW_NOTE =
  "Session-derived movement data for therapist review.";

export const INTERACTIVE_SHOULDER_OUTCOMES_DISCLAIMER = "For therapist review only.";

export type ProgressOutcomesAdherence = {
  planId: string;
  completed: number;
  total: number;
  progressPct: number;
};

export type ProgressOutcomesPainPoint = {
  sessionLogId: string;
  sessionNumber: number | null;
  planSessionId: string | null;
  completedAt: string;
  painBefore: number | null;
  painAfter: number | null;
  effortScore: number | null;
};

export type ProgressOutcomesAssessmentEntry = {
  assessmentId: string;
  assessmentType: string;
  submittedAt: string;
  painAtRest?: string;
  painOnMovement?: string;
  bodyRegion?: string;
};

export type ProgressOutcomesCvEvidenceEntry = {
  id: string;
  recordedAt: string;
  exerciseId: string;
  sessionDurationS: number | null;
  repCount: number | null;
  trackingQuality: string | null;
  movementDetected: boolean;
  source: string;
  planSessionId: string | null;
};

/** Map hub CV rows to the shared clinician motion review model. */
export function mapProgressCvEvidenceToMetrics(
  rows: readonly ProgressOutcomesCvEvidenceEntry[],
  patientId: string,
): CvSessionMetricPublic[] {
  return rows.map((row) => ({
    id: row.id,
    exerciseId: row.exerciseId,
    repCount: row.repCount,
    sessionDurationS: row.sessionDurationS,
    trackingQuality: row.trackingQuality,
    movementDetected: row.movementDetected,
    source: row.source,
    recordedAt: row.recordedAt,
    patientId,
    planSessionId: row.planSessionId,
  }));
}

export type ProgressOutcomesBundle = {
  patientId: string;
  patientName: string;
  planId: string | null;
  planTitle: string | null;
  adherence: ProgressOutcomesAdherence | null;
  painTrend: ProgressOutcomesPainPoint[];
  assessments: ProgressOutcomesAssessmentEntry[];
  cvEvidence: ProgressOutcomesCvEvidenceEntry[];
  captureQualityHistory: CaptureQualityHistoryEntry[];
  interactiveShoulderOutcomes: InteractiveShoulderOutcomeReportEntry[];
  /** Cross-plan Interactive Shoulder outcomes for longitudinal charts only. */
  interactiveShoulderChartOutcomes: InteractiveShoulderOutcomeReportEntry[];
  /** Patient-reported pain/effort joined across plans for longitudinal charts only. */
  interactiveShoulderChartPainTrend: ProgressOutcomesPainPoint[];
};

export type SessionLogInput = {
  id: string;
  plan_session_id: string | null;
  effort_score: number | null;
  pain_score: number | null;
  notes: string | null;
  completed_at: string;
};

export type CvMetricInput = {
  id: string;
  exercise_id: string;
  rep_count: number | null;
  session_duration_s: number | null;
  tracking_quality: string | null;
  movement_detected: boolean;
  source: string;
  recorded_at: string;
  plan_session_id: string | null;
  motion_quality: Record<string, unknown> | null;
};

export function buildPainTrendFromSessionLogs(
  logs: SessionLogInput[],
  sessionNumberById: Map<string, number>,
): ProgressOutcomesPainPoint[] {
  return [...logs]
    .sort(
      (a, b) =>
        new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime(),
    )
    .map((log) => {
      const coach = parseSessionCoachNotes(log.notes);
      return {
        sessionLogId: log.id,
        sessionNumber: log.plan_session_id
          ? sessionNumberById.get(log.plan_session_id) ?? null
          : null,
        planSessionId: log.plan_session_id,
        completedAt: log.completed_at,
        painBefore: coach.painBefore,
        painAfter: log.pain_score,
        effortScore: log.effort_score,
      };
    });
}

export function buildAssessmentHistory(
  rows: AssessmentPickInput[],
): ProgressOutcomesAssessmentEntry[] {
  return [...rows]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .map((row) => {
      const snap = extractAssessmentSnapshot(row);
      return {
        assessmentId: snap.assessmentId,
        assessmentType: snap.assessmentType,
        submittedAt: snap.submittedAt,
        painAtRest: snap.painAtRest,
        painOnMovement: snap.painOnMovement,
        bodyRegion: snap.bodyRegion,
      };
    });
}

export function buildCvEvidenceTimeline(
  rows: CvMetricInput[],
): ProgressOutcomesCvEvidenceEntry[] {
  return [...rows]
    .sort(
      (a, b) =>
        new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
    )
    .map((row) => ({
      id: row.id,
      recordedAt: row.recorded_at,
      exerciseId: row.exercise_id,
      sessionDurationS: row.session_duration_s,
      repCount: row.rep_count,
      trackingQuality: row.tracking_quality,
      movementDetected: row.movement_detected,
      source: row.source,
      planSessionId: row.plan_session_id,
    }));
}

export function buildProgressOutcomesBundle(input: {
  patientId: string;
  patientName: string;
  planId: string | null;
  planTitle: string | null;
  sessionsCompleted: number;
  totalSessions: number;
  sessionLogs: SessionLogInput[];
  sessionNumberById: Map<string, number>;
  assessmentRows: AssessmentPickInput[];
  cvMetricRows: CvMetricInput[];
  interactiveShoulderOutcomeRows: InteractiveShoulderOutcomeReportRow[];
  interactiveShoulderChartOutcomeRows: InteractiveShoulderOutcomeReportRow[];
  interactiveShoulderChartSessionLogs: SessionLogInput[];
  interactiveShoulderChartSessionNumberById: Map<string, number>;
}): ProgressOutcomesBundle {
  const adherence =
    input.planId && input.totalSessions > 0
      ? {
          planId: input.planId,
          completed: input.sessionsCompleted,
          total: input.totalSessions,
          progressPct:
            input.totalSessions > 0
              ? Math.round((input.sessionsCompleted / input.totalSessions) * 100)
              : 0,
        }
      : input.planId
        ? {
            planId: input.planId,
            completed: input.sessionsCompleted,
            total: input.totalSessions,
            progressPct: 0,
          }
        : null;

  return {
    patientId: input.patientId,
    patientName: input.patientName,
    planId: input.planId,
    planTitle: input.planTitle,
    adherence,
    painTrend: buildPainTrendFromSessionLogs(
      input.sessionLogs,
      input.sessionNumberById,
    ),
    assessments: buildAssessmentHistory(input.assessmentRows),
    cvEvidence: buildCvEvidenceTimeline(input.cvMetricRows),
    captureQualityHistory: buildCaptureQualityHistory(input.cvMetricRows),
    interactiveShoulderOutcomes: buildInteractiveShoulderOutcomeReportEntries(
      input.interactiveShoulderOutcomeRows,
    ),
    interactiveShoulderChartOutcomes: buildInteractiveShoulderOutcomeReportEntries(
      input.interactiveShoulderChartOutcomeRows,
    ),
    interactiveShoulderChartPainTrend: buildPainTrendFromSessionLogs(
      input.interactiveShoulderChartSessionLogs,
      input.interactiveShoulderChartSessionNumberById,
    ),
  };
}

export function assessmentTypeDisplayLabel(type: string): string {
  if (type === "general_msk") return "General MSK assessment";
  if (type === "structured") return "Structured assessment";
  if (type === "remote_questionnaire") return "Remote questionnaire";
  if (type === "questionnaire") return "Questionnaire";
  return type.replace(/_/g, " ");
}
