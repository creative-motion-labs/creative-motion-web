import {
  DEFAULT_TARGET_HIT_CONFIG,
  isWristInsideTarget,
  shouldRegisterTargetHit,
} from "./target-hit";
import { generateTherapeuticTarget } from "./target-generator";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import {
  createEmptyShoulderInteractionMetrics,
  type NormalizedPoint,
  type SafeTargetBounds,
  type ShoulderInteractionMetrics,
  type TargetAttemptStartEvent,
  type TargetAttemptTimeoutEvent,
  type TargetHitConfig,
  type TargetHitEvent,
  type TherapeuticTarget,
} from "./types";

export type TargetLifecycleState = {
  /**
   * The active target, or null when no attempt is running.
   *
   * `null` is also the structural exactly-once guarantee (CHANGE-008): every terminal path
   * sets it to null and returns, and both terminal paths require a non-null target to fire.
   * A target that has produced its hit or its expiry is therefore unreachable — it cannot
   * produce a second one no matter how many ticks follow.
   */
  currentTarget: TherapeuticTarget | null;
  /** Target currently playing an exit animation — presentation only, never contactable. */
  exitingTarget: TherapeuticTarget | null;
  /**
   * Presentation hold: withholds the next target until a hit's exit animation finishes.
   *
   * PRESENTATION ONLY (CHANGE-008). It EXTENDS the wait before a successor appears; it does
   * not create it. A successor is always built on a tick after the one that ended its
   * predecessor, whether or not a hold was set — see the successor phase in
   * `tickTargetLifecycle`.
   */
  spawnLockedUntilMs: number | null;
  /**
   * Whether the last MEASURED frame put the wrist inside the active target.
   *
   * Read only as one half of the entry edge that registers a hit, so what it must carry is
   * "what the next measured frame is compared against". It is therefore written from
   * measurement alone: a frame with no wrist sample leaves it untouched (REVIEW FIX,
   * BLOCKER 3) rather than writing `false`, because `false` here means the measured claim
   * "outside", and a gap is not that claim. See the no-else note in `tickTargetLifecycle`.
   */
  wristInside: boolean;
  targetHit: boolean;
  /**
   * Position of the most recently retired target, or null before the first one ends.
   *
   * PLACEMENT REFERENCE ONLY — not a second target and not a second owner. It exists
   * because the random generator's `MIN_TARGET_SEPARATION` guard needs somewhere to read
   * "where the last target was" from, and since CHANGE-008 no target is active at the
   * moment a successor is built. A position rather than a `TherapeuticTarget` so it cannot
   * be mistaken for something contactable, renderable, or attributable to an attempt.
   *
   * Deliberately NOT `exitingTarget`: that is a presentation slot, set only when a hit
   * animates out, and an expired attempt must produce no patient-facing feedback.
   */
  retiredTargetPosition: NormalizedPoint | null;
  sequence: number;
  interaction: ShoulderInteractionMetrics;
  /**
   * Compensation reported by the caller during the CURRENT attempt, or null when the
   * caller supplied none. Attempt-scoped: reset on every spawn so it can never leak into
   * the next target. Metadata only — it never influences hits, timeouts or difficulty.
   */
  attemptCompensationObserved: boolean | null;
  /**
   * Block-elapsed seconds accumulated during the CURRENT attempt while no wrist
   * measurement was available. Attempt-scoped: reset on every spawn and on every terminal
   * path, so an earlier attempt's tracking gap can never shorten a later attempt.
   *
   * WHY THIS EXISTS (REVIEW FIX, BLOCKER 2)
   * ---------------------------------------
   * The attempt clock is the orchestrator's pause-aware `blockElapsedSeconds`, and it
   * keeps advancing whenever the SESSION is healthy. But the affected-side wrist has its
   * own per-joint presence rule in the detector, so `primaryWristNormalized` can be null
   * on a frame where landmarks were found, no `trackerLost` fired, and no safety hold was
   * entered (see `shoulder-abduction-reach-pose-detector.ts`). Without this accumulator
   * that interval was charged to the patient's reach window, and a long enough one expired
   * the attempt into `incomplete` → `struggleStreak` → a LOWER level, on the strength of a
   * measurement the runtime never had.
   *
   * Subtracting it makes the comparison against `attemptTimeoutMs` a measurable-time
   * comparison. This is the same exclusion principle the orchestrator already applies for
   * pause and safety hold, applied to the one gap the orchestrator cannot see, and it
   * introduces no second clock: every value here is read from `blockElapsedSeconds`.
   */
  attemptUnmeasuredElapsedS: number;
  /**
   * `blockElapsedSeconds` as of the previous tick that observed it, or null before the
   * first. A CURSOR, not a clock: it exists only so an interval can be measured between
   * two consecutive readings of the orchestrator's own value.
   */
  lastObservedBlockElapsedS: number | null;
};

