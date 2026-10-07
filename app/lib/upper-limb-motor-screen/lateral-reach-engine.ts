/**
 * RASQ Upper-Limb Motor Screen — Phase 3: Seated Lateral Target Reach engine.
 *
 * A pure, command-driven reducer. Independent of forward-reach-engine.ts —
 * no shared module, no imported private logic, no refactor of Forward Reach.
 * No UI dependency, no Session Orchestrator dependency, no interactive-
 * shoulder state-machine reuse, no dependency on Mohammed's Interactive
 * Upper-Limb Rehabilitation work. Every externally meaningful transition
 * (readiness, resume, clinical stop, interruption, window end, manual
 * not-assessable) arrives as a named command — a "frame" command alone can
 * never finalize an attempt or resume a pause. No numeric threshold is
 * hardcoded anywhere in this file; every threshold is required, explicit
 * configuration, documented as needing CV validation / device testing /
 * capture-data calibration at its declaration site below.
 *
 * Camera orientation: this engine never detects mirroring, never transforms
 * preview coordinates, never infers camera orientation, and never mirrors
 * coordinates internally. It only ever consumes already-resolved raw-camera-
 * space geometry (fixedTarget/startingZone) and already-resolved raw-camera-
 * space wrist samples (NormalizedMotionFrame). The expected horizontal
 * reach direction is derived once, at config-validation time, purely from
 * the configured target and starting-zone x-coordinates — never from
 * screen-left/screen-right conventions, never from free-text direction, and
 * never inferred from motion. A configuration whose target and starting
 * zone share the same x-coordinate has no resolvable horizontal direction
 * and is rejected outright (validateLateralReachConfig returns ok:false) —
 * there is no code path that constructs a LateralReachAttemptState from such
 * a configuration, so an unresolved-orientation configuration can never
 * become an in-progress attempt, a technical pause, or a clinical stop.
 *
 * Directionality: the onset direction gate is a coarse, technical,
 * screen-space target-facing boundary-crossing check only. It never claims
 * anatomical scapular-plane verification — it only confirms that the
 * tested-side wrist has crossed the starting zone's target-facing horizontal
 * boundary (expectedSign * (wrist.x - startingZone.point.x) >
 * startingZone.radius). Pure vertical exits, non-target-facing exits, and
 * large vertical movement with tiny horizontal jitter never qualify. No
 * magnitude threshold or angular cone is invented beyond the configured
 * starting-zone radius.
 *
 * Composition only: distanceNormalized/isWristInsideTarget (target-hit.ts),
 * evaluateProtectivePause (protective-pause-evaluator.ts), isJointConfident
 * (motion-intelligence), and the Phase 1 types/guards/session-result safety
 * validator (types.ts) are imported read-only. Nothing in this file mutates
 * any of those modules, and this module never imports
 * resolveInteractiveShoulderSide, SHOULDER_ABDUCTION_REACH_BONUS_JOINTS,
 * clampToSafeBounds, or anything from forward-reach-engine.ts.
 *
 * Engine clock: every command carries its own nowMs, and the reducer
 * enforces one monotonic clock (lastAcceptedNowMs) across all seven command
 * types. Frame commands additionally require strictly increasing timestamps
 * (lastAcceptedFrameNowMs) — equal frame timestamps are rejected without
 * mutating state. A ClinicalStopEvent's recordedAt (an ISO string) and a
 * resumeRequested command's readinessConfirmedAt (also an ISO string) are
 * both purely evidentiary — neither is ever read as a clock input. Only the
 * numeric nowMs on each command drives engine time.
 */

