/**
 * Forward Reach Live-Camera Detector — Experimental integration spike.
 *
 * Validates that MediaPipe → BLAZEPOSE_ACQUISITION_ADAPTER → Forward Reach
 * engine integration works correctly from real camera input.
 *
 * Owns: camera lifecycle, MediaPipe initialization, frame loop, engine feeding.
 *
 * Does NOT own: React UI, tested side selection UI, persistence, API calls.
 *
 * Pattern: Mirrors SitToStandDetector architecture.
 */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition/adapters/motion/blazepose-acquisition-adapter";
import type { InputAcquisitionContext } from "@/app/lib/input-acquisition/contract";
import {
  applyForwardReachCommand,
  createForwardReachAttemptState,
  getForwardReachRuntimeSnapshot,
  validateForwardReachConfig,
  type ForwardReachAttemptState,
  type ForwardReachConfig,
  type ForwardReachRuntimeSnapshot,
} from "@/app/lib/upper-limb-motor-screen/forward-reach-engine";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";
import {
  releaseMediaStream,
  waitForDecodedVideoFrames,
  waitForVideoElementLayout,
} from "@/app/lib/cv/patient-camera-stream";

export type ForwardReachCameraStatus = "idle" | "initializing" | "running" | "error";
export type ForwardReachCameraInitPhase = null | "import" | "model" | "camera";

export type ForwardReachCameraSnapshot = {
  status: ForwardReachCameraStatus;
  initPhase: ForwardReachCameraInitPhase;
  error: string | null;
  engineSnapshot: ForwardReachRuntimeSnapshot | null;

  // Laterality diagnostics
  rightWristVisibility: number | null;
  leftWristVisibility: number | null;
  rightWristCoords: { x: number; y: number } | null;
  leftWristCoords: { x: number; y: number } | null;
  testedSide: UpperLimbSide;

  // Command feedback
  lastCommandType: string | null;
  lastCommandStatus: "applied" | "rejected" | null;
  lastCommandRejectionReason: string | null;

  // Armed readiness
  readinessArmed: boolean;
  readinessArmedTimeRemaining: number | null; // milliseconds remaining in armed window
};

type PoseLandmarkerInstance = {
  detectForVideo: (
    video: HTMLVideoElement,
    ts: number,
  ) => { landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>> };
  close?: () => void;
};

// Pose skeleton connections for debug visualization
// Body-only: shoulders, arms, minimal torso. No face, no legs.
const POSE_CONNECTIONS: [number, number][] = [
  // Shoulders
  [11, 12], // left shoulder to right shoulder
  // Left arm
  [11, 13], // left shoulder to elbow
  [13, 15], // left elbow to wrist
  // Right arm
  [12, 14], // right shoulder to elbow
  [14, 16], // right elbow to wrist
];

// Body landmark indices to draw (shoulders, elbows, wrists only)
const BODY_LANDMARKS_TO_DRAW = [11, 12, 13, 14, 15, 16];

export type ForwardReachCameraDetectorCallbacks = {
  onSnapshot: (snapshot: ForwardReachCameraSnapshot) => void;
};

type ForwardReachCameraConfig = {
  modelUrl?: string;
  wasmUrl?: string;
  initTimeoutMs?: number;
};

const DEFAULT_CONFIG: Required<ForwardReachCameraConfig> = {
  modelUrl:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  wasmUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
  initTimeoutMs: 15_000,
};

function mapStartError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return "Camera access was denied. Please check camera permission and try again.";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return "No camera was found on this device.";
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return "The camera is in use by another application. Close other apps and try again.";
    }
  }
  if (err instanceof Error) {
    if (err.message.includes("timed out")) return err.message;
    return err.message;
  }
  return "Camera could not start. Please check camera permission and try again.";
}

/**
 * Forward Reach Camera Detector — validates live MediaPipe → Motor Screen integration.
 *
 * Epoch-based async cancellation prevents stale init completions.
 * Idempotent cleanup safe for stop/unmount during async operations.
 */
export class ForwardReachCameraDetector {
  private readonly config: Required<ForwardReachCameraConfig>;
  private readonly callbacks: ForwardReachCameraDetectorCallbacks;

  // Session lifecycle
  private sessionEpoch = 0;
  private currentEpoch = 0;
  private status: ForwardReachCameraStatus = "idle";
  private initPhase: ForwardReachCameraInitPhase = null;
  private error: string | null = null;