export function createInitialTargetLifecycle(): TargetLifecycleState {
  return {
    currentTarget: null,
    exitingTarget: null,
    spawnLockedUntilMs: null,
    wristInside: false,
    targetHit: false,
    retiredTargetPosition: null,
    sequence: 0,
    interaction: createEmptyShoulderInteractionMetrics(),
    attemptCompensationObserved: null,
    attemptUnmeasuredElapsedS: 0,
    lastObservedBlockElapsedS: null,
  };
}

export type TargetLifecycleTickInput = {
  wrist: NormalizedPoint | null;
  /** Presentation/event clock. Drives reaction times and the spawn lock — never expiration. */
  nowMs: number;
  side: ShoulderAbductionReachSide;
  bounds: SafeTargetBounds;
  hitConfig?: TargetHitConfig;
  random?: () => number;
  /** Presentation-only delay before the next target spawns after a hit. Default 0. */
  hitExitTransitionMs?: number;
  /**
   * Pause-aware active block elapsed seconds, as produced by the orchestrator. ATTEMPT
   * CLOCK: the only clock attempt expiration is allowed to read. Because the orchestrator
   * freezes this value during pause and safety hold, a frozen session cannot expire an
   * attempt, and a resumed one continues from the same elapsed point. Omitted by legacy
   * callers, which disables expiration entirely.
   */
  blockElapsedSeconds?: number;
  /**
   * Time the patient is given to reach the active target, in ms.
   *
   * CLINICAL PARAMETER — the lifecycle ships no default and invents none. Omitted (or not
   * a finite value greater than 0) means the feature is off and the lifecycle behaves
   * exactly as it did before attempt expiration existed.
   */
  attemptTimeoutMs?: number;
  /**
   * Placement level in degrees to stamp on the next spawned target. Geometry only, and
   * never defaulted — see `TherapeuticTarget.levelDegrees`.
   *
   * Callers that also resolve `preferredTargetPosition` should supply the level the
   * position was actually built from, so the stamped level and the target's coordinates
   * describe the same placement. A level supplied WITHOUT a position is still legal (it is
   * then pure metadata on a randomly placed target), but it is not what CHANGE-007 wires.
   */
  levelDegrees?: number;
  /**
   * Position the next spawned target should occupy, resolved by the caller — today, the
   * adaptive shoulder-anchored geometry in `adaptive/adaptive-target-placement.ts`.
   *
   * Read ONLY at spawn, and forwarded verbatim to `generateTherapeuticTarget`, which stays
   * the single target-construction authority and applies its own safe-bounds clamp. The
   * lifecycle resolves no geometry of its own, owns no adaptive state, and imports nothing
   * from the adaptive module.
   *
   * OPTIONAL, NEVER DEFAULTED: omitted or null means the generator's existing random
   * placement runs unchanged.
   */
  preferredTargetPosition?: NormalizedPoint | null;
  /**
   * Caller-reported compensation for the current attempt. The lifecycle only accumulates
   * it (sticky until the next spawn) and passes it through on the terminal event; it runs
   * no detector of its own and draws no conclusion from it.
   */
  compensationObservedDuringAttempt?: boolean;
};

export type TargetLifecycleTickResult = {
  state: TargetLifecycleState;
  hitEvent: TargetHitEvent | null;
  /**
   * Attempt starts produced by this tick — exactly one per spawned target, and empty when
   * nothing spawned.
   *
   * Since CHANGE-008 a tick spawns at most once: a terminal path clears the target and
   * returns, so the successor is built on a later tick. The list shape is deliberately
   * KEPT rather than narrowed to a single slot, because a single slot is the shape that
   * silently drops an attempt identity if a second spawn ever becomes reachable again. The
   * cost of the wider type is one `[]`; the cost of the narrower one is a lost attempt.
   */
  attemptStartedEvents: TargetAttemptStartEvent[];
  /** Emitted at most once per target, and never together with a `hitEvent` for it. */
  attemptTimeoutEvent: TargetAttemptTimeoutEvent | null;
};

