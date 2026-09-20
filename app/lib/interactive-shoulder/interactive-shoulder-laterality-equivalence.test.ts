/**
 * Run:
 *   npx tsx --test app/lib/interactive-shoulder/interactive-shoulder-laterality-equivalence.test.ts
 *
 * READ-ONLY laterality QA — deterministic mirrored synthetic movement fed through
 * existing Interactive Shoulder runtime logic. No runtime changes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  ShoulderAbductionReachPoseDetector,
  type ShoulderAbductionReachMeasuredEvent,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import {
  SHOULDER_ABDUCTION_REACH_BONUS_JOINTS,
  type ShoulderAbductionReachSide,
} from "@/app/lib/shoulder-rehabilitation";
import { computeShoulderAbductionReachSideMetrics } from "@/app/lib/shoulder-rehabilitation/shoulder-abduction-reach-metrics";
import { DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS } from "@/app/lib/shoulder-rehabilitation/shoulder-abduction-reach-contract";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition";
import {
  createShoulderAbductionReachCompensationState,
  updateShoulderAbductionReachCompensation,
} from "@/app/lib/cv/shoulder-abduction-reach-compensation";
import { toMirroredPreviewPoint } from "./presentation-mirror";
import { DEFAULT_SAFE_TARGET_BOUNDS } from "./target-generator";
import { DEFAULT_TARGET_HIT_CONFIG, isWristInsideTarget } from "./target-hit";
import {
  createInitialTargetLifecycle,
  tickTargetLifecycle,
  type TargetLifecycleState,
} from "./target-lifecycle";
import { D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./motion-patterns/d1-inspired-diagonal-reach-pattern";
import { resolveActiveMotionPattern } from "./motion-patterns/motion-pattern-registry";
import { samplePathAtProgress } from "./motion-patterns/bezier-path";
import {
  createInitialPatternLifecycle,
  tickPatternLifecycle,
} from "./motion-patterns/pattern-lifecycle";
import type { NormalizedPoint } from "./types";

const T0 = 12_000_000;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

const REACH_SEEDS = [0.15, 0.42, 0.68, 0.91];
const TIMING_TOLERANCE_MS = 1;

function facingCameraLandmarks(options: {
  rightWrist: { x: number; y: number };
  leftWrist: { x: number; y: number };
}): PoseLandmark[] {
  const lm: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  lm[R_SHOULDER] = { x: 0.4, y: 0.35, visibility: 0.95 };
  lm[R_HIP] = { x: 0.42, y: 0.62, visibility: 0.95 };
  lm[R_ELBOW] = { x: 0.34, y: 0.48, visibility: 0.95 };
  lm[R_WRIST] = { x: options.rightWrist.x, y: options.rightWrist.y, visibility: 0.92 };
  lm[L_SHOULDER] = { x: 0.6, y: 0.35, visibility: 0.95 };
  lm[L_HIP] = { x: 0.58, y: 0.62, visibility: 0.95 };
  lm[L_ELBOW] = { x: 0.66, y: 0.48, visibility: 0.95 };
  lm[L_WRIST] = { x: options.leftWrist.x, y: options.leftWrist.y, visibility: 0.92 };
  return lm;
}

function blankLandmarks(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
}

/** Right-arm raise sequence from shoulder-abduction-reach-pose-detector.test.ts */
function restingRightDetectorStyle(): PoseLandmark[] {
  const lm = blankLandmarks();
  lm[R_HIP] = { x: 0.5, y: 0.6, visibility: 0.95 };
  lm[R_SHOULDER] = { x: 0.5, y: 0.35, visibility: 0.95 };
  lm[R_ELBOW] = { x: 0.5, y: 0.55, visibility: 0.95 };
  lm[R_WRIST] = { x: 0.5, y: 0.7, visibility: 0.9 };
  lm[L_HIP] = { x: 0.4, y: 0.6, visibility: 0.9 };
  lm[L_SHOULDER] = { x: 0.4, y: 0.35, visibility: 0.9 };
  lm[L_ELBOW] = { x: 0.4, y: 0.55, visibility: 0.9 };
  lm[L_WRIST] = { x: 0.4, y: 0.7, visibility: 0.9 };
  return lm;
}

