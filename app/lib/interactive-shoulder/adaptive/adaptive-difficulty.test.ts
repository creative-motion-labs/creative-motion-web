/**
 * Run: npx tsx --test app/lib/interactive-shoulder/adaptive/adaptive-difficulty.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAttemptOutcome,
  attemptCompensationAdvancesIncreaseStreak,
  clampLevel,
  createAdaptiveDifficultyState,
  resetAdaptiveDifficultyState,
  resolveAttemptCompensationState,
  validateDifficultyConfig,
} from "./adaptive-difficulty";
import type {
  AdaptiveAttemptOutcome,
  AdaptiveDifficultyState,
  DifficultyConfig,
} from "./adaptive-difficulty-types";

/**
 * TEST FIXTURE ONLY — these numbers are NOT clinically validated and must never be
 * copied into production. Real thresholds require therapist or clinical-team approval.
 * The level is an adaptive target-placement level, not a range-of-motion measurement.
 */
const TEST_CONFIG: DifficultyConfig = {
  startLevel: 60,
  minLevel: 30,
  maxLevel: 90,
  increaseStep: 5,
  decreaseStep: 5,
  successStreakToIncrease: 3,
  struggleStreakToDecrease: 2,
  cooldownAttempts: 2,
  normalAttemptTimeoutMs: 8_000,
  extendedAttemptTimeoutMs: 12_000,
  compensatedSuccessPolicy: "excludedFromIncrease",
};

/**
 * A CLEAN success — compensation was evaluated and none was observed.
 *
 * `compensated: false` is stated explicitly, and that is not noise. This fixture used to
 * omit the field, which made every "clean success" assertion in this file silently an
 * UNKNOWN-compensation assertion that passed only because the engine collapsed the two.
 * Spelling it out is what keeps these tests about the case they claim to be about.
 */
const success = (reachTimeMs = 1_200): AdaptiveAttemptOutcome => ({
  kind: "success",
  reachTimeMs,
  compensated: false,
});
const compensatedSuccess = (reachTimeMs = 1_200): AdaptiveAttemptOutcome => ({
  kind: "success",
  reachTimeMs,
  compensated: true,
});
/** A success for which NO compensation observation was supplied — UNKNOWN, not clean. */
const unknownCompensationSuccess = (reachTimeMs = 1_200): AdaptiveAttemptOutcome => ({
  kind: "success",
  reachTimeMs,
});
const INCOMPLETE: AdaptiveAttemptOutcome = { kind: "incomplete" };
const TRACKING_LOST: AdaptiveAttemptOutcome = { kind: "trackingLost" };

function applyAll(
  state: AdaptiveDifficultyState,
  outcomes: readonly AdaptiveAttemptOutcome[],
): AdaptiveDifficultyState {
  return outcomes.reduce(
    (acc, outcome) => applyAttemptOutcome(acc, outcome).state,
    state,
  );
}

function repeat(
  outcome: AdaptiveAttemptOutcome,
  times: number,
): AdaptiveAttemptOutcome[] {
  return Array.from({ length: times }, () => outcome);
}

function deepFreeze(state: AdaptiveDifficultyState): AdaptiveDifficultyState {
  Object.freeze(state.config);
  state.changes.forEach((change) => Object.freeze(change));
  Object.freeze(state.changes);
  return Object.freeze(state);
}

/**
 * Session totals the adaptive engine must never own (FIX-001). They belong to the target
 * lifecycle and the factual target-event layer. Asserted by shape, not by source text, and
 * including plausible aliases so the fields cannot quietly return under a new name.
 */
const FORBIDDEN_SESSION_METRIC_FIELDS = [
  "totalAttempts",
  "successfulAttempts",
  "incompleteAttempts",
  "voidedAttempts",
  "reachTimesMs",
  // Aliases that would reintroduce the same duplication under a different label.
  "attempts",
  "attemptCount",
  "totalAttemptCount",
  "successes",
  "successCount",
  "successfulTargets",
  "targetsReached",
  "targetsShown",
  "incompletes",
  "incompleteCount",
  "voided",
  "voidedCount",
  "reachTimes",
  "reactionTimesMs",
  "reachTimeMs",
  "atAttempt",
] as const;

function assertNoSessionTotals(state: AdaptiveDifficultyState, label: string): void {
  const keys = Object.keys(state);
  for (const forbidden of FORBIDDEN_SESSION_METRIC_FIELDS) {
    assert.equal(
      keys.includes(forbidden),
      false,
      `${label}: adaptive state must not own the session metric "${forbidden}"`,
    );
  }
}

