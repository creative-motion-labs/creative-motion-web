/** Pass-through gate for raw measured timing samples — no fabrication. */
export function extractReactionTimeSampleMs(reactionTimeMs: unknown): number | null {
  return typeof reactionTimeMs === "number" && Number.isFinite(reactionTimeMs) && reactionTimeMs >= 0
    ? reactionTimeMs
    : null;
}

/** Pass-through gate for raw measured peak-angle samples — no fabrication. */
export function extractPeakAngleSampleDegrees(
  metrics: Record<string, unknown> | undefined,
): number | null {
  const peak = metrics?.peakAngleDegrees;
  return typeof peak === "number" && Number.isFinite(peak) ? peak : null;
}
