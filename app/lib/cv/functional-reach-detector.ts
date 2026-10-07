/**
 * CV Lab / internal Functional Reach rep detector (foundation only).
 * Sagittal leading wrist–shoulder reach extent — forward reach attempt detection.
 */

import type { CvTrackingQuality } from "@/app/lib/cv/bio-0-contracts";
import { evaluateBodyFraming, type BodyFramingState } from "@/app/lib/cv/body-framing-evaluator";
import { STANDING_SAGITTAL_REP_FRAMING_PROFILE } from "@/app/lib/cv/body-framing-profiles";
import {
  emptyVisibilityLabelCounts,
  summarizeSessionVisibility,
  type VisibilityLabelCounts,
} from "@/app/lib/cv/session-visibility-summary";
import {
  computeTorsoSpan,
  createSagittalHipRepState,
  maybeFinalizeBaseline,
  resetSagittalHipRepBaseline,
  tickSagittalHipRepBaseline,
  type PoseLandmark,
  type SagittalHipRepBaselineConfig,
  type SagittalHipRepPhase,
  type SagittalHipRepState,
} from "@/app/lib/cv/sagittal-hip-rep-core";

export type FunctionalReachDerivedMetrics = {
  exerciseId: "functional-reach";
  repCount: number;
  sessionDurationS: number;
  trackingQuality: CvTrackingQuality;
  movementDetected: boolean;
  framesWithPose: number;
  framesTotal: number;
};

export type FunctionalReachRepConfig = SagittalHipRepBaselineConfig & {
  minShoulderVisibility: number;
  minWristVisibility: number;
  visibilityGood: number;
  visibilityFair: number;
  minSaveDurationS: number;
};

/** CV Lab starting config — separate from PATIENT_FUNCTIONAL_REACH_REP_CONFIG. */
export const LAB_FUNCTIONAL_REACH_REP_CONFIG: FunctionalReachRepConfig = {
  baselineDurationMs: 2_500,
  fallbackBaselineHipY: 0.08,
  baselineScaleByTorso: true,
  baselinePrimaryDelta: 0.05,
  baselineResetDelta: 0.025,
  baselinePrimaryDeltaRatio: 0.14,
  baselineResetDeltaRatio: 0.07,
  baselinePrimaryDeltaMin: 0.025,
  baselineResetDeltaMin: 0.012,
  minMsBetweenReps: 700,
  minShoulderVisibility: 0.3,
  minWristVisibility: 0.28,
  visibilityGood: 1.0,
  visibilityFair: 0.6,
  minSaveDurationS: 3,
};

export type FunctionalReachRepCounterSnapshot = {
  repCount: number;
  repPhase: SagittalHipRepPhase;
  baselineReachExtent: number | null;
  isBaselineCalibrating: boolean;
  movementDetected: boolean;
};

export type FunctionalReachDetectorSnapshot = FunctionalReachRepCounterSnapshot & {
  trackingStatus: "idle" | "detecting" | "pose-found" | "pose-lost";
  trackingQuality: CvTrackingQuality | null;
  bodyFramingState: BodyFramingState;
  sessionSeconds: number;
  framesWithPose: number;
  framesTotal: number;
};

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

export type LeadingReachLandmarks = {
  shoulderX: number;
  wristX: number;
  visSum: number;
};

export function resolveLeadingReachLandmarks(landmarks: PoseLandmark[]): LeadingReachLandmarks | null {
  const leftVis =
    (landmarks[L_SHOULDER]?.visibility ?? 0) + (landmarks[L_WRIST]?.visibility ?? 0);
  const rightVis =
    (landmarks[R_SHOULDER]?.visibility ?? 0) + (landmarks[R_WRIST]?.visibility ?? 0);
  if (leftVis <= 0 && rightVis <= 0) return null;

  if (leftVis >= rightVis) {
    return {
      shoulderX: landmarks[L_SHOULDER]?.x ?? 0,
      wristX: landmarks[L_WRIST]?.x ?? 0,
      visSum: leftVis,
    };
  }
  return {
    shoulderX: landmarks[R_SHOULDER]?.x ?? 0,
    wristX: landmarks[R_WRIST]?.x ?? 0,
    visSum: rightVis,
  };
}

