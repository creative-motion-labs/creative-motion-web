/**
 * CHANGE-006 — where a runtime `DifficultyConfig` comes from.
 *
 * Resolution is keyed off the block's existing `feedbackProfile` string, exactly as
 * `motion-patterns/motion-pattern-registry.ts` resolves a motion pattern. The generic
 * `MovementBlock` contract therefore gains no adaptive field, and
 * `session-orchestrator/types.ts` is not touched: a block carries a key, and this
 * interactive-shoulder module owns what that key means.
 *
 * DISABLED IS THE DEFAULT AND THE SAFE STATE
 * ------------------------------------------
 * Every resolver here returns `DifficultyConfig | null`, and `null` means "adaptive
 * runtime off". That is not an error path — it is the production default. With `null`
 * the caller supplies no `targetAttempt` seam at all, so attempt expiration stays off
 * and runtime behaviour is byte-identical to the behaviour before this stage existed.
 * A config is returned ONLY when the feature flag is on AND the profile is registered
 * AND the config passes `validateDifficultyConfig`.
 *
 * NO CLINICAL VALUES LIVE HERE
 * ----------------------------
 * The only registered configuration is an explicitly labelled development fixture (see
 * below). It is not a clinical default, it is not therapist-approved, and it is gated
 * behind an environment flag that is off unless deliberately set.
 */
import type { SessionDefinition } from "@/app/lib/session-orchestrator/types";
import { validateDifficultyConfig } from "./adaptive-difficulty";
import type { DifficultyConfig } from "./adaptive-difficulty-types";
import { REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE } from "../motion-patterns/motion-pattern-registry";

/**
 * DEVELOPMENT FIXTURE — NOT CLINICAL CONFIGURATION.
 *
 * These numbers exist so CHANGE-006's runtime feedback edge can be exercised and
 * reviewed. They are NOT therapist-approved, carry no clinical meaning, and must never
 * be presented to a patient or clinician as a validated protocol. `startLevel`,
 * `minLevel` and `maxLevel` are TARGET-PLACEMENT GEOMETRY degrees (see
 * `target-level-geometry.ts`), not joint angles or range of motion. The timeouts are
 * interaction windows, not clinical reach allowances.
 *
 * They are chosen only to make adaptation observable within a short test: a small
 * struggle threshold and no cooldown, with a level above the floor so that both the
 * decrease edge and the at-floor extended-timeout edge can be reached deterministically.
 *
 * Real values require clinical sign-off and must replace this fixture before adaptive
 * behaviour is enabled for any patient.
 */
export const DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG: DifficultyConfig = {
  startLevel: 50,
  minLevel: 40,
  maxLevel: 70,
  increaseStep: 10,
  decreaseStep: 10,
  successStreakToIncrease: 2,
  struggleStreakToDecrease: 2,
  cooldownAttempts: 0,
  normalAttemptTimeoutMs: 6_000,
  extendedAttemptTimeoutMs: 9_000,
  compensatedSuccessPolicy: "excludedFromIncrease",
};

/**
 * Registry of feedback-profile key → configuration. Mirrors `MOTION_PATTERN_REGISTRY`.
 * Only the Reach the Light target profile is registered, and only with the development
 * fixture above.
 */
const DIFFICULTY_CONFIG_REGISTRY: Record<string, DifficultyConfig> = {
  [REACH_THE_LIGHT_TARGET_FEEDBACK_PROFILE]: DEVELOPMENT_ADAPTIVE_DIFFICULTY_CONFIG,
};

export type AdaptiveDifficultyFeatureFlag = boolean;

/**
 * Resolves whether adaptive difficulty runtime behaviour is enabled.
 *
 * `NEXT_PUBLIC_RASQ_ADAPTIVE_DIFFICULTY_V1 === "true"` enables it. Any other value —
 * missing, "false", "1", "TRUE" — leaves it off. Deliberately the same strict-equality
 * shape as `resolveMotionPatternsFeatureFlag` in
 * `resolve-interactive-shoulder-session.ts`, so there is one flag convention in this
 * domain rather than two.
 */
export function resolveAdaptiveDifficultyFeatureFlag(
  envValue: string | undefined,
): AdaptiveDifficultyFeatureFlag {
  return envValue === "true";
}

/**
 * Looks up a registered configuration and returns it only if it is valid.
 *
 * Validation happens here rather than at the call site because
 * `createAdaptiveDifficultyState` THROWS on an invalid configuration, and this resolver
 * feeds a requestAnimationFrame loop. An invalid registry entry must degrade to
 * "adaptive off", never to an exception thrown through the render path.
 */
export function getRegisteredDifficultyConfig(
  feedbackProfileKey: string | undefined | null,
): DifficultyConfig | null {
  if (!feedbackProfileKey) return null;
  const config = DIFFICULTY_CONFIG_REGISTRY[feedbackProfileKey];
  if (!config) return null;
  return validateDifficultyConfig(config).valid ? config : null;
}

/** Resolves the configuration for one block's feedback profile, honouring the flag. */
export function resolveDifficultyConfigForBlock(
  feedbackProfileKey: string | undefined | null,
  enabled: AdaptiveDifficultyFeatureFlag,
): DifficultyConfig | null {
  if (!enabled) return null;
  return getRegisteredDifficultyConfig(feedbackProfileKey);
}

/**
 * Resolves the configuration for a whole session, from the first block that has one.
 *
 * Session scope is deliberate: `AdaptiveDifficultyState` is session-scoped (it must
 * survive block transitions), so the configuration that state was built from has to be
 * session-scoped too. Resolving per block would let a mid-session block hand the engine
 * a different config than the state it already owns was validated against.
 *
 * KNOWN LIMITATION: a session whose movement-target blocks disagree about difficulty
 * would silently use the first block's configuration. No such session exists today —
 * every current definition has a single movement-target block — and supporting one is a
 * product decision, not something this resolver should guess.
 */
export function resolveDifficultyConfigForSession(
  definition: SessionDefinition,
  enabled: AdaptiveDifficultyFeatureFlag,
): DifficultyConfig | null {
  if (!enabled) return null;
  for (const block of definition.blocks) {
    const config = getRegisteredDifficultyConfig(block.feedbackProfile);
    if (config) return config;
  }
  return null;
}

/** Convenience wrapper reading the flag from the environment, as the session resolver does. */
export function resolveDifficultyConfigForSessionFromEnv(
  definition: SessionDefinition,
  envValue: string | undefined = process.env.NEXT_PUBLIC_RASQ_ADAPTIVE_DIFFICULTY_V1,
): DifficultyConfig | null {
  return resolveDifficultyConfigForSession(
    definition,
    resolveAdaptiveDifficultyFeatureFlag(envValue),
  );
}
