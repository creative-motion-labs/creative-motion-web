import type { PatientPortalLanguage } from "@/app/lib/patient-portal-ui";
import { formatPortalChartDate } from "@/app/lib/patient-portal-ui";
import type { InteractiveShoulderOutcomeReportEntry } from "@/app/lib/progress/progress-outcomes-bundle";
import type { ProgressOutcomesPainPoint } from "@/app/lib/progress/progress-outcomes-bundle";
import { aggregateInteractiveShoulderSessionMetrics } from "@/app/lib/progress/aggregate-interactive-shoulder-session-metrics";
import type { PatientShoulderProgressPoint } from "@/app/lib/progress/interactive-shoulder-patient-progress";

export {
  buildPatientShoulderProgressPointsFromSessions,
  type PatientShoulderProgressPoint,
} from "@/app/lib/progress/interactive-shoulder-patient-progress";

export const PROGRESS_OVER_SESSIONS_TITLE = "Progress over sessions";
export const PROGRESS_OVER_SESSIONS_REVIEW_NOTE = "For therapist review";
export const PROGRESS_OVER_SESSIONS_SUMMARY_HELPER =
  "Trend shown from recorded Interactive Shoulder sessions.";
export const SINGLE_SESSION_CHART_EMPTY_STATE =
  "Progress charts will appear after more recorded sessions.";

export const PATIENT_PROGRESS_OVER_TIME_TITLE = "Your progress over time";
export const PATIENT_PROGRESS_OVER_TIME_SUBTITLE =
  "A simple view of your completed sessions and how you felt.";

export const MIN_SESSIONS_FOR_PROGRESS_CHARTS = 2;

export type InteractiveShoulderSessionChartPoint = {
  sessionId: string;
  sessionLabel: string;
  sessionDate: string;
  targetsContacted: number;
  averageResponseTimeSeconds: number | null;
  patternsCompleted: number;
  compensationEvents: number;
  painAfter: number | null;
  effortScore: number | null;
};

export type ProgressChartPointLabel = {
  sessionId: string;
  sessionLabel: string;
};

export type ProgressChartSeries = {
  id: string;
  label: string;
  helper?: string;
  secondary?: boolean;
  values: Array<number | null>;
  valueFormatter: (value: number) => string;
};

