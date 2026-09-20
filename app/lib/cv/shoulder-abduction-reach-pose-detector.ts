/**
 * Shoulder Abduction Reach — live pose-detector wrapper (PR1: live CV wiring).
 *
 * Owns the MediaPipe/camera/canvas capture lifecycle and drives the existing
 * shoulder-rehabilitation pure-function module (contract/metrics/phase/
 * detector — unmodified by this file) frame by frame. This is the first
 * real camera wiring that module has ever had; its own header comment says
 * so directly ("not wired into any live capture loop, component, or API
 * route"). Camera/MediaPipe lifecycle code below mirrors
 * `single-leg-stance-pose-detector.ts` — the same proven shell every other
 * patient-portal CV exercise already uses.
 *
 * Measurement source only. This class has no knowledge of session duration,
 * blocks, work/rest schedule, or completion — it emits discrete measured
 * events and exposes a snapshot. A future Session Orchestrator (PR2) and
 * Session Environment (PR3) decide what happens with that information.
 */

import {
  createShoulderAbductionReachDetectorState,
  updateShoulderAbductionReachDetector,
  extractShoulderAbductionReachArmGeometry,
  EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY,
  SHOULDER_ABDUCTION_REACH_BONUS_JOINTS,
  type ShoulderAbductionReachArmGeometry,
  type ShoulderAbductionReachDetectorState,
  type ShoulderAbductionReachFrameResult,
  type ShoulderAbductionReachSide,
} from "@/app/lib/shoulder-rehabilitation";
import { BLAZEPOSE_ACQUISITION_ADAPTER, type InputAcquisitionContext } from "@/app/lib/input-acquisition";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { drawPoseLandmarkDots } from "@/app/lib/cv/pose-landmark-overlay";
import {
  createShoulderAbductionReachCompensationState,
  updateShoulderAbductionReachCompensation,
  type ShoulderAbductionReachCompensationState,
} from "@/app/lib/cv/shoulder-abduction-reach-compensation";
import { DEFAULT_STS_CONFIG } from "@/app/lib/cv/bio-0-contracts";
import { UPPER_LIMB_REACH_FRAMING_PROFILE } from "@/app/lib/cv/body-framing-profiles";
import { drawBodyFramingOverlay, evaluateBodyFraming, type BodyFramingState } from "@/app/lib/cv/body-framing-evaluator";
import {
  PATIENT_CAMERA_NO_FRAMES_ERROR,
  releaseMediaStream,
  waitForVideoElementLayout,
} from "@/app/lib/cv/patient-camera-stream";
import {
  createPoseLandmarker,
  getSitToStandBrowserSupportError,
  mapSitToStandStartError,
  needsSitToStandSecureContext,
  startVideoPlayback,
  withSitToStandTimeout,
  type PoseReadiness,
  type SitToStandInitPhase,
} from "@/app/lib/cv/sit-to-stand-detector";

export { mapSitToStandStartError as mapShoulderAbductionReachStartError };
export type { SitToStandInitPhase as ShoulderAbductionReachInitPhase };

type PoseLandmarkerInstance = {
  detectForVideo: (
    video: HTMLVideoElement,
    ts: number,
  ) => { landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>> };
  close?: () => void;
};

export type ShoulderAbductionReachTrackingQuality = "good" | "fair" | "poor" | "unknown";
export type ShoulderAbductionReachTrackingStatus = "idle" | "tracking" | "lost" | "error";

