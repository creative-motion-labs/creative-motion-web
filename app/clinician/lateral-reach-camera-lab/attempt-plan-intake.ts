/**
 * Lateral Reach camera lab — Slice 16: attempt-plan intake / lock.
 *
 * Lab-local pure host helper. Owns pre-movement structured selection →
 * LateralReachCalibrationAttemptPlan lock via the existing Slice 10 resolver.
 *
 * Does NOT:
 * - own detector / camera lifecycle
 * - create calibration controllers
 * - invent direction from wrist-side metadata, geometry, or free-text placement
 * - invent calibration numeric policy
 */

import type { LateralReachCalibrationAttemptIntention } from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";
import {
  resolveLateralReachCalibrationAttemptIntentionFromPlan,
  type LateralReachCalibrationAttemptPlan,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-attempt-plan";

export type LabScreenHorizontalDirectionSelection =
  | "positive_x"
  | "negative_x"
  | null;

export type LabAttemptPlanLock = {
  readonly lockedPlan: LateralReachCalibrationAttemptPlan;
  readonly lockedIntention: LateralReachCalibrationAttemptIntention;
};

export type LabAttemptPlanLockResult =
  | { readonly ok: true; readonly lock: LabAttemptPlanLock }
  | {
      readonly ok: false;
      readonly error: string;
      readonly previousLock: LabAttemptPlanLock | null;
    };

const SELECTION_REQUIRED_MESSAGE =
  'screenHorizontalDirection selection must be exactly "positive_x" or "negative_x"';

/**
 * Lock a lab selection into a snapshotted attempt plan + Slice 8 intention.
 * Sign is minted only through resolveLateralReachCalibrationAttemptIntentionFromPlan.
 */
export function lockLateralReachLabAttemptPlan(
  selection: unknown,
): LabAttemptPlanLock {
  // Unselected host state fails before constructing a plan.
  if (selection === null || selection === undefined) {
    throw new RangeError(SELECTION_REQUIRED_MESSAGE);
  }

  // Unsupported tokens fail through the existing Slice 10 resolver (no local mint).
  const lockedIntention = resolveLateralReachCalibrationAttemptIntentionFromPlan({
    screenHorizontalDirection: selection,
  });

  if (selection !== "positive_x" && selection !== "negative_x") {
    // Resolver is the gate; this is unreachable when Slice 10 semantics hold.
    throw new RangeError(SELECTION_REQUIRED_MESSAGE);
  }

  // Snapshot: new object, independent of later editable selection mutation.
  return {
    lockedPlan: {
      screenHorizontalDirection: selection,
    },
    lockedIntention,
  };
}

/**
 * Fail-closed lock attempt that never mutates a previously valid lock on failure.
 */
export function tryLockLateralReachLabAttemptPlan(
  selection: unknown,
  previousLock: LabAttemptPlanLock | null = null,
): LabAttemptPlanLockResult {
  try {
    return { ok: true, lock: lockLateralReachLabAttemptPlan(selection) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      previousLock,
    };
  }
}

export function canLockLateralReachLabAttemptPlan(
  selection: LabScreenHorizontalDirectionSelection,
): boolean {
  return selection === "positive_x" || selection === "negative_x";
}
