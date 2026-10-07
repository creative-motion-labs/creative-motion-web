import {
  clinicalActionNeedsTherapistReview,
  deriveClinicalAction,
  type ClinicalActionStatus,
} from "@/app/lib/clinical-action-engine";
import { formatCvDuration } from "@/app/lib/cv/cv-metrics-display";
import { isGaitAssessmentExerciseId } from "@/app/lib/cv/gait-assessment-exercise-ids";
import { parseSessionCoachNotes } from "@/app/lib/session-coach-metadata";

export type TimelineEventType =
  | "assessment_submitted"
  | "assessment_report_available"
  | "assessment_movement_captured"
  | "plan_assigned"
  | "session_completed"
  | "review_flag_raised"
  | "review_completed";

export type TimelineEventSeverity = "info" | "warning" | "action";

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  label: string;
  detail?: string;
  severity?: TimelineEventSeverity;
  href?: string;
};

export type TimelineCvCapture = {
  id: string;
  recordedAt: string;
  exerciseId: string;
  exerciseLabel: string;
  sessionDurationS: number | null;
  source: string;
};

export type TimelineAssessment = {
  id: string;
  created_at: string;
  type?: string;
  assessment_type?: string;
  status?: string;
};

export type TimelinePlan = {
  id: string;
  created_at: string;
  title?: string | null;
  planTitle?: string | null;
  programName?: string | null;
  structured_data?: { programName?: string } | null;
};

export type TimelineSessionLog = {
  id: string;
  completed_at: string;
  pain_score?: number | null;
  effort_score?: number | null;
  session_number?: number | null;
  notes?: string | null;
};

export type TimelineReviewAck = {
  id: string;
  reviewed_at: string;
  review_note?: string | null;
};

export type TimelineRemoteRequest = {
  id: string;
  created_at?: string;
  createdAt?: string;
  status: string;
  submitted_at?: string | null;
  submittedAt?: string | null;
};

const FLAG_LABELS: Partial<Record<ClinicalActionStatus, string>> = {
  needs_review: "Flag raised: Patient-reported pain ≥8/10",
  pain_increase:
    "Flag raised: Patient-reported pain increased over 2 consecutive sessions",
  adherence_follow_up: "Flag raised: No session completed in 7+ days",
  high_effort: "Flag raised: Patient-reported effort ≥9/10 for 3+ sessions",
};

function assessmentTypeLabel(type: string | undefined): string {
  if (type === "remote_questionnaire") return "Remote questionnaire";
  if (type === "general_msk") return "Clinical assessment";
  if (type === "upper_limb_motor_screen") return "Remote Upper-Limb Battery";
  return "Clinical assessment";
}

function planDetail(plan: TimelinePlan): string | undefined {
  return (
    plan.planTitle ??
    plan.programName ??
    plan.title ??
    plan.structured_data?.programName ??
    undefined
  );
}

function remoteCreatedAt(req: TimelineRemoteRequest): string | null {
  return req.created_at ?? req.createdAt ?? null;
}

function flagLabelForSession(
  status: ClinicalActionStatus,
  painAfter: number | null,
  safetyConcern: boolean,
): string | null {
  if (!clinicalActionNeedsTherapistReview(status)) return null;

  if (status === "needs_review") {
    if (painAfter != null && painAfter >= 8) {
      return FLAG_LABELS.needs_review ?? null;
    }
    if (safetyConcern) {
      return "Flag raised: Patient reported a safety concern";
    }
    return "Flag raised: Therapist review recommended";
  }

  return FLAG_LABELS[status] ?? null;
}

function assessmentModuleHref(exerciseId: string): string | undefined {
  const id = exerciseId.trim().toLowerCase();
  if (isGaitAssessmentExerciseId(id)) return "/clinician/assessments/gait";
  if (id === "single-leg-stance") return "/clinician/assessments/single-leg-stance";
  if (id === "functional-reach") return "/clinician/assessments/functional-reach";
  if (id === "timed-up-and-go") return "/clinician/assessments/timed-up-and-go";
  return undefined;
}