describe("adaptive difficulty — state creation and configuration", () => {
  it("creates a valid starting state from an approved configuration", () => {
    const state = createAdaptiveDifficultyState(TEST_CONFIG);

    assert.equal(state.currentLevel, 60);
    assert.equal(state.attemptTimeoutMs, TEST_CONFIG.normalAttemptTimeoutMs);
    assert.equal(state.successStreak, 0);
    assert.equal(state.struggleStreak, 0);
    assert.equal(state.cooldownRemaining, 0);
    assert.equal(state.attemptsAtCurrentLevel, 0);
    assert.equal(state.highestSuccessfulLevel, null);
    assert.deepEqual(state.changes, []);
    assert.deepEqual(state.config, TEST_CONFIG);
  });

  // ── FIX-001: single source of truth for session metrics ──────────────────────
  it("holds adaptation state only — exactly the documented keys, nothing else", () => {
    const state = createAdaptiveDifficultyState(TEST_CONFIG);

    assert.deepEqual(Object.keys(state).sort(), [
      "attemptTimeoutMs",
      "attemptsAtCurrentLevel",
      "changes",
      "config",
      "cooldownRemaining",
      "currentLevel",
      "highestSuccessfulLevel",
      "struggleStreak",
      "successStreak",
    ]);
  });

  it("the initial state owns no session totals", () => {
    assertNoSessionTotals(createAdaptiveDifficultyState(TEST_CONFIG), "initial state");
  });

  it("the starting level stays recoverable from the config without a stored field", () => {
    const state = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 200 });

    // Clamped start is derived, never duplicated into its own field.
    assert.equal(clampLevel(state.config.startLevel, state.config), 90);
    assert.equal(state.currentLevel, 90);
  });

  it("clamps a starting level that sits outside the therapist-approved range", () => {
    const above = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 200 });
    const below = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 5 });

    assert.equal(above.currentLevel, 90);
    assert.equal(below.currentLevel, 30);
    assert.equal(clampLevel(200, TEST_CONFIG), 90);
    assert.equal(clampLevel(5, TEST_CONFIG), 30);
    assert.equal(clampLevel(60, TEST_CONFIG), 60);
  });

  it("does not copy the caller's config object by reference", () => {
    const mutable: DifficultyConfig = { ...TEST_CONFIG };
    const state = createAdaptiveDifficultyState(mutable);
    mutable.maxLevel = 999;

    assert.equal(state.config.maxLevel, 90);
  });

  it("rejects invalid clinical configuration instead of silently accepting it", () => {
    const invalidConfigs: ReadonlyArray<[string, DifficultyConfig]> = [
      ["non-finite level", { ...TEST_CONFIG, maxLevel: Number.NaN }],
      ["infinite timeout", { ...TEST_CONFIG, normalAttemptTimeoutMs: Number.POSITIVE_INFINITY }],
      ["zero increase step", { ...TEST_CONFIG, increaseStep: 0 }],
      ["negative decrease step", { ...TEST_CONFIG, decreaseStep: -5 }],
      ["zero success streak", { ...TEST_CONFIG, successStreakToIncrease: 0 }],
      ["negative struggle streak", { ...TEST_CONFIG, struggleStreakToDecrease: -1 }],
      ["negative cooldown", { ...TEST_CONFIG, cooldownAttempts: -1 }],
      ["zero normal timeout", { ...TEST_CONFIG, normalAttemptTimeoutMs: 0 }],
      ["min above max", { ...TEST_CONFIG, minLevel: 95 }],
      [
        "extended timeout shorter than normal",
        { ...TEST_CONFIG, extendedAttemptTimeoutMs: 4_000 },
      ],
    ];

    for (const [label, config] of invalidConfigs) {
      const validation = validateDifficultyConfig(config);
      assert.equal(validation.valid, false, `${label} should be rejected`);
      assert.ok(validation.issues.length > 0, `${label} should report an issue`);
      assert.throws(
        () => createAdaptiveDifficultyState(config),
        /Invalid adaptive difficulty configuration/,
        `${label} should throw`,
      );
    }
  });

  it("accepts a zero cooldown and an equal extended timeout", () => {
    const validation = validateDifficultyConfig({
      ...TEST_CONFIG,
      cooldownAttempts: 0,
      extendedAttemptTimeoutMs: TEST_CONFIG.normalAttemptTimeoutMs,
    });

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.issues, []);
  });

  // ── Review fix (PR #200): streaks and cooldown are counted in whole attempts ──
  // A fractional threshold is never met exactly, so the configured value and the value
  // a therapist observes would disagree. Rejected at validation rather than rounded.

  it("rejects a fractional streak or cooldown configuration", () => {
    const fractionalConfigs: ReadonlyArray<[string, DifficultyConfig]> = [
      ["successStreakToIncrease 1.5", { ...TEST_CONFIG, successStreakToIncrease: 1.5 }],
      ["successStreakToIncrease 2.25", { ...TEST_CONFIG, successStreakToIncrease: 2.25 }],
      ["successStreakToIncrease 0.5", { ...TEST_CONFIG, successStreakToIncrease: 0.5 }],
      ["struggleStreakToDecrease 1.5", { ...TEST_CONFIG, struggleStreakToDecrease: 1.5 }],
      ["struggleStreakToDecrease 2.25", { ...TEST_CONFIG, struggleStreakToDecrease: 2.25 }],
      ["struggleStreakToDecrease 0.5", { ...TEST_CONFIG, struggleStreakToDecrease: 0.5 }],
      ["cooldownAttempts 1.5", { ...TEST_CONFIG, cooldownAttempts: 1.5 }],
      ["cooldownAttempts 2.25", { ...TEST_CONFIG, cooldownAttempts: 2.25 }],
      ["cooldownAttempts 0.5", { ...TEST_CONFIG, cooldownAttempts: 0.5 }],
    ];

    for (const [label, config] of fractionalConfigs) {
      const validation = validateDifficultyConfig(config);
      assert.equal(validation.valid, false, `${label} should be rejected`);
      assert.ok(
        validation.issues.some((issue) => issue.includes("whole number of attempts")),
        `${label} should report the whole-attempt rule, received: ${validation.issues.join(" ")}`,
      );
      assert.throws(
        () => createAdaptiveDifficultyState(config),
        /Invalid adaptive difficulty configuration/,
        `${label} should never reach a live session`,
      );
    }
  });

  it("names the offending field when a streak or cooldown is fractional", () => {
    const validation = validateDifficultyConfig({
      ...TEST_CONFIG,
      successStreakToIncrease: 2.25,
    });

    assert.equal(validation.valid, false);
    assert.deepEqual(validation.issues, [
      "successStreakToIncrease must be a whole number of attempts.",
    ]);
  });

  it("reports every fractional field, not only the first", () => {
    const validation = validateDifficultyConfig({
      ...TEST_CONFIG,
      successStreakToIncrease: 1.5,
      struggleStreakToDecrease: 2.25,
      cooldownAttempts: 0.5,
    });

    assert.equal(validation.valid, false);
    assert.deepEqual(validation.issues, [
      "successStreakToIncrease must be a whole number of attempts.",
      "struggleStreakToDecrease must be a whole number of attempts.",
      "cooldownAttempts must be a whole number of attempts.",
    ]);
  });

  it("keeps the existing positivity rules alongside the whole-number rule", () => {
    // -1.5 breaks both rules; neither may silently replace the other.
    const validation = validateDifficultyConfig({
      ...TEST_CONFIG,
      successStreakToIncrease: -1.5,
    });

    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some((issue) => issue.includes("whole number of attempts")),
      "the whole-number rule must still fire",
    );
    assert.ok(
      validation.issues.some((issue) => issue.includes("greater than 0")),
      "the existing positivity rule must still fire",
    );
  });

  it("still accepts valid whole-number streak and cooldown values", () => {
    const validation = validateDifficultyConfig(TEST_CONFIG);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.issues, []);

    // Including the boundary values the existing rules already allow.
    const boundary = validateDifficultyConfig({
      ...TEST_CONFIG,
      successStreakToIncrease: 1,
      struggleStreakToDecrease: 1,
      cooldownAttempts: 0,
    });
    assert.equal(boundary.valid, true);
    assert.deepEqual(boundary.issues, []);

    const state = createAdaptiveDifficultyState({
      ...TEST_CONFIG,
      successStreakToIncrease: 4,
      struggleStreakToDecrease: 3,
      cooldownAttempts: 5,
    });
    assert.equal(state.currentLevel, 60);
  });

  it("leaves the non-attempt numeric fields free to be fractional", () => {
    // Levels, steps and timeouts are not attempt counts — the new rule must not widen.
    const validation = validateDifficultyConfig({
      ...TEST_CONFIG,
      startLevel: 60.5,
      increaseStep: 2.5,
      decreaseStep: 7.5,
      normalAttemptTimeoutMs: 8_000.5,
    });

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.issues, []);
  });
});

