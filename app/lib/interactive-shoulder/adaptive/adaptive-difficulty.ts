/**
 * Pure adaptive target-placement difficulty engine.
 *
 * Determinism contract: this module reads no clock, no randomness and no browser or
 * React API. Every input arrives through the arguments, so the same state plus the
 * same outcome always produces the same result.
 *
 * CLINICAL SAFETY: no threshold in this file is clinically validated, because this file
 * defines no thresholds at all. The caller supplies a `DifficultyConfig` that a therapist
 * or the clinical team has approved. See `adaptive-difficulty-types.ts`.
 *
 * SINGLE SOURCE OF TRUTH (FIX-001): this engine decides the next target-placement level
 * and nothing else. It keeps no attempt total, no successful-target count, no
 * incomplete-target count and no reach times — those are factual session metrics owned by
 * the existing target lifecycle (`ShoulderInteractionMetrics`) and by the target-event
 * layer. Mirroring them here would give a clinician two independently-updated answers to
 * the same question.
 */
import type {
  AdaptiveAttemptOutcome,
  AdaptiveAttemptResult,
  AdaptiveChange,
  AdaptiveDifficultyState,
  AttemptCompensationState,
  CompensatedSuccessPolicy,
  DifficultyConfig,
  DifficultyConfigValidation,
} from "./adaptive-difficulty-types";

const COMPENSATED_SUCCESS_POLICIES = [
  "countsTowardIncrease",
  "excludedFromIncrease",
] as const;

/**
 * Validates a clinical configuration. Returns the problems instead of throwing so a
 * caller can surface them, and so the check itself stays pure.
 *
 * `startLevel` is intentionally NOT range-checked here: it is the single documented
 * value the engine may silently correct, via `clampLevel`. Everything else is rejected.
 */
export function validateDifficultyConfig(
  config: DifficultyConfig,
): DifficultyConfigValidation {
  const issues: string[] = [];

  const numericFields = [
    ["startLevel", config.startLevel],
    ["minLevel", config.minLevel],
    ["maxLevel", config.maxLevel],
    ["increaseStep", config.increaseStep],
    ["decreaseStep", config.decreaseStep],
    ["successStreakToIncrease", config.successStreakToIncrease],
    ["struggleStreakToDecrease", config.struggleStreakToDecrease],
    ["cooldownAttempts", config.cooldownAttempts],
    ["normalAttemptTimeoutMs", config.normalAttemptTimeoutMs],
    ["extendedAttemptTimeoutMs", config.extendedAttemptTimeoutMs],
  ] as const;

  for (const [name, value] of numericFields) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(`${name} must be a finite number.`);
    }
  }

  // Comparisons below are meaningless once a value is NaN or Infinity.
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  // Streaks and cooldown are counted in whole attempts, so a fractional threshold can
  // never be met exactly: `successStreak >= 2.5` first fires on the 3rd attempt, and a
  // cooldown of 1.5 is consumed over 2. The configured number and the number a therapist
  // actually observes would silently disagree, so these are rejected rather than rounded.
  const wholeAttemptFields = [
    ["successStreakToIncrease", config.successStreakToIncrease],
    ["struggleStreakToDecrease", config.struggleStreakToDecrease],
    ["cooldownAttempts", config.cooldownAttempts],
  ] as const;

  for (const [name, value] of wholeAttemptFields) {
    if (!Number.isInteger(value)) {
      issues.push(`${name} must be a whole number of attempts.`);
    }
  }

  if (config.increaseStep <= 0) {
    issues.push("increaseStep must be greater than 0.");
  }
  if (config.decreaseStep <= 0) {
    issues.push("decreaseStep must be greater than 0.");
  }
  if (config.successStreakToIncrease <= 0) {
    issues.push("successStreakToIncrease must be greater than 0.");
  }
  if (config.struggleStreakToDecrease <= 0) {
    issues.push("struggleStreakToDecrease must be greater than 0.");
  }
  if (config.cooldownAttempts < 0) {
    issues.push("cooldownAttempts must be 0 or greater.");
  }
  if (config.normalAttemptTimeoutMs <= 0) {
    issues.push("normalAttemptTimeoutMs must be greater than 0.");
  }
  if (config.extendedAttemptTimeoutMs <= 0) {
    issues.push("extendedAttemptTimeoutMs must be greater than 0.");
  }
  if (config.minLevel > config.maxLevel) {
    issues.push("minLevel must not be greater than maxLevel.");
  }
  if (config.extendedAttemptTimeoutMs < config.normalAttemptTimeoutMs) {
    issues.push(
      "extendedAttemptTimeoutMs must not be shorter than normalAttemptTimeoutMs.",
    );
  }
  if (!COMPENSATED_SUCCESS_POLICIES.includes(config.compensatedSuccessPolicy)) {
    issues.push(
      `compensatedSuccessPolicy must be one of: ${COMPENSATED_SUCCESS_POLICIES.join(", ")}.`,
    );
  }

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

