export type ProgressChartSeriesColor = {
  stroke: string;
  pointFill: string;
  valueText: string;
  strokeWidth: number;
  pointRadius: number;
};

export const PROGRESS_CHART_SERIES_COLORS: Record<string, ProgressChartSeriesColor> = {
  targets: {
    stroke: "#3B82F6",
    pointFill: "#3B82F6",
    valueText: "#60A5FA",
    strokeWidth: 2,
    pointRadius: 4,
  },
  "response-time": {
    stroke: "#8B5CF6",
    pointFill: "#8B5CF6",
    valueText: "#A78BFA",
    strokeWidth: 2,
    pointRadius: 4,
  },
  "d1-traces": {
    stroke: "#14B8A6",
    pointFill: "#14B8A6",
    valueText: "#2DD4BF",
    strokeWidth: 2,
    pointRadius: 4,
  },
  "pain-after": {
    stroke: "#F97316",
    pointFill: "#F97316",
    valueText: "#FB923C",
    strokeWidth: 2,
    pointRadius: 4,
  },
  effort: {
    stroke: "#F59E0B",
    pointFill: "#F59E0B",
    valueText: "#FBBF24",
    strokeWidth: 2,
    pointRadius: 4,
  },
  compensation: {
    stroke: "#64748B",
    pointFill: "#64748B",
    valueText: "#94A3B8",
    strokeWidth: 1.5,
    pointRadius: 3.5,
  },
  "sessions-completed": {
    stroke: "#2563EB",
    pointFill: "#2563EB",
    valueText: "#3B82F6",
    strokeWidth: 2,
    pointRadius: 4,
  },
};

const FALLBACK_CLINICIAN_COLOR: ProgressChartSeriesColor = {
  stroke: "#1D9E75",
  pointFill: "#1D9E75",
  valueText: "#5DCAA5",
  strokeWidth: 2,
  pointRadius: 4,
};

const FALLBACK_PATIENT_COLOR: ProgressChartSeriesColor = {
  stroke: "#1D9E75",
  pointFill: "#1D9E75",
  valueText: "#1D9E75",
  strokeWidth: 2,
  pointRadius: 4,
};

export function resolveProgressChartSeriesColor(
  seriesId: string,
  options: { secondary?: boolean; variant?: "clinician" | "patient" } = {},
): ProgressChartSeriesColor {
  const mapped = PROGRESS_CHART_SERIES_COLORS[seriesId];
  if (mapped) {
    if (options.secondary && seriesId === "compensation") {
      return mapped;
    }
    return mapped;
  }

  return options.variant === "patient" ? FALLBACK_PATIENT_COLOR : FALLBACK_CLINICIAN_COLOR;
}