describe("adaptive difficulty — adaptation state accounting", () => {
  it("a successful attempt advances the streak, the level counter and the highest level", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const { state, change } = applyAttemptOutcome(start, success(1_450));

    assert.equal(change, null);
    assert.equal(state.attemptsAtCurrentLevel, 1);
    assert.equal(state.highestSuccessfulLevel, 60);
    assert.equal(state.successStreak, 1);
    assert.equal(state.struggleStreak, 0);
    assertNoSessionTotals(state, "after a success");
  });

  it("does not absorb the supplied reach time into adaptation state", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const withReachTime = applyAttemptOutcome(start, success(1_450)).state;
    // Compensation is held CONSTANT at clean so reach time is the only thing that varies.
    // Omitting it here would vary compensation too — and now legitimately changes the
    // streak — turning a reach-time test into an accidental UNKNOWN-compensation test.
    const withoutReachTime = applyAttemptOutcome(start, {
      kind: "success",
      compensated: false,
    }).state;

    // Reach time is factual metadata the engine passes over: supplying it, or omitting
    // it entirely, must produce byte-identical adaptation state.
    assert.deepEqual(withReachTime, withoutReachTime);
    assertNoSessionTotals(withReachTime, "success carrying a reach time");
  });

  it("a successful attempt resets the struggle streak", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const struggling = applyAll(start, [INCOMPLETE]);
    assert.equal(struggling.struggleStreak, 1);

    const recovered = applyAll(struggling, [success()]);
    assert.equal(recovered.struggleStreak, 0);
    assert.equal(recovered.successStreak, 1);
  });

  it("an incomplete attempt advances the struggle streak and resets the success streak", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const succeeded = applyAll(start, [success()]);
    const { state, change } = applyAttemptOutcome(succeeded, INCOMPLETE);

    assert.equal(change, null);
    assert.equal(state.attemptsAtCurrentLevel, 2);
    assert.equal(state.struggleStreak, 1);
    assert.equal(state.successStreak, 0);
    assertNoSessionTotals(state, "after an incomplete");
  });

  it("a tracking-loss outcome leaves the adaptation state completely unchanged", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const before = applyAll(start, [success(), INCOMPLETE]);
    const { state, change } = applyAttemptOutcome(before, TRACKING_LOST);

    assert.equal(change, null);
    // Strongest possible statement of "voided": nothing at all moved.
    assert.deepEqual(state, before);
    assertNoSessionTotals(state, "after a voided attempt");
  });

  it("a voided attempt creates no aggregate attempt metric of any kind", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, repeat(TRACKING_LOST, 10));

    // Ten voided attempts leave no trace whatsoever — no counter appears, and the
    // state is indistinguishable from a session in which they never happened.
    assert.deepEqual(state, start);
    assertNoSessionTotals(state, "after ten voided attempts");
    assert.equal(state.currentLevel, 60);
    assert.deepEqual(state.changes, []);
  });

  it("tracking loss between counted attempts does not disturb the streaks", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const interrupted = applyAll(start, [
      success(900),
      TRACKING_LOST,
      success(1_500),
      TRACKING_LOST,
    ]);
    const uninterrupted = applyAll(start, [success(900), success(1_500)]);

    assert.deepEqual(interrupted, uninterrupted);
    assert.equal(interrupted.successStreak, 2);
  });

  it("tracks the highest successful level even after the level drops back down", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    // Three successes raise the level to 65 and start the cooldown.
    const raised = applyAll(start, repeat(success(), 3));
    assert.equal(raised.currentLevel, 65);

    // One success at 65, then two incompletes that drain cooldown and force a decrease.
    const dropped = applyAll(raised, [success(), INCOMPLETE, INCOMPLETE]);

    assert.equal(dropped.highestSuccessfulLevel, 65);
    assert.equal(dropped.currentLevel, 60);
  });
});

