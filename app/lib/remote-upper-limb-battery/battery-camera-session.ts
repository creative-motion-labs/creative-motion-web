"use client";

import { DEFAULT_STS_CONFIG } from "@/app/lib/cv/bio-0-contracts";
import { drawPoseLandmarkDots } from "@/app/lib/cv/pose-landmark-overlay";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
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
  type SitToStandInitPhase,
} from "@/app/lib/cv/sit-to-stand-detector";
import type { InputAcquisitionContext } from "@/app/lib/input-acquisition";
import type { BatteryFrameProcessorSnapshot } from "./battery-frame-processors";

type PoseLandmarkerInstance = {
  detectForVideo: (
    video: HTMLVideoElement,
    ts: number,
  ) => { landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>> };
  close?: () => void;
};

export type BatteryCameraSnapshot = {
  previewActive: boolean;
  initPhase: SitToStandInitPhase;
  trackingError: string | null;
  processor: BatteryFrameProcessorSnapshot | null;
};

export type BatteryCameraCallbacks = {
  onSnapshot: (snapshot: BatteryCameraSnapshot) => void;
};

const SHELL = DEFAULT_STS_CONFIG;

export class BatteryCameraSession {
  private readonly callbacks: BatteryCameraCallbacks;
  private processFrame:
    | ((landmarks: readonly PoseLandmark[], context: InputAcquisitionContext) => BatteryFrameProcessorSnapshot)
    | null = null;

  private stream: MediaStream | null = null;
  private poseLandmarker: PoseLandmarkerInstance | null = null;
  private previewActive = false;
  private initPhase: SitToStandInitPhase = null;
  private trackingError: string | null = null;
  private animFrameId = 0;
  private sessionEpoch = 0;
  private detectTimestamp = 0;
  private frameIndex = 0;
  private lastProcessorSnapshot: BatteryFrameProcessorSnapshot | null = null;
  private lastProcessedVideoTimeS: number | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  constructor(callbacks: BatteryCameraCallbacks) {
    this.callbacks = callbacks;
  }

  setFrameProcessor(
    processor: (
      landmarks: readonly PoseLandmark[],
      context: InputAcquisitionContext,
    ) => BatteryFrameProcessorSnapshot,
  ): void {
    this.processFrame = processor;
  }

  private emit(): void {
    this.callbacks.onSnapshot({
      previewActive: this.previewActive,
      initPhase: this.initPhase,
      trackingError: this.trackingError,
      processor: this.lastProcessorSnapshot,
    });
  }

  async start(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    if (needsSitToStandSecureContext() && !window.isSecureContext) {
      throw new Error(mapSitToStandStartError("insecure_context"));
    }
    const supportError = getSitToStandBrowserSupportError();
    if (supportError) throw new Error(mapSitToStandStartError(supportError));

    this.stop();
    const epoch = ++this.sessionEpoch;
    this.videoEl = video;
    this.canvasEl = canvas;
    this.frameIndex = 0;
    this.lastProcessorSnapshot = null;
    this.lastProcessedVideoTimeS = null;
    this.trackingError = null;

    this.initPhase = "import";
    this.emit();

    try {
      const { PoseLandmarker, FilesetResolver } = await withSitToStandTimeout(
        import("@mediapipe/tasks-vision"),
        SHELL.initTimeoutMs,
        "import",
      );
      if (epoch !== this.sessionEpoch) return;

      this.initPhase = "model";
      this.emit();
      const filesetResolver = await withSitToStandTimeout(
        FilesetResolver.forVisionTasks(SHELL.wasmUrl),
        SHELL.initTimeoutMs,
        "model",
      );
      if (epoch !== this.sessionEpoch) return;

      const landmarker = await createPoseLandmarker(PoseLandmarker, filesetResolver, SHELL);
      if (epoch !== this.sessionEpoch) {
        landmarker.close?.();
        return;
      }
      this.poseLandmarker = landmarker;

      this.initPhase = "camera";
      this.emit();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (epoch !== this.sessionEpoch) {
        releaseMediaStream(stream);
        return;
      }
      this.stream = stream;
      video.srcObject = stream;
      await waitForVideoElementLayout(video);
      await startVideoPlayback(video);

      let framesSeen = 0;
      const waitStart = performance.now();
      while (video.videoWidth === 0 && performance.now() - waitStart < 5_000) {
        await new Promise((r) => setTimeout(r, 50));
        framesSeen += 1;
        if (framesSeen > 100) break;
      }
      if (video.videoWidth === 0) {
        throw new Error(PATIENT_CAMERA_NO_FRAMES_ERROR);
      }

      this.previewActive = true;
      this.initPhase = null;
      this.emit();
      this.tick();
    } catch (err) {
      this.trackingError = err instanceof Error ? err.message : String(err);
      this.previewActive = false;
      this.initPhase = null;
      this.emit();
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this.sessionEpoch += 1;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.animFrameId = 0;
    this.previewActive = false;
    releaseMediaStream(this.stream);
    this.stream = null;
    this.poseLandmarker?.close?.();
    this.poseLandmarker = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.lastProcessorSnapshot = null;
    this.emit();
  }

  private tick(): void {
    if (!this.previewActive || !this.videoEl || !this.canvasEl || !this.poseLandmarker) return;
    const video = this.videoEl;
    const canvas = this.canvasEl;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      if (video.paused) void video.play().catch(() => undefined);
      if (video.videoWidth === 0) {
        this.animFrameId = requestAnimationFrame(() => this.tick());
        return;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const currentVideoTimeS = video.currentTime;
      if (this.lastProcessedVideoTimeS !== null && currentVideoTimeS === this.lastProcessedVideoTimeS) {
        this.animFrameId = requestAnimationFrame(() => this.tick());
        return;
      }
      this.lastProcessedVideoTimeS = currentVideoTimeS;

      this.detectTimestamp = Math.max(this.detectTimestamp + 1, performance.now());
      const nowMs = performance.now();
      const result = this.poseLandmarker.detectForVideo(video, this.detectTimestamp);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const landmarks = result.landmarks?.[0] as PoseLandmark[] | undefined;
      if (landmarks?.length) {
        drawPoseLandmarkDots(ctx, landmarks, canvas.width, canvas.height, "ready");
        if (this.processFrame) {
          const context: InputAcquisitionContext = {
            frameIndex: this.frameIndex,
            capturedAtMs: nowMs,
          };
          this.frameIndex += 1;
          this.lastProcessorSnapshot = this.processFrame(landmarks, context);
        }
      } else if (this.processFrame) {
        const context: InputAcquisitionContext = {
          frameIndex: this.frameIndex,
          capturedAtMs: nowMs,
        };
        this.frameIndex += 1;
        this.lastProcessorSnapshot = this.processFrame([], context);
      }
    } catch {
      this.trackingError = "Camera tracking could not continue.";
    }

    this.emit();
    this.animFrameId = requestAnimationFrame(() => this.tick());
  }
}