export function sortInteractiveShoulderOutcomesChronologically(
  outcomes: InteractiveShoulderOutcomeReportEntry[],
): InteractiveShoulderOutcomeReportEntry[] {
  return [...outcomes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export type InteractiveShoulderProgressSessionsSummary = {
  recordedSessions: number;
  latestSessionAt: string | null;
  treatedSideLabel: string | null;
};

export function resolveProgressSessionsTreatedSideLabel(
  outcomes: readonly InteractiveShoulderOutcomeReportEntry[],
): string | null {
  if (outcomes.length === 0) return null;

  const sides = outcomes.map((outcome) => outcome.prescribedSide);
  if (sides.every((side) => side === "left")) return "LEFT";
  if (sides.every((side) => side === "right")) return "RIGHT";
  if (sides.some((side) => side === "left" || side === "right")) return "—";

  return null;
}

export function buildInteractiveShoulderProgressSessionsSummary(
  outcomes: readonly InteractiveShoulderOutcomeReportEntry[],
): InteractiveShoulderProgressSessionsSummary {
  const chronological = sortInteractiveShoulderOutcomesChronologically([...outcomes]);
  const latest = chronological[chronological.length - 1];

  return {
    recordedSessions: outcomes.length,
    latestSessionAt: latest?.createdAt ?? null,
    treatedSideLabel: resolveProgressSessionsTreatedSideLabel(outcomes),
  };
}

export function buildPainTrendByPlanSessionId(
  painTrend: readonly ProgressOutcomesPainPoint[],
): Map<string, { painAfter: number | null; effortScore: number | null }> {
  const map = new Map<string, { painAfter: number | null; effortScore: number | null }>();
  for (const point of painTrend) {
    if (!point.planSessionId) continue;
    map.set(point.planSessionId, {
      painAfter: point.painAfter,
      effortScore: point.effortScore,
    });
  }
  return map;
}

export function buildInteractiveShoulderSessionChartPoints(
  outcomes: InteractiveShoulderOutcomeReportEntry[],
  painTrend: readonly ProgressOutcomesPainPoint[] = [],
): InteractiveShoulderSessionChartPoint[] {
  const painByPlanSessionId = buildPainTrendByPlanSessionId(painTrend);

  return sortInteractiveShoulderOutcomesChronologically(outcomes).map((entry, index) => {
    const metrics = aggregateInteractiveShoulderSessionMetrics(entry);
    const patientReported = entry.planSessionId
      ? painByPlanSessionId.get(entry.planSessionId)
      : undefined;

    return {
      sessionId: entry.id,
      sessionLabel: `S${index + 1}`,
      sessionDate: entry.createdAt,
      targetsContacted: metrics.targetsContacted,
      averageResponseTimeSeconds:
        metrics.averageReactionMs != null ? metrics.averageReactionMs / 1000 : null,
      patternsCompleted: metrics.patternsCompleted,
      compensationEvents: metrics.compensationEvents,
      painAfter: patientReported?.painAfter ?? null,
      effortScore: patientReported?.effortScore ?? null,
    };
  });
}

function hasSeriesValues(values: Array<number | null>): boolean {
  return values.some((value) => value != null && value > 0);
}

export function buildClinicianProgressChartSeries(
  points: InteractiveShoulderSessionChartPoint[],
): ProgressChartSeries[] {
  const series: ProgressChartSeries[] = [];

  const targets = points.map((point) => point.targetsContacted);
  if (hasSeriesValues(targets)) {
    series.push({
      id: "targets",
      label: "Target interactions",
      helper: "Successful wrist-target interactions per session.",
      values: targets,
      valueFormatter: (value) => String(Math.round(value)),
    });
  }

  const responseTimes = points.map((point) => point.averageResponseTimeSeconds);
  if (responseTimes.some((value) => value != null)) {
    series.push({
      id: "response-time",
      label: "Avg target response time",
      helper: "Average time from target appearance to successful interaction.",
      values: responseTimes,
      valueFormatter: (value) => `${value.toFixed(1)} s`,
    });
  }

  const patterns = points.map((point) => point.patternsCompleted);
  if (hasSeriesValues(patterns)) {
    series.push({
      id: "d1-traces",
      label: "D1 path traces completed",
      helper: "Automated completions of the configured D1-inspired path; not prescribed repetition dose.",
      values: patterns,
      valueFormatter: (value) => String(Math.round(value)),
    });
  }

  const pain = points.map((point) => point.painAfter);
  if (pain.some((value) => value != null)) {
    series.push({
      id: "pain-after",
      label: "Patient-reported pain after session",
      helper: "Patient-reported value from session check-in; for therapist review.",
      values: pain,
      valueFormatter: (value) => `${Math.round(value)}/10`,
    });
  }

  const effort = points.map((point) => point.effortScore);
  if (effort.some((value) => value != null)) {
    series.push({
      id: "effort",
      label: "Patient-reported effort",
      helper: "Patient-reported effort from session check-in; for therapist review.",
      values: effort,
      valueFormatter: (value) => `${Math.round(value)}/10`,
    });
  }

  const compensation = points.map((point) => point.compensationEvents);
  if (hasSeriesValues(compensation)) {
    series.push({
      id: "compensation",
      label: "Compensation signal",
      helper: "Automated single-camera geometric proxy; not a validated clinical compensation measure.",
      secondary: true,
      values: compensation,
      valueFormatter: (value) => String(Math.round(value)),
    });
  }

  return series;
}

export function shouldShowInteractiveShoulderProgressCharts(sessionCount: number): boolean {
  return sessionCount >= MIN_SESSIONS_FOR_PROGRESS_CHARTS;
}

const PATIENT_PROGRESS_CHART_LABELS: Record<
  PatientPortalLanguage,
  { sessionsCompleted: string; painAfter: string; effort: string }
> = {
  en: {
    sessionsCompleted: "Sessions completed",
    painAfter: "How you felt after session",
    effort: "Your effort",
  },
  ar: {
    sessionsCompleted: "الجلسات المكتملة",
    painAfter: "شعورك بعد الجلسة",
    effort: "جهدك",
  },
};

export function buildPatientProgressChartSeries(
  points: PatientShoulderProgressPoint[],
  lang: PatientPortalLanguage = "en",
): ProgressChartSeries[] {
  const labels = PATIENT_PROGRESS_CHART_LABELS[lang];
  const series: ProgressChartSeries[] = [
    {
      id: "sessions-completed",
      label: labels.sessionsCompleted,
      values: points.map((_point, index) => index + 1),
      valueFormatter: (value) => String(Math.round(value)),
    },
  ];

  const pain = points.map((point) => point.painAfter);
  if (pain.some((value) => value != null)) {
    series.push({
      id: "pain-after",
      label: labels.painAfter,
      values: pain,
      valueFormatter: (value) => `${Math.round(value)}/10`,
    });
  }

  const effort = points.map((point) => point.effortScore);
  if (effort.some((value) => value != null)) {
    series.push({
      id: "effort",
      label: labels.effort,
      values: effort,
      valueFormatter: (value) => `${Math.round(value)}/10`,
    });
  }

  return series;
}

export function toProgressChartPointLabels(
  points: Array<{ sessionId: string; sessionLabel: string }>,
): ProgressChartPointLabel[] {
  return points.map((point) => ({
    sessionId: point.sessionId,
    sessionLabel: point.sessionLabel,
  }));
}

export function toProgressChartDateLabels(
  points: readonly Pick<PatientShoulderProgressPoint, "sessionId" | "completedAt">[],
  lang: PatientPortalLanguage,
): ProgressChartPointLabel[] {
  return points.map((point) => ({
    sessionId: point.sessionId,
    sessionLabel: formatPortalChartDate(point.completedAt, lang),
  }));
}
