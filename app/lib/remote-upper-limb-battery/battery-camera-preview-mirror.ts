/**
 * Patient-facing mirror presentation for Remote Upper-Limb Battery camera preview.
 * Measurement landmarks stay in raw MediaPipe image space; only the canvas draw path flips.
 */

/** CSS-equivalent horizontal mirror for canvas presentation. */
export const BATTERY_MIRRORED_CAMERA_PREVIEW_TRANSFORM = "scaleX(-1)";

/**
 * Wraps preview drawing (video frame + arm overlay) in a horizontal mirror.
 * Does not affect landmark values passed to CV processors.
 */
export function withBatteryMirroredCameraPreviewDraw(
  ctx: CanvasRenderingContext2D,
  width: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
}