/**
 * Names the compensation state carried by a success outcome, without collapsing any of
 * the three cases into another.
 *
 * The explicit `=== false` arm is the load-bearing one: it is what keeps "an observation
 * was made and it was clean" distinguishable from "no observation was made at all". A
 * truthiness check (`!outcome.compensated`) answers both with the same value and is the
 * exact shape this function exists to prevent.
 */
export function resolveAttemptCompensationState(
  compensated: boolean | undefined,
): AttemptCompensationState {
  if (compensated === true) return "compensated";
  if (compensated === false) return "clean";
  return "unknown";
}

/**
 * Whether a success in this compensation state may advance the streak that raises the
 * target-placement level.
 *
 * THE RULE FOR `unknown`: a success advances only when EVERY compensation state it could
 * actually have been would also have advanced it.
 *
 * This invents no clinical interpretation of `unknown`, which is the whole point. An
 * unobserved attempt was really either clean or compensated. When the configured policy
 * would advance the streak for both, the missing observation could not have changed the
 * decision, so advancing asserts nothing the runtime does not know. When the policy
 * separates them — `excludedFromIncrease` — the decision genuinely depends on the fact
 * that is missing, and the engine declines to resolve that ambiguity in the direction of
 * a harder target. Unknown is never granted more credit than the worst state it might be.
 *
 * `unknown` is expressed as the conjunction of the other two arms rather than as a
 * hand-written policy comparison so the property is structural: a future policy that
 * changes how `clean` or `compensated` progress cannot leave `unknown` behind, and no
 * edit can make `unknown` advance where `compensated` does not.
 */
