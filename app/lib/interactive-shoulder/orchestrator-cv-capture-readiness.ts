/**
 * Capture-readiness delivery boundary for `OrchestratorCvSessionCore`. Issue #276.
 *
 * `onCaptureReadinessChange` is the only per-snapshot callback that leaves the
 * Interactive Shoulder runtime: it lands in `PatientExerciseSessionCard`, which
 * re-renders its whole card tree. #276 raised snapshot publication from one per 15
 * camera frames to one per frame so the wrist marker stops lagging — which means this
 * seam, and only this seam, had its fan-out rate multiplied by fifteen as a side
 * effect.
 *
 * Both decisions below are pure and live here rather than inline in the component for
 * the same reason `orchestrator-cv-runtime-fault` and `orchestrator-cv-session-completion`
 * do: this repository has no DOM or React renderer, so logic left inside the component
 * can only ever be mirror-tested. Extracted, the shipped decision itself is under test.
 *
 * This module makes NO clinical judgement. It reformats an already-measured framing
 * state into the existing guidance vocabulary and decides when to hand it over; it
 * never changes what was measured.
 */
import type { CaptureSetupGuidance } from "@/app/lib/cv/patient-cv-capture-readiness";
import type { BodyFramingState } from "@/app/lib/cv/body-framing-evaluator";
import type { ShoulderAbductionReachTrackingStatus } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { OrchestratorCvSessionCoreProps } from "./orchestrator-cv-session-types";

/**
 * The payload shape, derived from the prop it is passed to so the two can never drift.
 */
export type CaptureReadinessPayload = Parameters<
  NonNullable<OrchestratorCvSessionCoreProps["onCaptureReadinessChange"]>
>[0];

/**
 * Floor on the interval between deliveries to the ancestor.
 *
 * `resolveCaptureReadinessPayload` is a pure function of `evaluateBodyFraming`, which
 * is a per-frame threshold test with no hysteresis. A patient whose shoulder/hip
 * visibility or torso span sits ON one of those thresholds therefore flips framing
 * state frame to frame. Every flip is a genuine value change — a change-only guard
 * cannot bound it — so at one publication per camera frame the ancestor would re-render
 * at camera rate.
 *
 * 500 ms is not a tuned number: at ~30 fps it is exactly the interval this seam
 * received before #276 (15 frames), so it is provably never driven faster than it
 * already was, while the wrist measurement #276 is about keeps publishing every frame.
 * Milliseconds rather than frames, so the bound holds at any camera rate.
 */
export const READINESS_MIN_DELIVERY_INTERVAL_MS = 500;

/** The snapshot fields readiness is derived from — narrower than the full snapshot. */
export type CaptureReadinessSource = {
  bodyFramingState?: BodyFramingState;
  trackingStatus?: ShoulderAbductionReachTrackingStatus;
  previewActive?: boolean;
} | null;

/**
 * Reformats a published snapshot into the ancestor's guidance vocabulary. Unchanged
 * behaviour from the inline version this replaces — same branches, same order.
 */
export function resolveCaptureReadinessPayload(
  snap: CaptureReadinessSource,
): CaptureReadinessPayload {
  const framing = snap?.bodyFramingState ?? "checking";
  const canStart = framing === "good_distance" && snap?.trackingStatus === "tracking";
  const primaryGuidance: CaptureSetupGuidance = canStart
    ? "ready"
    : framing === "move_closer"
      ? "step_into_frame"
      : framing === "move_back"
        ? "move_farther"
        : framing === "low_visibility"
          ? "improve_lighting"
          : "adjust_position";
  return {
    primaryGuidance,
    canStartTracking: Boolean(canStart),
    minimumMet: framing !== "checking",
    previewActive: Boolean(snap?.previewActive),
  };
}

export function captureReadinessPayloadsEqual(
  a: CaptureReadinessPayload,
  b: CaptureReadinessPayload,
): boolean {
  return (
    a.primaryGuidance === b.primaryGuidance &&
    a.canStartTracking === b.canStartTracking &&
    a.minimumMet === b.minimumMet &&
    a.previewActive === b.previewActive
  );
}

/**
 * Whether this payload should be handed to the ancestor now.
 *
 * Delivers when the value actually changed AND either this is the session's first
 * payload, the camera preview started or stopped, or the rate floor has elapsed.
 *
 * `previewActive` is exempt from the floor because it is written once at start and
 * once at stop and never churns — and because `stop()` emits the final snapshot of the
 * session. Without the exemption a floor could swallow that last delivery and leave the
 * ancestor holding a stale "tracking" banner with no further publication to correct it.
 *
 * Callers must record `nowMs` as the last delivery time ONLY when this returns true.
 * Leaving the last DELIVERED payload in place on a skip is what makes the next
 * publication (~33 ms later) re-offer the current state rather than treat the skipped
 * one as already sent — so a skip delays a change by at most the floor, never drops it.
 */
export function shouldDeliverCaptureReadiness(input: {
  previous: CaptureReadinessPayload | null;
  next: CaptureReadinessPayload;
  nowMs: number;
  lastDeliveredAtMs: number;
}): boolean {
  const { previous, next, nowMs, lastDeliveredAtMs } = input;
  if (!previous) return true;
  if (captureReadinessPayloadsEqual(previous, next)) return false;
  if (previous.previewActive !== next.previewActive) return true;
  return nowMs - lastDeliveredAtMs >= READINESS_MIN_DELIVERY_INTERVAL_MS;
}