export type ShoulderAbductionReachPoseDetectorSnapshot = {
  trackingStatus: ShoulderAbductionReachTrackingStatus;
  trackingQuality: ShoulderAbductionReachTrackingQuality;
  bodyFramingState: BodyFramingState;
  primarySide: ShoulderAbductionReachSide;
  primaryPhase: ShoulderAbductionReachFrameResult["left"]["phase"];
  primaryRepCount: number;
  primaryPeakAngleDegrees: number | null;
  bilateralAngleDifferenceDegrees: number | null;
  compensationFlagged: boolean;
  framesWithPose: number;
  framesTotal: number;
  initPhase: SitToStandInitPhase;
  previewActive: boolean;
  trackingError: string | null;
  /** Primary-side wrist in normalized preview coordinates for interactive target UI. */
  primaryWristNormalized: { x: number; y: number } | null;
  /**
   * Affected-side shoulder in the same normalized preview space — the anchor for
   * adaptive target-placement geometry. Optional so existing consumers keep compiling.
   */
  primaryShoulderNormalized?: { x: number; y: number } | null;
  /** Affected-side elbow in the same normalized preview space. */
  primaryElbowNormalized?: { x: number; y: number } | null;
  /**
   * shoulder→elbow plus elbow→wrist normalized distance, or null when any of the
   * three joints fails the existing presence rule. Never a fabricated default.
   * An on-screen reach scale, NOT an anthropometric or clinical measurement.
   */
  estimatedArmLengthNormalized?: number | null;
};

/**
 * Discrete measured events, emitted on state transitions only (never once
 * per frame). Concrete to this detector — a future adapter (PR3) is
 * responsible for translating these into the Session Orchestrator's
 * generic input-event vocabulary; this file does not import or know about
 * that vocabulary.
 */
export type ShoulderAbductionReachMeasuredEvent =
  | {
      type: "repCompleted";
      side: ShoulderAbductionReachSide;
      repCount: number;
      peakAngleDegrees: number | null;
      capturedAtMs: number;
    }
  | { type: "compensationDetected"; side: ShoulderAbductionReachSide; capturedAtMs: number }
  | { type: "compensationCleared"; side: ShoulderAbductionReachSide; capturedAtMs: number }
  | { type: "trackerLost"; capturedAtMs: number }
  | { type: "trackerRecovered"; capturedAtMs: number };

export type ShoulderAbductionReachDerivedMetrics = {
  exerciseId: "shoulder-abduction-reach";
  primarySide: ShoulderAbductionReachSide;
  repCount: number;
  sessionDurationS: number;
  trackingQuality: ShoulderAbductionReachTrackingQuality;
  movementDetected: boolean;
  framesWithPose: number;
  framesTotal: number;
};

export type ShoulderAbductionReachPoseDetectorCallbacks = {
  onSnapshot: (snapshot: ShoulderAbductionReachPoseDetectorSnapshot) => void;
  /** Optional — PR1 exposes the event stream; nothing subscribes to it in production yet. */
  onMeasuredEvent?: (event: ShoulderAbductionReachMeasuredEvent) => void;
  /**
   * Optional, dev-only hook — RASQ ML bridge Slice 1 (2026-08-19). Fires once per
   * frame that produced a usable `NormalizedMotionFrame`, alongside this frame's
   * primary-side phase/rep state, for a research capture recorder
   * (`app/lib/ml-research/shoulder-abduction-reach/rep-recorder.ts`) to consume.
   * Never invoked unless a caller explicitly supplies it — omitting it (every
   * existing caller) leaves this class's behavior completely unchanged. No
   * production caller wires this today.
   *
   * Does NOT include `peakAngleDegrees` (Slice 1.1, 2026-08-19): the phase
   * FSM's own running peak intentionally persists across the resting phase
   * (see `tickShoulderAbductionReachPhase`'s doc comment) and is correct for
   * that FSM's own purpose, but a real live-capture session showed it
   * leaking as a stale, carried-over value into unrelated downstream
   * research records when passed through. The recorder now computes its own
   * peak strictly from the frames it captured — see the Slice 1.1 project
   * report.
   */
  onDevFrameCaptured?: (input: {
    frame: NormalizedMotionFrame;
    capturedAtMs: number;
    phase: ShoulderAbductionReachFrameResult["left"]["phase"];
    repCount: number;
  }) => void;
};

const TRACKER_LOST_CONSECUTIVE_FRAMES = 10;
const MIN_SAVE_DURATION_S = 3;