export function buildPatientTimeline(data: {
  assessments: TimelineAssessment[];
  plans: TimelinePlan[];
  sessionLogs: TimelineSessionLog[];
  reviewAcknowledgments: TimelineReviewAck[];
  remoteAssessmentRequests?: TimelineRemoteRequest[];
  cvCaptures?: TimelineCvCapture[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const req of data.remoteAssessmentRequests ?? []) {
    const createdAt = remoteCreatedAt(req);
    if (!createdAt) continue;

    const submitted = req.status === "submitted";
    events.push({
      id: `req-${req.id}`,
      type: "assessment_submitted",
      timestamp: createdAt,
      label: "Assessment link sent to patient",
      detail: submitted ? "Patient submitted assessment" : "Awaiting patient response",
      severity: "info",
    });

    const submittedAt = req.submitted_at ?? req.submittedAt;
    if (submitted && submittedAt) {
      events.push({
        id: `req-submitted-${req.id}`,
        type: "assessment_submitted",
        timestamp: submittedAt,
        label: "Assessment submitted",
        detail: "Remote questionnaire",
        severity: "info",
      });
    }
  }

  for (const assessment of data.assessments) {
    if (!assessment.created_at) continue;
    events.push({
      id: `assessment-${assessment.id}`,
      type: "assessment_submitted",
      timestamp: assessment.created_at,
      label: "Assessment submitted",
      detail: assessmentTypeLabel(assessment.type ?? assessment.assessment_type),
      severity: "info",
    });
  }

  for (const plan of data.plans) {
    if (!plan.created_at) continue;
    events.push({
      id: `plan-${plan.id}`,
      type: "plan_assigned",
      timestamp: plan.created_at,
      label: "Rehabilitation plan assigned",
      detail: planDetail(plan),
      severity: "info",
    });
  }

  for (const capture of data.cvCaptures ?? []) {
    if (!capture.recordedAt) continue;
    const duration = formatCvDuration(capture.sessionDurationS);
    const sourceLabel = capture.source === "patient_session" ? "Patient portal" : "Assessment";
    events.push({
      id: `cv-${capture.id}`,
      type: "assessment_movement_captured",
      timestamp: capture.recordedAt,
      label: `${sourceLabel} movement captured`,
      detail: `${capture.exerciseLabel} · ${duration}`,
      severity: "action",
      href: assessmentModuleHref(capture.exerciseId),
    });
  }

  for (const log of data.sessionLogs) {
    if (!log.completed_at) continue;

    const parts: string[] = [];
    if (log.pain_score != null) {
      parts.push(`Patient-reported pain: ${log.pain_score}/10`);
    }
    if (log.effort_score != null) {
      parts.push(`Patient-reported effort: ${log.effort_score}/10`);
    }

    const coachMeta = parseSessionCoachNotes(log.notes);
    const sessionAction = deriveClinicalAction({
      painBefore: coachMeta.painBefore,
      painAfter: log.pain_score ?? null,
      effortScore: log.effort_score ?? null,
      safetyConcern: coachMeta.safetyConcern,
      completedSessionsCount: 0,
      missedSessionsCount: 0,
      stableSessionsCount: 0,
    });

    const needsReview = clinicalActionNeedsTherapistReview(sessionAction.status);

    events.push({
      id: `session-${log.id}`,
      type: "session_completed",
      timestamp: log.completed_at,
      label: log.session_number
        ? `Session ${log.session_number} completed`
        : "Session completed",
      detail: parts.length > 0 ? parts.join(" · ") : undefined,
      severity: needsReview ? "warning" : "info",
    });

    const flagLabel = flagLabelForSession(
      sessionAction.status,
      log.pain_score ?? null,
      coachMeta.safetyConcern,
    );

    if (flagLabel) {
      events.push({
        id: `flag-${log.id}`,
        type: "review_flag_raised",
        timestamp: log.completed_at,
        label: flagLabel,
        detail: "Therapist review recommended",
        severity: "warning",
      });
    }
  }

  for (const ack of data.reviewAcknowledgments) {
    if (!ack.reviewed_at) continue;
    events.push({
      id: `review-${ack.id}`,
      type: "review_completed",
      timestamp: ack.reviewed_at,
      label: "Therapist reviewed",
      detail: ack.review_note?.trim()
        ? `Note: ${ack.review_note.trim()}`
        : undefined,
      severity: "action",
    });
  }

  return events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function formatTimelineTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const datePart = date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const timePart = date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${datePart} · ${timePart}`;
  } catch {
    return iso;
  }
}

export function formatRelativeTimelineTime(iso: string): string {
  try {
    const deltaMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 14) return `${days}d ago`;
    return formatTimelineTimestamp(iso);
  } catch {
    return formatTimelineTimestamp(iso);
  }
}