/** Forward reach extent in normalized image X (leading wrist ahead of ipsilateral shoulder). */
export function computeReachExtent(landmarks: PoseLandmark[]): number | null {
  const leading = resolveLeadingReachLandmarks(landmarks);
  if (!leading) return null;
  return Math.max(0, leading.wristX - leading.shoulderX);
}

export type ReachExtentSide = "left" | "right";

const REACH_SIDE_INDICES: Record<ReachExtentSide, { shoulder: number; wrist: number }> = {
  left: { shoulder: L_SHOULDER, wrist: L_WRIST },
  right: { shoulder: R_SHOULDER, wrist: R_WRIST },
};

/** Forward reach extent for a single tested arm (battery side-view flow). */
export function computeReachExtentForSide(
  landmarks: PoseLandmark[],
  side: ReachExtentSide,
): number | null {
  const indices = REACH_SIDE_INDICES[side];
  const shoulder = landmarks[indices.shoulder];
  const wrist = landmarks[indices.wrist];
  if (!shoulder || !wrist) return null;
  return Math.max(0, wrist.x - shoulder.x);
}

export function reachLandmarksMeetMinVisibility(
  landmarks: PoseLandmark[],
  config: Pick<FunctionalReachRepConfig, "minShoulderVisibility" | "minWristVisibility">,
): boolean {
  const leftShoulder = landmarks[L_SHOULDER]?.visibility ?? 0;
  const rightShoulder = landmarks[R_SHOULDER]?.visibility ?? 0;
  const leftWrist = landmarks[L_WRIST]?.visibility ?? 0;
  const rightWrist = landmarks[R_WRIST]?.visibility ?? 0;
  const shoulderOk = leftShoulder >= config.minShoulderVisibility || rightShoulder >= config.minShoulderVisibility;
  const wristOk = leftWrist >= config.minWristVisibility || rightWrist >= config.minWristVisibility;
  return shoulderOk && wristOk;
}

export function evaluateReachTrackingQuality(
  landmarks: PoseLandmark[],
  visibilityGood: number,
  visibilityFair: number,
): CvTrackingQuality {
  const leading = resolveLeadingReachLandmarks(landmarks);
  const visSum = leading?.visSum ?? 0;
  if (visSum >= visibilityGood) return "good";
  if (visSum >= visibilityFair) return "fair";
  if (visSum > 0) return "poor";
  return "unknown";
}

/**
 * Frame-driven functional-reach rep engine (rise polarity on forward reach extent).
 */
export class FunctionalReachRepCounter {
  private readonly config: FunctionalReachRepConfig;
  private readonly state: SagittalHipRepState = createSagittalHipRepState();
  private movementDetected = false;

  constructor(config: FunctionalReachRepConfig = LAB_FUNCTIONAL_REACH_REP_CONFIG) {
    this.config = config;
  }

  get repCount(): number {
    return this.state.repCount;
  }

  get repPhase(): SagittalHipRepPhase {
    return this.state.repPhase;
  }

  get baselineReachExtent(): number | null {
    return this.state.baselineHipY;
  }

  get isBaselineCalibrating(): boolean {
    return this.state.isBaselineCalibrating;
  }

  resetReps(): void {
    this.state.repCount = 0;
    this.state.repPhase = "rest";
    this.state.lastRepAtMs = 0;
  }

  resetBaseline(): void {
    resetSagittalHipRepBaseline(this.state);
    this.state.repCount = 0;
  }

  startBaselineWindow(nowMs: number): void {
    if (this.state.baselineHipY !== null || this.state.baselineWindowEndMs > 0) return;
    this.state.baselineWindowEndMs = nowMs + this.config.baselineDurationMs;
    this.state.isBaselineCalibrating = true;
  }