function peakRightDetectorStyle(): PoseLandmark[] {
  const lm = restingRightDetectorStyle();
  lm[R_ELBOW] = { x: 0.75, y: 0.35, visibility: 0.95 };
  lm[R_WRIST] = { x: 0.95, y: 0.35, visibility: 0.9 };
  return lm;
}

function peakRightDetectorStyleWithLean(): PoseLandmark[] {
  const lm = peakRightDetectorStyle();
  lm[R_SHOULDER] = { x: 0.62, y: 0.35, visibility: 0.95 };
  return lm;
}

function mirrorLandmarksHorizontal(landmarks: PoseLandmark[]): PoseLandmark[] {
  const mirrored = blankLandmarks();
  const swap = (leftIndex: number, rightIndex: number) => {
    mirrored[leftIndex] = {
      x: 1 - landmarks[rightIndex].x,
      y: landmarks[rightIndex].y,
      visibility: landmarks[rightIndex].visibility,
    };
    mirrored[rightIndex] = {
      x: 1 - landmarks[leftIndex].x,
      y: landmarks[leftIndex].y,
      visibility: landmarks[leftIndex].visibility,
    };
  };
  swap(L_SHOULDER, R_SHOULDER);
  swap(L_ELBOW, R_ELBOW);
  swap(L_WRIST, R_WRIST);
  swap(L_HIP, R_HIP);
  return mirrored;
}

function restingLeftMirrored(): PoseLandmark[] {
  return mirrorLandmarksHorizontal(restingRightDetectorStyle());
}

function peakLeftMirrored(): PoseLandmark[] {
  return mirrorLandmarksHorizontal(peakRightDetectorStyle());
}

function peakLeftMirroredWithLean(): PoseLandmark[] {
  return mirrorLandmarksHorizontal(peakRightDetectorStyleWithLean());
}

function driveDetector(
  side: ShoulderAbductionReachSide,
  sequence: PoseLandmark[][],
): {
  peakAngle: number | null;
  repCount: number;
  compensationFlagged: boolean;
  primaryWristRaw: NormalizedPoint | null;
  previewWrist: NormalizedPoint | null;
} {
  const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, side);
  const internals = detector as unknown as {
    processFrame: (landmarks: PoseLandmark[] | null, capturedAtMs: number) => void;
  };
  for (let i = 0; i < sequence.length; i += 1) {
    internals.processFrame(sequence[i] ?? null, T0 + i * 33);
  }
  const snap = detector.getSnapshot();
  const measured = snap.primaryWristNormalized;
  return {
    peakAngle: snap.primaryPeakAngleDegrees,
    repCount: snap.primaryRepCount,
    compensationFlagged: snap.compensationFlagged,
    primaryWristRaw: measured,
    previewWrist: measured ? toMirroredPreviewPoint(measured) : null,
  };
}

function restingWristPreview(side: ShoulderAbductionReachSide): NormalizedPoint {
  return side === "right" ? { x: 0.05, y: 0.95 } : { x: 0.95, y: 0.95 };
}

function advanceToSuccessor(
  state: TargetLifecycleState,
  side: ShoulderAbductionReachSide,
  seed: number,
  nowMs: number,
) {
  const result = tickTargetLifecycle(state, {
    wrist: restingWristPreview(side),
    nowMs,
    side,
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    random: () => seed,
    hitExitTransitionMs: 0,
  });
  assert.ok(result.state.currentTarget, "expected successor target");
  return result;
}