/** MediaPipe shell — reuses the already-configured STS wasm/model URLs, not new values. */
const SHOULDER_ABDUCTION_REACH_POSE_SHELL = {
  wasmUrl: DEFAULT_STS_CONFIG.wasmUrl,
  modelUrl: DEFAULT_STS_CONFIG.modelUrl,
  canvasWidth: DEFAULT_STS_CONFIG.canvasWidth,
  canvasHeight: DEFAULT_STS_CONFIG.canvasHeight,
  initTimeoutMs: DEFAULT_STS_CONFIG.initTimeoutMs,
  /**
   * Snapshot publication cadence, in processed camera frames — deliberately NOT
   * `DEFAULT_STS_CONFIG.uiFrameUpdateInterval` (15). Issue #276.
   *
   * The shared default is tuned for the reporting-style detectors that consume it
   * (sit-to-stand, heel raise, functional reach, single-leg stance, step-up, lateral
   * step), whose snapshots carry slow clinical readouts — rep counts, hold seconds,
   * framing guidance — where a ~2 Hz refresh is invisible. It is left untouched here
   * for exactly that reason; this override is local to Shoulder Abduction Reach.
   *
   * Interactive Shoulder is the only surface that publishes an INTERACTIVE
   * measurement: `primaryWristNormalized` drives both the on-screen hand marker and
   * the target hit test. Since the decoded-frame dedup added in #258, `framesTotal`
   * counts real camera frames rather than rAF ticks, so an interval of 15 at ~30 fps
   * published a new wrist roughly every 500 ms — while MediaPipe had already computed
   * a fresh one on every one of those frames. The throttle was discarding
   * measurements that already existed, and `TrackedHandCursor` then smoothed toward
   * each stale value one lerp step per publication, compounding the visible lag.
   *
   * Publishing on every processed frame costs no additional inference: it emits what
   * the frame already computed. The dedup guard above still gates this — one
   * inference and at most one publication per decoded camera frame.
   */
  uiFrameUpdateInterval: 1,
  prototypeVersion: "cv-neuro-1-shoulder-abduction-reach",
} as const;

/**
 * Patient portal Shoulder Abduction Reach CV detector — bilateral angle
 * tracking via MediaPipe Pose. On-device only, no landmarks or video
 * persisted. Tracks both sides simultaneously (the underlying detector
 * state is inherently bilateral); `primarySide` selects which side's rep
 * count and compensation signal are treated as the reported measurement —
 * both sides' raw results remain available via the frame result.
 */
export class ShoulderAbductionReachPoseDetector {
  private consecutiveDetectErrors = 0;

  private readonly callbacks: ShoulderAbductionReachPoseDetectorCallbacks;
  private readonly primarySide: ShoulderAbductionReachSide;

  private detectorState: ShoulderAbductionReachDetectorState =
    createShoulderAbductionReachDetectorState();
  private compensationState: ShoulderAbductionReachCompensationState =
    createShoulderAbductionReachCompensationState();

  private animFrameId = 0;
  private stream: MediaStream | null = null;
  private poseLandmarker: PoseLandmarkerInstance | null = null;
  private sessionEpoch = 0;
  private previewActive = false;
  private initPhase: SitToStandInitPhase = null;
  private trackingError: string | null = null;
  private detectTimestamp = 0;
  private videoPauseHandler: (() => void) | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  private frameIndex = 0;
  private sessionStartMs = 0;
  private framesWithPose = 0;
  private framesTotal = 0;
  private consecutiveNoLandmarkFrames = 0;
  private trackerWasLost = false;
  private lastFrameResult: ShoulderAbductionReachFrameResult | null = null;
  private lastBodyFramingState: BodyFramingState = "checking";
  private lastPrimaryWristNormalized: { x: number; y: number } | null = null;
  private lastPrimaryArmGeometry: ShoulderAbductionReachArmGeometry =
    EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY;
  /**
   * The `<video>` element's own `currentTime` (seconds) at the last frame
   * actually processed. Slice 1.1 (2026-08-19) root-cause fix: `detect()`
   * runs once per `requestAnimationFrame` tick, which fires at the DISPLAY's
   * refresh rate (commonly 60-144Hz, i.e. every ~7-17ms) — NOT at the
   * camera's actual decode rate (commonly ~30fps, i.e. every ~33ms). A real
   * live-capture session showed captured-frame intervals of 11-14ms despite
   * a normal webcam, which traces directly to this: without this guard,
   * `detectForVideo` was re-run on the SAME underlying decoded video frame
   * multiple times per real camera frame, each re-timestamped as if it were
   * a new observation. `null` at session start / after `resetSessionState()`.
   */
  private lastProcessedVideoTimeS: number | null = null;

