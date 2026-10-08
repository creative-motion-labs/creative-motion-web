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
  /** Short calendar date of the recorded session, shown under the label when present. */
  dateLabel?: string;
};

/** Patient-reported pain and effort are 0-10 scales: their axis must not stretch to the data. */
export const PATIENT_REPORTED_SCALE_MAX = 10;

export type ProgressChartSeries = {
  id: string;
  label: string;
  helper?: string;
  secondary?: boolean;
  /**
   * Fixed upper bound for a bounded scale (e.g. 10 for patient-reported pain/effort).
   * Without it the chart scales to the largest plotted value, which would make a 3/10 look
   * like a "full" bar next to a 4/10 on the same axis.
   */
  axisMax?: number;
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

// ── Comparable sessions & single-session baseline ─────────────────────

export const BASELINE_SESSION_TITLE = "Baseline — first comparable recorded session";
export const BASELINE_NEEDS_SECOND_SESSION_NOTE =
  "No trend can be shown from one session. A second comparable session is needed to calculate a trend.";
export const BASELINE_NOT_A_TREND_NOTE =
  "Single-session values are a starting point for therapist review, not a trend or a measure of change.";

/**
 * Two sessions are only comparable when they were treated on the same side AND used the same
 * active-block design. Summing left with right, or a target-reach session with a different
 * exercise pattern, would plot numbers that do not measure the same thing as one trend.
 * Instructional (warm-up / cool-down) blocks are ignored: they carry no performance data.
 * A legacy outcome saved before block types were recorded keeps its own "unknown" design
 * key, so it is never assumed to match a newer session.
 */
export function resolveOutcomeComparabilityKey(
  entry: InteractiveShoulderOutcomeReportEntry,
): string {
  const side = entry.prescribedSide ?? "unknown-side";
  const design = entry.blocks
    .filter((block) => block.displayCategory !== "instructional")
    .map((block) => `${block.blockType ?? "unknown"}:${block.movementId}:${block.blockId}`)
    .join("|");
  return `${side}#${design}`;
}

export type ComparableOutcomeSelection = {
  /** Chronological (oldest first). Empty when there are no outcomes. */
  comparable: InteractiveShoulderOutcomeReportEntry[];
  /** Recorded sessions deliberately left out because side or design differs. */
  excludedCount: number;
  sideLabel: "LEFT" | "RIGHT" | null;
};

/**
 * Picks the sessions that may share one trend: those comparable to the MOST RECENT session
 * (the current regimen). Everything else is counted, never silently dropped, so the
 * clinician is told how many recorded sessions are not charted.
 */
export function selectComparableOutcomes(
  outcomes: readonly InteractiveShoulderOutcomeReportEntry[],
): ComparableOutcomeSelection {
  if (outcomes.length === 0) return { comparable: [], excludedCount: 0, sideLabel: null };

  const chronological = sortInteractiveShoulderOutcomesChronologically([...outcomes]);
  const latest = chronological[chronological.length - 1]!;
  const key = resolveOutcomeComparabilityKey(latest);
  const comparable = chronological.filter((entry) => resolveOutcomeComparabilityKey(entry) === key);

  const side = latest.prescribedSide;
  return {
    comparable,
    excludedCount: chronological.length - comparable.length,
    sideLabel: side === "left" ? "LEFT" : side === "right" ? "RIGHT" : null,
  };
}

/** Note shown with the chart whenever some recorded sessions are not part of the trend. */
export function describeComparableSelection(selection: ComparableOutcomeSelection): string | null {
  if (selection.excludedCount === 0) return null;
  const charted = selection.comparable.length;
  const side = selection.sideLabel ? `${selection.sideLabel} side, ` : "";
  return (
    `${charted} comparable recorded session${charted === 1 ? "" : "s"} shown (${side}same session design). ` +
    `${selection.excludedCount} other recorded session${selection.excludedCount === 1 ? "" : "s"} ` +
    "not shown because the treated side or session design differs."
  );
}

export type BaselineSessionMetric = {
  id: string;
  label: string;
  value: string;
  helper?: string;
  secondary?: boolean;
};

/**
 * The first comparable session's measures, using exactly the same definitions, units and
 * visibility rules as the multi-session series (so a baseline can never show a value the
 * trend would not). A measure that was not recorded is simply absent.
 */
export function buildBaselineSessionMetrics(
  entry: InteractiveShoulderOutcomeReportEntry,
  painTrend: readonly ProgressOutcomesPainPoint[] = [],
): BaselineSessionMetric[] {
  const [point] = buildInteractiveShoulderSessionChartPoints([entry], painTrend);
  if (!point) return [];
  return buildClinicianProgressChartSeries([point]).flatMap((series) => {
    const value = series.values[0];
    if (value == null) return [];
    return [
      {
        id: series.id,
        label: series.label,
        value: series.valueFormatter(value),
        helper: series.helper,
        secondary: series.secondary,
      },
    ];
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
      axisMax: PATIENT_REPORTED_SCALE_MAX,
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
      axisMax: PATIENT_REPORTED_SCALE_MAX,
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
      axisMax: PATIENT_REPORTED_SCALE_MAX,
      values: pain,
      valueFormatter: (value) => `${Math.round(value)}/10`,
    });
  }

  const effort = points.map((point) => point.effortScore);
  if (effort.some((value) => value != null)) {
    series.push({
      id: "effort",
      label: labels.effort,
      axisMax: PATIENT_REPORTED_SCALE_MAX,
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

/** Clinician axis labels: session number plus the real calendar date of that session. */
export function toProgressChartDatedPointLabels(
  points: ReadonlyArray<
    Pick<InteractiveShoulderSessionChartPoint, "sessionId" | "sessionLabel" | "sessionDate">
  >,
  lang: PatientPortalLanguage = "en",
): ProgressChartPointLabel[] {
  return points.map((point) => ({
    sessionId: point.sessionId,
    sessionLabel: point.sessionLabel,
    dateLabel: formatPortalChartDate(point.sessionDate, lang),
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