function simulateReachTheLight(side: ShoulderAbductionReachSide, seeds: readonly number[]) {
  let state = createInitialTargetLifecycle();
  let nowMs = T0;
  let hits = 0;
  const reactionTimes: number[] = [];
  const collisionRadius = DEFAULT_TARGET_HIT_CONFIG.collisionRadius;
  const resting = restingWristPreview(side);

  let spawned = tickTargetLifecycle(state, {
    wrist: resting,
    nowMs,
    side,
    bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    random: () => seeds[0] ?? 0.5,
    hitExitTransitionMs: 0,
  });
  state = spawned.state;
  nowMs += 33;

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index] ?? 0.5;

    if (!state.currentTarget) {
      const next = advanceToSuccessor(state, side, seed, nowMs);
      state = next.state;
      nowMs += 33;
    }

    const target = state.currentTarget;
    if (!target) break;

    const outside: NormalizedPoint =
      side === "right"
        ? { x: target.x + collisionRadius * 2.5, y: target.y }
        : { x: target.x - collisionRadius * 2.5, y: target.y };

    let ticked = tickTargetLifecycle(state, {
      wrist: outside,
      nowMs,
      side,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => seed,
      hitExitTransitionMs: 0,
    });
    state = ticked.state;
    nowMs += 33;

    ticked = tickTargetLifecycle(state, {
      wrist: { x: target.x, y: target.y },
      nowMs,
      side,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: () => seed,
      hitExitTransitionMs: 0,
    });
    if (ticked.hitEvent) {
      hits += 1;
      reactionTimes.push(ticked.hitEvent.reactionTimeMs);
    }
    state = ticked.state;
    nowMs += 33;

    for (let wait = 0; wait < 6; wait += 1) {
      ticked = tickTargetLifecycle(state, {
        wrist: resting,
        nowMs,
        side,
        bounds: DEFAULT_SAFE_TARGET_BOUNDS,
        random: () => seed,
        hitExitTransitionMs: 0,
      });
      state = ticked.state;
      nowMs += 33;
      if (!state.currentTarget && !state.exitingTarget) break;
    }
  }

  return { hits, reactionTimes };
}

function simulateD1Completion(side: ShoulderAbductionReachSide) {
  const pattern = resolveActiveMotionPattern(D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE, side)!;
  let state = createInitialPatternLifecycle(pattern.id);
  let completionCount = 0;

  for (let step = 0; step <= 24; step += 1) {
    const progress = 0.05 + (0.93 * step) / 24;
    const ticked = tickPatternLifecycle(state, {
      wrist: samplePathAtProgress(pattern.sampledPath, progress),
      nowMs: T0 + step * 50,
      pattern,
      completionExitTransitionMs: 0,
    });
    state = ticked.state;
    if (ticked.completionEvent) completionCount += 1;
  }

  return {
    completionCount,
    patternsCompleted: state.interaction.patternsCompleted,
    furthestProgress: state.furthestProgress,
  };
}

function compensationFlagAfterSequence(
  side: ShoulderAbductionReachSide,
  resting: PoseLandmark[],
  peak: PoseLandmark[],
  leanPeak: PoseLandmark[],
): boolean {
  const state = createShoulderAbductionReachCompensationState();
  const sequence: Array<{ landmarks: PoseLandmark[]; isResting: boolean }> = [
    { landmarks: resting, isResting: true },
    { landmarks: resting, isResting: true },
    { landmarks: peak, isResting: false },
    { landmarks: peak, isResting: false },
    { landmarks: leanPeak, isResting: false },
    { landmarks: leanPeak, isResting: false },
  ];
  for (const step of sequence) {
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(step.landmarks, {
      frameIndex: 0,
      capturedAtMs: T0,
    });
    if (!frame) continue;
    updateShoulderAbductionReachCompensation(state, frame, side, step.isResting);
  }
  return state.flagged;
}