  constructor(
    callbacks: ShoulderAbductionReachPoseDetectorCallbacks,
    primarySide: ShoulderAbductionReachSide = "right",
  ) {
    this.callbacks = callbacks;
    this.primarySide = primarySide;
  }

  private primaryResult(result: ShoulderAbductionReachFrameResult) {
    return this.primarySide === "left" ? result.left : result.right;
  }

  private computeTrackingQuality(): ShoulderAbductionReachTrackingQuality {
    if (this.framesTotal === 0) return "unknown";
    const ratio = this.framesWithPose / this.framesTotal;
    if (ratio >= 0.85) return "good";
    if (ratio >= 0.5) return "fair";
    return "poor";
  }

  getSnapshot(): ShoulderAbductionReachPoseDetectorSnapshot {
    const result = this.lastFrameResult;
    const primary = result ? this.primaryResult(result) : null;
    return {
      trackingStatus: this.trackingError
        ? "error"
        : this.trackerWasLost
          ? "lost"
          : this.previewActive
            ? "tracking"
            : "idle",
      trackingQuality: this.computeTrackingQuality(),
      bodyFramingState: this.lastBodyFramingState,
      primarySide: this.primarySide,
      primaryPhase: primary?.phase ?? "resting",
      primaryRepCount: primary?.repCount ?? 0,
      primaryPeakAngleDegrees: primary?.peakAngleDegrees ?? null,
      bilateralAngleDifferenceDegrees: result?.bilateralAngleDifferenceDegrees ?? null,
      compensationFlagged: this.compensationState.flagged,
      framesWithPose: this.framesWithPose,
      framesTotal: this.framesTotal,
      initPhase: this.initPhase,
      previewActive: this.previewActive,
      trackingError: this.trackingError,
      primaryWristNormalized: this.lastPrimaryWristNormalized,
      primaryShoulderNormalized: this.lastPrimaryArmGeometry.shoulder,
      primaryElbowNormalized: this.lastPrimaryArmGeometry.elbow,
      estimatedArmLengthNormalized: this.lastPrimaryArmGeometry.estimatedArmLengthNormalized,
    };
  }

  getDerivedMetrics(): ShoulderAbductionReachDerivedMetrics {
    const sessionDurationS =
      this.sessionStartMs > 0 ? Math.round((performance.now() - this.sessionStartMs) / 1_000) : 0;
    const primary = this.lastFrameResult ? this.primaryResult(this.lastFrameResult) : null;
    return {
      exerciseId: "shoulder-abduction-reach",
      primarySide: this.primarySide,
      repCount: primary?.repCount ?? 0,
      sessionDurationS,
      trackingQuality: this.computeTrackingQuality(),
      movementDetected: (primary?.repCount ?? 0) > 0,
      framesWithPose: this.framesWithPose,
      framesTotal: this.framesTotal,
    };
  }

  canSaveMetrics(): boolean {
    return this.getDerivedMetrics().sessionDurationS >= MIN_SAVE_DURATION_S;
  }

  isPreviewActive(): boolean {
    return this.previewActive;
  }

  private emit(): void {
    this.callbacks.onSnapshot(this.getSnapshot());
  }