describe("adaptive difficulty — increase and decrease", () => {
  it("raises the level only after the configured success streak", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);

    const afterOne = applyAttemptOutcome(start, success());
    assert.equal(afterOne.change, null);
    assert.equal(afterOne.state.currentLevel, 60);

    const afterTwo = applyAttemptOutcome(afterOne.state, success());
    assert.equal(afterTwo.change, null);
    assert.equal(afterTwo.state.currentLevel, 60);

    const afterThree = applyAttemptOutcome(afterTwo.state, success());
    assert.ok(afterThree.change);
    assert.equal(afterThree.change.direction, "increase");
    assert.equal(afterThree.change.reason, "consecutiveSuccess");
    assert.equal(afterThree.change.fromLevel, 60);
    assert.equal(afterThree.change.toLevel, 65);
    assert.equal(afterThree.state.currentLevel, 65);
    assert.deepEqual(afterThree.state.changes, [afterThree.change]);
    // Ordering lives in the array position, not in a stored attempt index.
    assert.equal(Object.keys(afterThree.change).includes("atAttempt"), false);
  });

  it("a broken success streak does not raise the level", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, [success(), success(), INCOMPLETE, success(), success()]);

    assert.equal(state.currentLevel, 60);
    assert.deepEqual(state.changes, []);
  });

  it("lowers the level only after the configured struggle streak", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);

    const afterOne = applyAttemptOutcome(start, INCOMPLETE);
    assert.equal(afterOne.change, null);
    assert.equal(afterOne.state.currentLevel, 60);

    const afterTwo = applyAttemptOutcome(afterOne.state, INCOMPLETE);
    assert.ok(afterTwo.change);
    assert.equal(afterTwo.change.direction, "decrease");
    assert.equal(afterTwo.change.reason, "consecutiveStruggle");
    assert.equal(afterTwo.change.fromLevel, 60);
    assert.equal(afterTwo.change.toLevel, 55);
    assert.equal(afterTwo.state.currentLevel, 55);
  });

  it("resets both streaks and the level attempt counter after an increase", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, repeat(success(), 3));

    assert.equal(state.currentLevel, 65);
    assert.equal(state.successStreak, 0);
    assert.equal(state.struggleStreak, 0);
    assert.equal(state.attemptsAtCurrentLevel, 0);
    assert.equal(state.cooldownRemaining, TEST_CONFIG.cooldownAttempts);
    // The change itself survives in the history; no session total is created alongside it.
    assert.equal(state.changes.length, 1);
    assertNoSessionTotals(state, "after an increase");
  });

  it("resets both streaks and the level attempt counter after a decrease", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, repeat(INCOMPLETE, 2));

    assert.equal(state.currentLevel, 55);
    assert.equal(state.successStreak, 0);
    assert.equal(state.struggleStreak, 0);
    assert.equal(state.attemptsAtCurrentLevel, 0);
    assert.equal(state.cooldownRemaining, TEST_CONFIG.cooldownAttempts);
    assert.equal(state.changes.length, 1);
    assertNoSessionTotals(state, "after a decrease");
  });
});