function angleForLandmarks(side: ShoulderAbductionReachSide, landmarks: PoseLandmark[]): number | null {
  const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, {
    frameIndex: 0,
    capturedAtMs: T0,
  });
  if (!frame) return null;
  return computeShoulderAbductionReachSideMetrics(
    frame,
    side,
    DEFAULT_SHOULDER_ABDUCTION_REACH_THRESHOLDS.minJointConfidence,
  ).abductionAngleDegrees;
}

describe("interactive-shoulder laterality equivalence QA", () => {
  it("uses ipsilateral wrist joints for treated-side measurement", () => {
    assert.equal(SHOULDER_ABDUCTION_REACH_BONUS_JOINTS.right.wrist, "right_wrist");
    assert.equal(SHOULDER_ABDUCTION_REACH_BONUS_JOINTS.left.wrist, "left_wrist");

    const right = driveDetector("right", [peakRightDetectorStyle()]);
    const left = driveDetector("left", [peakLeftMirrored()]);

    assert.ok(right.primaryWristRaw);
    assert.ok(left.primaryWristRaw);
    assert.ok(right.primaryWristRaw.x > 0.5, "right treated wrist tracks the raised right arm");
    assert.ok(left.primaryWristRaw.x < 0.5, "left treated wrist tracks the mirrored raised left arm");
  });

  it("mirrors preview wrist while keeping raw measurement geometry separate", () => {
    const right = driveDetector("right", [peakRightDetectorStyle()]);
    const left = driveDetector("left", [peakLeftMirrored()]);

    assert.ok(right.previewWrist && left.previewWrist);
    assert.ok(Math.abs(right.previewWrist.x - (1 - left.previewWrist.x)) < 0.02);
    assert.equal(right.previewWrist.y, left.previewWrist.y);
    assert.notEqual(right.primaryWristRaw!.x, right.previewWrist.x);
  });

  it("produces equivalent Reach the Light hits for mirrored RIGHT and LEFT sessions", () => {
    const right = simulateReachTheLight("right", REACH_SEEDS);
    const left = simulateReachTheLight("left", REACH_SEEDS);

    assert.equal(right.hits, left.hits);
    assert.equal(right.hits, REACH_SEEDS.length);
    assert.deepEqual(right.reactionTimes, left.reactionTimes);
  });

  it("uses the same collision radius and entry-edge hit rules on both sides", () => {
    const radius = DEFAULT_TARGET_HIT_CONFIG.collisionRadius;
    const target: NormalizedPoint = { x: 0.72, y: 0.4 };
    const rightWrist = { x: 0.72 + radius * 0.5, y: 0.4 };
    const leftWrist = { x: 0.28 - radius * 0.5, y: 0.4 };

    assert.equal(isWristInsideTarget(rightWrist, target, DEFAULT_TARGET_HIT_CONFIG), true);
    assert.equal(isWristInsideTarget(leftWrist, { x: 0.28, y: 0.4 }, DEFAULT_TARGET_HIT_CONFIG), true);
  });

  it("completes mirrored D1 paths equivalently", () => {
    const right = simulateD1Completion("right");
    const left = simulateD1Completion("left");

    assert.equal(right.completionCount, left.completionCount);
    assert.equal(right.completionCount, 1);
    assert.equal(right.patternsCompleted, left.patternsCompleted);
    assert.ok(Math.abs(right.furthestProgress - left.furthestProgress) < 0.001);
  });

  it("counts equivalent movement-cycle rep events on mirrored raise sequences", () => {
    const rightEvents: ShoulderAbductionReachMeasuredEvent[] = [];
    const leftEvents: ShoulderAbductionReachMeasuredEvent[] = [];

    const rightDetector = new ShoulderAbductionReachPoseDetector(
      { onSnapshot: () => {}, onMeasuredEvent: (event) => rightEvents.push(event) },
      "right",
    );
    const leftDetector = new ShoulderAbductionReachPoseDetector(
      { onSnapshot: () => {}, onMeasuredEvent: (event) => leftEvents.push(event) },
      "left",
    );

    const rightInternals = rightDetector as unknown as {
      processFrame: (landmarks: PoseLandmark[] | null, capturedAtMs: number) => void;
    };
    const leftInternals = leftDetector as unknown as {
      processFrame: (landmarks: PoseLandmark[] | null, capturedAtMs: number) => void;
    };

    const sequence = [
      restingRightDetectorStyle(),
      restingRightDetectorStyle(),
      peakRightDetectorStyle(),
      peakRightDetectorStyle(),
      restingRightDetectorStyle(),
      restingRightDetectorStyle(),
    ];
    const mirroredSequence = sequence.map((landmarks) => mirrorLandmarksHorizontal(landmarks));

    sequence.forEach((landmarks, index) => {
      rightInternals.processFrame(landmarks, T0 + index * 33);
    });
    mirroredSequence.forEach((landmarks, index) => {
      leftInternals.processFrame(landmarks, T0 + index * 33);
    });

    assert.equal(rightDetector.getSnapshot().primaryRepCount, leftDetector.getSnapshot().primaryRepCount);
    assert.equal(rightEvents.filter((event) => event.type === "repCompleted").length, 1);
    assert.equal(leftEvents.filter((event) => event.type === "repCompleted").length, 1);
  });

  it("keeps shoulder-angle and compensation equivalence within tolerance on mirrored poses", () => {
    const rightAngle = angleForLandmarks("right", peakRightDetectorStyle());
    const leftAngle = angleForLandmarks("left", peakLeftMirrored());
    assert.ok(rightAngle != null && leftAngle != null);
    assert.ok(Math.abs(rightAngle - leftAngle) < 3, `angle delta ${Math.abs(rightAngle - leftAngle)}°`);

    const rightComp = compensationFlagAfterSequence(
      "right",
      restingRightDetectorStyle(),
      peakRightDetectorStyle(),
      peakRightDetectorStyleWithLean(),
    );
    const leftComp = compensationFlagAfterSequence(
      "left",
      restingLeftMirrored(),
      peakLeftMirrored(),
      peakLeftMirroredWithLean(),
    );
    assert.equal(rightComp, leftComp);
    assert.equal(rightComp, true);
  });

  it("does not let the opposite wrist trigger treated-side target hits", () => {
    const rightTarget = { x: 0.72, y: 0.4 };
    const rightTreatedPreview = driveDetector("right", [peakRightDetectorStyle()]).previewWrist;
    const leftOnlyPreview = driveDetector("left", [
      facingCameraLandmarks({
        rightWrist: { x: 0.42, y: 0.7 },
        leftWrist: { x: 0.72, y: 0.4 },
      }),
    ]).previewWrist;

    assert.ok(rightTreatedPreview);
    assert.ok(leftOnlyPreview);
    assert.equal(
      isWristInsideTarget(rightTreatedPreview, rightTarget, DEFAULT_TARGET_HIT_CONFIG),
      false,
      "opposite-side-only movement must not satisfy a right-biased target via treated wrist",
    );
    assert.equal(
      isWristInsideTarget(leftOnlyPreview, rightTarget, DEFAULT_TARGET_HIT_CONFIG),
      false,
      "non-treated wrist in preview space must not be used as the right treated wrist",
    );
  });

  it("reports zero timing delta for mirrored Reach the Light reaction times", () => {
    const right = simulateReachTheLight("right", REACH_SEEDS);
    const left = simulateReachTheLight("left", REACH_SEEDS);
    const maxDelta = right.reactionTimes.reduce((max, value, index) => {
      const other = left.reactionTimes[index] ?? 0;
      return Math.max(max, Math.abs(value - other));
    }, 0);
    assert.ok(maxDelta <= TIMING_TOLERANCE_MS, `timing delta ${maxDelta}ms`);
  });
});