/**
 * Reads the caller's attempt timeout as a feature switch.
 *
 * Returns null — meaning "expiration is off, behave exactly as before this feature
 * existed" — for an omitted value and for any value that could not describe a real
 * reach window (non-finite, zero or negative). `DifficultyConfig` is validated upstream
 * by `validateDifficultyConfig`, so this is not a second validator: it is the local
 * enabled/disabled predicate for a publicly callable function whose `number` type cannot
 * by itself exclude NaN. It deliberately does not throw and does not substitute a
 * fallback timeout, because a reach window is a clinical parameter this layer may not
 * invent.
 */
function resolveConfiguredAttemptTimeoutMs(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Whether this tick carried a usable wrist sample.
 *
 * The single definition of "the runtime could observe the patient's reach this frame",
 * used both by the accumulator below and by the hit path's own guard. Note what it is
 * NOT: a statement about the tracker, the session, or the patient. A null wrist is a gap
 * in one measurement, and this module draws no further conclusion from it.
 */
function hasWristMeasurement(wrist: NormalizedPoint | null | undefined): boolean {
  return wrist !== null && wrist !== undefined;
}

/**
 * Accumulates block time that elapsed while the attempt could not be measured.
 *
 * ATTRIBUTION RULE: the interval BETWEEN the previous reading and this one is charged as
 * unmeasured when THIS tick has no wrist sample. Only facts already in hand are used —
 * the previous cursor and the current sample — so no interval is ever guessed at.
 *
 * It composes with pause and safety hold rather than competing with them: those freeze
 * `blockElapsedSeconds` itself upstream, so the interval measured here is already near
 * zero across a pause and nothing is double-counted.
 */
function accumulateUnmeasuredAttemptTime(
  state: TargetLifecycleState,
  input: TargetLifecycleTickInput,
): TargetLifecycleState {
  const blockElapsedSeconds = input.blockElapsedSeconds;
  // No attempt clock supplied: expiration is off entirely, so there is no window to
  // protect and no interval that could be measured.
  if (blockElapsedSeconds === undefined || !Number.isFinite(blockElapsedSeconds)) {
    return state;
  }
  // No attempt in flight. The cursor still advances so the gap before a spawn is never
  // charged to the attempt that follows it.
  if (!state.currentTarget) {
    return { ...state, lastObservedBlockElapsedS: blockElapsedSeconds };
  }
  if (hasWristMeasurement(input.wrist)) {
    return { ...state, lastObservedBlockElapsedS: blockElapsedSeconds };
  }
  const previous = state.lastObservedBlockElapsedS;
  // Clamped at 0: a block boundary can restart block elapsed time, and a negative
  // interval must never CREDIT measurable time back to the attempt.
  const unmeasuredIntervalS =
    previous === null ? 0 : Math.max(0, blockElapsedSeconds - previous);
  return {
    ...state,
    lastObservedBlockElapsedS: blockElapsedSeconds,
    attemptUnmeasuredElapsedS: state.attemptUnmeasuredElapsedS + unmeasuredIntervalS,
  };
}

/**
 * Pause-aware, MEASURABLE active attempt duration in ms, or null when it cannot be
 * computed — which is the case for every legacy caller that ticks without block elapsed
 * time.
 *
 * Two exclusions, both by construction rather than by inspection:
 *   - frozen block time (pause, safety hold) — excluded upstream by the orchestrator,
 *     which stops advancing `blockElapsedSeconds` at all;
 *   - unmeasurable time (no wrist sample) — excluded here, via the attempt-scoped
 *     accumulator.
 *
 * What remains is the time during which the patient was actually being observed trying to
 * reach the target, which is the only quantity a reach window may be compared against.
 *
 * MONOTONIC: the span and the accumulator advance by the same interval on an unmeasured
 * tick, so the result holds flat rather than moving backwards, and resumes growing when
 * measurement returns. Clamped at 0 for the same block-boundary reason as before.
 */
function resolveAttemptMeasurableElapsedMs(
  target: TherapeuticTarget,
  blockElapsedSeconds: number | undefined,
  unmeasuredElapsedS: number,
): number | null {
  const baselineS = target.spawnedAtBlockElapsedS;
  if (baselineS === undefined || !Number.isFinite(baselineS)) return null;
  if (blockElapsedSeconds === undefined || !Number.isFinite(blockElapsedSeconds)) return null;
  const spanS = blockElapsedSeconds - baselineS;
  const measurableS = spanS - unmeasuredElapsedS;
  return Math.max(0, measurableS * 1000);
}

type SpawnResult = {
  state: TargetLifecycleState;
  attemptStartedEvent: TargetAttemptStartEvent;
};

/**
 * Spawns the next target and, with it, starts exactly one attempt. Attempt identity is
 * the target's own id/sequence — no separate attempt counter exists to drift from it.
 *
 * Every attempt-scoped value is re-established here, so no terminal state and no attempt
 * metadata from the previous target can leak forward.
 */
function spawnNextTarget(
  state: TargetLifecycleState,
  input: TargetLifecycleTickInput,
  config: TargetHitConfig,
): SpawnResult {
  const nextSequence = state.sequence + 1;
  const generated = generateTherapeuticTarget({
    bounds: input.bounds,
    side: input.side,
    nowMs: input.nowMs,
    sequence: nextSequence,
    // The position the RANDOM sampler must keep its distance from. It is read from
    // `retiredTargetPosition` rather than from `currentTarget`, which is null on every
    // spawn: a target is only ever built when none is active. Before CHANGE-008 this read
    // `currentTarget` and so silently passed null on the normal-motion hit path, where the
    // contacted target had already been cleared for its exit animation — the separation
    // guard was live on two paths out of three. Routing it through the retired position
    // makes it live on all of them.
    previousTarget: state.retiredTargetPosition,
    random: input.random,
    // Forwarded verbatim. The generator decides what to do with it — including ignoring it
    // when it is absent or unusable, which is the legacy path.
    preferredPosition: input.preferredTargetPosition,
  });
  // Optional metadata is attached only when the caller actually supplied it — an absent
  // level stays absent rather than becoming a fabricated clinical default.
  const target: TherapeuticTarget = { ...generated };
  if (input.levelDegrees !== undefined && Number.isFinite(input.levelDegrees)) {
    target.levelDegrees = input.levelDegrees;
  }
  if (input.blockElapsedSeconds !== undefined && Number.isFinite(input.blockElapsedSeconds)) {
    target.spawnedAtBlockElapsedS = input.blockElapsedSeconds;
  }
  // WRIST-ENTRY SEEDING — the invariant that keeps a spawn from paying out a free hit.
  //
  // A hit is registered on ENTRY only (`shouldRegisterTargetHit`: false → true). Seeding
  // this flag to a flat `false` therefore asserted "the wrist is outside the new target",
  // which is a claim about the patient that the lifecycle had not checked. Whenever it was
  // wrong — a successor landing where the wrist already is — the very next tick saw a
  // false → true edge that no movement produced, and credited a reach that never happened.
  //
  // Deterministic adaptive placement makes that case ordinary rather than rare: two
  // attempts at the same level with an unmoved patient land in the same spot, so the wrist
  // that just hit target N is inside target N+1 at the instant it appears.
  //
  // Reading the wrist's ACTUAL relationship to the new target fixes it at the source. A
  // wrist already inside begins inside, so the patient must leave the target and come back
  // for the entry edge to occur — one real reach, one hit.
  //
  // This is a software interaction invariant, not a clinical rule, and it is deliberately
  // NOT conditional on adaptive difficulty: a randomly placed target can also land under
  // the wrist, and two different hit semantics depending on a feature flag would be worse
  // than either. No threshold is invented — the caller's own `config.collisionRadius` and
  // the existing `isWristInsideTarget` decide, exactly as they do for every other tick.
  const wristInsideAtSpawn =
    input.wrist !== null && input.wrist !== undefined
      ? isWristInsideTarget(input.wrist, target, config)
      : false;

  return {
    state: {
      ...state,
      sequence: nextSequence,
      currentTarget: target,
      wristInside: wristInsideAtSpawn,
      targetHit: false,
      attemptCompensationObserved: null,
      // Attempt-scoped, re-established here with every other per-attempt value: the new
      // attempt starts with a full, unspent measurable window whatever happened during
      // the last one. The cursor is seeded to this tick's own reading so the interval
      // BEFORE the spawn is never charged to the attempt that just started.
      attemptUnmeasuredElapsedS: 0,
      lastObservedBlockElapsedS:
        input.blockElapsedSeconds !== undefined && Number.isFinite(input.blockElapsedSeconds)
          ? input.blockElapsedSeconds
          : state.lastObservedBlockElapsedS,
      interaction: {
        ...state.interaction,
        targetsShown: state.interaction.targetsShown + 1,
      },
    },
    attemptStartedEvent: {
      targetId: target.id,
      sequence: nextSequence,
      startedAtMs: target.spawnedAtMs,
      startedAtBlockElapsedS: target.spawnedAtBlockElapsedS ?? null,
      side: input.side,
      ...(target.levelDegrees !== undefined ? { levelDegrees: target.levelDegrees } : {}),
    },
  };
}

export function tickTargetLifecycle(
  state: TargetLifecycleState,
  input: TargetLifecycleTickInput,
): TargetLifecycleTickResult {
  const config = input.hitConfig ?? DEFAULT_TARGET_HIT_CONFIG;
  const exitTransitionMs = input.hitExitTransitionMs ?? 0;
  let next = state;
  const attemptStartedEvents: TargetAttemptStartEvent[] = [];

  const spawn = (from: TargetLifecycleState): TargetLifecycleState => {
    const spawned = spawnNextTarget(from, input, config);
    attemptStartedEvents.push(spawned.attemptStartedEvent);
    return spawned.state;
  };

  // SUCCESSOR PHASE (CHANGE-008).
  //
  // Every terminal path below clears `currentTarget` and returns, so a successor is never
  // built in the same tick as the outcome that ended its predecessor. It is built here, on
  // a LATER tick, from that tick's own inputs — which is what lets the caller apply the
  // attempt's adaptive outcome in between and have the successor reflect it.
  //
  // This one branch now serves both spawn causes — the first target of a block and the
  // successor of a terminated attempt — because after CHANGE-008 they are the same
  // situation: no target is active, and nothing is holding one back. The previous code
  // needed two branches only because a hit with an exit transition deferred its successor
  // while a hit without one, and every timeout, spawned inline.
  //
  // `spawnLockedUntilMs` is now purely a PRESENTATION hold (the hit exit animation). It
  // extends the wait; it is no longer what creates it.
  if (next.spawnLockedUntilMs !== null && input.nowMs < next.spawnLockedUntilMs) {
    // Exit transition still playing. No target is active, so no attempt is running and
    // nothing here can expire.
    return {
      state: { ...next, wristInside: false },
      hitEvent: null,
      attemptStartedEvents,
      attemptTimeoutEvent: null,
    };
  }

  if (!next.currentTarget) {
    next = spawn({
      ...next,
      exitingTarget: null,
      spawnLockedUntilMs: null,
      wristInside: false,
      targetHit: false,
    });
  }

  // ATTEMPT MEASURABILITY (review fix, blocker 2) — evaluated before contact and before
  // expiration, so both read a cursor that is current for this tick. On a tick that just
  // spawned, the interval is zero by construction.
  next = accumulateUnmeasuredAttemptTime(next, input);

  // Sticky for the current attempt only; `spawnNextTarget` clears it for the next one.
  if (input.compensationObservedDuringAttempt !== undefined && next.currentTarget) {
    next = {
      ...next,
      attemptCompensationObserved:
        next.attemptCompensationObserved === true || input.compensationObservedDuringAttempt,
    };
  }

  if (input.wrist && next.currentTarget) {
    const isInside = isWristInsideTarget(input.wrist, next.currentTarget, config);
    if (shouldRegisterTargetHit(next.wristInside, isInside, next.targetHit)) {
      const hitTarget = next.currentTarget;
      const reactionTimeMs = Math.max(0, input.nowMs - hitTarget.spawnedAtMs);
      const compensated = next.attemptCompensationObserved;
      const hitEvent: TargetHitEvent = {
        targetId: hitTarget.id,
        capturedAtMs: input.nowMs,
        reactionTimeMs,
        sequence: next.sequence,
        ...(hitTarget.levelDegrees !== undefined
          ? { levelDegrees: hitTarget.levelDegrees }
          : {}),
        ...(compensated !== null ? { compensatedDuringAttempt: compensated } : {}),
      };
      // TERMINAL: the attempt is over. Its metrics are recorded and its target is retired in
      // one step — the two were separate objects while a successor still had to be spawned
      // between them, and splitting them now would only assign a `wristInside`/`targetHit`
      // pair that the very next line overwrites.
      //
      // One shape serves both motion preferences. `hitExitTransitionMs` selects only the
      // PRESENTATION effects — whether an exiting orb animates out, and how long the next
      // target is withheld. It no longer decides whether the successor is built now or
      // later: it is always later. That is what makes reduced motion an animation
      // preference rather than a different adaptive timeline.
      next = {
        ...next,
        interaction: {
          ...next.interaction,
          targetsReached: next.interaction.targetsReached + 1,
          targetHitTimestampsMs: [...next.interaction.targetHitTimestampsMs, input.nowMs],
          reactionTimesMs: [...next.interaction.reactionTimesMs, reactionTimeMs],
        },
        currentTarget: null,
        exitingTarget: exitTransitionMs > 0 ? hitTarget : null,
        spawnLockedUntilMs: exitTransitionMs > 0 ? input.nowMs + exitTransitionMs : null,
        retiredTargetPosition: { x: hitTarget.x, y: hitTarget.y },
        wristInside: false,
        targetHit: false,
        // Cleared with the target it described. `spawnNextTarget` clears it too, but that
        // now happens a tick later, and leaving a finished attempt's observation sitting in
        // the state in between would make it readable when it no longer means anything.
        attemptCompensationObserved: null,
        // Same reasoning: the finished attempt's unmeasured total describes an attempt
        // that no longer exists and must not be readable against the next one.
        attemptUnmeasuredElapsedS: 0,
      };
      return { state: next, hitEvent, attemptStartedEvents, attemptTimeoutEvent: null };
    }
    next = { ...next, wristInside: isInside };
  }
  // NO ELSE — a missing wrist sample leaves `wristInside` exactly as the last MEASURED
  // frame left it (REVIEW FIX, BLOCKER 3).
  //
  // This branch used to set `wristInside = false`, which asserted "the wrist is outside the
  // target" on the strength of a measurement the runtime never took. `hasWristMeasurement`
  // already states the rule this file follows: a null wrist is a gap in one measurement,
  // and no further conclusion may be drawn from it. Writing `false` drew exactly that
  // conclusion, and the state machine cannot tell a written `false` from an observed one.
  //
  // The damage was a fabricated hit, because a hit is an ENTRY EDGE (`shouldRegisterTargetHit`:
  // false → true). For a wrist resting inside the active target the sequence ran:
  //
  //     measured inside (true) → gap writes false → measurement returns inside (true)
  //
  // The runtime saw the false → true edge and paid out a `TargetHitEvent` — and with it a
  // `targetsReached`, an `AdaptiveAttemptOutcome(success)`, a success streak and a possible
  // level increase — for a patient who had not moved at all. The exit half of that edge was
  // never observed; only the gap invented it. Deterministic adaptive placement makes the
  // precondition ordinary rather than rare, since a successor lands where the wrist already is.
  //
  // Preserving the previous boolean is sufficient BECAUSE this flag is only ever read as one
  // half of an edge against a MEASURED `isInside`. Holding the last measured value means a gap
  // produces no edge in either direction, which is the correct reading of "inside/outside
  // unknown for this frame". A third `unknown` state would have to answer the same question
  // this answers — what does the next measured frame compare against — and would answer it by
  // deferring to the last measured value anyway, so it would widen the type without changing a
  // single outcome.
  //
  // Nothing is suppressed and no hit is deferred. A real exit still lands the moment an
  // OUTSIDE measurement arrives (true → false), and the re-entry after it still pays exactly
  // one hit. This is the same principle `attemptUnmeasuredElapsedS` applies to the attempt
  // clock, applied to the contact state: missing measurement is not patient performance.
  //
  // Stale state cannot leak into a different target: every spawn re-seeds `wristInside` from
  // the wrist's actual relationship to the NEW target (`spawnNextTarget`), and both terminal
  // paths clear it with the target they retire.

  // ATTEMPT EXPIRATION — evaluated only after contact has had its chance above.
  //
  // BOUNDARY PRECEDENCE: contact wins. At exactly `activeElapsedMs === attemptTimeoutMs`
  // a qualifying wrist entry has already returned a success above, so the same target can
  // never produce both results. The order is the rule, not an accident of if-placement:
  // the wrist is demonstrably inside the target on this tick, and reporting an incomplete
  // attempt against visible contact would be a false negative.
  //
  // This runs whether or not a wrist was available, because expiration is caused by
  // elapsed MEASURABLE time alone — never by `wrist === null`. A missing wrist cannot
  // cause an expiry and cannot bring one closer: the interval it spans is excluded from
  // the comparison by `resolveAttemptMeasurableElapsedMs`, so the attempt is held, not
  // failed, until measurement returns.
  //
  // THREE DISTINCT UNAVAILABILITIES, THREE OWNERS (review fix, blocker 2). The previous
  // note here said "tracking loss" but described only the GLOBAL tracker, which is why
  // the wrist-only case fell through it:
  //   - session paused / safety held → the orchestrator freezes `blockElapsedSeconds`
  //     and the gating layer stops ticking this function at all;
  //   - global tracker lost          → the same safety-hold path, entered from the
  //     detector's `trackerLost` event;
  //   - affected-side wrist absent   → NEITHER of the above fires. The detector's
  //     per-joint presence rule can drop `primaryWristNormalized` on a frame where
  //     landmarks were found and the session is perfectly healthy. That gap is owned
  //     here, by the attempt-scoped accumulator, because this is the only layer that
  //     knows which attempt it belongs to.
  const attemptTimeoutMs = resolveConfiguredAttemptTimeoutMs(input.attemptTimeoutMs);
  const blockElapsedSeconds = input.blockElapsedSeconds;
  if (
    attemptTimeoutMs !== null &&
    blockElapsedSeconds !== undefined &&
    Number.isFinite(blockElapsedSeconds) &&
    next.currentTarget &&
    // Redundant today — every contact path above returns — and deliberately kept as a
    // second lock on "a contacted target never also expires" if that early return is ever
    // restructured. No test can kill it while the early return stands.
    !next.targetHit
  ) {
    const expiringTarget = next.currentTarget;
    const activeElapsedMs = resolveAttemptMeasurableElapsedMs(
      expiringTarget,
      blockElapsedSeconds,
      next.attemptUnmeasuredElapsedS,
    );
    if (activeElapsedMs !== null && activeElapsedMs >= attemptTimeoutMs) {
      const compensated = next.attemptCompensationObserved;
      const attemptTimeoutEvent: TargetAttemptTimeoutEvent = {
        targetId: expiringTarget.id,
        sequence: next.sequence,
        expiredAtMs: input.nowMs,
        expiredAtBlockElapsedS: blockElapsedSeconds,
        activeElapsedMs,
        attemptTimeoutMs,
        ...(expiringTarget.levelDegrees !== undefined
          ? { levelDegrees: expiringTarget.levelDegrees }
          : {}),
        ...(compensated !== null ? { compensatedDuringAttempt: compensated } : {}),
      };
      // TERMINAL: the expired attempt's target is retired here and its successor is built
      // on a later tick, exactly as on the hit path above — so an incomplete attempt and a
      // successful one hand the caller the same opportunity to adapt before the patient is
      // shown what to reach for next. For a struggling patient that opportunity is the
      // whole point: the easier level and the longer window apply to the very next target,
      // not the one after it.
      //
      // No exiting target and no spawn lock: those are hit presentation effects, and an
      // expired attempt produces no patient-facing feedback. The successor therefore
      // appears on the next tick rather than after an animation.
      next = {
        ...next,
        currentTarget: null,
        exitingTarget: null,
        spawnLockedUntilMs: null,
        retiredTargetPosition: { x: expiringTarget.x, y: expiringTarget.y },
        wristInside: false,
        targetHit: false,
        attemptCompensationObserved: null,
        attemptUnmeasuredElapsedS: 0,
      };
      return {
        state: next,
        hitEvent: null,
        attemptStartedEvents,
        attemptTimeoutEvent,
      };
    }
  }

  return { state: next, hitEvent: null, attemptStartedEvents, attemptTimeoutEvent: null };
}
