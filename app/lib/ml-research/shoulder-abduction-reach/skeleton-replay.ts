/**
 * Shoulder Abduction Reach — dev-only skeleton replay helpers.
 * RASQ ML bridge, First Labeling Slice (2026-08-19); Anatomical Visual
 * Guide Overlay (Option A) added 2026-08-19.
 *
 * Reconstructs a 2D stick-figure animation from a repetition's captured
 * landmark frames — no video, no images, ever (there is none to replay:
 * captures never included raw frames, only joint landmarks). Pure/testable
 * logic here; the stateful playback loop (setTimeout/rAF-driven) lives in
 * the labeling page component itself.
 *
 * ANATOMICAL GUIDE OVERLAY — SCOPE NOTE
 * ---------------------------------------
 * Everything below is Category A ("anatomical visual reference") only, per
 * the RASQ ML bridge orientation-guide design report: pure geometry drawn
 * from already-captured x/y landmark positions, with zero inference and
 * zero interpretation. There is deliberately no orientation estimate
 * (FRONT_ALIGNED/ROTATED_LEFT/ROTATED_RIGHT), no movement-plane
 * classification, no compensation score, and no threshold anywhere in this
 * file — those are explicitly out of scope for this slice (see the design
 * report's Option B/C). The guide only draws lines between measured joint
 * positions; it never judges them.
 */

import type { MotionFrameJoint } from "@/app/lib/motion-intelligence";
import type { ShoulderAbductionReachCapturedFrame } from "./capture-schema";
import type { MlResearchCapturedJointId } from "./capture-schema";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

