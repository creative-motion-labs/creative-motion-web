/**
 * Gait Assessment v1 — MediaPipe pose shell for bounded walking observation.
 */

import { DEFAULT_STS_CONFIG } from "@/app/lib/cv/bio-0-contracts";
import {
  drawBodyFramingOverlay,
  type BodyFramingState,
} from "@/app/lib/cv/body-framing-evaluator";
import { drawPoseLandmarkDots } from "@/app/lib/cv/pose-landmark-overlay";
import {
  ASSESSMENT_GAIT_WALKING_CONFIG,
  GaitWalkingObservationEngine,
  type GaitWalkingDerivedMetrics,
} from "@/app/lib/cv/gait-walking-observation-detector";
import type { PoseLandmark } from "@/app/lib/cv/sagittal-hip-rep-core";
import {
  PATIENT_CAMERA_NO_FRAMES_ERROR,
  releaseMediaStream,
  waitForDecodedVideoFrames,
  waitForVideoElementLayout,
} from "@/app/lib/cv/patient-camera-stream";
import {
  createPoseLandmarker,
  formatSitToStandDuration,
  getSitToStandBrowserSupportError,
  mapSitToStandStartError,
  needsSitToStandSecureContext,
  withSitToStandTimeout,
  type SitToStandDetectorSnapshot,
  type SitToStandInitPhase,
  type SitToStandTrackingQuality,
  type SitToStandTrackingStatus,
} from "@/app/lib/cv/sit-to-stand-detector";

const GAIT_POSE_SHELL = {
  wasmUrl: DEFAULT_STS_CONFIG.wasmUrl,
  modelUrl: DEFAULT_STS_CONFIG.modelUrl,
  initTimeoutMs: DEFAULT_STS_CONFIG.initTimeoutMs,
  canvasWidth: DEFAULT_STS_CONFIG.canvasWidth,
  canvasHeight: DEFAULT_STS_CONFIG.canvasHeight,
  uiFrameUpdateInterval: 6,
  landmarksOverlayOnly: false,
};

export {
  formatSitToStandDuration as formatGaitWalkingDuration,
  mapSitToStandStartError as mapGaitWalkingStartError,
};

type PoseLandmarkerInstance = {
  detectForVideo: (
    video: HTMLVideoElement,
    ts: number,
  ) => { landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>> };
  close?: () => void;
};

export type GaitWalkingPoseDetectorCallbacks = {
  onSnapshot: (snapshot: SitToStandDetectorSnapshot) => void;
};

export class GaitWalkingObservationPoseDetector {
  private readonly callbacks: GaitWalkingPoseDetectorCallbacks;
  private readonly engine: GaitWalkingObservationEngine;

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
  private engineStarted = false;

  constructor(callbacks: GaitWalkingPoseDetectorCallbacks) {
    this.callbacks = callbacks;
    this.engine = new GaitWalkingObservationEngine();
  }

  getSnapshot(): SitToStandDetectorSnapshot {
    const engine = this.engine.getSnapshot();
    return {
      trackingStatus: this.engineStarted
        ? (engine.trackingStatus as SitToStandTrackingStatus)
        : "idle",
      trackingQuality: engine.trackingQuality as SitToStandTrackingQuality | null,
      poseReadiness: engine.framesWithPose > 0 ? "ready" : "checking",
      bodyFramingState: engine.bodyFramingState,
      repCount: engine.repCount,
      sessionSeconds: engine.sessionSeconds,
      movementDetected: engine.movementDetected,
      framesWithPose: engine.framesWithPose,
      framesTotal: engine.framesTotal,
      initPhase: this.initPhase,
      previewActive: this.previewActive,
      trackingError: this.trackingError,
      isBaselineCalibrating: false,
    };
  }

  getDerivedMetrics(): GaitWalkingDerivedMetrics {
    return this.engine.getDerivedMetrics();
  }

  isPreviewActive(): boolean {
    return this.previewActive;
  }

  canSaveMetrics(): boolean {
    return this.engine.canSaveMetrics();
  }