import { isJointConfident, type JointId, type NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import { distanceNormalized, isWristInsideTarget } from "@/app/lib/interactive-shoulder/target-hit";
import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import { evaluateProtectivePause } from "./protective-pause-evaluator";
import {
  isCompletionStateConsistentWithEvents,
  isRecord,
  isValidProtectivePauseResumeActor,
  isValidUpperLimbSide,
  validateUpperLimbMotorScreenSessionResultSafety,
  type ClinicalStopEvent,
  type ProtectivePauseEvent,
  type ProtectivePauseReason,
  type UpperLimbAttemptCompletionState,
  type UpperLimbMovementAttemptResult,
  type UpperLimbSide,
} from "./types";

// ---------------------------------------------------------------------------
// Tested-side wrist resolution — local, exhaustive, no fallback.
// ---------------------------------------------------------------------------

const TESTED_SIDE_WRIST_JOINT_ID: Record<UpperLimbSide, JointId> = {
  left: "left_wrist",
  right: "right_wrist",
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type LateralReachZone = {
  point: NormalizedPoint;
  radius: number;
};

function isFiniteUnitCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveFiniteRadius(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

type ZoneValidationResult =
  | { ok: true; zone: LateralReachZone }
  | { ok: false; reason: "invalid_zone_geometry"; detail: string };

function validateZone(candidate: unknown, label: string): ZoneValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_zone_geometry", detail: `${label} must be an object` };
  }
  const point = candidate.point;
  if (!isRecord(point) || !isFiniteUnitCoordinate(point.x) || !isFiniteUnitCoordinate(point.y)) {
    return {
      ok: false,
      reason: "invalid_zone_geometry",
      detail: `${label}.point requires finite x and y within [0,1]`,
    };
  }
  if (!isPositiveFiniteRadius(candidate.radius)) {
    return { ok: false, reason: "invalid_zone_geometry", detail: `${label}.radius must be finite and > 0` };
  }
  return { ok: true, zone: { point: { x: point.x, y: point.y }, radius: candidate.radius } };
}

/** Circles touching or overlapping are rejected — a structural geometric rule, not a clinical threshold. */
function zonesOverlapOrTouch(a: LateralReachZone, b: LateralReachZone): boolean {
  return distanceNormalized(a.point, b.point) <= a.radius + b.radius;
}

/**
 * Screen-space horizontal projection separation only — not anatomical target
 * placement, camera orientation, mirroring, scapular plane, or ipsilateral/
 * contralateral anatomy verification.
 */
function hasInsufficientHorizontalTargetSeparation(startingZone: LateralReachZone, fixedTarget: LateralReachZone): boolean {
  const horizontalSeparation = Math.abs(fixedTarget.point.x - startingZone.point.x);
  return horizontalSeparation <= startingZone.radius + fixedTarget.radius;
}

/** Target-facing boundary crossed — screen-space geometry only. */
function hasCrossedTargetFacingBoundary(
  wristX: number,
  startingZoneCenterX: number,
  startingZoneRadius: number,
  expectedSign: 1 | -1,
): boolean {
  return expectedSign * (wristX - startingZoneCenterX) > startingZoneRadius;
}

/** Non-target-facing side exit — screen-space geometry only. */
function hasExitedNonTargetFacingSide(
  wristX: number,
  startingZoneCenterX: number,
  startingZoneRadius: number,
  expectedSign: 1 | -1,
): boolean {
  return expectedSign * (wristX - startingZoneCenterX) < -startingZoneRadius;
}

// ---------------------------------------------------------------------------
// Configuration — explicit, no internal defaults, no invented values.
// ---------------------------------------------------------------------------

export type LateralReachTrackingConfig = {
  /** needs CV validation, needs device testing. */
  minWristVisibility: number;
  /** needs CV validation, needs device testing. */
  maxAllowedGapMs: number;
};

export type LateralReachTimingConfig = {
  /** needs CV validation, needs capture-data calibration. */
  onsetConfirmationMs: number;
  /** needs CV validation, needs capture-data calibration. */
  dwellDurationMs: number;
  /** needs CV validation, needs capture-data calibration. */
  returnConfirmationMs: number;
};

export type LateralReachConfig = {
  testedSide: UpperLimbSide;
  fixedTarget: LateralReachZone;
  startingZone: LateralReachZone;
  tracking: LateralReachTrackingConfig;
  timing: LateralReachTimingConfig;
  /**
   * Derived once, at validation time, from
   * Math.sign(fixedTarget.point.x - startingZone.point.x). Never a clinical
   * or anatomical claim — a plain screen-space sign used only to gate onset
   * confirmation (see handleFrame's "ready_confirmed_awaiting_onset" case).
   * Guaranteed nonzero: a zero difference is rejected by
   * validateLateralReachConfig before a LateralReachConfig can exist.
   */
  readonly expectedHorizontalDirectionSign: 1 | -1;
};

export type LateralReachConfigValidationFailure =
  | "invalid_config"
  | "invalid_tested_side"
  | "invalid_zone_geometry"
  | "zones_overlap"
  | "insufficient_horizontal_target_separation"
  | "ambiguous_target_direction"
  | "invalid_tracking_config"
  | "invalid_timing_config";

export type LateralReachConfigValidationResult =
  | { ok: true; config: LateralReachConfig }
  | { ok: false; reason: LateralReachConfigValidationFailure; detail?: string };

function validateTrackingConfig(
  candidate: unknown,
): { ok: true; tracking: LateralReachTrackingConfig } | { ok: false; reason: "invalid_tracking_config"; detail: string } {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_tracking_config", detail: "tracking config must be an object" };
  }
  const { minWristVisibility, maxAllowedGapMs } = candidate;
  if (
    typeof minWristVisibility !== "number" ||
    !Number.isFinite(minWristVisibility) ||
    minWristVisibility < 0 ||
    minWristVisibility > 1
  ) {
    return {
      ok: false,
      reason: "invalid_tracking_config",
      detail: "minWristVisibility must be a finite number within [0,1]",
    };
  }
  if (typeof maxAllowedGapMs !== "number" || !Number.isFinite(maxAllowedGapMs) || maxAllowedGapMs < 0) {
    return {
      ok: false,
      reason: "invalid_tracking_config",
      detail: "maxAllowedGapMs must be a finite number >= 0",
    };
  }
  return { ok: true, tracking: { minWristVisibility, maxAllowedGapMs } };
}

function validateTimingConfig(
  candidate: unknown,
): { ok: true; timing: LateralReachTimingConfig } | { ok: false; reason: "invalid_timing_config"; detail: string } {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_timing_config", detail: "timing config must be an object" };
  }
  const fields = ["onsetConfirmationMs", "dwellDurationMs", "returnConfirmationMs"] as const;
  for (const field of fields) {
    const value = candidate[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return {
        ok: false,
        reason: "invalid_timing_config",
        detail: `${field} must be a finite number >= 0`,
      };
    }
  }
  return {
    ok: true,
    timing: {
      onsetConfirmationMs: candidate.onsetConfirmationMs as number,
      dwellDurationMs: candidate.dwellDurationMs as number,
      returnConfirmationMs: candidate.returnConfirmationMs as number,
    },
  };
}

/**
 * Rejects invalid geometry and configuration outright — never clamps,
 * repairs, moves, defaults, or silently normalizes. testedSide has no
 * fallback: an invalid or missing value is rejected, not defaulted. A
 * configured target and starting zone that share the same x-coordinate have
 * no resolvable horizontal reach direction and are rejected as
 * "ambiguous_target_direction" — this is the fail-closed orientation
 * behavior: no LateralReachConfig, and therefore no LateralReachAttemptState,
 * can ever be produced from such input. This is a configuration rejection,
 * never a clinical stop and never an in-progress protective pause.
 */