const BONES: readonly [MlResearchCapturedJointId, MlResearchCapturedJointId][] = [
  ["left_hip", "right_hip"],
  ["left_shoulder", "right_shoulder"],
  ["left_hip", "left_shoulder"],
  ["right_hip", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
];

/** Only the true arm segments (not the trunk lines) count as "the recorded side" for highlighting. */
function armBoneIdsForSide(side: ShoulderAbductionReachSide): ReadonlySet<string> {
  const prefix = side;
  return new Set([`${prefix}_shoulder-${prefix}_elbow`, `${prefix}_elbow-${prefix}_wrist`]);
}

function isSideBone(bone: readonly [string, string], side: ShoulderAbductionReachSide): boolean {
  return armBoneIdsForSide(side).has(`${bone[0]}-${bone[1]}`);
}

function visibleJoint(joint: MotionFrameJoint | undefined): MotionFrameJoint | null {
  if (!joint) return null;
  if (joint.confidence.present === false) return null;
  return joint;
}

// ---------------------------------------------------------------------------
// Anatomical guide geometry (Category A — pure visual reference, no inference)
// ---------------------------------------------------------------------------

export type ReplayPoint = { x: number; y: number };
export type ReplaySegment = { from: ReplayPoint; to: ReplayPoint };

type CapturedJoints = ShoulderAbductionReachCapturedFrame["joints"];

function midpoint(a: MotionFrameJoint, b: MotionFrameJoint): ReplayPoint {
  return { x: (a.landmark.x + b.landmark.x) / 2, y: (a.landmark.y + b.landmark.y) / 2 };
}

/** Midpoint between left_shoulder and right_shoulder, or null if either is missing/not present. */
export function computeShoulderMidpoint(joints: CapturedJoints): ReplayPoint | null {
  const left = visibleJoint(joints.left_shoulder);
  const right = visibleJoint(joints.right_shoulder);
  if (!left || !right) return null;
  return midpoint(left, right);
}

/** Midpoint between left_hip and right_hip, or null if either is missing/not present. */
export function computeHipMidpoint(joints: CapturedJoints): ReplayPoint | null {
  const left = visibleJoint(joints.left_hip);
  const right = visibleJoint(joints.right_hip);
  if (!left || !right) return null;
  return midpoint(left, right);
}

/** left_shoulder -> right_shoulder for the given frame's joints. Anatomical identity preserved: always reads the named left_/right_ joints, never side-swapped. */
export function computeShoulderLine(joints: CapturedJoints): ReplaySegment | null {
  const left = visibleJoint(joints.left_shoulder);
  const right = visibleJoint(joints.right_shoulder);
  if (!left || !right) return null;
  return { from: { x: left.landmark.x, y: left.landmark.y }, to: { x: right.landmark.x, y: right.landmark.y } };
}

/** left_hip -> right_hip for the given frame's joints. */
export function computePelvicLine(joints: CapturedJoints): ReplaySegment | null {
  const left = visibleJoint(joints.left_hip);
  const right = visibleJoint(joints.right_hip);
  if (!left || !right) return null;
  return { from: { x: left.landmark.x, y: left.landmark.y }, to: { x: right.landmark.x, y: right.landmark.y } };
}

/**
 * Hip midpoint -> shoulder midpoint for THIS frame — recomputed fresh every
 * call, so it moves with the body frame-by-frame. This is what makes it the
 * "live" trunk axis, as opposed to the static midline below.
 */
export function computeCurrentTrunkAxis(joints: CapturedJoints): ReplaySegment | null {
  const hipMid = computeHipMidpoint(joints);
  const shoulderMid = computeShoulderMidpoint(joints);
  if (!hipMid || !shoulderMid) return null;
  return { from: hipMid, to: shoulderMid };
}

export type StaticBodyMidline = {
  /** Normalized x (0-1) the vertical reference line is drawn at — constant for the whole replay. */
  x: number;
  /** Index of the frame used as the baseline, kept for traceability/testing. */
  baselineFrameIndex: number;
};

/**
 * Selects the baseline frame and derives the static anatomical midline from
 * it — the single reference the whole replay is measured against.
 *
 * Baseline selection: the EARLIEST frame in the repetition where both the
 * shoulder midpoint and hip midpoint are computable (i.e. all four of
 * left/right shoulder and left/right hip pass the same `confidence.present`
 * gate already used everywhere else in this pipeline — no new visibility
 * threshold is invented here). This is normally frame 0; if the first frame
 * has a momentarily occluded joint, the next usable frame is used instead.
 * Returns null only if NO frame in the whole repetition has a usable
 * baseline (in practice this cannot happen for a repetition that passed the
 * capture pipeline's own technical-validity gate, but is handled explicitly
 * rather than assumed).
 *
 * The line itself is deliberately normalized to pure vertical (constant x =
 * the mean of the baseline shoulder-midpoint and hip-midpoint x-values),
 * not "whatever slope frame 0 happened to have" — this is what makes it
 * read as a vertical reference rather than a second trunk-axis line, and
 * keeps it visually distinct from the live trunk axis (which does follow
 * whatever slope the current frame has).
 *
 * Computed ONCE per repetition and never recomputed from later frames — if
 * the patient leans, the live trunk axis moves away from this fixed line by
 * design. It must never be re-derived mid-replay, or it would visually
 * "correct" for the very compensation a therapist is trying to judge.
 */
export function computeInitialBodyMidline(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
): StaticBodyMidline | null {
  for (let i = 0; i < frames.length; i += 1) {
    const shoulderMid = computeShoulderMidpoint(frames[i].joints);
    const hipMid = computeHipMidpoint(frames[i].joints);
    if (shoulderMid && hipMid) {
      return { x: (shoulderMid.x + hipMid.x) / 2, baselineFrameIndex: i };
    }
  }
  return null;
}

/**
 * Recent positions of the selected side's wrist, up to and including
 * `uptoFrameIndex`, oldest first. Short by design (default 8 frames, ~260ms
 * at the pipeline's real ~33ms capture cadence) — a light trail, not a full
 * trajectory plot. Frames with no usable wrist landmark are skipped rather
 * than breaking the trail.
 */
export function computeWristTrail(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  side: ShoulderAbductionReachSide,
  uptoFrameIndex: number,
  trailLength = 8,
): ReplayPoint[] {
  const wristJointId: MlResearchCapturedJointId = side === "right" ? "right_wrist" : "left_wrist";
  const start = Math.max(0, uptoFrameIndex - trailLength + 1);
  const points: ReplayPoint[] = [];
  for (let i = start; i <= uptoFrameIndex && i < frames.length; i += 1) {
    const joint = visibleJoint(frames[i]?.joints[wristJointId]);
    if (joint) points.push({ x: joint.landmark.x, y: joint.landmark.y });
  }
  return points;
}

/**
 * Returns the index of the last frame whose relativeTimestampMs <= elapsedMs,
 * clamped to a valid index. frames is assumed sorted ascending by timestamp
 * (true for every capture written by the existing pipeline).
 */
export function resolveFrameIndexForElapsedMs(
  frames: readonly ShoulderAbductionReachCapturedFrame[],
  elapsedMs: number,
): number {
  if (frames.length === 0) return -1;
  if (elapsedMs <= frames[0].relativeTimestampMs) return 0;
  let index = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].relativeTimestampMs <= elapsedMs) index = i;
    else break;
  }
  return index;
}

export function computeReplayDurationMs(frames: readonly ShoulderAbductionReachCapturedFrame[]): number {
  if (frames.length === 0) return 0;
  return frames[frames.length - 1].relativeTimestampMs;
}

export type SkeletonDrawOptions = {
  side: ShoulderAbductionReachSide;
  /** CSS color for the recorded side's arm bones — orientation aid only. */
  sideColor?: string;
  /** CSS color for everything else (trunk + contralateral arm). */
  neutralColor?: string;
  /** CSS color for a joint whose landmark visibility confidence is below lowVisibilityThreshold. */
  lowConfidenceColor?: string;
  lowVisibilityThreshold?: number;
};

