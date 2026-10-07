/**
 * The measurement → presentation boundary for the Interactive Shoulder preview. Issue #277.
 *
 * THE CONVENTION MISMATCH THIS RESOLVES
 * -------------------------------------
 * Every piece of authored therapeutic geometry in this slice is written in a MIRRORED
 * (selfie) preview space, where SCREEN RIGHT is the patient's own RIGHT side. That
 * convention is stated explicitly in `adaptive/target-level-geometry.ts`, and three
 * independent modules already implement it:
 *
 *   - `mirrorX` in motion-patterns/motion-pattern-types.ts treats "right" as identity
 *     and mirrors "left" via `1 - x`, so the D1 path runs to high x for a right side.
 *   - `resolveSideBiasedBounds` in target-generator.ts biases the "right" side to the
 *     HIGH-x half of the frame, and "left" to the low-x half.
 *   - `resolveTargetLevelPosition` uses `lateral = +1` for right, opening the sweep
 *     toward increasing x.
 *
 * The camera presentation, however, was never mirrored: the `<video>` element carried
 * no transform, so it showed the raw camera image. MediaPipe reports landmarks in that
 * same raw image space, where a patient facing the camera has their ANATOMICAL RIGHT
 * on the IMAGE LEFT — `right_wrist` at LOW x, the exact opposite of what all of the
 * geometry above assumes.
 *
 * Because the hand marker and the hit test both read the raw wrist, they agreed with
 * each other and the marker correctly followed the right hand — while the therapeutic
 * path, drawn from authored geometry, appeared on the opposite side. That is the
 * reversed D1 confirmed in live RIGHT-side QA (#277), and the same mismatch placed
 * Reach the Light's side-biased targets away from the reaching arm.
 *
 * THE FIX IS ONE BOUNDARY, NOT SCATTERED FLIPS
 * --------------------------------------------
 * The preview is now genuinely mirrored — `scaleX(-1)` on the video and its overlay
 * canvas together — which is also the correct presentation for a reach-to-target
 * interaction: the patient sees themselves as in a mirror, so moving the hand toward
 * their right moves the cursor toward screen right.
 *
 * With the preview mirrored, the authored convention becomes true and NONE of the
 * geometry modules above needs to change. All that is required is to express the
 * MEASURED points in the same space the preview now draws, which is what this module
 * does — applied only where a measured point enters presentation.
 *
 * This changes no measurement. `primaryWristNormalized` and friends keep their raw
 * meaning in the detector, which is also consumed by the ML capture lab and the
 * volunteer flow; the conversion happens at the point of USE, not at the source. It
 * changes no clinical laterality semantics either: which arm is the affected arm is
 * resolved upstream and is untouched here.
 */
import type { NormalizedPoint } from "./types";

/**
 * Reflect a measured normalized point into mirrored preview space.
 *
 * `x` only: the preview mirrors horizontally, so `y` (which grows downward in both
 * MediaPipe and browser space) is carried through unchanged.
 *
 * Self-inverse — applying it twice returns the original point (to floating-point
 * precision) — so a double application is a no-op rather than a silent half-flip.
 */
export function toMirroredPreviewPoint(point: NormalizedPoint): NormalizedPoint;
export function toMirroredPreviewPoint(point: NormalizedPoint | null | undefined): NormalizedPoint | null;
export function toMirroredPreviewPoint(
  point: NormalizedPoint | null | undefined,
): NormalizedPoint | null {
  if (!point) return null;
  return { x: 1 - point.x, y: point.y };
}

/**
 * The CSS transform that mirrors the preview. Applied to the `<video>` and to the
 * landmark/framing `<canvas>` TOGETHER — the canvas is drawn with raw MediaPipe x, so
 * it only stays registered to the video if both flip about the same centerline.
 *
 * Exported as a constant so the two elements cannot drift apart, and so a test can
 * assert the preview is mirrored without parsing class strings.
 */
export const MIRRORED_PREVIEW_TRANSFORM = "scaleX(-1)";
