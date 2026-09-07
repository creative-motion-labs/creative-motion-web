"use client";

import type { ObjectiveMetricSeries } from "@/app/lib/progress/objective-assessment-series";
import {
  formatObjectiveDate,
  formatObjectiveValue,
} from "@/app/lib/progress/objective-assessment-series";

type ObjectiveMetricTrendChartProps = {
  series: ObjectiveMetricSeries;
};

const VIEWBOX_WIDTH = 360;
const VIEWBOX_HEIGHT = 148;
const PADDING = { top: 22, right: 18, bottom: 32, left: 42 };

function chartDomain(values: number[]): { min: number; max: number } {
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) {
    const pad = max === 0 ? 1 : Math.abs(max) * 0.15;
    return { min: min - pad, max: max + pad };
  }
  const span = max - min;
  return { min: min - span * 0.12, max: max + span * 0.12 };
}

export function ObjectiveMetricTrendChart({ series }: ObjectiveMetricTrendChartProps) {
  const values = series.points.map((point) => point.value);
  const { min, max } = chartDomain(values);
  const plotWidth = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom;

  const points = series.points.map((point, index) => {
    const x =
      series.points.length === 1
        ? PADDING.left + plotWidth / 2
        : PADDING.left + (index / (series.points.length - 1)) * plotWidth;
    const y = PADDING.top + plotHeight - ((point.value - min) / (max - min)) * plotHeight;
    return { ...point, x, y, isLatest: index === series.points.length - 1 };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      className="h-[148px] w-full min-w-[260px]"
      role="img"
      aria-label={`${series.assessmentTitle} ${series.metricLabel} over assessment dates`}
    >
      <text
        x={12}
        y={16}
        fontSize="9"
        fill="rgba(255,255,255,0.35)"
        style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
      >
        {series.unit}
      </text>

      <line
        x1={PADDING.left}
        y1={PADDING.top}
        x2={PADDING.left}
        y2={VIEWBOX_HEIGHT - PADDING.bottom}
        stroke="#1E2D42"
        strokeWidth={1}
      />
      <line
        x1={PADDING.left}
        y1={VIEWBOX_HEIGHT - PADDING.bottom}
        x2={VIEWBOX_WIDTH - PADDING.right}
        y2={VIEWBOX_HEIGHT - PADDING.bottom}
        stroke="#1E2D42"
        strokeWidth={1}
      />

      {linePath ? (
        <path
          d={linePath}
          fill="none"
          stroke="#1D9E75"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      {points.map((point) => (
        <a key={point.resultId} href={point.workspaceHref}>
          <title>
            {`${formatObjectiveDate(point.recordedAt)}: ${formatObjectiveValue(point.value, series.unit)}`}
          </title>
          <circle
            cx={point.x}
            cy={point.y}
            r={point.isLatest ? 5 : 4}
            fill={point.isLatest ? "#5DCAA5" : "#1D9E75"}
            stroke="#0B1220"
            strokeWidth={1.5}
          />
          <text
            x={point.x}
            y={point.y - 10}
            textAnchor="middle"
            fontSize="9"
            fill="#F9FAFB"
            style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}
          >
            {formatObjectiveValue(point.value, series.unit)}
          </text>
          <text
            x={point.x}
            y={VIEWBOX_HEIGHT - 10}
            textAnchor="middle"
            fontSize="9"
            fill="rgba(255,255,255,0.35)"
          >
            {formatObjectiveDate(point.recordedAt)}
          </text>
        </a>
      ))}
    </svg>
  );
}