  // Camera resources
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private poseLandmarker: PoseLandmarkerInstance | null = null;

  // Frame processing
  private rafId = 0;
  private detectTimestamp = 0;
  private frameIndex = 0;

  // Engine state
  private engineConfig: ForwardReachConfig | null = null;
  private engineState: ForwardReachAttemptState | null = null;

  // Laterality diagnostics
  private lastRightWristVisibility: number | null = null;
  private lastLeftWristVisibility: number | null = null;
  private lastRightWristCoords: { x: number; y: number } | null = null;
  private lastLeftWristCoords: { x: number; y: number } | null = null;

  // Command feedback
  private lastCommandType: string | null = null;
  private lastCommandStatus: "applied" | "rejected" | null = null;
  private lastCommandRejectionReason: string | null = null;

  // Armed readiness
  private readinessArmed = false;
  private readinessArmedUntilMs: number | null = null;
  private readinessStableSinceMs: number | null = null;
  private readinessAlreadySent = false;

  constructor(
    callbacks: ForwardReachCameraDetectorCallbacks,
    config: ForwardReachCameraConfig = {},
  ) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getSnapshot(): ForwardReachCameraSnapshot {
    return {
      status: this.status,
      initPhase: this.initPhase,
      error: this.error,
      engineSnapshot: this.engineState ? getForwardReachRuntimeSnapshot(this.engineState) : null,
      rightWristVisibility: this.lastRightWristVisibility,
      leftWristVisibility: this.lastLeftWristVisibility,
      rightWristCoords: this.lastRightWristCoords,
      leftWristCoords: this.lastLeftWristCoords,
      testedSide: this.engineConfig?.testedSide ?? "right",
      lastCommandType: this.lastCommandType,
      lastCommandStatus: this.lastCommandStatus,
      lastCommandRejectionReason: this.lastCommandRejectionReason,
      readinessArmed: this.readinessArmed,
      readinessArmedTimeRemaining:
        this.readinessArmed && this.readinessArmedUntilMs
          ? Math.max(0, this.readinessArmedUntilMs - performance.now())
          : null,
    };
  }

  private emit(): void {
    this.callbacks.onSnapshot(this.getSnapshot());
  }