  /**
   * Clears every per-session measurement value. Called only from `start()` — this is
   * that single lifecycle boundary factored out so it can be exercised without a
   * camera, not a second way to reset the detector.
   */
  private resetSessionState(): void {
    this.detectorState = createShoulderAbductionReachDetectorState();
    this.compensationState = createShoulderAbductionReachCompensationState();
    this.frameIndex = 0;
    this.framesWithPose = 0;
    this.framesTotal = 0;
    this.consecutiveNoLandmarkFrames = 0;
    this.trackerWasLost = false;
    this.lastFrameResult = null;
    // Cached geometry is deliberately retained across a dropped frame *within* a
    // session (see `processFrame`), so the session boundary is the only place that can
    // clear it. Without this, the previous session's last wrist/shoulder/elbow position
    // stays readable through `getSnapshot()` until the new session's first valid frame.
    this.lastPrimaryWristNormalized = null;
    this.lastPrimaryArmGeometry = EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY;
    this.lastProcessedVideoTimeS = null;
    // Framing is written only by the live capture loop, and only for a frame that
    // actually produced landmarks — so it is cached across dropped frames exactly like
    // the geometry above. Back to the same "not yet evaluated" value the field is
    // constructed with, so the previous session's guidance ("move_closer", …) is not
    // shown against the new session before its own framing evaluation has run.
    this.lastBodyFramingState = "checking";
    this.consecutiveDetectErrors = 0;
  }

  /**
   * One live-capture loop iteration: deduplicates on `video.currentTime`, runs
   * MediaPipe inference when the decoded frame advanced, and feeds landmarks
   * into `processFrame`. Extracted from `start()` so the dedup guard can be
   * exercised behaviorally without a camera or MediaPipe model load.
   */
  private tickLiveVideoFrame(options?: { scheduleNext?: boolean }): void {
    if (!this.previewActive || !this.videoEl || !this.canvasEl) return;

    const ctx = this.canvasEl.getContext("2d");
    if (!ctx || !this.poseLandmarker) return;

    const { canvasWidth, canvasHeight, uiFrameUpdateInterval } = SHOULDER_ABDUCTION_REACH_POSE_SHELL;

    try {
      if (this.videoEl.paused && this.previewActive) {
        void this.videoEl.play().catch(() => undefined);
      }
      if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) {
        if (options?.scheduleNext !== false) {
          this.animFrameId = requestAnimationFrame(() => this.tickLiveVideoFrame());
        }
        return;
      }

      const currentVideoTimeS = this.videoEl.currentTime;
      if (this.lastProcessedVideoTimeS !== null && currentVideoTimeS === this.lastProcessedVideoTimeS) {
        if (options?.scheduleNext !== false) {
          this.animFrameId = requestAnimationFrame(() => this.tickLiveVideoFrame());
        }
        return;
      }
      this.lastProcessedVideoTimeS = currentVideoTimeS;

      this.detectTimestamp = Math.max(this.detectTimestamp + 1, performance.now());
      const nowMs = performance.now();
      const result = this.poseLandmarker.detectForVideo(this.videoEl, this.detectTimestamp);

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      this.consecutiveDetectErrors = 0;

      if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0] as PoseLandmark[];
        const trackingQuality = this.computeTrackingQuality();
        const framing = evaluateBodyFraming(landmarks, UPPER_LIMB_REACH_FRAMING_PROFILE, {
          checking: false,
          trackingQuality: trackingQuality === "unknown" ? null : trackingQuality,
        });
        this.lastBodyFramingState = framing;
        drawBodyFramingOverlay(ctx, canvasWidth, canvasHeight, framing);
        const poseReadiness: PoseReadiness =
          framing === "checking" ? "checking" : framing === "good_distance" ? "ready" : "not_ready";
        drawPoseLandmarkDots(ctx, landmarks, canvasWidth, canvasHeight, poseReadiness);