export function validateLateralReachConfig(candidate: unknown): LateralReachConfigValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_config", detail: "config must be an object" };
  }

  if (!isValidUpperLimbSide(candidate.testedSide)) {
    return { ok: false, reason: "invalid_tested_side" };
  }
  const testedSide = candidate.testedSide;

  const targetResult = validateZone(candidate.fixedTarget, "fixedTarget");
  if (!targetResult.ok) return targetResult;

  const startingZoneResult = validateZone(candidate.startingZone, "startingZone");
  if (!startingZoneResult.ok) return startingZoneResult;

  if (zonesOverlapOrTouch(targetResult.zone, startingZoneResult.zone)) {
    return { ok: false, reason: "zones_overlap" };
  }

  const horizontalDelta = targetResult.zone.point.x - startingZoneResult.zone.point.x;
  if (horizontalDelta === 0) {
    return { ok: false, reason: "ambiguous_target_direction" };
  }

  if (hasInsufficientHorizontalTargetSeparation(startingZoneResult.zone, targetResult.zone)) {
    return { ok: false, reason: "insufficient_horizontal_target_separation" };
  }

  const expectedHorizontalDirectionSign: 1 | -1 = horizontalDelta > 0 ? 1 : -1;

  const trackingResult = validateTrackingConfig(candidate.tracking);
  if (!trackingResult.ok) return trackingResult;

  const timingResult = validateTimingConfig(candidate.timing);
  if (!timingResult.ok) return timingResult;

  return {
    ok: true,
    config: {
      testedSide,
      fixedTarget: targetResult.zone,
      startingZone: startingZoneResult.zone,
      tracking: trackingResult.tracking,
      timing: timingResult.timing,
      expectedHorizontalDirectionSign,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal runtime phases — not the public Phase 1 completion-state contract.
// ---------------------------------------------------------------------------

export const LATERAL_REACH_PHASES = [
  "idle",
  "awaiting_readiness",
  "ready_confirmed_awaiting_onset",
  "outbound",
  "dwelling",
  "reach_confirmed",
  "returning",
  "completed_pending_finalization",
] as const;
export type LateralReachPhase = (typeof LATERAL_REACH_PHASES)[number];

/** Orthogonal to phase — an active pause freezes whichever phase is current rather than replacing it. */
export type LateralReachActivePause = {
  reason: ProtectivePauseReason;
  startedAtMs: number;
};

type TimedCandidate = { candidateStartedAtMs: number };

/**
 * An unconfirmed dwell attempt owns its own entry timestamp and a snapshot
 * of the outbound path exactly as it stood at that entry — nothing is
 * committed to the shared attempt state (targetEntryAtMs, targetReachedFlag,
 * outboundSamples) until this specific candidate's dwell succeeds. If it
 * fails, the candidate — and only the candidate — is discarded; the
 * continuously-growing outboundSamples array is untouched, so a later
 * successful entry's snapshot correctly includes the failed attempt's
 * wandering as genuine pre-reach movement.
 */
type DwellCandidate = {
  candidateStartedAtMs: number;
  outboundSamplesAtEntry: NormalizedPoint[];
};

type LateralReachAttemptStateInternal = {
  readonly config: LateralReachConfig;
  readonly attemptIndex: number;
  readonly armedAtMs: number;

  /** Monotonic engine clock — the nowMs of the last accepted command. Never decreases. */
  lastAcceptedNowMs: number;

  /** Strictly increasing frame clock — the nowMs of the last accepted frame command. */
  lastAcceptedFrameNowMs: number | null;

  phase: LateralReachPhase;
  terminal: boolean;
  activePause: LateralReachActivePause | null;

  lastValidWristSample: { point: NormalizedPoint; atMs: number } | null;
  invalidTrackingSinceMs: number | null;

  onsetCandidate: TimedCandidate | null;
  pendingOnsetSamples: NormalizedPoint[];
  pendingTargetEntryAtMs: number | null;
  nonTargetFacingExitObservedBeforeValidOnset: boolean;
  dwellCandidate: DwellCandidate | null;
  returnCandidate: TimedCandidate | null;

  movementOnsetAtMs: number | null;
  movementOnsetWristPoint: NormalizedPoint | null;
  outboundSamples: NormalizedPoint[];
  outboundIntegrityBroken: boolean;

  targetEntryAtMs: number | null;
  targetReachedFlag: boolean;
  reachConfirmedAtMs: number | null;
  dwellConfirmedFlag: boolean;

  returnConfirmedAtMs: number | null;
  returnToStartCompletedFlag: boolean;

  completedAtMs: number | null;
  clinicalStopEvent: ClinicalStopEvent | null;
  runtimeInterruptionOccurred: boolean;
  notAssessableReason: string | null;

  protectivePauseEvents: ProtectivePauseEvent[];

  finalResult: UpperLimbMovementAttemptResult | null;
};

/** Opaque handle — callers must not reach into internals; use getLateralReachRuntimeSnapshot. */
export type LateralReachAttemptState = LateralReachAttemptStateInternal;

export type LateralReachAttemptInitializationFailure = "invalid_armed_at_ms" | "invalid_attempt_index";

export type LateralReachAttemptInitializationResult =
  | { ok: true; state: LateralReachAttemptState }
  | { ok: false; reason: LateralReachAttemptInitializationFailure };

/**
 * Validates armedAtMs (finite, non-negative — it seeds the engine's
 * monotonic clock) and attemptIndex (finite — Phase 1's contract types it as
 * a plain number and defines no stricter rule, so none is invented here).
 */
export function createLateralReachAttemptState(
  config: LateralReachConfig,
  attemptIndex: number,
  armedAtMs: number,
): LateralReachAttemptInitializationResult {
  if (!Number.isFinite(armedAtMs) || armedAtMs < 0) {
    return { ok: false, reason: "invalid_armed_at_ms" };
  }
  if (!Number.isFinite(attemptIndex)) {
    return { ok: false, reason: "invalid_attempt_index" };
  }
  return {
    ok: true,
    state: {
      config,
      attemptIndex,
      armedAtMs,
      lastAcceptedNowMs: armedAtMs,
      lastAcceptedFrameNowMs: null,
      phase: "idle",
      terminal: false,
      activePause: null,
      lastValidWristSample: null,
      invalidTrackingSinceMs: null,
      onsetCandidate: null,
      pendingOnsetSamples: [],
      pendingTargetEntryAtMs: null,
      nonTargetFacingExitObservedBeforeValidOnset: false,
      dwellCandidate: null,
      returnCandidate: null,
      movementOnsetAtMs: null,
      movementOnsetWristPoint: null,
      outboundSamples: [],
      outboundIntegrityBroken: false,
      targetEntryAtMs: null,
      targetReachedFlag: false,
      reachConfirmedAtMs: null,
      dwellConfirmedFlag: false,
      returnConfirmedAtMs: null,
      returnToStartCompletedFlag: false,
      completedAtMs: null,
      clinicalStopEvent: null,
      runtimeInterruptionOccurred: false,
      notAssessableReason: null,
      protectivePauseEvents: [],
      finalResult: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Read-only runtime snapshot — informational only, never a persisted result.
// ---------------------------------------------------------------------------

export type LateralReachRuntimeSnapshot = {
  attemptIndex: number;
  phase: LateralReachPhase;
  terminal: boolean;
  hasActivePause: boolean;
  targetReached: boolean;
  dwellConfirmed: boolean;
  returnToStartCompleted: boolean;
  protectivePauseCount: number;
};

export function getLateralReachRuntimeSnapshot(state: LateralReachAttemptState): LateralReachRuntimeSnapshot {
  return {
    attemptIndex: state.attemptIndex,
    phase: state.phase,
    terminal: state.terminal,
    hasActivePause: state.activePause !== null,
    targetReached: state.targetReachedFlag,
    dwellConfirmed: state.dwellConfirmedFlag,
    returnToStartCompleted: state.returnToStartCompletedFlag,
    protectivePauseCount: state.protectivePauseEvents.length,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type LateralReachCommand =
  | { type: "frame"; nowMs: number; frame: NormalizedMotionFrame }
  | { type: "observationUnavailable"; nowMs: number }
  | { type: "readinessConfirmed"; nowMs: number; confirmedBy: unknown }
  | { type: "resumeRequested"; nowMs: number; readinessConfirmedAt: unknown; resumedBy: unknown }
  | { type: "clinicalStopReceived"; nowMs: number; event: ClinicalStopEvent }
  | { type: "runtimeInterruptionReceived"; nowMs: number; reason?: string }
  | { type: "attemptWindowEnded"; nowMs: number }
  | { type: "markedNotAssessable"; nowMs: number; reason: string };

export type LateralReachCommandRejectionReason =
  | "attempt_already_terminal"
  | "invalid_now_ms"
  | "now_ms_not_monotonic"
  | "frame_timestamp_not_strictly_increasing"
  | "awaiting_explicit_finalization"
  | "readiness_not_applicable_in_current_phase"
  | "readiness_requires_wrist_in_starting_zone"
  | "readiness_requires_valid_confirmed_by"
  | "readiness_blocked_by_active_pause"
  | "no_active_pause_to_resume"
  | "resume_requires_readiness_confirmation"
  | "resume_requires_valid_human_actor";

export type LateralReachCommandResult =
  | {
      status: "applied";
      state: LateralReachAttemptState;
      snapshot: LateralReachRuntimeSnapshot;
      protectivePauseEvent: ProtectivePauseEvent | null;
      attemptResult: UpperLimbMovementAttemptResult | null;
    }
  | {
      status: "rejected";
      reason: LateralReachCommandRejectionReason;
      state: LateralReachAttemptState;
      snapshot: LateralReachRuntimeSnapshot;
    };

function applied(
  state: LateralReachAttemptState,
  protectivePauseEvent: ProtectivePauseEvent | null = null,
  attemptResult: UpperLimbMovementAttemptResult | null = null,
): LateralReachCommandResult {
  return {
    status: "applied",
    state,
    snapshot: getLateralReachRuntimeSnapshot(state),
    protectivePauseEvent,
    attemptResult,
  };
}

function rejected(
  state: LateralReachAttemptState,
  reason: LateralReachCommandRejectionReason,
): LateralReachCommandResult {
  return { status: "rejected", reason, state, snapshot: getLateralReachRuntimeSnapshot(state) };
}

// ---------------------------------------------------------------------------
// Monotonic clock gate
// ---------------------------------------------------------------------------

function validateNowMs(
  lastAcceptedNowMs: number,
  nowMs: number,
): { ok: true } | { ok: false; reason: "invalid_now_ms" | "now_ms_not_monotonic" } {
  if (!Number.isFinite(nowMs) || nowMs < 0) return { ok: false, reason: "invalid_now_ms" };
  if (nowMs < lastAcceptedNowMs) return { ok: false, reason: "now_ms_not_monotonic" };
  return { ok: true };
}

function validateFrameNowMs(
  lastAcceptedFrameNowMs: number | null,
  nowMs: number,
): { ok: true } | { ok: false; reason: "invalid_now_ms" | "frame_timestamp_not_strictly_increasing" } {
  if (!Number.isFinite(nowMs) || nowMs < 0) return { ok: false, reason: "invalid_now_ms" };
  if (lastAcceptedFrameNowMs !== null && nowMs <= lastAcceptedFrameNowMs) {
    return { ok: false, reason: "frame_timestamp_not_strictly_increasing" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Wrist sample extraction — tested-side only, confidence- and bounds-gated.
// ---------------------------------------------------------------------------

function extractTestedSideWristSample(
  frame: NormalizedMotionFrame,
  config: LateralReachConfig,
): NormalizedPoint | null {
  const jointId = TESTED_SIDE_WRIST_JOINT_ID[config.testedSide];
  const joint = frame.joints[jointId];
  if (!joint) return null;
  if (!isJointConfident(joint.confidence, config.tracking.minWristVisibility)) return null;
  const { x, y } = joint.landmark;
  if (!isFiniteUnitCoordinate(x) || !isFiniteUnitCoordinate(y)) return null;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Path metrics
// ---------------------------------------------------------------------------

/**
 * Covers accumulated floating-point rounding across a bounded number of
 * double-precision additions/divisions for one attempt's outbound sample
 * count — a software numerical invariant, not a CV or clinical tolerance.
 * A raw ratio within this tolerance of [0,1] is treated as legitimate
 * epsilon noise and normalized; anything materially outside it is treated
 * as an unreliable measurement (null), never silently clamped to a
 * plausible-looking value.
 */
const PATH_EFFICIENCY_TOLERANCE = 1e-6;

function computePathMetrics(state: LateralReachAttemptStateInternal): {
  normalizedPathLength: number | null;
  pathEfficiency: number | null;
} {
  if (state.outboundIntegrityBroken) return { normalizedPathLength: null, pathEfficiency: null };
  if (state.movementOnsetAtMs === null || state.movementOnsetWristPoint === null || state.targetEntryAtMs === null) {
    return { normalizedPathLength: null, pathEfficiency: null };
  }
  const samples = state.outboundSamples;
  if (samples.length < 2) return { normalizedPathLength: null, pathEfficiency: null };

  let length = 0;
  for (let i = 1; i < samples.length; i += 1) {
    length += distanceNormalized(samples[i - 1], samples[i]);
  }
  if (!Number.isFinite(length) || length <= 0) {
    return { normalizedPathLength: Number.isFinite(length) ? length : null, pathEfficiency: null };
  }

  const straightLineDistance = distanceNormalized(state.movementOnsetWristPoint, state.config.fixedTarget.point);
  const rawEfficiency = straightLineDistance / length;
  if (!Number.isFinite(rawEfficiency)) return { normalizedPathLength: length, pathEfficiency: null };

  if (rawEfficiency > 1 + PATH_EFFICIENCY_TOLERANCE || rawEfficiency < 0 - PATH_EFFICIENCY_TOLERANCE) {
    // Materially outside the mathematically valid range — never silently
    // clamped to a plausible-looking value. Reported as unreliable instead.
    return { normalizedPathLength: length, pathEfficiency: null };
  }
  const efficiency = Math.min(1, Math.max(0, rawEfficiency));
  return { normalizedPathLength: length, pathEfficiency: efficiency };
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

/**
 * Phase 3 does not yet have a CV-validated basis for grading tracking
 * quality — reporting "good"/"fair"/"poor" from pause count alone risks
 * being misread as a movement-quality or patient-performance judgment
 * (a more impaired patient may plausibly trigger more tracking gaps through
 * atypical movement, which is exactly the kind of inference this project
 * must not make). Factual pause count/duration/events remain on the result;
 * the graded summary stays "unknown" until CV validation exists.
 */
function trackingQualitySummary(): "unknown" {
  return "unknown";
}

function buildFactualNotes(state: LateralReachAttemptStateInternal): string[] {
  const notes: string[] = [];
  if (state.protectivePauseEvents.length > 0) {
    notes.push(`protective_pause_count:${state.protectivePauseEvents.length}`);
  }
  if (state.runtimeInterruptionOccurred) notes.push("runtime_interruption_received");
  if (state.notAssessableReason) notes.push(`marked_not_assessable_reason:${state.notAssessableReason}`);
  if (state.nonTargetFacingExitObservedBeforeValidOnset) {
    notes.push("non_target_facing_exit_observed_before_valid_onset");
  }
  return notes;
}

function sumProtectivePauseDurationMs(events: readonly ProtectivePauseEvent[]): number {
  let total = 0;
  for (const event of events) {
    const duration = event.endedAtMs !== null ? event.endedAtMs - event.startedAtMs : 0;
    if (duration < 0) {
      throw new Error("lateral-reach-engine: internal inconsistency — a finalized pause has a negative duration");
    }
    total += duration;
  }
  return total;
}

function buildAttemptResult(
  state: LateralReachAttemptStateInternal,
  completionState: UpperLimbAttemptCompletionState,
  completedAtMs: number,
): UpperLimbMovementAttemptResult {
  const hasClinicalStop = state.clinicalStopEvent !== null;
  const hasRuntimeInterruption = state.runtimeInterruptionOccurred;
  if (!isCompletionStateConsistentWithEvents({ completionState, hasClinicalStop, hasRuntimeInterruption })) {
    throw new Error(
      `lateral-reach-engine: internal inconsistency — completionState "${completionState}" is not consistent with recorded events`,
    );
  }

  const reachTimeMs =
    state.targetEntryAtMs !== null && state.movementOnsetAtMs !== null
      ? state.targetEntryAtMs - state.movementOnsetAtMs
      : null;
  const returnTimeMs =
    state.returnConfirmedAtMs !== null && state.reachConfirmedAtMs !== null
      ? state.returnConfirmedAtMs - state.reachConfirmedAtMs
      : null;
  const totalMovementTimeMs = state.movementOnsetAtMs !== null ? completedAtMs - state.movementOnsetAtMs : null;

  for (const [label, value] of [
    ["reachTimeMs", reachTimeMs],
    ["returnTimeMs", returnTimeMs],
    ["totalMovementTimeMs", totalMovementTimeMs],
  ] as const) {
    if (value !== null && value < 0) {
      throw new Error(`lateral-reach-engine: internal inconsistency — ${label} computed as negative (${value})`);
    }
  }

  const pathMetrics = computePathMetrics(state);
  const protectivePauseDurationMs = sumProtectivePauseDurationMs(state.protectivePauseEvents);

  if (state.targetReachedFlag !== state.dwellConfirmedFlag) {
    throw new Error(
      "lateral-reach-engine: internal inconsistency — targetReached and dwellConfirmed diverged; Phase 3 requires targetReached to mean dwell-confirmed entry only",
    );
  }

  const result: UpperLimbMovementAttemptResult = {
    attemptIndex: state.attemptIndex,
    taskId: "lateralReach",
    testedSide: state.config.testedSide,
    startedAtMs: state.armedAtMs,
    completedAtMs,
    completionState,

    targetReached: state.targetReachedFlag,
    dwellConfirmed: state.dwellConfirmedFlag,
    returnToStartCompleted: state.returnToStartCompletedFlag,

    reachTimeMs,
    returnTimeMs,
    totalMovementTimeMs,
    normalizedPathLength: pathMetrics.normalizedPathLength,
    pathEfficiency: pathMetrics.pathEfficiency,
    peakShoulderAngleDeg: null,
    peakElbowExtensionDeg: null,

    trunkDisplacementObserved: null,
    withinConfiguredLimitThroughout: null,

    trackingQualitySummary: trackingQualitySummary(),
    protectivePauseCount: state.protectivePauseEvents.length,
    protectivePauseDurationMs,
    protectivePauseEvents: [...state.protectivePauseEvents],

    factualNotes: buildFactualNotes(state),
  };

  const safety = validateUpperLimbMotorScreenSessionResultSafety(result);
  if (!safety.ok) {
    throw new Error(
      `lateral-reach-engine: internal inconsistency — finalized result failed the safety-vocabulary check at ${safety.forbiddenKeyPaths.join(", ")}`,
    );
  }

  return result;
}

type FinalizeOutcome = "completed" | "incomplete" | "interrupted" | "stopped" | "not_assessable" | "not_started";

/**
 * Shared finalization path. If a pause is still active, it is resolved
 * first via the unmodified Phase 1 evaluateProtectivePause — this module
 * never constructs a ProtectivePauseEvent by hand. evaluateProtectivePause
 * is only ever called here with engine-controlled, already-valid reason and
 * outcome values, so ok:false represents a genuine internal bug, not a
 * rejectable external input — it fails loudly rather than silently
 * dropping the pause, consistent with this file's other internal-invariant
 * checks.
 */
function finalizeAttempt(
  state: LateralReachAttemptStateInternal,
  nowMs: number,
  completionState: FinalizeOutcome,
  pauseOutcomeIfActive: "escalated_to_clinical_stop" | "session_ended_while_paused",
): LateralReachCommandResult {
  let next = state;
  let finalizedPauseEvent: ProtectivePauseEvent | null = null;

  if (next.activePause) {
    const evaluation = evaluateProtectivePause({
      reason: next.activePause.reason,
      startedAtMs: next.activePause.startedAtMs,
      endedAtMs: nowMs,
      outcome: pauseOutcomeIfActive,
      readinessConfirmedAt: null,
      resumedBy: null,
    });
    if (!evaluation.ok) {
      throw new Error(
        `lateral-reach-engine: internal inconsistency — evaluateProtectivePause rejected an engine-constructed pause finalization (${evaluation.reason})`,
      );
    }
    finalizedPauseEvent = evaluation.event;
    next = {
      ...next,
      activePause: null,
      protectivePauseEvents: [...next.protectivePauseEvents, evaluation.event],
    };
  }

  const result = buildAttemptResult(next, completionState, nowMs);
  next = { ...next, terminal: true, completedAtMs: nowMs, finalResult: result };
  return applied(next, finalizedPauseEvent, result);
}

// ---------------------------------------------------------------------------
// Continuity resets — invoked on any non-valid sample.
// ---------------------------------------------------------------------------

/**
 * An invalid sample discards every in-progress continuity candidate
 * (onset/dwell/return). A pending dwell candidate reverts phase back to
 * "outbound" — the same rule as a valid-but-target-exit sample — so a later
 * successful entry is free to start a fresh candidate. Outbound path
 * integrity is broken only when the gap occurs before any entry has been
 * committed (targetEntryAtMs still null) and while genuinely in the
 * outbound segment — not during onset-candidate watching, which has no
 * path data yet to corrupt.
 */
function resetContinuityCandidates(state: LateralReachAttemptStateInternal): LateralReachAttemptStateInternal {
  const revertedPhase: LateralReachPhase = state.phase === "dwelling" ? "outbound" : state.phase;
  const outboundIntegrityBroken =
    state.outboundIntegrityBroken || (revertedPhase === "outbound" && state.targetEntryAtMs === null);
  return {
    ...state,
    phase: revertedPhase,
    onsetCandidate: null,
    pendingOnsetSamples: [],
    pendingTargetEntryAtMs: null,
    dwellCandidate: null,
    returnCandidate: null,
    outboundIntegrityBroken,
  };
}

// ---------------------------------------------------------------------------
// Outbound / dwelling — a single handler, since a dwell candidate is simply
// an unconfirmed entry sitting on top of the still-accumulating outbound
// path. Phase is "outbound" whenever no candidate is active and "dwelling"
// whenever one is.
// ---------------------------------------------------------------------------

function handleOutboundOrDwelling(
  state: LateralReachAttemptStateInternal,
  sample: NormalizedPoint,
  nowMs: number,
): LateralReachCommandResult {
  const outboundSamples = [...state.outboundSamples, sample];
  const insideTarget = isWristInsideTarget(sample, state.config.fixedTarget.point, {
    collisionRadius: state.config.fixedTarget.radius,
  });

  if (!insideTarget) {
    // Not inside the target: either still watching (outbound), or a pending
    // candidate just failed and is discarded here — either way, "outbound".
    return applied({ ...state, phase: "outbound", outboundSamples, dwellCandidate: null });
  }

  const candidate: DwellCandidate =
    state.dwellCandidate ?? { candidateStartedAtMs: nowMs, outboundSamplesAtEntry: outboundSamples };
  const elapsed = nowMs - candidate.candidateStartedAtMs;

  if (elapsed >= state.config.timing.dwellDurationMs) {
    return applied({
      ...state,
      phase: "reach_confirmed",
      dwellCandidate: null,
      targetEntryAtMs: candidate.candidateStartedAtMs,
      targetReachedFlag: true,
      dwellConfirmedFlag: true,
      reachConfirmedAtMs: nowMs,
      outboundSamples: candidate.outboundSamplesAtEntry,
    });
  }

  return applied({ ...state, phase: "dwelling", outboundSamples, dwellCandidate: candidate });
}

function confirmMovementOnset(
  state: LateralReachAttemptStateInternal,
  candidateStartedAtMs: number,
  pendingSamples: NormalizedPoint[],
  nowMs: number,
  sample: NormalizedPoint,
): LateralReachCommandResult {
  const onsetPoint = pendingSamples[0];
  const pendingTargetEntryAtMs = state.pendingTargetEntryAtMs;
  const insideTarget = isWristInsideTarget(sample, state.config.fixedTarget.point, {
    collisionRadius: state.config.fixedTarget.radius,
  });
  const targetEntryAtMs = pendingTargetEntryAtMs ?? (insideTarget ? nowMs : null);

  const next: LateralReachAttemptStateInternal = {
    ...state,
    phase: "outbound",
    onsetCandidate: null,
    pendingOnsetSamples: [],
    pendingTargetEntryAtMs: null,
    movementOnsetAtMs: candidateStartedAtMs,
    movementOnsetWristPoint: onsetPoint,
    outboundSamples: pendingSamples,
  };

  if (targetEntryAtMs !== null && insideTarget) {
    const outboundSamples = pendingSamples;
    const candidate: DwellCandidate = {
      candidateStartedAtMs: targetEntryAtMs,
      outboundSamplesAtEntry: outboundSamples,
    };
    const elapsed = nowMs - candidate.candidateStartedAtMs;
    if (elapsed >= state.config.timing.dwellDurationMs) {
      return applied({
        ...next,
        phase: "reach_confirmed",
        dwellCandidate: null,
        targetEntryAtMs: candidate.candidateStartedAtMs,
        targetReachedFlag: true,
        dwellConfirmedFlag: true,
        reachConfirmedAtMs: nowMs,
        outboundSamples: candidate.outboundSamplesAtEntry,
      });
    }
    return applied({ ...next, phase: "dwelling", outboundSamples, dwellCandidate: candidate });
  }

  return applied(next);
}

function handleReadyConfirmedAwaitingOnset(
  state: LateralReachAttemptStateInternal,
  sample: NormalizedPoint,
  nowMs: number,
): LateralReachCommandResult {
  const { startingZone, fixedTarget, expectedHorizontalDirectionSign, timing } = state.config;

  const insideStartingZone = isWristInsideTarget(sample, startingZone.point, {
    collisionRadius: startingZone.radius,
  });
  if (insideStartingZone) {
    return applied({
      ...state,
      onsetCandidate: null,
      pendingOnsetSamples: [],
      pendingTargetEntryAtMs: null,
    });
  }

  const crossedBoundary = hasCrossedTargetFacingBoundary(
    sample.x,
    startingZone.point.x,
    startingZone.radius,
    expectedHorizontalDirectionSign,
  );
  const wrongSideExit = hasExitedNonTargetFacingSide(
    sample.x,
    startingZone.point.x,
    startingZone.radius,
    expectedHorizontalDirectionSign,
  );

  if (wrongSideExit) {
    // Unreachable while activePause is set: handleFrame freezes phase progression
    // until an explicit resumeRequested clears the pause. Wrong-direction reset
    // therefore never inherits a stale protective pause.
    return applied({
      ...state,
      phase: "awaiting_readiness",
      onsetCandidate: null,
      pendingOnsetSamples: [],
      pendingTargetEntryAtMs: null,
      nonTargetFacingExitObservedBeforeValidOnset: true,
    });
  }

  const insideTarget = isWristInsideTarget(sample, fixedTarget.point, {
    collisionRadius: fixedTarget.radius,
  });
  const pendingTargetEntryAtMs =
    insideTarget && state.pendingTargetEntryAtMs === null ? nowMs : state.pendingTargetEntryAtMs;

  if (!crossedBoundary) {
    return applied({
      ...state,
      pendingTargetEntryAtMs,
      onsetCandidate: null,
      pendingOnsetSamples: [],
    });
  }

  const candidate = state.onsetCandidate ?? { candidateStartedAtMs: nowMs };
  const pendingSamples =
    state.onsetCandidate === null ? [sample] : [...state.pendingOnsetSamples, sample];
  const elapsed = nowMs - candidate.candidateStartedAtMs;

  if (elapsed >= timing.onsetConfirmationMs) {
    return confirmMovementOnset(
      { ...state, pendingTargetEntryAtMs },
      candidate.candidateStartedAtMs,
      pendingSamples,
      nowMs,
      sample,
    );
  }

  return applied({
    ...state,
    onsetCandidate: candidate,
    pendingOnsetSamples: pendingSamples,
    pendingTargetEntryAtMs,
  });
}

// ---------------------------------------------------------------------------
// Tracking-loss handling — shared by frame with invalid wrist and observationUnavailable
// ---------------------------------------------------------------------------

/**
 * Applies tracking-loss semantics when no usable wrist observation is available.
 * Used by both frame commands with invalid/missing wrist and observationUnavailable commands.
 */
function handleInvalidTracking(
  state: LateralReachAttemptStateInternal,
  nowMs: number,
): LateralReachCommandResult {
  const invalidSince = state.invalidTrackingSinceMs ?? nowMs;
  let next = resetContinuityCandidates({ ...state, invalidTrackingSinceMs: invalidSince });

  const gapDurationMs = nowMs - invalidSince;
  // >= once the gap has begun, matching the onset/dwell/return confirmation
  // convention — a maxAllowedGapMs of 0 opens a pause on the very first
  // invalid frame, since gapDurationMs is 0 on that frame too.
  if (
    gapDurationMs >= next.config.tracking.maxAllowedGapMs &&
    next.activePause === null &&
    next.phase !== "completed_pending_finalization"
  ) {
    next = {
      ...next,
      activePause: {
        reason: { category: "tracking_or_environment", detail: "insufficient_tracking_quality" },
        startedAtMs: invalidSince,
      },
    };
  }
  return applied(next);
}

// ---------------------------------------------------------------------------
// Frame command handling
// ---------------------------------------------------------------------------

function handleFrame(state: LateralReachAttemptStateInternal, nowMs: number, frame: NormalizedMotionFrame): LateralReachCommandResult {
  let next = state.phase === "idle" ? { ...state, phase: "awaiting_readiness" as LateralReachPhase } : { ...state };

  const sample = extractTestedSideWristSample(frame, next.config);

  if (sample === null) {
    return handleInvalidTracking(next, nowMs);
  }

  // Valid sample.
  next = { ...next, lastValidWristSample: { point: sample, atMs: nowMs }, invalidTrackingSinceMs: null };

  if (next.activePause !== null) {
    // Frozen — tracking bookkeeping updates, but no phase progression while unresolved.
    return applied(next);
  }

  switch (next.phase) {
    case "awaiting_readiness":
      return applied(next);

    case "ready_confirmed_awaiting_onset":
      return handleReadyConfirmedAwaitingOnset(next, sample, nowMs);

    case "outbound":
    case "dwelling":
      return handleOutboundOrDwelling(next, sample, nowMs);

    case "reach_confirmed":
    case "returning": {
      const promoted = next.phase === "reach_confirmed" ? { ...next, phase: "returning" as LateralReachPhase } : next;
      const insideStartingZone = isWristInsideTarget(sample, promoted.config.startingZone.point, {
        collisionRadius: promoted.config.startingZone.radius,
      });
      if (!insideStartingZone) {
        return applied({ ...promoted, returnCandidate: null });
      }
      const candidate = promoted.returnCandidate ?? { candidateStartedAtMs: nowMs };
      const elapsed = nowMs - candidate.candidateStartedAtMs;
      if (elapsed >= promoted.config.timing.returnConfirmationMs) {
        return applied({
          ...promoted,
          phase: "completed_pending_finalization",
          returnCandidate: null,
          returnConfirmedAtMs: nowMs,
          returnToStartCompletedFlag: true,
        });
      }
      return applied({ ...promoted, returnCandidate: candidate });
    }

    case "completed_pending_finalization":
      // Unreachable: applyLateralReachCommand rejects "frame" commands in
      // this phase before handleFrame is ever called.
      return applied(next);

    case "idle":
      // Unreachable: idle is promoted to awaiting_readiness at the top of
      // this function. Retained only so the exhaustiveness check below
      // compiles against the full LATERAL_REACH_PHASES union.
      return applied(next);

    default: {
      const _exhaustive: never = next.phase;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function applyLateralReachCommand(
  state: LateralReachAttemptState,
  command: LateralReachCommand,
): LateralReachCommandResult {
  if (state.terminal) {
    return rejected(state, "attempt_already_terminal");
  }

  const clockCheck = validateNowMs(state.lastAcceptedNowMs, command.nowMs);
  if (!clockCheck.ok) {
    return rejected(state, clockCheck.reason);
  }

  // The movement measurement is complete once return is confirmed. Later
  // movement-observation commands (frame, observationUnavailable) must not
  // silently continue accumulating metrics or opening new tracking-triggered
  // pauses — reject with a documented reason. Every other command type
  // (including clinicalStopReceived) is still processed normally in this phase.
  if (
    (command.type === "frame" || command.type === "observationUnavailable") &&
    state.phase === "completed_pending_finalization"
  ) {
    return rejected(state, "awaiting_explicit_finalization");
  }

  if (command.type === "frame") {
    const frameClockCheck = validateFrameNowMs(state.lastAcceptedFrameNowMs, command.nowMs);
    if (!frameClockCheck.ok) {
      return rejected(state, frameClockCheck.reason);
    }
  }

  const stateWithClock: LateralReachAttemptStateInternal = {
    ...state,
    lastAcceptedNowMs: command.nowMs,
    ...(command.type === "frame" ? { lastAcceptedFrameNowMs: command.nowMs } : {}),
  };

  switch (command.type) {
    case "frame":
      return handleFrame(stateWithClock, command.nowMs, command.frame);

    case "observationUnavailable": {
      const next = stateWithClock.phase === "idle" ? { ...stateWithClock, phase: "awaiting_readiness" as LateralReachPhase } : { ...stateWithClock };
      return handleInvalidTracking(next, command.nowMs);
    }

    case "readinessConfirmed": {
      if (stateWithClock.phase !== "idle" && stateWithClock.phase !== "awaiting_readiness") {
        return rejected(stateWithClock, "readiness_not_applicable_in_current_phase");
      }
      if (!isValidProtectivePauseResumeActor(command.confirmedBy)) {
        return rejected(stateWithClock, "readiness_requires_valid_confirmed_by");
      }
      const sample = stateWithClock.lastValidWristSample;
      if (sample === null || command.nowMs - sample.atMs > stateWithClock.config.tracking.maxAllowedGapMs) {
        return rejected(stateWithClock, "readiness_requires_wrist_in_starting_zone");
      }
      const inZone = isWristInsideTarget(sample.point, stateWithClock.config.startingZone.point, {
        collisionRadius: stateWithClock.config.startingZone.radius,
      });
      if (!inZone) {
        return rejected(stateWithClock, "readiness_requires_wrist_in_starting_zone");
      }
      // Protective pause is orthogonal to phase and must be cleared only by
      // resumeRequested (or terminal finalization). Accepting readinessConfirmed
      // while a pause is active would create ready_confirmed_awaiting_onset with
      // a stale activePause and freeze all subsequent movement progression.
      if (stateWithClock.activePause !== null) {
        return rejected(stateWithClock, "readiness_blocked_by_active_pause");
      }
      return applied({ ...stateWithClock, phase: "ready_confirmed_awaiting_onset" });
    }

    case "resumeRequested": {
      if (!stateWithClock.activePause) {
        return rejected(stateWithClock, "no_active_pause_to_resume");
      }
      const readinessConfirmedAt =
        typeof command.readinessConfirmedAt === "string" ? command.readinessConfirmedAt : null;
      const evaluation = evaluateProtectivePause({
        reason: stateWithClock.activePause.reason,
        startedAtMs: stateWithClock.activePause.startedAtMs,
        endedAtMs: command.nowMs,
        outcome: "resumed",
        readinessConfirmedAt,
        resumedBy: command.resumedBy,
      });
      if (!evaluation.ok) {
        if (evaluation.reason === "readiness_confirmation_required_for_resume") {
          return rejected(stateWithClock, "resume_requires_readiness_confirmation");
        }
        return rejected(stateWithClock, "resume_requires_valid_human_actor");
      }
      return applied(
        {
          ...stateWithClock,
          activePause: null,
          invalidTrackingSinceMs: null,
          protectivePauseEvents: [...stateWithClock.protectivePauseEvents, evaluation.event],
        },
        evaluation.event,
      );
    }

    case "clinicalStopReceived": {
      const next = { ...stateWithClock, clinicalStopEvent: { ...command.event } };
      return finalizeAttempt(next, command.nowMs, "stopped", "escalated_to_clinical_stop");
    }

    case "runtimeInterruptionReceived": {
      const next = { ...stateWithClock, runtimeInterruptionOccurred: true };
      return finalizeAttempt(next, command.nowMs, "interrupted", "session_ended_while_paused");
    }

    case "markedNotAssessable": {
      const next = { ...stateWithClock, notAssessableReason: command.reason };
      return finalizeAttempt(next, command.nowMs, "not_assessable", "session_ended_while_paused");
    }

    case "attemptWindowEnded": {
      if (stateWithClock.activePause) {
        return finalizeAttempt(stateWithClock, command.nowMs, "not_assessable", "session_ended_while_paused");
      }
      if (stateWithClock.phase === "completed_pending_finalization") {
        return finalizeAttempt(stateWithClock, command.nowMs, "completed", "session_ended_while_paused");
      }
      // Movement onset — not mere readiness — is the source of truth for
      // not_started vs incomplete. Readiness confirmation alone is not
      // movement initiation.
      if (stateWithClock.movementOnsetAtMs === null) {
        return finalizeAttempt(stateWithClock, command.nowMs, "not_started", "session_ended_while_paused");
      }
      return finalizeAttempt(stateWithClock, command.nowMs, "incomplete", "session_ended_while_paused");
    }

    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}
