/**
 * Types for the adaptive target-placement difficulty engine.
 *
 * CLINICAL SAFETY BOUNDARY
 * ------------------------
 * A "level" here is an adaptive TARGET-PLACEMENT level: it drives how far a reach
 * target is placed from the patient. It is NOT a measured range-of-motion value,
 * NOT a joint angle, and NOT a clinical outcome. Measured CV values stay in the
 * detector layer and in `ShoulderInteractionMetrics` — never derive a clinical
 * reading from these numbers.
 *
 * This module ships NO default configuration on purpose. Every threshold (levels,
 * steps, streaks, cooldown, timeouts) is a clinical parameter and must be approved
 * by a therapist or the clinical team before production use. Any values appearing
 * in tests are fixtures only and carry no clinical validation.
 *
 * METRIC OWNERSHIP
 * ----------------
 * This engine owns adaptation state only. Final session totals — attempts, successful
 * targets, incomplete targets, reach times — are owned by the existing target lifecycle
 * and the factual target-event layer, and are never mirrored here. See the boundary note
 * on `AdaptiveDifficultyState`.
 */

/** Direction of an adaptive decision. `hold` means the level was deliberately not moved. */
export type AdaptiveChangeDirection = "increase" | "decrease" | "hold";

/**
 * Why an adaptive decision was emitted.
 * - `consecutiveSuccess`      — success streak threshold met, level raised.
 * - `consecutiveStruggle`     — struggle streak threshold met, level lowered.
 * - `maxLevelReached`         — success streak met while already at the therapist-approved
 *                               ceiling; the level is held and the streak is consumed.
 * - `minLevelExtendedTimeout` — struggle streak met while already at the therapist-approved
 *                               floor; instead of lowering further, the attempt timeout is extended.
 */
export type AdaptiveChangeReason =
  | "consecutiveSuccess"
  | "consecutiveStruggle"
  | "maxLevelReached"
  | "minLevelExtendedTimeout";

/**
 * Whether a success achieved with a compensatory movement pattern (e.g. trunk lean,
 * shoulder hike) may advance the streak that raises difficulty. Compensated successes
 * are always counted in the success metrics either way — only progression is affected.
 */
export type CompensatedSuccessPolicy =
  | "countsTowardIncrease"
  | "excludedFromIncrease";

/**
 * The compensation state of one successful attempt, as three explicit facts.
 *
 * WHY THIS TYPE EXISTS (REVIEW-FIX)
 * ---------------------------------
 * The wire field is `compensated?: boolean`, and an optional boolean has exactly the
 * failure mode that caused the blocker this type fixes: `outcome.compensated === true`
 * reads a missing observation as "not compensated", which is a claim about the patient's
 * movement that nobody made. The three states are named here so that the one place that
 * interprets them must handle each by name, and so `unknown` cannot be reached by
 * falling off the end of a truthiness check.
 *
 *   `clean`       — an observation was supplied and reported no compensatory pattern.
 *   `compensated` — an observation was supplied and reported a compensatory pattern.
 *   `unknown`     — NO observation was supplied. Not a third clinical finding and not a
 *                   weaker form of `clean`: the attempt really was one of the other two,
 *                   and the runtime simply cannot say which.
 *
 * See `resolveAttemptCompensationState` and `attemptCompensationAdvancesIncreaseStreak`
 * in `adaptive-difficulty.ts` for how `unknown` is resolved for progression.
 */
export type AttemptCompensationState = "clean" | "compensated" | "unknown";

/**
 * Clinical configuration for the adaptive engine. All fields are required and there is
 * deliberately no exported default, so a caller cannot inherit unvalidated thresholds.
 */
export type DifficultyConfig = {
  /** Level the session starts at. Clamped into [minLevel, maxLevel] — the only silent correction. */
  startLevel: number;
  /** Therapist-approved floor. The engine never places a target below this level. */
  minLevel: number;
  /** Therapist-approved ceiling. The engine never places a target above this level. */
  maxLevel: number;
  /** Level units added on an increase. Must be greater than 0. */
  increaseStep: number;
  /** Level units removed on a decrease. Must be greater than 0. */
  decreaseStep: number;
  /** Consecutive qualifying successes required before the level is raised. Must be greater than 0. */
  successStreakToIncrease: number;
  /** Consecutive incomplete attempts required before the level is lowered. Must be greater than 0. */
  struggleStreakToDecrease: number;
  /** Counted attempts that must pass after a real change before another is evaluated. Must be >= 0. */
  cooldownAttempts: number;
  /** Time the patient is given to reach a target under normal conditions. Must be greater than 0. */
  normalAttemptTimeoutMs: number;
  /** Longer timeout granted at the floor instead of lowering the level. Must be >= the normal timeout. */
  extendedAttemptTimeoutMs: number;
  /** Whether compensated successes advance the increase streak. */
  compensatedSuccessPolicy: CompensatedSuccessPolicy;
};

