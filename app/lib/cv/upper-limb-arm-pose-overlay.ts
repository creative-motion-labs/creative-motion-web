/**
 * Subtle tested-arm pose overlay for booth / patient camera views.
 * Lines and dots only when landmarks meet visibility thresholds — never frozen after loss.
 */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { BLAZEPOSE_SIDE_INDICES } from "@/app/lib/remote-upper-limb-battery/battery-tracking";
import type { RemoteUpperLimbBatterySide } from "@/app/lib/remote-upper-limb-battery/types";

export type UpperLimbArmOverlaySide = RemoteUpperLimbBatterySide;

export type DrawUpperLimbArmOverlayOptions = {
  minVisibility?: number;
  lineColor?: string;
  dotRadius?: number;
  lineWidth?: number;
};

const DEFAULT_LINE = "rgba(29, 158, 117, 0.72)";
const DEFAULT_DOT = "rgba(29, 158, 117, 0.95)";

function landmarkPoint(
  landmarks: readonly PoseLandmark[],
  index: number,
  width: number,
  height: number,
  minVisibility: number,
): { x: number; y: number } | null {
  const lm = landmarks[index];
  if (!lm || (lm.visibility ?? 0) < minVisibility) return null;
  return { x: lm.x * width, y: lm.y * height };
}

/**
 * Returns true when shoulder, elbow, and wrist are all visible enough to draw.
 */
export function isUpperLimbArmOverlayReady(
  landmarks: readonly PoseLandmark[],
  side: UpperLimbArmOverlaySide,
  minVisibility = 0.35,
): boolean {
  if (landmarks.length === 0) return false;
  const indices = BLAZEPOSE_SIDE_INDICES[side];
  return (
    landmarkPoint(landmarks, indices.shoulder, 1, 1, minVisibility) != null &&
    landmarkPoint(landmarks, indices.elbow, 1, 1, minVisibility) != null &&
    landmarkPoint(landmarks, indices.wrist, 1, 1, minVisibility) != null
  );
}

export function drawUpperLimbArmMotionGuidanceOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  width: number,
  height: number,
  side: UpperLimbArmOverlaySide,
  options: DrawUpperLimbArmOverlayOptions = {},
): boolean {
  const minVisibility = options.minVisibility ?? 0.35;
  if (!isUpperLimbArmOverlayReady(landmarks, side, minVisibility)) {
    return false;
  }

  const indices = BLAZEPOSE_SIDE_INDICES[side];
  const shoulder = landmarkPoint(landmarks, indices.shoulder, width, height, minVisibility)!;
  const elbow = landmarkPoint(landmarks, indices.elbow, width, height, minVisibility)!;
  const wrist = landmarkPoint(landmarks, indices.wrist, width, height, minVisibility)!;

  const lineColor = options.lineColor ?? DEFAULT_LINE;
  const dotRadius = options.dotRadius ?? 5;
  const lineWidth = options.lineWidth ?? 2.5;

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.stroke();

  for (const point of [shoulder, elbow, wrist]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = options.lineColor ? lineColor : DEFAULT_DOT;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
  ctx.restore();

  return true;
}