  updateRepCountFromReachExtent(reachExtent: number, nowMs: number, torsoSpan: number | null): void {
    this.movementDetected = true;
    tickSagittalHipRepBaseline({
      state: this.state,
      polarity: "rise",
      hipY: reachExtent,
      nowMs,
      torsoSpan,
      config: this.config,
      canCollectBaseline: this.state.baselineWindowEndMs > 0,
      canIncrementReps: (s) => s.baselineHipY !== null,
    });
  }

  driveFrame(reachExtent: number, nowMs: number, torsoSpan: number | null = 0.25): void {
    this.updateRepCountFromReachExtent(reachExtent, nowMs, torsoSpan);
  }

  getSnapshot(): FunctionalReachRepCounterSnapshot {
    return {
      repCount: this.state.repCount,
      repPhase: this.state.repPhase,
      baselineReachExtent: this.state.baselineHipY,
      isBaselineCalibrating: this.state.isBaselineCalibrating,
      movementDetected: this.movementDetected,
    };
  }

  getDerivedMetrics(
    sessionDurationS: number,
    framesWithPose: number,
    framesTotal: number,
    trackingQuality: CvTrackingQuality = "unknown",
  ): FunctionalReachDerivedMetrics {
    return {
      exerciseId: "functional-reach",
      repCount: this.state.repCount,
      sessionDurationS,
      trackingQuality,
      movementDetected: this.movementDetected && this.state.repCount > 0,
      framesWithPose,
      framesTotal,
    };
  }
}

export type FunctionalReachDetectorOptions = {
  useBodyFraming?: boolean;
};

/**
 * Landmark-driven functional-reach detector for CV Lab / unit tests.
 */
export class FunctionalReachDetector {
  private readonly config: FunctionalReachRepConfig;
  private readonly options: FunctionalReachDetectorOptions;
  private readonly counter: FunctionalReachRepCounter;
  private sessionStartMs: number | null = null;
  private sessionEndMs: number | null = null;
  private lastFrameMs = 0;
  private framesWithPose = 0;
  private framesTotal = 0;
  private visibilityLabelCounts: VisibilityLabelCounts = emptyVisibilityLabelCounts();
  private reachVisSamples: number[] = [];
  private lastTrackingQuality: CvTrackingQuality | null = null;
  private bodyFramingState: BodyFramingState = "checking";

  constructor(
    config: FunctionalReachRepConfig = LAB_FUNCTIONAL_REACH_REP_CONFIG,
    options: FunctionalReachDetectorOptions = {},
  ) {
    this.config = config;
    this.options = options;
    this.counter = new FunctionalReachRepCounter(config);
  }

  startSession(nowMs: number): void {
    this.sessionStartMs = nowMs;
    this.sessionEndMs = null;
    this.lastFrameMs = nowMs;
    this.framesWithPose = 0;
    this.framesTotal = 0;
    this.visibilityLabelCounts = emptyVisibilityLabelCounts();
    this.reachVisSamples = [];
    this.lastTrackingQuality = null;
    this.bodyFramingState = "checking";
    this.counter.resetBaseline();
    this.counter.startBaselineWindow(nowMs);
  }

  endSession(nowMs: number): void {
    this.sessionEndMs = nowMs;
  }

  reset(): void {
    this.sessionStartMs = null;
    this.sessionEndMs = null;
    this.lastFrameMs = 0;
    this.framesWithPose = 0;
    this.framesTotal = 0;
    this.visibilityLabelCounts = emptyVisibilityLabelCounts();
    this.reachVisSamples = [];
    this.lastTrackingQuality = null;
    this.bodyFramingState = "checking";
    this.counter.resetBaseline();
  }

