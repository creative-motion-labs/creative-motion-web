/**
 * Patient-facing mirror presentation for Remote Upper-Limb Battery camera preview.
 * MediaPipe/CV use unmirrored video and raw landmarks; only this draw path flips once.
 */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { drawUpperLimbArmMotionGuidanceOverlay } from "@/app/lib/cv/upper-limb-arm-pose-overlay";
import type { RemoteUpperLimbBatterySide } from "./types";

/**
 * Draws the visible preview (video + arm overlay) with exactly one horizontal mirror.
 */
export function drawBatteryMirroredCameraPreview(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  landmarks: readonly PoseLandmark[] | undefined,
  motionGuidanceSide: RemoteUpperLimbBatterySide | null,
): void {
  const width = canvas.width;
  const height = canvas.height;

  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, width, height);
  if (landmarks?.length && motionGuidanceSide) {
    drawUpperLimbArmMotionGuidanceOverlay(
      ctx,
      landmarks,
      width,
      height,
      motionGuidanceSide,
    );
  }
  ctx.restore();
}

/** Typical webcam default before `videoWidth` / `videoHeight` are available (4:3). */
export const BATTERY_CAMERA_PREVIEW_DEFAULT_ASPECT = 4 / 3;

export function resolveBatteryCameraPreviewAspect(
  videoWidth: number,
  videoHeight: number,
): number {
  if (videoWidth > 0 && videoHeight > 0) {
    return videoWidth / videoHeight;
  }
  return BATTERY_CAMERA_PREVIEW_DEFAULT_ASPECT;
}