describe("adaptive difficulty — therapist-approved bounds", () => {
  it("never raises the level above the approved maximum and consumes the streak", () => {
    const atCeiling = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 90 });

    const first = applyAll(atCeiling, repeat(success(), 3));
    assert.equal(first.currentLevel, 90);
    assert.equal(first.changes.length, 1);
    assert.equal(first.changes[0].direction, "hold");
    assert.equal(first.changes[0].reason, "maxLevelReached");
    assert.equal(first.changes[0].fromLevel, 90);
    assert.equal(first.changes[0].toLevel, 90);
    // Streak consumed, so the decision is not re-emitted on the next success.
    assert.equal(first.successStreak, 0);

    const afterTwoMore = applyAll(first, repeat(success(), 2));
    assert.equal(afterTwoMore.changes.length, 1);

    const afterThird = applyAll(afterTwoMore, [success()]);
    assert.equal(afterThird.changes.length, 2);
    assert.equal(afterThird.currentLevel, 90);
  });

  it("clamps an increase whose step would overshoot the approved maximum", () => {
    const nearCeiling = createAdaptiveDifficultyState({
      ...TEST_CONFIG,
      startLevel: 88,
    });
    const state = applyAll(nearCeiling, repeat(success(), 3));

    assert.equal(state.currentLevel, 90);
    assert.equal(state.changes[0].direction, "increase");
    assert.equal(state.changes[0].toLevel, 90);
  });

  it("never lowers the level below the approved minimum", () => {
    const atFloor = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 30 });
    const state = applyAll(atFloor, repeat(INCOMPLETE, 6));

    assert.equal(state.currentLevel, 30);
    assert.ok(state.changes.every((change) => change.toLevel === 30));
    assert.ok(state.changes.every((change) => change.direction === "hold"));
  });

  it("extends the attempt timeout at the minimum instead of lowering further", () => {
    const atFloor = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 30 });
    assert.equal(atFloor.attemptTimeoutMs, TEST_CONFIG.normalAttemptTimeoutMs);

    const state = applyAll(atFloor, repeat(INCOMPLETE, 2));

    assert.equal(state.attemptTimeoutMs, TEST_CONFIG.extendedAttemptTimeoutMs);
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0].reason, "minLevelExtendedTimeout");
    assert.equal(state.changes[0].direction, "hold");
    assert.equal(
      state.changes[0].attemptTimeoutMs,
      TEST_CONFIG.extendedAttemptTimeoutMs,
    );
    assert.equal(state.struggleStreak, 0);
  });

  it("clamps a decrease whose step would undershoot the approved minimum", () => {
    const nearFloor = createAdaptiveDifficultyState({ ...TEST_CONFIG, startLevel: 32 });
    const state = applyAll(nearFloor, repeat(INCOMPLETE, 2));

    assert.equal(state.currentLevel, 30);
    assert.equal(state.changes[0].direction, "decrease");
    assert.equal(state.changes[0].toLevel, 30);
  });

  it("restores the normal timeout once the patient progresses off the floor", () => {
    const atFloor = createAdaptiveDifficultyState({
      ...TEST_CONFIG,
      startLevel: 30,
      cooldownAttempts: 0,
    });
    const extended = applyAll(atFloor, repeat(INCOMPLETE, 2));
    assert.equal(extended.attemptTimeoutMs, TEST_CONFIG.extendedAttemptTimeoutMs);

    const recovered = applyAll(extended, repeat(success(), 3));
    assert.equal(recovered.currentLevel, 35);
    assert.equal(recovered.attemptTimeoutMs, TEST_CONFIG.normalAttemptTimeoutMs);
  });
});