export function attemptCompensationAdvancesIncreaseStreak(
  state: AttemptCompensationState,
  policy: CompensatedSuccessPolicy,
): boolean {
  switch (state) {
    case "clean":
      // An observed clean reach is the one case that always carries the patient forward.
      return true;
    case "compensated":
      // Observed compensation advances only where the therapist-approved policy says it may.
      return policy === "countsTowardIncrease";
    case "unknown":
      return (
        attemptCompensationAdvancesIncreaseStreak("clean", policy) &&
        attemptCompensationAdvancesIncreaseStreak("compensated", policy)
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** Clamps a level into the therapist-approved [minLevel, maxLevel] range. */
export function clampLevel(level: number, config: DifficultyConfig): number {
  return Math.min(Math.max(level, config.minLevel), config.maxLevel);
}

/**
 * Creates a fresh session state. Throws on an invalid configuration — an unvalidated
 * clinical configuration must never reach a live session.
 */
export function createAdaptiveDifficultyState(
  config: DifficultyConfig,
): AdaptiveDifficultyState {
  const validation = validateDifficultyConfig(config);
  if (!validation.valid) {
    throw new Error(
      `Invalid adaptive difficulty configuration: ${validation.issues.join(" ")}`,
    );
  }

  return {
    // Copied so later caller-side mutation of their object cannot leak into the session.
    config: { ...config },
    currentLevel: clampLevel(config.startLevel, config),
    attemptTimeoutMs: config.normalAttemptTimeoutMs,
    successStreak: 0,
    struggleStreak: 0,
    cooldownRemaining: 0,
    attemptsAtCurrentLevel: 0,
    highestSuccessfulLevel: null,
    changes: [],
  };
}

/** Returns a fresh session state built from the config already validated in `state`. */
export function resetAdaptiveDifficultyState(
  state: AdaptiveDifficultyState,
): AdaptiveDifficultyState {
  return createAdaptiveDifficultyState(state.config);
}

function withChange(
  state: AdaptiveDifficultyState,
  change: AdaptiveChange,
): AdaptiveAttemptResult {
  return { state: { ...state, changes: [...state.changes, change] }, change };
}

/**
 * Decides whether the level moves. Only reached for a counted attempt that is not in
 * cooldown. Increase is checked first; the two streaks can never both be at threshold,
 * because every counted attempt zeroes one of them.
 */
function evaluateLevelChange(
  state: AdaptiveDifficultyState,
): AdaptiveAttemptResult {
  const { config } = state;

  if (state.successStreak >= config.successStreakToIncrease) {
    if (state.currentLevel < config.maxLevel) {
      const toLevel = clampLevel(state.currentLevel + config.increaseStep, config);
      return withChange(
        {
          ...state,
          currentLevel: toLevel,
          // Progressing away from the floor withdraws the extended-timeout accommodation.
          attemptTimeoutMs: config.normalAttemptTimeoutMs,
          successStreak: 0,
          struggleStreak: 0,
          attemptsAtCurrentLevel: 0,
          cooldownRemaining: config.cooldownAttempts,
        },
        {
          direction: "increase",
          reason: "consecutiveSuccess",
          fromLevel: state.currentLevel,
          toLevel,
          attemptTimeoutMs: config.normalAttemptTimeoutMs,
        },
      );
    }

    // Already at the therapist-approved ceiling. Hold, and consume the streak so the
    // same decision is not re-emitted on every following success.
    return withChange(
      { ...state, successStreak: 0 },
      {
        direction: "hold",
        reason: "maxLevelReached",
        fromLevel: state.currentLevel,
        toLevel: state.currentLevel,
        attemptTimeoutMs: state.attemptTimeoutMs,
      },
    );
  }

  if (state.struggleStreak >= config.struggleStreakToDecrease) {
    if (state.currentLevel > config.minLevel) {
      const toLevel = clampLevel(state.currentLevel - config.decreaseStep, config);
      return withChange(
        {
          ...state,
          currentLevel: toLevel,
          successStreak: 0,
          struggleStreak: 0,
          attemptsAtCurrentLevel: 0,
          cooldownRemaining: config.cooldownAttempts,
        },
        {
          direction: "decrease",
          reason: "consecutiveStruggle",
          fromLevel: state.currentLevel,
          toLevel,
          attemptTimeoutMs: state.attemptTimeoutMs,
        },
      );
    }

    // Already at the therapist-approved floor. Never go lower: grant more time instead,
    // and consume the streak so the decision is not re-emitted on every following attempt.
    return withChange(
      {
        ...state,
        attemptTimeoutMs: config.extendedAttemptTimeoutMs,
        struggleStreak: 0,
      },
      {
        direction: "hold",
        reason: "minLevelExtendedTimeout",
        fromLevel: state.currentLevel,
        toLevel: state.currentLevel,
        attemptTimeoutMs: config.extendedAttemptTimeoutMs,
      },
    );
  }

  return { state, change: null };
}

/**
 * Applies one attempt outcome and returns the next state plus any decision emitted.
 * Never mutates `state`.
 */
export function applyAttemptOutcome(
  state: AdaptiveDifficultyState,
  outcome: AdaptiveAttemptOutcome,
): AdaptiveAttemptResult {
  // Tracking loss says nothing about the patient, so it changes nothing here: no streak
  // moves, no cooldown is consumed, no decision is emitted, and — since FIX-001 removed
  // the session totals — there is no counter left for it to touch either. The state is
  // returned unchanged, which is the strongest possible statement of "voided". How many
  // attempts were voided is recorded by the factual target-event layer, not by this engine.
  if (outcome.kind === "trackingLost") {
    return { state, change: null };
  }

  const { config } = state;
  let next: AdaptiveDifficultyState;

  if (outcome.kind === "success") {
    // Three states, resolved by name. Before the review fix this line was
    // `outcome.compensated === true`, which answered "was compensation observed?" with
    // the same `false` for an observed-clean reach and for an attempt nobody evaluated —
    // so an UNKNOWN success advanced the streak exactly like a clean one and could raise
    // the level on evidence that was never collected.
    const compensationState = resolveAttemptCompensationState(outcome.compensated);
    const advancesStreak = attemptCompensationAdvancesIncreaseStreak(
      compensationState,
      config.compensatedSuccessPolicy,
    );

    // `outcome.reachTimeMs` is deliberately not read: reach times are a factual session
    // metric owned by the target lifecycle, never mirrored into adaptation state.
    next = {
      ...state,
      attemptsAtCurrentLevel: state.attemptsAtCurrentLevel + 1,
      highestSuccessfulLevel:
        state.highestSuccessfulLevel === null
          ? state.currentLevel
          : Math.max(state.highestSuccessfulLevel, state.currentLevel),
      // The target WAS reached, whatever the compensation state. A success is never a
      // struggle, so the struggle streak resets on all three — an unobserved reach must
      // not lower the level any more than it may raise it.
      struggleStreak: 0,
      // A success that does not advance the streak PRESERVES it rather than resetting it.
      // The attempt still counts as a successful target interaction (recorded by the
      // event layer); it simply does not carry the patient toward a harder target. This
      // is the previously approved compensated-success semantic, now shared by UNKNOWN.
      successStreak: advancesStreak ? state.successStreak + 1 : state.successStreak,
    };
  } else {
    next = {
      ...state,
      attemptsAtCurrentLevel: state.attemptsAtCurrentLevel + 1,
      struggleStreak: state.struggleStreak + 1,
      successStreak: 0,
    };
  }

  // Cooldown: adaptation state keeps progressing (streaks and the per-level counter still
  // move), but no second decision is evaluated. One counted attempt consumes exactly one
  // cooldown slot.
  if (next.cooldownRemaining > 0) {
    return {
      state: { ...next, cooldownRemaining: next.cooldownRemaining - 1 },
      change: null,
    };
  }

  return evaluateLevelChange(next);
}
