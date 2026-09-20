import type {
  ProgressChartPointLabel,
  ProgressChartSeries,
} from "@/app/lib/progress/interactive-shoulder-progress-charts";
import { resolveProgressChartSeriesColor } from "@/app/lib/progress/progress-session-chart-colors";

type ProgressSessionBarChartProps = {
  pointLabels: ProgressChartPointLabel[];
  series: ProgressChartSeries;
  variant?: "clinician" | "patient";
};

type PlotPoint = {
  x: number;
  y: number;
  value: number;
  index: number;
};

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 132;
const PADDING = { top: 18, right: 12, bottom: 28, left: 12 };

function chartMaxValue(values: Array<number | null>): number {
  const numeric = values.filter((value): value is number => value != null);
  if (numeric.length === 0) return 1;
  return Math.max(...numeric, 1);
}

function buildPlotPoints(values: Array<number | null>): PlotPoint[] {
  const max = chartMaxValue(values);
  const plotWidth = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom;
  const count = values.length;

  return values.flatMap((value, index) => {
    if (value == null) return [];

    const x =
      count === 1
        ? PADDING.left + plotWidth / 2
        : PADDING.left + (index / (count - 1)) * plotWidth;
    const y = PADDING.top + plotHeight - (value / max) * plotHeight;

    return [{ x, y, value, index }];
  });
}

function buildLineSegments(points: PlotPoint[]): string[] {
  if (points.length < 2) return [];

  const segments: string[] = [];
  let current: PlotPoint[] = [points[0]!];

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    const previous = current[current.length - 1]!;

    if (point.index === previous.index + 1) {
      current.push(point);
      continue;
    }

    if (current.length >= 2) {
      segments.push(
        current.map((entry, idx) => `${idx === 0 ? "M" : "L"} ${entry.x} ${entry.y}`).join(" "),
      );
    }
    current = [point];
  }

  if (current.length >= 2) {
    segments.push(
      current.map((entry, idx) => `${idx === 0 ? "M" : "L"} ${entry.x} ${entry.y}`).join(" "),
    );
  }

  return segments;
}

export function ProgressSessionBarChart({
  pointLabels,
  series,
  variant = "clinician",
}: ProgressSessionBarChartProps) {
  const isPatient = variant === "patient";
  const colors = resolveProgressChartSeriesColor(series.id, {
    secondary: series.secondary,
    variant,
  });
  const plotPoints = buildPlotPoints(series.values);
  const lineSegments = buildLineSegments(plotPoints);
  const gridY = PADDING.top + (VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom) / 2;

  return (
    <div
      className={
        isPatient
          ? "rounded-[8px] border border-[#E2E8E5] bg-[#F9FAFB] px-3 py-3"
          : "rounded-[8px] border border-[#1E2D42]/50 bg-[#0B1220]/40 px-3 py-3"
      }
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${
          series.secondary
            ? isPatient
              ? "text-[#9CA3AF]"
              : "text-white/35"
            : isPatient
              ? "text-[#374151]"
              : "text-white/55"
        }`}
      >
        {series.label}
      </p>
      {series.helper ? (
        <p className={`mt-1 text-[9px] leading-relaxed ${isPatient ? "text-[#9CA3AF]" : "text-white/30"}`}>
          {series.helper}
        </p>
      ) : null}

      <div className="mt-3 w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          className="h-[132px] w-full min-w-[240px]"
          role="img"
          aria-label={`${series.label} line chart across ${pointLabels.length} sessions`}
        >
          <line
            x1={PADDING.left}
            y1={gridY}
            x2={VIEWBOX_WIDTH - PADDING.right}
            y2={gridY}
            stroke={isPatient ? "#E2E8E5" : "#1E2D42"}
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          {lineSegments.map((segment, index) => (
            <path
              key={`${series.id}-segment-${index}`}
              d={segment}
              fill="none"
              stroke={colors.stroke}
              strokeWidth={colors.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={series.secondary ? 0.75 : 1}
            />
          ))}

          {plotPoints.map((point) => {
            const label = pointLabels[point.index];
            const formattedValue = series.valueFormatter(point.value);
            const sessionLabel = label?.sessionLabel ?? `S${point.index + 1}`;

            return (
              <g key={`${series.id}-${label?.sessionId ?? point.index}`}>
                <title>{`${sessionLabel}: ${formattedValue}`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={colors.pointRadius}
                  fill={colors.pointFill}
                  stroke={isPatient ? "#FFFFFF" : "#0B1220"}
                  strokeWidth={1.5}
                />
                <text
                  x={point.x}
                  y={point.y - 10}
                  textAnchor="middle"
                  fontSize="9"
                  fill={isPatient ? colors.valueText : colors.valueText}
                  style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
                >
                  {formattedValue}
                </text>
                <text
                  x={point.x}
                  y={VIEWBOX_HEIGHT - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fill={isPatient ? "#9CA3AF" : "rgba(255,255,255,0.35)"}
                >
                  {sessionLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