describe("adaptive difficulty — compensated success policy", () => {
  it("excludes compensated successes from the increase streak", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, repeat(compensatedSuccess(), 5));

    assert.equal(state.currentLevel, 60);
    assert.equal(state.successStreak, 0);
    assert.deepEqual(state.changes, []);
  });

  it("still treats a compensated success as a success without counting it separately", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, [
      compensatedSuccess(1_100),
      compensatedSuccess(1_300),
      compensatedSuccess(1_700),
    ]);

    // It is still a successful target interaction — the highest successful level moves and
    // the struggle streak stays cleared — but the engine creates no second success metric
    // to compete with the event layer's own successful-target count.
    assert.equal(state.highestSuccessfulLevel, 60);
    assert.equal(state.struggleStreak, 0);
    assert.equal(state.attemptsAtCurrentLevel, 3);
    assertNoSessionTotals(state, "after three compensated successes");
  });

  it("counts compensated successes toward the increase when the policy allows it", () => {
    const permissive = createAdaptiveDifficultyState({
      ...TEST_CONFIG,
      compensatedSuccessPolicy: "countsTowardIncrease",
    });
    const state = applyAll(permissive, repeat(compensatedSuccess(), 3));

    assert.equal(state.currentLevel, 65);
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0].direction, "increase");
  });

  it("a compensated success still breaks a struggle streak", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, [INCOMPLETE, compensatedSuccess(), INCOMPLETE]);

    assert.equal(state.currentLevel, 60);
    assert.equal(state.struggleStreak, 1);
    assert.deepEqual(state.changes, []);
  });

  // ── Review fix (PR #204): approved `excludedFromIncrease` streak policy ──────
  // A compensated success PAUSES clean progression: it preserves the clean-success
  // streak already built, without advancing it and without resetting it. The existing
  // tests above all start from a zero streak, where preserve and reset are
  // indistinguishable; this one starts from a non-zero streak, where they are not.

  it("preserves a non-zero clean-success streak across an excluded compensated success", () => {
    // The whole point of the sequence is that the compensated success lands while the
    // streak is one short of the threshold, so a reset would be visible.
    assert.equal(TEST_CONFIG.successStreakToIncrease, 3);
    assert.equal(TEST_CONFIG.compensatedSuccessPolicy, "excludedFromIncrease");

    const start = deepFreeze(createAdaptiveDifficultyState(TEST_CONFIG));

    // 1 — first clean success builds the streak to 1.
    const afterFirst = applyAttemptOutcome(start, success());
    assert.equal(afterFirst.change, null);
    assert.equal(afterFirst.state.successStreak, 1);
    assert.equal(afterFirst.state.currentLevel, 60);

    // 2 — second clean success builds the streak to 2, one short of the threshold.
    const beforeSecond = structuredClone(afterFirst.state);
    const afterSecond = applyAttemptOutcome(afterFirst.state, success());
    assert.equal(afterSecond.change, null);
    assert.equal(afterSecond.state.successStreak, 2);
    assert.equal(afterSecond.state.currentLevel, 60);
    assert.deepEqual(afterFirst.state, beforeSecond, "the prior state was not mutated");

    // 3 — compensated success: the streak is held at 2. Neither advanced nor reset.
    const beforeCompensated = structuredClone(afterSecond.state);
    const compensatedOutcome = compensatedSuccess(1_600);
    const outcomeSnapshot = structuredClone(compensatedOutcome);
    const afterCompensated = applyAttemptOutcome(afterSecond.state, compensatedOutcome);

    assert.equal(afterCompensated.state.successStreak, 2, "the clean streak is preserved");
    assert.notEqual(afterCompensated.state.successStreak, 3, "it is not incremented");
    assert.notEqual(afterCompensated.state.successStreak, 0, "it is not reset");
    // No level movement, and no decision emitted on the strength of a compensated success.
    assert.equal(afterCompensated.change, null);
    assert.equal(afterCompensated.state.currentLevel, 60);
    assert.deepEqual(afterCompensated.state.changes, []);
    // Every other successful-outcome rule keeps the behaviour it already had.
    assert.equal(afterCompensated.state.struggleStreak, 0, "successful outcome clears struggle");
    assert.equal(afterCompensated.state.attemptsAtCurrentLevel, 3, "it is a counted attempt");
    assert.equal(afterCompensated.state.highestSuccessfulLevel, 60, "it is still a success");
    assert.equal(afterCompensated.state.cooldownRemaining, 0);
    assert.equal(afterCompensated.state.attemptTimeoutMs, TEST_CONFIG.normalAttemptTimeoutMs);
    assertNoSessionTotals(afterCompensated.state, "after an excluded compensated success");
    assert.deepEqual(afterSecond.state, beforeCompensated, "the prior state was not mutated");
    assert.deepEqual(compensatedOutcome, outcomeSnapshot, "the outcome was not mutated");

    // 4 — the next clean success reaches the threshold, exactly as if the compensated
    // attempt had never interrupted the run.
    const beforeFourth = structuredClone(afterCompensated.state);
    const afterFourth = applyAttemptOutcome(afterCompensated.state, success());

    assert.ok(afterFourth.change);
    assert.equal(afterFourth.change.direction, "increase");
    assert.equal(afterFourth.change.reason, "consecutiveSuccess");
    assert.equal(afterFourth.change.fromLevel, 60);
    assert.equal(afterFourth.change.toLevel, 65);
    assert.equal(afterFourth.state.currentLevel, 65);
    // Unchanged post-increase reset and cooldown policy.
    assert.equal(afterFourth.state.successStreak, 0);
    assert.equal(afterFourth.state.struggleStreak, 0);
    assert.equal(afterFourth.state.attemptsAtCurrentLevel, 0);
    assert.equal(afterFourth.state.cooldownRemaining, TEST_CONFIG.cooldownAttempts);
    assert.equal(afterFourth.state.attemptTimeoutMs, TEST_CONFIG.normalAttemptTimeoutMs);
    assert.deepEqual(afterFourth.state.changes, [afterFourth.change]);
    assert.deepEqual(afterCompensated.state, beforeFourth, "the prior state was not mutated");
  });

  it("a preserved streak needs one fewer clean success than a reset streak would", () => {
    // Same sequence, stated as the difference the policy actually makes: under a reset
    // policy the fourth attempt below would leave the level at 60.
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const preserved = applyAll(start, [success(), success(), compensatedSuccess(), success()]);

    assert.equal(preserved.currentLevel, 65);
    assert.equal(preserved.changes.length, 1);
    assert.equal(preserved.changes[0].direction, "increase");
  });
});

// ── REVIEW FIX, BLOCKER 1 (PR #240) ─────────────────────────────────────────────
// UNKNOWN compensation must never be interpreted as an observation of clean movement.
//
// Before this fix the engine asked `outcome.compensated === true`, so an attempt for
// which NO compensation observation was supplied answered the same as an attempt that
// was evaluated and found clean. Under `excludedFromIncrease` that let successes nobody
// could evaluate build the increase streak and raise the target-placement level.
//
// None of this assigns a clinical meaning to UNKNOWN. The rule is only that the engine
// may not resolve a missing observation in the direction of a harder target.

