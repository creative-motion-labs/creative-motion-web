/**
 * Read-only Patient Profile objective-results view model.
 * Charts persisted measurements only. No composite scores. No write path.
 */

import { formatCvTrackingSignal } from "@/app/lib/cv/cv-metrics-display";
import {
  extractRemoteUpperLimbBatteryFromStructuredData,
  findBatteryRomTest,
  peakObservedAngleDeg,
} from "@/app/lib/remote-upper-limb-battery/extract-battery-payload";
import type { RemoteUpperLimbBatterySide } from "@/app/lib/remote-upper-limb-battery/types";

export const OBJECTIVE_RESULTS_SECTION_TITLE = "Progress & Objective Results";

export const OBJECTIVE_RESULTS_DISCLAIMER =
  "Camera-assisted and timed observations for therapist review. Not a diagnosis. Not a RASQ score or stroke severity score.";

export const OBJECTIVE_RESULTS_EMPTY_TITLE = "No objective assessment results yet";

export const OBJECTIVE_RESULTS_EMPTY_BODY =
  "Completed Timed Up and Go, Single-Leg Stance, Sit-to-Stand, or Remote Upper-Limb Battery results will appear here after they are saved.";

export const OBJECTIVE_RESULTS_DIRECTION_COPY = {
  tug: "Lower time may indicate improved performance.",
  sls: "Longer duration may indicate improved performance.",
  sts: "Higher rep count may reflect more completed stands.",
  ulAngle: "Greater observed angle is not automatically improvement.",
} as const;

export const ASSESSMENT_MOVEMENT_SOURCE = "assessment_movement";

export const OBJECTIVE_CV_EXERCISE_IDS = {
  tug: "timed-up-and-go",
  sls: "single-leg-stance",
  sts: "sit-to-stand",
} as const;

export type ObjectiveAssessmentKey = "tug" | "sls" | "sts" | "ulms-battery";

export type ObjectiveMetricKey =
  | "tug.completion_time_s"
  | "sls.duration_s"
  | "sts.rep_count"
  | "ulms-battery.shoulder_flexion_deg"
  | "ulms-battery.shoulder_abduction_deg"
  | "ulms-battery.elbow_flexion_deg";

export type ObjectiveCvMetricInput = {
  id: string;
  exerciseId: string;
  repCount: number | null;
  sessionDurationS: number | null;
  trackingQuality: string | null;
  source: string;
  recordedAt: string;
};

export type ObjectiveBatteryAssessmentInput = {
  id: string;
  type: string;
  createdAt: string;
  structuredData: unknown;
};

export type ObjectiveResultPoint = {
  resultId: string;
  sourceEventId: string;
  recordedAt: string;
  value: number;
  quality: string | null;
  workspaceHref: string;
};

export type ObjectiveComparableChange = {
  baselineValue: number;
  latestValue: number;
  delta: number;
};

export type ObjectiveMetricSeries = {
  seriesId: string;
  assessmentKey: ObjectiveAssessmentKey;
  metricKey: ObjectiveMetricKey;
  assessmentTitle: string;
  metricLabel: string;
  unit: string;
  side: RemoteUpperLimbBatterySide | null;
  directionCopy: string;
  workspaceHref: string;
  points: ObjectiveResultPoint[];
  latest: ObjectiveResultPoint;
  baseline: ObjectiveResultPoint;
  change: ObjectiveComparableChange | null;
};

export type LatestObjectiveEvent = {
  assessmentTitle: string;
  recordedAt: string;
  quality: string | null;
  workspaceHref: string;
  results: Array<{
    seriesId: string;
    metricLabel: string;
    value: number;
    unit: string;
    change: ObjectiveComparableChange | null;
  }>;
};

export type ObjectiveResultsViewModel = {
  patientId: string;
  series: ObjectiveMetricSeries[];
  latestEvent: LatestObjectiveEvent | null;
};

function tugWorkspaceHref(patientId: string): string {
  return `/clinician/assessments/timed-up-and-go?patientId=${encodeURIComponent(patientId)}`;
}

function slsWorkspaceHref(patientId: string): string {
  return `/clinician/assessments/single-leg-stance?patientId=${encodeURIComponent(patientId)}`;
}

function stsWorkspaceHref(patientId: string): string {
  return `/clinician/assessments/sit-to-stand?patientId=${encodeURIComponent(patientId)}`;
}