  /**
   * Start camera session with Forward Reach engine configuration.
   * Async operations protected by epoch cancellation.
   */
  async start(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    engineConfig: ForwardReachConfig,
  ): Promise<void> {
    // Validate config
    const configResult = validateForwardReachConfig(engineConfig);
    if (!configResult.ok) {
      throw new Error(`Invalid Forward Reach config: ${configResult.reason}`);
    }

    // Start new session epoch
    const epoch = this.sessionEpoch + 1;
    this.sessionEpoch = epoch;
    this.currentEpoch = epoch;

    const isCurrent = () => this.sessionEpoch === epoch;

    this.videoEl = video;
    this.canvasEl = canvas;
    this.engineConfig = configResult.config;
    this.status = "initializing";
    this.initPhase = "import";
    this.error = null;
    this.detectTimestamp = 0;
    this.frameIndex = 0;
    this.lastRightWristVisibility = null;
    this.lastLeftWristVisibility = null;
    this.lastRightWristCoords = null;
    this.lastLeftWristCoords = null;
    this.lastCommandType = null;
    this.lastCommandStatus = null;
    this.lastCommandRejectionReason = null;
    this.emit();

    try {
      // Import MediaPipe
      const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      if (!isCurrent()) return;

      this.initPhase = "model";
      this.emit();

      // Init FilesetResolver
      const fileset = await FilesetResolver.forVisionTasks(this.config.wasmUrl);
      if (!isCurrent()) return;

      // Create PoseLandmarker
      const baseOptions = { modelAssetPath: this.config.modelUrl, delegate: "GPU" as const };
      const options = { baseOptions, runningMode: "VIDEO" as const, numPoses: 1 };

      let landmarker: PoseLandmarkerInstance;
      try {
        landmarker = await PoseLandmarker.createFromOptions(fileset, options);
      } catch {
        // Fallback to CPU
        landmarker = await PoseLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...baseOptions, delegate: "CPU" },
        });
      }

      if (!isCurrent()) {
        landmarker.close?.();
        return;
      }
      this.poseLandmarker = landmarker;

      this.initPhase = "camera";
      this.emit();

      // Wait for video element layout
      await waitForVideoElementLayout(video);
      if (!isCurrent()) {
        this.poseLandmarker?.close?.();
        this.poseLandmarker = null;
        return;
      }

      // Release any existing stream
      releaseMediaStream(this.stream, video);

      // getUserMedia
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        this.poseLandmarker?.close?.();
        this.poseLandmarker = null;
        return;
      }
      this.stream = stream;

      // Attach to video element
      video.srcObject = stream;

      // Wait for video playback
      await waitForDecodedVideoFrames(video);
      if (!isCurrent()) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error("Camera opened but no video frames detected.");
      }

      // Initialize Forward Reach engine
      const stateResult = createForwardReachAttemptState(
        this.engineConfig,
        0, // attemptIndex
        performance.now(), // armedAtMs
      );

      if (!stateResult.ok) {
        throw new Error(`Failed to create Forward Reach state: ${stateResult.reason}`);
      }
      this.engineState = stateResult.state;

      // Start frame loop
      this.status = "running";
      this.initPhase = null;
      this.emit();

      this.startFrameLoop(video);
    } catch (err) {
      // Always clean up resources created during this session
      if (this.poseLandmarker && this.currentEpoch === epoch) {
        this.poseLandmarker.close?.();
        this.poseLandmarker = null;
      }

      if (!isCurrent()) return;
      this.stop();
      this.error = mapStartError(err);
      this.status = "error";
      this.emit();
      throw err;
    }
  }

  /**
   * Draw text that remains readable despite canvas CSS mirror (scaleX(-1)).
   * Applies compensating transform so text reads normally.
   */
  private drawUnmirroredText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    width: number,
  ): void {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillText(text, -(width - x), y);
    ctx.restore();
  }

  /**
   * Draw pose debug overlay: skeleton, tested wrist, starting zone.
   * Engineering visualization only - not clinical measurement.
   */
  private drawPoseDebugOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    landmarks: PoseLandmark[] | undefined,
  ): void {
    if (!this.engineConfig) return;

    const testedSide = this.engineConfig.testedSide;
    const testedWristIndex = testedSide === "right" ? 16 : 15;

    // Draw skeleton connections
    if (landmarks && landmarks.length > 0) {
      for (const [a, b] of POSE_CONNECTIONS) {
        if (!landmarks[a] || !landmarks[b]) continue;
        if ((landmarks[a].visibility ?? 0) < 0.3 || (landmarks[b].visibility ?? 0) < 0.3) continue;

        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
        ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
        ctx.stroke();
      }

      // Draw body landmarks only (shoulders, elbows, wrists)
      for (const i of BODY_LANDMARKS_TO_DRAW) {
        if (i >= landmarks.length) continue;
        const lm = landmarks[i];
        if (!lm || (lm.visibility ?? 0) < 0.3) continue;

        ctx.beginPath();
        ctx.arc(lm.x * width, lm.y * height, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fill();
      }

      // Highlight tested wrist
      const testedWrist = landmarks[testedWristIndex];
      if (testedWrist && (testedWrist.visibility ?? 0) >= 0.3) {
        const wx = testedWrist.x * width;
        const wy = testedWrist.y * height;

        // Outer ring
        ctx.beginPath();
        ctx.arc(wx, wy, 12, 0, Math.PI * 2);
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(wx, wy, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#22d3ee";
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(wx, wy, 18, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(34,211,238,0.2)";
        ctx.fill();
      }
    }

    // Draw starting zone
    const startingZone = this.engineConfig.startingZone;
    const centerX = startingZone.point.x * width;
    const centerY = startingZone.point.y * height;
    const radiusPixels = startingZone.radius * Math.min(width, height);

    // Zone circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radiusPixels, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(239,159,39,0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center marker
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(239,159,39,0.9)";
    ctx.fill();

    // Zone label (readable despite CSS mirror)
    ctx.fillStyle = "rgba(239,159,39,0.9)";
    ctx.font = "12px monospace";
    this.drawUnmirroredText(ctx, "Starting Zone", centerX + radiusPixels + 5, centerY, width);

    // Readiness status text
    const minVisibility = this.engineConfig.tracking.minWristVisibility;
    let wristTracked = false;
    let wristInZone = false;

    if (landmarks && landmarks.length > 0) {
      const testedWrist = landmarks[testedWristIndex];
      const visibility = testedWrist?.visibility ?? 0;
      wristTracked = visibility >= minVisibility;

      if (wristTracked && testedWrist) {
        const wx = testedWrist.x;
        const wy = testedWrist.y;

        // Check if wrist is in starting zone
        const dx = wx - startingZone.point.x;
        const dy = wy - startingZone.point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        wristInZone = distance <= startingZone.radius;
      }
    }

    // Status text at top - line 1: tracked status (readable despite CSS mirror)
    const trackedStatus = wristTracked ? "TRACKED" : "NOT TRACKED";
    const trackedColor = wristTracked ? "#22d3ee" : "#ef4444";
    ctx.fillStyle = trackedColor;
    ctx.font = "bold 14px monospace";
    this.drawUnmirroredText(ctx, `Tested wrist (${testedSide.toUpperCase()}): ${trackedStatus}`, 10, 25, width);

    // Line 2: zone status (readable despite CSS mirror)
    if (wristTracked) {
      const zoneStatus = wristInZone ? "INSIDE STARTING ZONE" : "OUTSIDE STARTING ZONE";
      const zoneColor = wristInZone ? "#22d3ee" : "#ef9f27";
      ctx.fillStyle = zoneColor;
      this.drawUnmirroredText(ctx, zoneStatus, 10, 45, width);
    }

    // Line 3: armed status (readable despite CSS mirror)
    const armedStatus = this.readinessArmed ? "ARMED" : "NOT ARMED";
    const armedColor = this.readinessArmed ? "#ef9f27" : "#6b7280";
    ctx.fillStyle = armedColor;
    this.drawUnmirroredText(ctx, `Readiness: ${armedStatus}`, 10, 65, width);

    // Overlay label (readable despite CSS mirror)
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "11px monospace";
    this.drawUnmirroredText(ctx, "Pose Debug Overlay — Engineering/therapist review only", 10, height - 10, width);
  }

  /**
   * Frame processing loop with epoch guard and monotonic MediaPipe timestamps.
   */
  private startFrameLoop(video: HTMLVideoElement): void {
    const epoch = this.currentEpoch;

    const detect = () => {
      // Guard: session still active
      if (this.sessionEpoch !== epoch) return;

      // Guard: resources ready
      if (!this.poseLandmarker || !this.engineState) return;

      // Guard: video ready
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        this.rafId = requestAnimationFrame(detect);
        return;
      }

      try {
        // Monotonic MediaPipe inference timestamp
        this.detectTimestamp = Math.max(this.detectTimestamp + 1, performance.now());

        // Single event timestamp for this acquisition cycle
        const capturedAtMs = performance.now();

        // MediaPipe inference
        const result = this.poseLandmarker.detectForVideo(video, this.detectTimestamp);
        const landmarks = result.landmarks?.[0];

        // Draw video + debug overlay to canvas
        if (this.canvasEl) {
          const ctx = this.canvasEl.getContext("2d");
          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            // Only reset dimensions if they changed (optimization)
            const needsResize =
              this.canvasEl.width !== video.videoWidth || this.canvasEl.height !== video.videoHeight;
            if (needsResize) {
              this.canvasEl.width = video.videoWidth;
              this.canvasEl.height = video.videoHeight;
            }

            ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
            ctx.drawImage(video, 0, 0, this.canvasEl.width, this.canvasEl.height);

            // Draw pose debug overlay
            this.drawPoseDebugOverlay(ctx, this.canvasEl.width, this.canvasEl.height, landmarks);
          }
        }

        // Increment frame index
        this.frameIndex += 1;

        if (landmarks && landmarks.length > 0) {
          // Create acquisition context
          const context: InputAcquisitionContext = {
            frameIndex: this.frameIndex,
            capturedAtMs,
            deviceLabel: "front_camera",
          };

          // Normalize via existing BlazePose adapter
          const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);

          // Update laterality diagnostics
          this.updateLateralityDiagnostics(landmarks);

          // Feed engine
          if (frame) {
            // CASE A: Valid frame from adapter
            const engineResult = applyForwardReachCommand(this.engineState, {
              type: "frame",
              nowMs: capturedAtMs,
              frame,
            });

            if (engineResult.status === "applied") {
              this.engineState = engineResult.state;
            }
          } else {
            // CASE C: MediaPipe returned landmarks but adapter returned null
            const engineResult = applyForwardReachCommand(this.engineState, {
              type: "observationUnavailable",
              nowMs: capturedAtMs,
            });

            if (engineResult.status === "applied") {
              this.engineState = engineResult.state;
            }
          }
        } else {
          // CASE B: MediaPipe returned no pose landmarks
          const engineResult = applyForwardReachCommand(this.engineState, {
            type: "observationUnavailable",
            nowMs: capturedAtMs,
          });

          if (engineResult.status === "applied") {
            this.engineState = engineResult.state;
          }

          // Clear laterality diagnostics
          this.lastRightWristVisibility = null;
          this.lastLeftWristVisibility = null;
          this.lastRightWristCoords = null;
          this.lastLeftWristCoords = null;
        }

        // Check armed readiness
        this.checkArmedReadiness(capturedAtMs);

        // Emit snapshot
        this.emit();
      } catch (err) {
        console.error("[ForwardReachCameraDetector] Frame processing error:", err);
      }

      // Schedule next frame
      this.rafId = requestAnimationFrame(detect);
    };

    this.rafId = requestAnimationFrame(detect);
  }

  /**
   * Update laterality diagnostics from raw landmarks.
   */
  private updateLateralityDiagnostics(landmarks: readonly PoseLandmark[]): void {
    // Right wrist: index 16
    const rightWrist = landmarks[16];
    if (rightWrist) {
      this.lastRightWristVisibility = rightWrist.visibility ?? null;
      if (
        typeof rightWrist.x === "number" &&
        typeof rightWrist.y === "number" &&
        Number.isFinite(rightWrist.x) &&
        Number.isFinite(rightWrist.y)
      ) {
        this.lastRightWristCoords = { x: rightWrist.x, y: rightWrist.y };
      } else {
        this.lastRightWristCoords = null;
      }
    } else {
      this.lastRightWristVisibility = null;
      this.lastRightWristCoords = null;
    }

    // Left wrist: index 15
    const leftWrist = landmarks[15];
    if (leftWrist) {
      this.lastLeftWristVisibility = leftWrist.visibility ?? null;
      if (
        typeof leftWrist.x === "number" &&
        typeof leftWrist.y === "number" &&
        Number.isFinite(leftWrist.x) &&
        Number.isFinite(leftWrist.y)
      ) {
        this.lastLeftWristCoords = { x: leftWrist.x, y: leftWrist.y };
      } else {
        this.lastLeftWristCoords = null;
      }
    } else {
      this.lastLeftWristVisibility = null;
      this.lastLeftWristCoords = null;
    }
  }

  /**
   * Stop session — idempotent cleanup safe for repeated calls.
   */
  stop(): void {
    // Invalidate current session
    this.sessionEpoch += 1;

    // Cancel RAF
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;

    // Disarm readiness
    this.disarmReadiness();

    // Stop camera
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    // Detach video
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }

    // Clear canvas
    this.canvasEl = null;

    // Close MediaPipe
    if (this.poseLandmarker) {
      this.poseLandmarker.close?.();
      this.poseLandmarker = null;
    }

    // Reset state
    this.detectTimestamp = 0;
    this.frameIndex = 0;
    this.engineState = null;
    this.status = "idle";
    this.initPhase = null;

    // Emit final snapshot
    this.emit();
  }

  /**
   * Check armed readiness conditions and send readinessConfirmed if stable in zone.
   */
  private checkArmedReadiness(nowMs: number): void {
    if (!this.readinessArmed || !this.engineState || !this.engineConfig) {
      return;
    }

    // Check timeout
    if (this.readinessArmedUntilMs && nowMs >= this.readinessArmedUntilMs) {
      this.disarmReadiness();
      return;
    }

    // Don't send if already sent
    if (this.readinessAlreadySent) {
      return;
    }

    // Check engine phase
    const phase = this.engineState.phase;
    if (phase !== "idle" && phase !== "awaiting_readiness") {
      this.disarmReadiness();
      return;
    }

    // Check wrist conditions
    const testedSide = this.engineConfig.testedSide;

    // Get tested wrist from laterality diagnostics
    const testedWristVisibility = testedSide === "right"
      ? this.lastRightWristVisibility
      : this.lastLeftWristVisibility;
    const testedWristCoords = testedSide === "right"
      ? this.lastRightWristCoords
      : this.lastLeftWristCoords;

    // Check if wrist is tracked sufficiently
    const minVisibility = this.engineConfig.tracking.minWristVisibility;
    if (!testedWristVisibility || testedWristVisibility < minVisibility) {
      // Not tracked sufficiently - reset stability
      this.readinessStableSinceMs = null;
      return;
    }

    // Check if wrist coords available
    if (!testedWristCoords) {
      this.readinessStableSinceMs = null;
      return;
    }

    // Check if wrist is in starting zone
    const startingZone = this.engineConfig.startingZone;
    const dx = testedWristCoords.x - startingZone.point.x;
    const dy = testedWristCoords.y - startingZone.point.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const inZone = distance <= startingZone.radius;

    if (!inZone) {
      // Not in zone - reset stability
      this.readinessStableSinceMs = null;
      return;
    }

    // Wrist is tracked and in zone
    if (this.readinessStableSinceMs === null) {
      // Start stability timer
      this.readinessStableSinceMs = nowMs;
      return;
    }

    // Check if stability duration met (750ms)
    const stabilityDuration = nowMs - this.readinessStableSinceMs;
    if (stabilityDuration >= 750) {
      // Send readinessConfirmed command
      const result = applyForwardReachCommand(this.engineState, {
        type: "readinessConfirmed",
        nowMs,
        confirmedBy: "clinician",
      });

      // Store command outcome
      this.lastCommandType = "readinessConfirmed";
      this.lastCommandStatus = result.status;
      this.lastCommandRejectionReason = result.status === "rejected" ? result.reason : null;

      if (result.status === "applied") {
        this.engineState = result.state;
      }

      // Mark as sent and disarm
      this.readinessAlreadySent = true;
      this.disarmReadiness();
    }
  }

  /**
   * Arm readiness — opens a 15-second window for automatic readiness confirmation
   * when wrist is stable in starting zone.
   */
  armReadiness(): void {
    if (!this.engineState || this.status !== "running") {
      return;
    }

    // Only arm if in correct phase
    const phase = this.engineState.phase;
    if (phase !== "idle" && phase !== "awaiting_readiness") {
      return;
    }

    // Arm for 15 seconds
    this.readinessArmed = true;
    this.readinessArmedUntilMs = performance.now() + 15000;
    this.readinessStableSinceMs = null;
    this.readinessAlreadySent = false;

    this.emit();
  }

  /**
   * Disarm readiness — cancels armed readiness window.
   */
  disarmReadiness(): void {
    this.readinessArmed = false;
    this.readinessArmedUntilMs = null;
    this.readinessStableSinceMs = null;
    this.readinessAlreadySent = false;

    this.emit();
  }

  /**
   * Confirm readiness — explicit human action to advance from awaiting_readiness.
   */
  confirmReadiness(confirmedBy: string): void {
    if (!this.engineState || this.status !== "running") {
      return;
    }

    const result = applyForwardReachCommand(this.engineState, {
      type: "readinessConfirmed",
      nowMs: performance.now(),
      confirmedBy,
    });

    // Store command outcome for UI feedback
    this.lastCommandType = "readinessConfirmed";
    this.lastCommandStatus = result.status;
    this.lastCommandRejectionReason = result.status === "rejected" ? result.reason : null;

    if (result.status === "applied") {
      this.engineState = result.state;
    }

    // Always emit - UI needs feedback for both success and rejection
    this.emit();
  }

  /**
   * Resume after protective pause — explicit human action required.
   */
  resumeAfterPause(resumedBy: string): void {
    if (!this.engineState || this.status !== "running") {
      return;
    }

    // Engine requires readinessConfirmedAt for resume command
    // Use ISO timestamp for evidentiary attribution
    const readinessConfirmedAt = new Date().toISOString();

    const result = applyForwardReachCommand(this.engineState, {
      type: "resumeRequested",
      nowMs: performance.now(),
      readinessConfirmedAt,
      resumedBy,
    });

    // Store command outcome for UI feedback
    this.lastCommandType = "resumeRequested";
    this.lastCommandStatus = result.status;
    this.lastCommandRejectionReason = result.status === "rejected" ? result.reason : null;

    if (result.status === "applied") {
      this.engineState = result.state;
    }

    // Always emit - UI needs feedback for both success and rejection
    this.emit();
  }
}