describe("adaptive difficulty — UNKNOWN compensation (review fix, blocker 1)", () => {
  it("names the three compensation states without collapsing any into another", () => {
    assert.equal(resolveAttemptCompensationState(true), "compensated");
    assert.equal(resolveAttemptCompensationState(false), "clean");
    assert.equal(resolveAttemptCompensationState(undefined), "unknown");

    // The distinction that the old `=== true` check destroyed: evaluated-and-clean and
    // never-evaluated are different states, not two spellings of one.
    assert.notEqual(
      resolveAttemptCompensationState(false),
      resolveAttemptCompensationState(undefined),
    );
  });

  it("never lets UNKNOWN qualify where an observed compensated success would not", () => {
    for (const policy of ["excludedFromIncrease", "countsTowardIncrease"] as const) {
      const unknown = attemptCompensationAdvancesIncreaseStreak("unknown", policy);
      const compensated = attemptCompensationAdvancesIncreaseStreak("compensated", policy);
      const clean = attemptCompensationAdvancesIncreaseStreak("clean", policy);

      // The safety property, stated directly: an unobserved attempt is never granted
      // more credit toward a harder target than the worst state it might actually be.
      assert.ok(
        !unknown || compensated,
        `UNKNOWN must not out-qualify an observed compensated success under ${policy}`,
      );
      // And it advances exactly when the missing observation could not have changed the
      // answer — i.e. when both possible resolutions agree.
      assert.equal(unknown, clean && compensated, `under ${policy}`);
    }
  });

  // A — UNKNOWN cannot escalate, however many of them arrive.
  it("A. never raises the level from UNKNOWN successes alone, well past the threshold", () => {
    assert.equal(TEST_CONFIG.compensatedSuccessPolicy, "excludedFromIncrease");
    assert.equal(TEST_CONFIG.successStreakToIncrease, 3);

    const start = deepFreeze(createAdaptiveDifficultyState(TEST_CONFIG));
    // Twelve — four times the configured threshold, so no off-by-one could hide an escape.
    const state = applyAll(start, repeat(unknownCompensationSuccess(), 12));

    assert.equal(state.currentLevel, 60, "the level never moved");
    assert.equal(state.successStreak, 0, "no increase streak was ever built");
    assert.deepEqual(state.changes, [], "no decision was emitted");
    assert.equal(state.attemptTimeoutMs, TEST_CONFIG.normalAttemptTimeoutMs);
  });

  // E — and they are not reclassified as struggle either. UNKNOWN is not a failure.
  it("E. does not turn UNKNOWN successes into struggle, incomplete or tracking loss", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, repeat(unknownCompensationSuccess(), 12));

    assert.equal(state.struggleStreak, 0, "a success is never a struggle");
    assert.equal(state.currentLevel, 60, "the level was not lowered either");
    assert.deepEqual(state.changes, []);
    // It is still a real, counted, successful target interaction.
    assert.equal(state.attemptsAtCurrentLevel, 12);
    assert.equal(state.highestSuccessfulLevel, 60);
    assertNoSessionTotals(state, "after twelve UNKNOWN-compensation successes");
  });

  it("E. an UNKNOWN success still breaks a struggle streak, like any other success", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    // Threshold is 2, so without the reset in the middle this would decrease the level.
    const state = applyAll(start, [INCOMPLETE, unknownCompensationSuccess(), INCOMPLETE]);

    assert.equal(state.struggleStreak, 1, "the struggle streak was reset by the success");
    assert.equal(state.currentLevel, 60);
    assert.deepEqual(state.changes, []);
  });

  it("preserves — never resets — a clean streak across an UNKNOWN success", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, [success(), success(), unknownCompensationSuccess()]);

    // Same approved semantic as an excluded compensated success: held, not advanced,
    // not reset. UNKNOWN neither helps the patient nor punishes them.
    assert.equal(state.successStreak, 2, "the clean streak is preserved");
    assert.notEqual(state.successStreak, 3, "it is not advanced");
    assert.notEqual(state.successStreak, 0, "it is not reset");
    assert.equal(state.currentLevel, 60, "and no level change was triggered");
    assert.deepEqual(state.changes, []);
  });

  // B — the clean path is untouched by the fix.
  it("B. still raises the level on the configured run of OBSERVED clean successes", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, repeat(success(), 3));

    assert.equal(state.currentLevel, 65, "clean successes still progress");
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0].direction, "increase");
    assert.equal(state.changes[0].reason, "consecutiveSuccess");
  });

  it("B. an UNKNOWN success cannot substitute for the clean success it is missing", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);

    // Two clean plus one unknown is NOT three clean — the run stops one short.
    const withUnknown = applyAll(start, [success(), success(), unknownCompensationSuccess()]);
    assert.equal(withUnknown.currentLevel, 60);
    assert.deepEqual(withUnknown.changes, []);

    // The same three attempts with the third actually observed clean do progress. The
    // only difference between the two sequences is whether anyone looked.
    const withClean = applyAll(start, [success(), success(), success()]);
    assert.equal(withClean.currentLevel, 65);
    assert.equal(withClean.changes.length, 1);
  });

  it("lets a later observed clean success complete a run an UNKNOWN paused", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const state = applyAll(start, [
      success(),
      success(),
      unknownCompensationSuccess(),
      success(),
    ]);

    // The unknown attempt cost the patient nothing: the streak it preserved is completed
    // by the next observed clean reach.
    assert.equal(state.currentLevel, 65);
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0].direction, "increase");
  });

  it("counts UNKNOWN toward the increase only where compensation cannot change it", () => {
    // Under `countsTowardIncrease` the therapist has configured compensation as
    // irrelevant to progression: an observed compensated success advances exactly like a
    // clean one. No resolution of the missing observation could change the decision, so
    // advancing asserts nothing the runtime does not know. This is the ONLY policy under
    // which UNKNOWN progresses, and it progresses because compensation is not consulted
    // at all — not because it was read as clean.
    const permissive = createAdaptiveDifficultyState({
      ...TEST_CONFIG,
      compensatedSuccessPolicy: "countsTowardIncrease",
    });
    const state = applyAll(permissive, repeat(unknownCompensationSuccess(), 3));

    assert.equal(state.currentLevel, 65);
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0].direction, "increase");

    // Under the excluding policy the identical sequence must not move at all.
    const strict = createAdaptiveDifficultyState(TEST_CONFIG);
    const strictState = applyAll(strict, repeat(unknownCompensationSuccess(), 3));
    assert.equal(strictState.currentLevel, 60);
    assert.deepEqual(strictState.changes, []);
  });

  it("keeps the engine pure and non-mutating for an UNKNOWN success", () => {
    const start = deepFreeze(createAdaptiveDifficultyState(TEST_CONFIG));
    const outcome = unknownCompensationSuccess(1_450);
    const snapshot = structuredClone(outcome);
    const before = structuredClone(start);

    const first = applyAttemptOutcome(start, outcome);
    const second = applyAttemptOutcome(start, outcome);

    assert.deepEqual(first.state, second.state, "deterministic");
    assert.deepEqual(start, before, "the input state was not mutated");
    assert.deepEqual(outcome, snapshot, "the outcome was not mutated");
  });
});