  private emit(): void {
    this.callbacks.onSnapshot(this.getSnapshot());
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
    if (this.videoEl) this.videoEl.srcObject = null;
    this.poseLandmarker?.close?.();
    this.poseLandmarker = null;
    if (this.engineStarted) {
      this.engine.endSession(performance.now());
    }
    this.engineStarted = false;
    this.initPhase = null;
    this.trackingError = null;
    this.emit();
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    const browserError = getSitToStandBrowserSupportError();
    if (browserError) throw new Error(browserError);
    if (needsSitToStandSecureContext()) {
      throw new Error(
        "Camera access requires HTTPS. Open this page over HTTPS and try again.",
      );
    }

    const epoch = this.sessionEpoch + 1;
    this.sessionEpoch = epoch;
    this.videoEl = video;
    this.canvasEl = canvas;
    this.trackingError = null;
    this.initPhase = "import";
    this.engine.reset();
    this.engineStarted = false;
    this.emit();

    const isCurrent = () => this.sessionEpoch === epoch;

    try {
      const { PoseLandmarker, FilesetResolver } = await withSitToStandTimeout(
        import("@mediapipe/tasks-vision"),
        GAIT_POSE_SHELL.initTimeoutMs,
        "Pose library load",
      );
      if (!isCurrent()) return;

      this.initPhase = "model";
      this.emit();

      const filesetResolver = await withSitToStandTimeout(
        FilesetResolver.forVisionTasks(GAIT_POSE_SHELL.wasmUrl),
        GAIT_POSE_SHELL.initTimeoutMs,
        "Pose runtime load",
      );
      if (!isCurrent()) return;

      const poseLandmarker = await createPoseLandmarker(PoseLandmarker, filesetResolver, {
        ...DEFAULT_STS_CONFIG,
        wasmUrl: GAIT_POSE_SHELL.wasmUrl,
        modelUrl: GAIT_POSE_SHELL.modelUrl,
        initTimeoutMs: GAIT_POSE_SHELL.initTimeoutMs,
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
          width: { ideal: GAIT_POSE_SHELL.canvasWidth },
          height: { ideal: GAIT_POSE_SHELL.canvasHeight },
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
      void video.play().catch(() => undefined);
      await waitForDecodedVideoFrames(video);
      if (!isCurrent()) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error(PATIENT_CAMERA_NO_FRAMES_ERROR);
      }

      this.previewActive = true;
      this.initPhase = null;
      this.engineStarted = true;
      this.emit();

      let consecutiveDetectErrors = 0;
      const { canvasWidth, canvasHeight, uiFrameUpdateInterval } = GAIT_POSE_SHELL;

      const detect = () => {
        if (!this.previewActive || !this.videoEl || !this.canvasEl) return;
        const ctx = this.canvasEl.getContext("2d");
        if (!ctx || !this.poseLandmarker) return;

        try {
          if (this.videoEl.paused && this.previewActive) {
            void this.videoEl.play().catch(() => undefined);
          }
          if (this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) {
            this.animFrameId = requestAnimationFrame(detect);
            return;
          }

          this.detectTimestamp = Math.max(this.detectTimestamp + 1, performance.now());
          const nowMs = performance.now();
          const result = this.poseLandmarker.detectForVideo(this.videoEl, this.detectTimestamp);

          ctx.clearRect(0, 0, canvasWidth, canvasHeight);
          ctx.drawImage(this.videoEl, 0, 0, canvasWidth, canvasHeight);
          consecutiveDetectErrors = 0;

          if (result.landmarks && result.landmarks.length > 0) {
            const landmarks = result.landmarks[0] as PoseLandmark[];
            this.engine.driveFrame(landmarks, nowMs);
            const snap = this.getSnapshot();
            drawBodyFramingOverlay(ctx, canvasWidth, canvasHeight, snap.bodyFramingState);
            drawPoseLandmarkDots(ctx, landmarks, canvasWidth, canvasHeight, snap.poseReadiness);
          }
        } catch {
          consecutiveDetectErrors += 1;
          if (consecutiveDetectErrors >= 10) {
            this.trackingError = "Walking observation could not continue. Stop and try again.";
            this.emit();
            return;
          }
        }

        const engineSnap = this.engine.getSnapshot();
        if (engineSnap.framesTotal % uiFrameUpdateInterval === 0) {
          this.emit();
        }
        this.animFrameId = requestAnimationFrame(detect);
      };

      this.animFrameId = requestAnimationFrame(detect);
    } catch (err) {
      if (!isCurrent()) return;
      this.stop();
      throw err;
    }
  }
}
