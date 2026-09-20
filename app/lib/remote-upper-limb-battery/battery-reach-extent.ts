/**
 * Direction-normalized Functional Reach extent for the remote battery.
 *
 * The Functional Reach FSM uses rise polarity: a decrease from baseline is the
 * reach excursion. Left and right side-view profiles invert camera X, so the
 * raw wrist–shoulder delta is flipped for the left tested side.
 *
 * Persisted peakReachExtent is displacement from baseline, not the raw extrema.
 */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { BLAZEPOSE_SIDE_INDICES } from "./battery-tracking";
import type { RemoteUpperLimbBatterySide } from "./types";

export const FUNCTIONAL_REACH_TRACKING_LOSS_RESET_TICKS = 8;

export function computeBatteryReachExtent(
  landmarks: readonly PoseLandmark[],
  side: RemoteUpperLimbBatterySide,
): number | null {
  const indices = BLAZEPOSE_SIDE_INDICES[side];
  const shoulder = landmarks[indices.shoulder];
  const wrist = landmarks[indices.wrist];
  if (!shoulder || !wrist) return null;
  const delta = wrist.x - shoulder.x;
  return side === "left" ? -delta : delta;
}

export function computeReachDisplacementFromBaseline(
  baselineExtent: number,
  extremaExtent: number,
): number {
  return Math.max(0, baselineExtent - extremaExtent);
}