function batteryReportHref(patientId: string, assessmentId: string): string {
  return `/clinician/assessment/report?patientId=${encodeURIComponent(patientId)}&assessmentId=${encodeURIComponent(assessmentId)}`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sortPointsChronologically(points: ObjectiveResultPoint[]): ObjectiveResultPoint[] {
  return [...points].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
}

function buildChange(
  baseline: ObjectiveResultPoint,
  latest: ObjectiveResultPoint,
): ObjectiveComparableChange | null {
  if (baseline.resultId === latest.resultId) return null;
  return {
    baselineValue: baseline.value,
    latestValue: latest.value,
    delta: latest.value - baseline.value,
  };
}

function finalizeSeries(
  input: Omit<ObjectiveMetricSeries, "latest" | "baseline" | "change" | "workspaceHref" | "points"> & {
    workspaceHref: string;
    points: ObjectiveResultPoint[];
  },
): ObjectiveMetricSeries | null {
  const points = sortPointsChronologically(input.points);
  if (points.length === 0) return null;
  const baseline = points[0]!;
  const latest = points[points.length - 1]!;
  return {
    ...input,
    points,
    baseline,
    latest,
    change: buildChange(baseline, latest),
    workspaceHref: latest.workspaceHref,
  };
}

function collectCvSeries(input: {
  patientId: string;
  rows: readonly ObjectiveCvMetricInput[];
  exerciseId: string;
  assessmentKey: "tug" | "sls" | "sts";
  metricKey: ObjectiveMetricKey;
  assessmentTitle: string;
  metricLabel: string;
  unit: string;
  directionCopy: string;
  workspaceHref: string;
  readValue: (row: ObjectiveCvMetricInput) => number | null;
}): ObjectiveMetricSeries | null {
  const points: ObjectiveResultPoint[] = [];
  for (const row of input.rows) {
    if (row.exerciseId !== input.exerciseId) continue;
    if (row.source !== ASSESSMENT_MOVEMENT_SOURCE) continue;
    const value = input.readValue(row);
    if (!isFiniteNumber(value)) continue;
    if (typeof row.recordedAt !== "string" || !row.recordedAt.trim()) continue;
    points.push({
      resultId: row.id,
      sourceEventId: row.id,
      recordedAt: row.recordedAt,
      value,
      quality: row.trackingQuality,
      workspaceHref: input.workspaceHref,
    });
  }

  return finalizeSeries({
    seriesId: input.metricKey,
    assessmentKey: input.assessmentKey,
    metricKey: input.metricKey,
    assessmentTitle: input.assessmentTitle,
    metricLabel: input.metricLabel,
    unit: input.unit,
    side: null,
    directionCopy: input.directionCopy,
    workspaceHref: input.workspaceHref,
    points,
  });
}

function collectBatterySeries(input: {
  patientId: string;
  assessments: readonly ObjectiveBatteryAssessmentInput[];
  testId: "shoulderAbduction" | "shoulderFlexion" | "elbowFlexion";
  metricKey: ObjectiveMetricKey;
  metricLabel: string;
  side: RemoteUpperLimbBatterySide;
}): ObjectiveMetricSeries | null {
  const points: ObjectiveResultPoint[] = [];

  for (const assessment of input.assessments) {
    if (assessment.type !== "upper_limb_motor_screen") continue;
    const battery = extractRemoteUpperLimbBatteryFromStructuredData(assessment.structuredData);
    if (!battery) continue;
    if (battery.testedSide !== input.side) continue;
    const test = findBatteryRomTest(battery, input.testId);
    if (!test) continue;
    const value = peakObservedAngleDeg(test.peakAnglesDeg);
    if (!isFiniteNumber(value)) continue;
    const recordedAt = battery.completedAt.trim() || assessment.createdAt;
    if (!recordedAt) continue;
    const href = batteryReportHref(input.patientId, assessment.id);
    points.push({
      resultId: `${assessment.id}:${input.testId}`,
      sourceEventId: assessment.id,
      recordedAt,
      value,
      quality: test.trackingQuality,
      workspaceHref: href,
    });
  }

  const sideLabel = input.side === "left" ? "left" : "right";
  return finalizeSeries({
    seriesId: `${input.metricKey}.${input.side}`,
    assessmentKey: "ulms-battery",
    metricKey: input.metricKey,
    assessmentTitle: `Upper-Limb Motor Screen (${sideLabel})`,
    metricLabel: input.metricLabel,
    unit: "degrees",
    side: input.side,
    directionCopy: OBJECTIVE_RESULTS_DIRECTION_COPY.ulAngle,
    workspaceHref: batteryReportHref(input.patientId, "pending"),
    points,
  });
}

export function buildPatientObjectiveResults(input: {
  patientId: string;
  cvMetrics: readonly ObjectiveCvMetricInput[];
  batteryAssessments: readonly ObjectiveBatteryAssessmentInput[];
}): ObjectiveResultsViewModel {
  const patientId = input.patientId.trim();
  const series: ObjectiveMetricSeries[] = [];

  const tug = collectCvSeries({
    patientId,
    rows: input.cvMetrics,
    exerciseId: OBJECTIVE_CV_EXERCISE_IDS.tug,
    assessmentKey: "tug",
    metricKey: "tug.completion_time_s",
    assessmentTitle: "Timed Up and Go",
    metricLabel: "Completion time",
    unit: "seconds",
    directionCopy: OBJECTIVE_RESULTS_DIRECTION_COPY.tug,
    workspaceHref: tugWorkspaceHref(patientId),
    readValue: (row) => row.sessionDurationS,
  });
  if (tug) series.push(tug);

  const sls = collectCvSeries({
    patientId,
    rows: input.cvMetrics,
    exerciseId: OBJECTIVE_CV_EXERCISE_IDS.sls,
    assessmentKey: "sls",
    metricKey: "sls.duration_s",
    assessmentTitle: "Single-Leg Stance",
    metricLabel: "Duration",
    unit: "seconds",
    directionCopy: OBJECTIVE_RESULTS_DIRECTION_COPY.sls,
    workspaceHref: slsWorkspaceHref(patientId),
    readValue: (row) => row.sessionDurationS,
  });
  if (sls) series.push(sls);

  const sts = collectCvSeries({
    patientId,
    rows: input.cvMetrics,
    exerciseId: OBJECTIVE_CV_EXERCISE_IDS.sts,
    assessmentKey: "sts",
    metricKey: "sts.rep_count",
    assessmentTitle: "Sit-to-Stand",
    metricLabel: "Rep count",
    unit: "reps",
    directionCopy: OBJECTIVE_RESULTS_DIRECTION_COPY.sts,
    workspaceHref: stsWorkspaceHref(patientId),
    readValue: (row) => row.repCount,
  });
  if (sts) series.push(sts);

  for (const side of ["right", "left"] as const) {
    const abduction = collectBatterySeries({
      patientId,
      assessments: input.batteryAssessments,
      testId: "shoulderAbduction",
      metricKey: "ulms-battery.shoulder_abduction_deg",
      metricLabel: "Shoulder abduction peak angle",
      side,
    });
    if (abduction) series.push(abduction);

    const flexion = collectBatterySeries({
      patientId,
      assessments: input.batteryAssessments,
      testId: "shoulderFlexion",
      metricKey: "ulms-battery.shoulder_flexion_deg",
      metricLabel: "Shoulder flexion peak angle",
      side,
    });
    if (flexion) series.push(flexion);

    const elbow = collectBatterySeries({
      patientId,
      assessments: input.batteryAssessments,
      testId: "elbowFlexion",
      metricKey: "ulms-battery.elbow_flexion_deg",
      metricLabel: "Elbow flexion peak angle",
      side,
    });
    if (elbow) series.push(elbow);
  }

  return {
    patientId,
    series,
    latestEvent: buildLatestObjectiveEvent(series),
  };
}

export function buildLatestObjectiveEvent(
  series: readonly ObjectiveMetricSeries[],
): LatestObjectiveEvent | null {
  let newest: { series: ObjectiveMetricSeries; point: ObjectiveResultPoint } | null = null;
  for (const item of series) {
    for (const point of item.points) {
      if (
        !newest ||
        new Date(point.recordedAt).getTime() > new Date(newest.point.recordedAt).getTime()
      ) {
        newest = { series: item, point };
      }
    }
  }
  if (!newest) return null;

  const eventId = newest.point.sourceEventId;
  const results = series.flatMap((item) => {
    const point = item.points.find((entry) => entry.sourceEventId === eventId);
    if (!point) return [];
    return [
      {
        seriesId: item.seriesId,
        metricLabel: item.metricLabel,
        value: point.value,
        unit: item.unit,
        change: item.change,
      },
    ];
  });

  return {
    assessmentTitle: newest.series.assessmentTitle,
    recordedAt: newest.point.recordedAt,
    quality: newest.point.quality,
    workspaceHref: newest.point.workspaceHref,
    results,
  };
}

export function formatObjectiveValue(value: number, unit: string): string {
  if (unit === "reps") return `${Math.round(value)} ${unit}`;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (unit === "degrees") return `${rounded}°`;
  if (unit === "seconds") return `${rounded} s`;
  return `${rounded} ${unit}`;
}

export function formatObjectiveChange(
  change: ObjectiveComparableChange | null,
  unit: string,
): string | null {
  if (!change) return null;
  const formatted = formatObjectiveValue(change.delta, unit);
  const sign = change.delta > 0 ? "+" : "";
  return `Change: ${sign}${formatted}`;
}

export function formatObjectiveQuality(quality: string | null): string {
  return formatCvTrackingSignal(quality);
}

export function formatObjectiveDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