/**
 * A single adaptive decision, recorded for clinician review and for later persistence.
 *
 * Ordering is carried by the position of the entry inside `changes`, not by an attempt
 * index. A decision deliberately does NOT record "which attempt number" it happened on:
 * that number is a factual session total owned by the target-event layer (FIX-001). A
 * consumer that needs the correlation composes it there, where both the change history
 * and the factual attempt identity are available.
 */
export type AdaptiveChange = {
  direction: AdaptiveChangeDirection;
  reason: AdaptiveChangeReason;
  fromLevel: number;
  toLevel: number;
  /** Attempt timeout in effect immediately after this decision. */
  attemptTimeoutMs: number;
};

/** Outcome kinds the engine understands. */
export type AdaptiveAttemptOutcomeKind = "success" | "incomplete" | "trackingLost";

/**
 * Result of one attempt.
 *
 * `trackingLost` is a VOIDED attempt: the pose/landmark stream was unusable, so the
 * attempt says nothing about the patient's ability. Since FIX-001 it leaves the adaptive
 * state completely untouched — there is no counter left for it to move. How many attempts
 * were voided is a factual session metric, recorded by the target-event layer alongside
 * the detector's own tracking-quality signal, not by this engine.
 */
export type AdaptiveAttemptOutcome =
  | {
      kind: "success";
      /**
       * Attempt-start to target-capture duration, supplied by the caller — this module
       * reads no clock.
       *
       * FACTUAL METADATA, INPUT ONLY. The engine does not read, aggregate, store or own
       * this value; reach/reaction times belong to the target lifecycle and the factual
       * session-event layer (`ShoulderInteractionMetrics.reactionTimesMs`). It stays on
       * the input so a future therapist-approved rule may adapt on reach duration without
       * reshaping this contract. Optional precisely because adaptation never needs it.
       */
      reachTimeMs?: number;
      /**
       * Compensation observed during the reach — a THREE-state fact carried in an
       * optional boolean, never a two-state one with a default:
       *
       *   true      → a compensatory pattern was observed
       *   false     → compensation was evaluated and none was observed
       *   undefined → no compensation observation was supplied — UNKNOWN
       *
       * ABSENCE IS NOT `false`. There is deliberately no default: defaulting the missing
       * case to "no compensation" manufactures an observation of clean movement out of
       * having failed to look, and lets an attempt nobody could evaluate carry a patient
       * toward a harder target. `mapTargetHitToAdaptiveOutcome` preserves the distinction
       * on the way in by omitting the key rather than coercing it, and
       * `resolveAttemptCompensationState` names it `unknown` on the way out.
       */
      compensated?: boolean;
    }
  | { kind: "incomplete" }
  | { kind: "trackingLost" };

/**
 * Full engine state. Treated as immutable: `applyAttemptOutcome` returns a new object
 * and never mutates its input.
 *
 * SOURCE-OF-TRUTH BOUNDARY (FIX-001)
 * ----------------------------------
 * This state holds ADAPTATION STATE ONLY — what the engine needs to decide the next
 * target-placement level. It deliberately holds NO final session totals: no attempt
 * count, no successful-target count, no incomplete-target count, no reach times.
 * Those are factual session metrics owned by the existing target lifecycle
 * (`ShoulderInteractionMetrics`) and by the target-event layer. Duplicating them here
 * would create a second, independently-updated source of truth that drifts from the
 * first and reports conflicting session results to the clinician.
 *
 * The starting level is not stored separately either: it is recoverable, purely and
 * deterministically, as `clampLevel(config.startLevel, config)`.
 */
export type AdaptiveDifficultyState = {
  /** Validated configuration this state was created from. */
  config: DifficultyConfig;
  /** Current adaptive target-placement level, always within [minLevel, maxLevel]. */
  currentLevel: number;
  /** Timeout currently granted per attempt — raised to the extended value at the floor. */
  attemptTimeoutMs: number;
  /** Consecutive qualifying successes since the last reset. Drives the increase decision. */
  successStreak: number;
  /** Consecutive incomplete attempts since the last reset. Drives the decrease decision. */
  struggleStreak: number;
  /** Counted attempts still to pass before another level change may be evaluated. */
  cooldownRemaining: number;
  /**
   * Counted attempts since the last real level change. Scoped to the current level —
   * a concept only this engine has, so it duplicates no session metric. Retained for
   * adaptation rules that must know how long the patient has been at a level.
   */
  attemptsAtCurrentLevel: number;
  /** Highest level at which a success was recorded, or null before the first success. */
  highestSuccessfulLevel: number | null;
  /** Every decision emitted this session, in order. */
  changes: AdaptiveChange[];
};

/** Return shape of `applyAttemptOutcome` — mirrors the `{ state, event }` shape used by target-lifecycle. */
export type AdaptiveAttemptResult = {
  state: AdaptiveDifficultyState;
  /** The decision emitted by this attempt, or null when none was. */
  change: AdaptiveChange | null;
};

/** Outcome of validating a `DifficultyConfig`. */
export type DifficultyConfigValidation =
  | { valid: true; issues: [] }
  | { valid: false; issues: string[] };