describe("adaptive difficulty — cooldown", () => {
  it("blocks a second change while cooldown is active, even at the streak threshold", () => {
    const config: DifficultyConfig = { ...TEST_CONFIG, cooldownAttempts: 5 };
    const start = createAdaptiveDifficultyState(config);

    // Attempts 1-3 raise the level and start a 5-attempt cooldown.
    const raised = applyAll(start, repeat(success(), 3));
    assert.equal(raised.changes.length, 1);
    assert.equal(raised.cooldownRemaining, 5);

    // Attempts 4-8 rebuild the streak past the threshold but stay inside cooldown.
    const cooling = applyAll(raised, repeat(success(), 5));
    assert.equal(cooling.changes.length, 1, "no change may be emitted during cooldown");
    assert.equal(cooling.cooldownRemaining, 0);
    assert.equal(cooling.successStreak, 5);
    assert.equal(cooling.currentLevel, 65);
    // Adaptation state keeps progressing throughout cooldown, without any session total.
    assert.equal(cooling.attemptsAtCurrentLevel, 5);
    assertNoSessionTotals(cooling, "during cooldown");

    // Attempt 9 is the first evaluated attempt after cooldown.
    const released = applyAttemptOutcome(cooling, success());
    assert.ok(released.change);
    assert.equal(released.change.direction, "increase");
    assert.equal(released.state.currentLevel, 70);
  });

  it("decrements the cooldown once per counted attempt and not for voided attempts", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const raised = applyAll(start, repeat(success(), 3));
    assert.equal(raised.cooldownRemaining, 2);

    const afterVoid = applyAll(raised, repeat(TRACKING_LOST, 3));
    assert.equal(afterVoid.cooldownRemaining, 2, "voided attempts do not consume cooldown");

    const afterOne = applyAll(afterVoid, [success()]);
    assert.equal(afterOne.cooldownRemaining, 1);

    const afterTwo = applyAll(afterOne, [INCOMPLETE]);
    assert.equal(afterTwo.cooldownRemaining, 0);
  });

  it("evaluates immediately when cooldown is configured as zero", () => {
    const config: DifficultyConfig = { ...TEST_CONFIG, cooldownAttempts: 0 };
    const start = createAdaptiveDifficultyState(config);
    const state = applyAll(start, repeat(success(), 6));

    assert.equal(state.changes.length, 2);
    assert.equal(state.currentLevel, 70);
  });
});

describe("adaptive difficulty — purity and determinism", () => {
  it("resets the session state back to the configured starting point", () => {
    const start = createAdaptiveDifficultyState(TEST_CONFIG);
    const used = applyAll(start, [
      success(),
      INCOMPLETE,
      TRACKING_LOST,
      success(),
      success(),
      success(),
    ]);
    // The session genuinely moved before the reset.
    assert.notDeepEqual(used, start);
    assert.ok(used.changes.length > 0);

    const reset = resetAdaptiveDifficultyState(used);
    assert.deepEqual(reset, createAdaptiveDifficultyState(TEST_CONFIG));
    assert.equal(reset.currentLevel, 60);
    assert.equal(reset.attemptsAtCurrentLevel, 0);
    assert.equal(reset.highestSuccessfulLevel, null);
    assert.deepEqual(reset.changes, []);
    assertNoSessionTotals(reset, "after a reset");
  });

  it("never mutates the state passed in", () => {
    const start = deepFreeze(createAdaptiveDifficultyState(TEST_CONFIG));
    const snapshot = structuredClone(start);

    const first = applyAttemptOutcome(start, success(1_000));
    assert.notEqual(first.state, start);
    assert.deepEqual(start, snapshot);

    // Also exercise the branch that records a change.
    const raised = deepFreeze(applyAll(createAdaptiveDifficultyState(TEST_CONFIG), repeat(success(), 2)));
    const raisedSnapshot = structuredClone(raised);
    const changed = applyAttemptOutcome(raised, success());

    assert.ok(changed.change);
    assert.deepEqual(raised, raisedSnapshot);
    assert.equal(raised.changes.length, 0);
    assert.equal(changed.state.changes.length, 1);
  });

  it("produces identical output for identical inputs", () => {
    const outcomes: AdaptiveAttemptOutcome[] = [
      success(1_000),
      INCOMPLETE,
      TRACKING_LOST,
      compensatedSuccess(1_400),
      success(1_100),
      success(1_050),
      INCOMPLETE,
      INCOMPLETE,
      success(1_900),
    ];

    const runA = applyAll(createAdaptiveDifficultyState(TEST_CONFIG), outcomes);
    const runB = applyAll(createAdaptiveDifficultyState(TEST_CONFIG), outcomes);

    assert.deepStrictEqual(runA, runB);
  });
});
