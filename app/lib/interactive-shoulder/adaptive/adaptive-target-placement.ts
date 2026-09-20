/**
 * CHANGE-007 — the runtime edge that turns an adaptive LEVEL into a real target POSITION.
 *
 * CHANGE-006 closed the feedback edge (attempt → outcome → level → attemptTimeoutMs). The
 * level itself still moved nothing: `target-generator.ts` placed every target randomly.
 * This module is the missing half — it resolves, per tick, the position the next target
 * should occupy, so that `AdaptiveDifficultyState.currentLevel` has an observable effect
 * on what the patient is actually asked to reach for.
 *
 *   adaptiveState.currentLevel
 *     → levelDegrees
 *     → current CV geometry (affected shoulder anchor + estimated arm length)
 *     → resolveTargetLevelPosition()          [existing canonical resolver, unchanged]
 *     → preferredTargetPosition seam
 *     → target-lifecycle spawn
 *     → generateTherapeuticTarget()           [existing single generation authority]
 *     → TherapeuticTarget.x / .y
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * - It is NOT a second geometry engine. Every coordinate it returns comes from
 *   `resolveTargetLevelPosition` in `target-level-geometry.ts`; the arithmetic, the
 *   coordinate convention, the safe-bounds clamp and the anchor-separation guard all
 *   stay in that one file.
 * - It is NOT a target owner. It produces a value; `target-lifecycle.ts` remains the only
 *   thing that decides when a target exists, and `target-generator.ts` remains the only
 *   thing that constructs one.
 * - It reads no clock, holds no state, mutates no input and touches no browser API.
 *
 * CLINICAL SAFETY BOUNDARY
 * ------------------------
 * `levelDegrees` is TARGET-PLACEMENT GEOMETRY — the angle around the shoulder anchor at
 * which a reach target is drawn. It is not a measured range of motion, not a joint angle,
 * not a diagnosis and not a clinical outcome. `reachRadiusNormalized` is the detector's
 * on-screen normalized arm-length estimate and is passed through UNSCALED: applying a
 * factor to it (0.9 × arm length, "80 % of reach", …) would be inventing a clinical reach
 * allowance this layer may not choose. The adaptive dimension here is the ANGLE only.
 *
 * DISABLED IS THE DEFAULT
 * -----------------------
 * `adaptiveState: null` — the production default, since the feature flag is off — returns
 * `{ placed: false, reason: "adaptiveDisabled" }`. The caller then supplies no preferred
 * position, and target placement is byte-identical to its pre-CHANGE-007 behaviour. There
 * is no fallback level, no default anchor and no substituted radius anywhere below:
 * geometry that is unavailable stays unavailable and the legacy random path runs.
 */
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { NormalizedPoint, SafeTargetBounds } from "../types";
import type { AdaptiveDifficultyState } from "./adaptive-difficulty-types";
import {
  resolveTargetLevelPosition,
  type TargetLevelGeometryUnavailableReason,
} from "./target-level-geometry";

export type AdaptiveTargetPlacementInput = {
  /**
   * The session's adaptive state, or null when adaptive difficulty is not enabled.
   * Required (not optional) so that "adaptive is off" is an explicit argument the caller
   * has to pass, rather than something this module could infer from an omitted field.
   */
  adaptiveState: AdaptiveDifficultyState | null;
  /** Therapeutic side, resolved upstream. This module never assumes a side. */
  affectedSide: ShoulderAbductionReachSide;
  /**
   * `ShoulderAbductionReachPoseDetectorSnapshot.primaryShoulderNormalized` for this frame.
   * `null`/`undefined` means the detector could not produce it — never a reason to invent
   * an anchor.
   */
  shoulderAnchorNormalized: NormalizedPoint | null | undefined;
  /**
   * `ShoulderAbductionReachPoseDetectorSnapshot.estimatedArmLengthNormalized` for this
   * frame. On-screen scale only; see the clinical boundary above.
   */
  reachRadiusNormalized: number | null | undefined;
  /** The same safe bounds the target generator will place within. */
  bounds: SafeTargetBounds;
};

/**
 * Why no adaptive position was produced.
 *
 * `adaptiveDisabled` is deliberately a distinct value rather than being folded into the
 * geometry reasons: it is the ordinary production state, not a degraded one, and a caller
 * or test must be able to tell "the feature is off" apart from "the feature is on but the
 * patient's shoulder was not visible this frame".
 */
export type AdaptiveTargetPlacementUnavailableReason =
  | "adaptiveDisabled"
  | TargetLevelGeometryUnavailableReason;

export type AdaptiveTargetPlacementResult =
  | {
      placed: true;
      /** Resolved position in normalized preview coordinates, already inside `bounds`. */
      position: NormalizedPoint;
      /**
       * The level this position was actually built from, after clamping into the
       * therapist-approved range. Reported so the caller stamps the target with the level
       * it truly occupies rather than with the requested one.
       */
      levelDegrees: number;
      /** True when the requested level fell outside [minLevel, maxLevel]. */
      levelWasClamped: boolean;
      /** True when the safe-bounds clamp moved the projected position. */
      positionWasClampedToBounds: boolean;
    }
  | { placed: false; reason: AdaptiveTargetPlacementUnavailableReason };

/**
 * Resolves the position the next target should occupy for the current adaptive level.
 *
 * Pure and deterministic: the same state and the same geometry always yield the same
 * point. That is a property, not a limitation — two consecutive attempts at the same level
 * with an unmoved patient SHOULD ask for the same reach. The interaction consequence (a
 * successor spawning under a wrist that is already there) is handled where it belongs, by
 * the lifecycle seeding its wrist-entry state from the new target — not by perturbing the
 * geometry, which would make placement no longer mean what it says.
 */
export function resolveAdaptiveTargetPlacement(
  input: AdaptiveTargetPlacementInput,
): AdaptiveTargetPlacementResult {
  const adaptiveState = input.adaptiveState;
  if (!adaptiveState) {
    return { placed: false, reason: "adaptiveDisabled" };
  }

  const resolved = resolveTargetLevelPosition({
    affectedSide: input.affectedSide,
    shoulderAnchorNormalized: input.shoulderAnchorNormalized ?? null,
    reachRadiusNormalized: input.reachRadiusNormalized ?? null,
    // The engine's live level — never a constant and never a start-level fallback.
    levelDegrees: adaptiveState.currentLevel,
    // The therapist-approved range travels with the state's own validated config, so the
    // placement range and the adaptation range can never disagree.
    minimumLevelDegrees: adaptiveState.config.minLevel,
    maximumLevelDegrees: adaptiveState.config.maxLevel,
    bounds: input.bounds,
    // Side bias is the RANDOM generator's heuristic for landing targets on the reach side.
    // Shoulder-anchored geometry already places the target on the affected side by
    // construction, and re-applying the bias would clamp legitimate low-level placements
    // toward the midline. Left at the resolver's own default (off), stated explicitly.
    applySideBias: false,
  });

  if (!resolved.available) {
    return { placed: false, reason: resolved.reason };
  }

  return {
    placed: true,
    position: resolved.position,
    levelDegrees: resolved.appliedLevelDegrees,
    levelWasClamped: resolved.levelWasClamped,
    positionWasClampedToBounds: resolved.positionWasClampedToBounds,
  };
}