const DEFAULT_OPTIONS: Required<SkeletonDrawOptions> = {
  side: "right",
  sideColor: "#1D9E75",
  neutralColor: "#9CA3AF",
  lowConfidenceColor: "#EF9F27",
  lowVisibilityThreshold: 0.5,
};

/** Draws one skeleton frame onto a 2D canvas context, scaled to canvasWidth/canvasHeight. */
export function drawShoulderAbductionSkeletonFrame(
  ctx: CanvasRenderingContext2D,
  frame: ShoulderAbductionReachCapturedFrame,
  canvasWidth: number,
  canvasHeight: number,
  options: SkeletonDrawOptions,
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  for (const bone of BONES) {
    const a = visibleJoint(frame.joints[bone[0]]);
    const b = visibleJoint(frame.joints[bone[1]]);
    if (!a || !b) continue;
    ctx.strokeStyle = isSideBone(bone, opts.side) ? opts.sideColor : opts.neutralColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.landmark.x * canvasWidth, a.landmark.y * canvasHeight);
    ctx.lineTo(b.landmark.x * canvasWidth, b.landmark.y * canvasHeight);
    ctx.stroke();
  }

  for (const jointId of Object.keys(frame.joints) as MlResearchCapturedJointId[]) {
    const joint = visibleJoint(frame.joints[jointId]);
    if (!joint) continue;
    const lowConfidence = joint.confidence.visibility < opts.lowVisibilityThreshold;
    ctx.fillStyle = lowConfidence ? opts.lowConfidenceColor : opts.neutralColor;
    ctx.beginPath();
    ctx.arc(joint.landmark.x * canvasWidth, joint.landmark.y * canvasHeight, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type AnatomicalGuideOptions = {
  /** Master on/off — the "Show anatomical guides" toggle. */
  show: boolean;
  /** Precomputed once per repetition via `computeInitialBodyMidline` — never recomputed per frame. */
  staticMidline: StaticBodyMidline | null;
  /** Precomputed via `computeWristTrail` for the currently displayed frame. Empty array = no trail. */
  wristTrail: readonly ReplayPoint[];
  /** Neutral reference color — deliberately not red/green/amber (those are already used elsewhere in this file for tracking-confidence semantics, which this overlay must not be confused with). */
  guideColor?: string;
  wristTrailColor?: string;
};

const DEFAULT_GUIDE_COLOR = "#60A5FA"; // neutral blue — an "informational reference" color, not a pass/fail one
const DEFAULT_WRIST_TRAIL_COLOR = "rgba(96, 165, 250, 0.4)";

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  segment: ReplaySegment,
  canvasWidth: number,
  canvasHeight: number,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(segment.from.x * canvasWidth, segment.from.y * canvasHeight);
  ctx.lineTo(segment.to.x * canvasWidth, segment.to.y * canvasHeight);
  ctx.stroke();
}

/**
 * Draws the neutral anatomical reference overlay on top of an already-drawn
 * skeleton frame (call `drawShoulderAbductionSkeletonFrame` first — this
 * function does not clear the canvas, so it layers on top).
 *
 * Draws, in order: the static vertical midline (dashed, so it reads as a
 * fixed reference rather than a moving body part), the live shoulder line,
 * the live pelvic line, the live trunk axis, and the optional wrist trail.
 * Every line is a direct geometric construction from measured joint
 * positions — no number, score, threshold, or classification is ever drawn
 * or computed here.
 */
export function drawAnatomicalGuideOverlay(
  ctx: CanvasRenderingContext2D,
  frame: ShoulderAbductionReachCapturedFrame,
  canvasWidth: number,
  canvasHeight: number,
  options: AnatomicalGuideOptions,
): void {
  if (!options.show) return;
  const guideColor = options.guideColor ?? DEFAULT_GUIDE_COLOR;

  if (options.staticMidline) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    strokeSegment(
      ctx,
      {
        from: { x: options.staticMidline.x, y: 0 },
        to: { x: options.staticMidline.x, y: 1 },
      },
      canvasWidth,
      canvasHeight,
      guideColor,
      1.5,
    );
    ctx.restore();
  }

  const shoulderLine = computeShoulderLine(frame.joints);
  if (shoulderLine) strokeSegment(ctx, shoulderLine, canvasWidth, canvasHeight, guideColor, 2);

  const pelvicLine = computePelvicLine(frame.joints);
  if (pelvicLine) strokeSegment(ctx, pelvicLine, canvasWidth, canvasHeight, guideColor, 2);

  const trunkAxis = computeCurrentTrunkAxis(frame.joints);
  if (trunkAxis) strokeSegment(ctx, trunkAxis, canvasWidth, canvasHeight, guideColor, 2.5);

  if (options.wristTrail.length > 1) {
    ctx.strokeStyle = options.wristTrailColor ?? DEFAULT_WRIST_TRAIL_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    options.wristTrail.forEach((point, index) => {
      const x = point.x * canvasWidth;
      const y = point.y * canvasHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
