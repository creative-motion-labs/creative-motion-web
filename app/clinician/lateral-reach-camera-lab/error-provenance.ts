/**
 * Lateral Reach Camera Lab — Runtime QA: error provenance helpers.
 *
 * Pure decision helpers for fail-closed camera error recovery ownership.
 * Explicit provenance tracking prevents calibration errors from exposing
 * legacy Start Session / Retry controls.
 */

export type ErrorProvenance = "legacy" | "calibration" | null;

export type DetectorStatus = "idle" | "initializing" | "acquiring" | "running" | "error";

/**
 * Pure decision helper: is the legacy Retry button eligible given current
 * detector error state and explicit start provenance?
 *
 * Safe fail-closed semantics:
 * - Legacy Retry ONLY when provenance is explicitly "legacy"
 * - Calibration errors (provenance "calibration") remain hidden even if lifecycle is idle
 * - Unknown/null provenance fails closed (no Retry)
 */
export function isLegacyRetryEligible(
  detectorStatus: DetectorStatus,
  lastStartIntention: ErrorProvenance,
): boolean {
  return detectorStatus === "error" && lastStartIntention === "legacy";
}

/**
 * Pure decision helper: is the legacy Start Session button eligible given
 * current detector state and explicit start provenance?
 *
 * Critical fail-closed semantics for error state:
 * - Legacy Start Session ONLY when detector is idle OR (error AND provenance "legacy")
 * - Calibration errors (provenance "calibration") hide Start Session even if lifecycle is idle
 * - Unknown/null error provenance hides Start Session (fail-closed)
 * - Initializing, acquiring, running states hide Start Session (existing behavior)
 */
export function isLegacyStartSessionEligible(
  detectorStatus: DetectorStatus,
  lastStartIntention: ErrorProvenance,
): boolean {
  if (detectorStatus === "idle") return true;
  if (detectorStatus === "error" && lastStartIntention === "legacy") return true;
  return false;
}
