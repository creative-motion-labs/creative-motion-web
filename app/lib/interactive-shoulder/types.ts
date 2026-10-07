import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

/** Normalized screen coordinates in [0, 1] — same space as MediaPipe landmark x/y. */
export type NormalizedPoint = {
  x: number;
  y: number;
};

export type TherapeuticTarget = NormalizedPoint & {
  id: string;
  /**
   * Wall-clock spawn timestamp. PRESENTATION/EVENT CLOCK ONLY — reaction times and
   * spawn locks are derived from it. Never used to decide attempt expiration.
   */
  spawnedAtMs: number;
  /**
   * Target-placement level in degrees, carried only when the caller supplied one.
   *
   * CLINICAL SAFETY: this is TARGET-PLACEMENT GEOMETRY (see `target-level-geometry.ts`),
   * not a measured range-of-motion value, not a joint angle, and not a clinical outcome.
   * It is optional and is NEVER defaulted: absence means "no level was configured", and
   * no fallback level may be invented for it.
   */
  levelDegrees?: number;
  /**
   * Pause-aware block elapsed seconds at the moment this target spawned — the baseline
   * for attempt expiration. ATTEMPT/CLINICAL CLOCK ONLY, kept deliberately separate from
   * `spawnedAtMs`. Absent when the caller ticks the lifecycle without block elapsed time,
   * in which case attempt expiration is not evaluated at all.
   */
  spawnedAtBlockElapsedS?: number;
};

export type SafeTargetBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type TargetHitConfig = {
  collisionRadius: number;
};

export type TargetHitEvent = {
  targetId: string;
  capturedAtMs: number;
  reactionTimeMs: number;
  /**
   * Target sequence this hit belongs to — the attempt identity. Optional so existing
   * hand-constructed events (orchestrator adapters, fixtures) stay valid; the target
   * lifecycle always populates it.
   */
  sequence?: number;
  /** Placement level carried over from the target. Geometry only — see `TherapeuticTarget.levelDegrees`. */
  levelDegrees?: number;
  /**
   * True when the caller reported a compensatory movement pattern at any point during
   * this attempt. Pass-through metadata: the lifecycle neither detects compensation nor
   * interprets it, and it never changes target difficulty here. Absent when the caller
   * supplied no compensation input for the attempt — absence means "unknown", not "clean".
   */
  compensatedDuringAttempt?: boolean;
};

/**
 * A target attempt has begun. Emitted exactly once per spawned target, on the tick that
 * spawns it. Attempt identity is the target's own identity — no second counter exists.
 */
export type TargetAttemptStartEvent = {
  targetId: string;
  /** Target sequence number; monotonic within a lifecycle instance. */
  sequence: number;
  /** Wall-clock spawn time — presentation/event clock. */
  startedAtMs: number;
  /**
   * Pause-aware block elapsed seconds at attempt start, or null when the caller ticks
   * without block elapsed time. Null means this attempt can never expire.
   */
  startedAtBlockElapsedS: number | null;
  /**
   * Reach side supplied to the lifecycle tick. NOT an affected-side diagnosis: the
   * caller may have resolved this from a documented fallback
   * (`INTERACTIVE_SHOULDER_DEFAULT_SIDE`).
   */
  side: ShoulderAbductionReachSide;
  /** Placement level when configured. Geometry only — see `TherapeuticTarget.levelDegrees`. */
  levelDegrees?: number;
};

/**
 * A target attempt reached its configured active time without contact.
 *
 * CLINICAL SAFETY BOUNDARY
 * ------------------------
 * This is an INTERACTION-LIFECYCLE result, not a clinical finding, not a diagnosis, and
 * not a measured CV failure. It states one fact only: the allotted pause-aware active
 * attempt time elapsed while the target was still un-contacted.
 *
 * The event carries NO `reason` discriminant, and that omission is deliberate and load
 * bearing. Tracking loss is NOT patient failure, so it must never be expressible as a
 * variant of this event. The adaptive engine models the two as separate outcome kinds
 * (`incomplete` vs. `trackingLost`, see `adaptive-difficulty-types.ts`); a shared reason
 * union here would let a consumer collapse them into one patient-performance meaning.
 * A future tracking-loss signal must therefore be its own event type, never a reason on
 * this one.
 */
export type TargetAttemptTimeoutEvent = {
  targetId: string;
  /** Target sequence this expired attempt belongs to. */
  sequence: number;
  /** Wall-clock time at which expiration was observed — presentation/event clock. */
  expiredAtMs: number;
  /** Pause-aware block elapsed seconds at which expiration was observed. */
  expiredAtBlockElapsedS: number;
  /**
   * Pause-aware MEASURABLE attempt duration in ms — the value that was compared against
   * `attemptTimeoutMs`, not the wall span of the attempt.
   *
   * Two kinds of time are excluded by construction: frozen block time (pause, safety
   * hold), which the orchestrator never adds to `blockElapsedSeconds` in the first place;
   * and time during which no wrist measurement was available, which the target lifecycle
   * accumulates per attempt and subtracts. So this is time the patient was actually
   * observed reaching — never time the runtime merely failed to watch.
   */
  activeElapsedMs: number;
  /** The configured timeout that was reached. */
  attemptTimeoutMs: number;
  /** Placement level when configured. Geometry only — see `TherapeuticTarget.levelDegrees`. */
  levelDegrees?: number;
  /**
   * Compensation reported during the expired attempt, when the caller supplied any.
   * Pass-through metadata only — see `TargetHitEvent.compensatedDuringAttempt`.
   */
  compensatedDuringAttempt?: boolean;
};

/** Interaction performance — separate from measured CV reps/angles. */
export type ShoulderInteractionMetrics = {
  targetsShown: number;
  targetsReached: number;
  targetHitTimestampsMs: number[];
  reactionTimesMs: number[];
};

export function createEmptyShoulderInteractionMetrics(): ShoulderInteractionMetrics {
  return {
    targetsShown: 0,
    targetsReached: 0,
    targetHitTimestampsMs: [],
    reactionTimesMs: [],
  };
}