        this.processFrame(landmarks, nowMs);
      } else {
        this.processFrame(null, nowMs);
      }
    } catch {
      this.consecutiveDetectErrors += 1;
      if (this.consecutiveDetectErrors >= 10) {
        this.trackingError = "Movement tracking could not continue. Please stop and try again.";
        this.emit();
        return;
      }
    }

    if (this.framesTotal % uiFrameUpdateInterval === 0) {
      this.emit();
    }

    if (options?.scheduleNext !== false) {
      this.animFrameId = requestAnimationFrame(() => this.tickLiveVideoFrame());
    }
  }

  /**
   * Process one already-detected landmark array. Split out from the capture
   * loop so frame-processing logic is exercised the same way whether
   * landmarks arrive from a live camera or (in tests) a synthetic sequence.
   */
  private processFrame(landmarks: PoseLandmark[] | null, capturedAtMs: number): void {
    this.framesTotal += 1;

    if (!landmarks) {
      this.consecutiveNoLandmarkFrames += 1;
      if (!this.trackerWasLost && this.consecutiveNoLandmarkFrames >= TRACKER_LOST_CONSECUTIVE_FRAMES) {
        this.trackerWasLost = true;
        this.callbacks.onMeasuredEvent?.({ type: "trackerLost", capturedAtMs });
      }
      return;
    }

    this.framesWithPose += 1;
    this.consecutiveNoLandmarkFrames = 0;
    if (this.trackerWasLost) {
      this.trackerWasLost = false;
      this.callbacks.onMeasuredEvent?.({ type: "trackerRecovered", capturedAtMs });
    }

    const context: InputAcquisitionContext = { frameIndex: this.frameIndex, capturedAtMs };
    this.frameIndex += 1;

    const previousPrimaryRepCount = this.lastFrameResult
      ? this.primaryResult(this.lastFrameResult).repCount
      : 0;

    const result = updateShoulderAbductionReachDetector(this.detectorState, landmarks, context);
    this.lastFrameResult = result;

    const primary = this.primaryResult(result);
    if (primary.repCount > previousPrimaryRepCount) {
      this.callbacks.onMeasuredEvent?.({
        type: "repCompleted",
        side: this.primarySide,
        repCount: primary.repCount,
        peakAngleDegrees: primary.peakAngleDegrees,
        capturedAtMs,
      });
    }

    // Compensation signal is computed for the primary side only in this
    // slice — tracking it for the non-primary side too is a documented
    // future extension, not required for one live movement block.
    //
    // The detector above normalizes landmarks internally but does not
    // expose the NormalizedMotionFrame, so it is normalized again here via
    // the same BlazePose adapter — a small duplicated computation, not a
    // second implementation of it.
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
    if (frame) {
      // Dev-only, opt-in — see the callback's own doc comment. No-op unless a
      // caller explicitly supplies onDevFrameCaptured.
      this.callbacks.onDevFrameCaptured?.({
        frame,
        capturedAtMs,
        phase: primary.phase,
        repCount: primary.repCount,
      });

      const wristJointId = SHOULDER_ABDUCTION_REACH_BONUS_JOINTS[this.primarySide].wrist;
      const wristJoint = frame.joints[wristJointId];
      this.lastPrimaryWristNormalized =
        wristJoint?.confidence.present === true
          ? { x: wristJoint.landmark.x, y: wristJoint.landmark.y }
          : null;

      // Affected-side shoulder/elbow/arm-length for adaptive target geometry. Uses the
      // same already-normalized frame and the same presence rule as the wrist above.
      this.lastPrimaryArmGeometry = extractShoulderAbductionReachArmGeometry(
        frame,
        this.primarySide,
      );

      const wasFlagged = this.compensationState.flagged;
      const status = updateShoulderAbductionReachCompensation(
        this.compensationState,
        frame,
        this.primarySide,
        primary.phase === "resting",
      );
      if (status === "flagged" && !wasFlagged) {
        this.callbacks.onMeasuredEvent?.({
          type: "compensationDetected",
          side: this.primarySide,
          capturedAtMs,
        });
      } else if (status === "clear" && wasFlagged) {
        this.callbacks.onMeasuredEvent?.({
          type: "compensationCleared",
          side: this.primarySide,
          capturedAtMs,
        });
      }
    } else {
      this.lastPrimaryWristNormalized = null;
      this.lastPrimaryArmGeometry = EMPTY_SHOULDER_ABDUCTION_REACH_ARM_GEOMETRY;
    }
  }

  private detachVideoPauseHandler(): void {
    const video = this.videoEl;
    const handler = this.videoPauseHandler;
    if (video && handler) {
      video.removeEventListener("pause", handler);
    }
    this.videoPauseHandler = null;
  }

  stop(): void {
    this.sessionEpoch += 1;
    this.previewActive = false;
    cancelAnimationFrame(this.animFrameId);
    this.animFrameId = 0;
    this.detachVideoPauseHandler();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.poseLandmarker?.close?.();
    this.poseLandmarker = null;
    this.detectTimestamp = 0;
    this.initPhase = null;
    this.trackingError = null;
    this.emit();
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    const browserError = getSitToStandBrowserSupportError();
    if (browserError) {
      throw new Error(browserError);
    }
    if (needsSitToStandSecureContext()) {
      throw new Error(
        "Camera access requires a secure connection (HTTPS). Open this page over HTTPS and try again.",
      );
    }

    const epoch = this.sessionEpoch + 1;
    this.sessionEpoch = epoch;
    this.videoEl = video;
    this.canvasEl = canvas;
    this.trackingError = null;
    this.initPhase = "import";
    this.previewActive = false;
    this.resetSessionState();
    this.emit();

    const isCurrent = () => this.sessionEpoch === epoch;

    try {
      const { PoseLandmarker, FilesetResolver } = await withSitToStandTimeout(
        import("@mediapipe/tasks-vision"),
        SHOULDER_ABDUCTION_REACH_POSE_SHELL.initTimeoutMs,
        "Pose library load",
      );
      if (!isCurrent()) return;

      this.initPhase = "model";
      this.emit();

      const filesetResolver = await withSitToStandTimeout(
        FilesetResolver.forVisionTasks(SHOULDER_ABDUCTION_REACH_POSE_SHELL.wasmUrl),
        SHOULDER_ABDUCTION_REACH_POSE_SHELL.initTimeoutMs,
        "Pose runtime load",
      );
      if (!isCurrent()) return;

      const poseLandmarker = await createPoseLandmarker(PoseLandmarker, filesetResolver, {
        ...DEFAULT_STS_CONFIG,
        wasmUrl: SHOULDER_ABDUCTION_REACH_POSE_SHELL.wasmUrl,
        modelUrl: SHOULDER_ABDUCTION_REACH_POSE_SHELL.modelUrl,
        initTimeoutMs: SHOULDER_ABDUCTION_REACH_POSE_SHELL.initTimeoutMs,
      });
      if (!isCurrent()) {
        poseLandmarker.close?.();
        return;
      }
      this.poseLandmarker = poseLandmarker;

      this.initPhase = "camera";
      this.emit();

      await waitForVideoElementLayout(video);
      releaseMediaStream(this.stream, video);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: SHOULDER_ABDUCTION_REACH_POSE_SHELL.canvasWidth },
          height: { ideal: SHOULDER_ABDUCTION_REACH_POSE_SHELL.canvasHeight },
        },
        audio: false,
      });
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;

      video.srcObject = stream;
      this.detachVideoPauseHandler();
      const onVideoPause = () => {
        if (!this.previewActive || video.paused) {
          void video.play().catch(() => undefined);
        }
      };
      this.videoPauseHandler = onVideoPause;
      video.addEventListener("pause", onVideoPause);

      await startVideoPlayback(video);
      if (!isCurrent()) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error(PATIENT_CAMERA_NO_FRAMES_ERROR);
      }

      this.previewActive = true;
      this.initPhase = null;
      this.sessionStartMs = performance.now();
      this.emit();

      this.animFrameId = requestAnimationFrame(() => this.tickLiveVideoFrame());
    } catch (err) {
      if (!isCurrent()) return;
      this.stop();
      throw err;
    }
  }
}