  driveFrame(landmarks: PoseLandmark[], nowMs: number): void {
    if (this.sessionStartMs === null) {
      this.startSession(nowMs);
    }
    this.lastFrameMs = nowMs;
    this.framesTotal += 1;

    const trackingQuality = evaluateReachTrackingQuality(
      landmarks,
      this.config.visibilityGood,
      this.config.visibilityFair,
    );
    this.lastTrackingQuality = trackingQuality;

    if (this.options.useBodyFraming !== false) {
      this.bodyFramingState = evaluateBodyFraming(
        landmarks,
        STANDING_SAGITTAL_REP_FRAMING_PROFILE,
        {
          checking: false,
          trackingQuality: trackingQuality === "unknown" ? null : trackingQuality,
        },
      );
    }

    if (!reachLandmarksMeetMinVisibility(landmarks, this.config)) {
      return;
    }

    const reachExtent = computeReachExtent(landmarks);
    if (reachExtent === null) return;

    this.framesWithPose += 1;
    const leading = resolveLeadingReachLandmarks(landmarks);
    if (leading) {
      this.reachVisSamples.push(leading.visSum);
    }
    this.visibilityLabelCounts[trackingQuality === "unknown" ? "poor" : trackingQuality] += 1;

    const torsoSpan = computeTorsoSpan(landmarks);
    this.counter.driveFrame(reachExtent, nowMs, torsoSpan);
  }

  getSnapshot(): FunctionalReachDetectorSnapshot {
    const sessionSeconds = this.resolveSessionSeconds();
    return {
      ...this.counter.getSnapshot(),
      trackingStatus: this.resolveTrackingStatus(),
      trackingQuality: this.lastTrackingQuality,
      bodyFramingState: this.bodyFramingState,
      sessionSeconds,
      framesWithPose: this.framesWithPose,
      framesTotal: this.framesTotal,
    };
  }

  getDerivedMetrics(): FunctionalReachDerivedMetrics {
    const sessionSeconds = this.resolveSessionSeconds();
    const trackingQuality = summarizeSessionVisibility({
      hipVisSamples: this.reachVisSamples,
      labelCounts: this.visibilityLabelCounts,
      framesWithPose: this.framesWithPose,
      visibilityGood: this.config.visibilityGood,
      visibilityFair: this.config.visibilityFair,
    });
    return this.counter.getDerivedMetrics(
      sessionSeconds,
      this.framesWithPose,
      this.framesTotal,
      trackingQuality,
    );
  }

  canSaveMetrics(): boolean {
    const metrics = this.getDerivedMetrics();
    return (
      metrics.sessionDurationS >= this.config.minSaveDurationS &&
      metrics.movementDetected &&
      metrics.repCount > 0
    );
  }

  private resolveSessionSeconds(): number {
    if (this.sessionStartMs === null) return 0;
    const endMs = this.sessionEndMs ?? this.lastFrameMs;
    if (endMs < this.sessionStartMs) return 0;
    return Math.floor((endMs - this.sessionStartMs) / 1_000);
  }

  private resolveTrackingStatus(): FunctionalReachDetectorSnapshot["trackingStatus"] {
    if (this.sessionStartMs === null) return "idle";
    if (this.framesWithPose === 0) return "detecting";
    if (this.framesWithPose === this.framesTotal) return "pose-found";
    return "pose-lost";
  }
}

/** @internal Test helper — build landmarks with given forward reach extent. */
export function mockFunctionalReachLandmarks(reachExtent: number, vis = 0.65): PoseLandmark[] {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: vis,
  }));
  const shoulderX = 0.42;
  const wristX = shoulderX + Math.max(0, reachExtent);
  landmarks[0] = { x: 0.5, y: 0.12, visibility: 0.85 };
  landmarks[L_SHOULDER] = { x: shoulderX, y: 0.32, visibility: vis };
  landmarks[R_SHOULDER] = { x: 0.58, y: 0.32, visibility: vis * 0.8 };
  landmarks[L_WRIST] = { x: wristX, y: 0.38, visibility: vis };
  landmarks[R_WRIST] = { x: 0.62, y: 0.42, visibility: vis * 0.7 };
  landmarks[L_HIP] = { x: 0.45, y: 0.55, visibility: vis };
  landmarks[R_HIP] = { x: 0.55, y: 0.55, visibility: vis };
  landmarks[25] = { x: 0.45, y: 0.68, visibility: vis };
  landmarks[26] = { x: 0.55, y: 0.68, visibility: vis };
  landmarks[27] = { x: 0.45, y: 0.82, visibility: vis };
  landmarks[28] = { x: 0.55, y: 0.82, visibility: vis };
  return landmarks;
}
