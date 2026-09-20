/**
 * Lateral Reach Live-Camera Detector — Experimental integration spike.
 *
 * Validates that MediaPipe → BLAZEPOSE_ACQUISITION_ADAPTER → Lateral Reach
 * engine integration works correctly from real camera input.
 *
 * Owns: camera lifecycle, MediaPipe initialization, frame loop, engine feeding.
 *
 * Does NOT own: React UI, tested side selection UI, persistence, API calls.
 *
 * Pattern: Mirrors ForwardReachCameraDetector architecture but uses Lateral
 * Reach engine which has directional onset semantics and strictly increasing
 * frame timestamps.
 */

import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition/adapters/motion/blazepose-acquisition-adapter";
import type { InputAcquisitionContext } from "@/app/lib/input-acquisition/contract";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import {
  applyLateralReachCommand,
  createLateralReachAttemptState,
  getLateralReachRuntimeSnapshot,
  validateLateralReachConfig,
  type LateralReachAttemptState,
  type LateralReachConfig,
  type LateralReachRuntimeSnapshot,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import type {
  UpperLimbMovementAttemptResult,
  UpperLimbSide,
} from "@/app/lib/upper-limb-motor-screen/types";
import {
  releaseMediaStream,
  waitForDecodedVideoFrames,
  waitForVideoElementLayout,
} from "@/app/lib/cv/patient-camera-stream";

/**
 * Normalize command timestamp for engine command stream.
 *
 * Guarantees:
 * 1. Result >= lastCommandNowMs (general monotonic)
 * 2. For frame commands, result > lastFrameNowMs (strictly increasing)
 *
 * Prevents clock skew when normalized frame timestamps move ahead of raw wall-clock time.
 *
 * @internal Exported for regression testing only.
 */
export function normalizeCommandTimestampForTesting(
  rawTimestamp: number,
  lastCommandNowMs: number | null,
  lastFrameNowMs: number | null,
  isFrameCommand: boolean
): number {
  // General monotonic constraint: never move backward relative to last command
  let normalized = lastCommandNowMs !== null
    ? Math.max(lastCommandNowMs + 1, rawTimestamp)
    : rawTimestamp;

  // Frame-specific strictly-increasing constraint
  if (isFrameCommand && lastFrameNowMs !== null) {
    normalized = Math.max(lastFrameNowMs + 1, normalized);
  }

  return normalized;
}

/**
 * Isolated optional onFrame notification.
 * Observer failures must not escape into detector frame processing.
 *
 * @internal Exported for regression testing only.
 */
export function notifyLateralReachCameraFrameObserver(
  onFrame: ((frame: NormalizedMotionFrame) => void) | undefined,
  frame: NormalizedMotionFrame,
): void {
  if (!onFrame) return;
  try {
    onFrame(frame);
  } catch (err) {
    console.error("[LateralReachCameraDetector] Frame observer error:", err);
  }
}

/**
 * One processed camera observation tick: a normalized frame when the
 * adapter produced one, or null when no pose was available (no landmarks,
 * or adapter rejected the landmarks). Uses the same raw acquisition
 * timestamp as onFrame — no timestamp repair.
 */
export type LateralReachCameraAcquisitionObservation = {
  capturedAtMs: number;
  frame: NormalizedMotionFrame | null;
};

/**
 * Isolated optional onAcquisitionObservation notification.
 * Fires once per processed camera observation regardless of engine
 * activation state. Observer failures must not escape into detector frame
 * processing.
 *
 * @internal Exported for regression testing only.
 */
export function notifyLateralReachCameraAcquisitionObserver(
  onAcquisitionObservation:
    | ((observation: LateralReachCameraAcquisitionObservation) => void)
    | undefined,
  observation: LateralReachCameraAcquisitionObservation,
): void {
  if (!onAcquisitionObservation) return;
  try {
    onAcquisitionObservation(observation);
  } catch (err) {
    console.error(
      "[LateralReachCameraDetector] Acquisition observation observer error:",
      err,
    );
  }
}

export type LateralReachCameraStatus =
  | "idle"
  | "initializing"
  | "acquiring"
  | "running"
  | "error";
export type LateralReachCameraInitPhase = null | "import" | "model" | "camera";

export type LateralReachCameraSnapshot = {
  status: LateralReachCameraStatus;
  initPhase: LateralReachCameraInitPhase;
  error: string | null;
  engineSnapshot: LateralReachRuntimeSnapshot | null;

  // Laterality diagnostics
  rightWristVisibility: number | null;
  leftWristVisibility: number | null;
  rightWristCoords: { x: number; y: number } | null;
  leftWristCoords: { x: number; y: number } | null;
  testedSide: UpperLimbSide;

  // Directional diagnostics - derived from config
  expectedHorizontalDirectionSign: 1 | -1 | null;

  // Command feedback
  lastCommandType: string | null;
  lastCommandStatus: "applied" | "rejected" | null;
  lastCommandRejectionReason: string | null;

  // Armed readiness
  readinessArmed: boolean;
  readinessArmedTimeRemaining: number | null; // milliseconds remaining in armed window

  // Terminal outcome — set once the attempt window has been explicitly ended.
  finalResult: UpperLimbMovementAttemptResult | null;
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

export type LateralReachCameraOverlayDisplayMode = "clinical" | "patient";

export type LateralReachCameraAcquisitionOptions = {
  /** Tested side for acquisition-only pose overlay (before engine config exists). */
  overlayTestedSide?: UpperLimbSide;
  /** Patient mode draws skeleton only; clinical mode includes debug labels and zones. */
  overlayDisplayMode?: LateralReachCameraOverlayDisplayMode;
};

export type LateralReachCameraDetectorCallbacks = {
  onSnapshot: (snapshot: LateralReachCameraSnapshot) => void;
  /** Optional — acquisition observation only; invoked after engine frame handling. */
  onFrame?: (frame: NormalizedMotionFrame) => void;
  /**
   * Optional — fires once per processed camera observation (frame present
   * or absent) regardless of engine activation state. Uses the raw
   * acquisition timestamp; no timestamp repair, no coordinate transforms.
   */
  onAcquisitionObservation?: (
    observation: LateralReachCameraAcquisitionObservation,
  ) => void;
};

type LateralReachCameraConfig = {
  modelUrl?: string;
  wasmUrl?: string;
  initTimeoutMs?: number;
};

const DEFAULT_CONFIG: Required<LateralReachCameraConfig> = {
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
      // NotReadableError: device busy, hardware issue, or browser-level lock
      // DO NOT assume another application owns it
      return "Camera could not be started by the browser. The device may be busy, in use by another tab or application, or unavailable. Check that no other tabs or apps are using the camera, then retry.";
    }
  }
  if (err instanceof Error) {
    if (err.message.includes("timed out")) return err.message;
    return err.message;
  }
  return "Camera could not start. Please check camera permission and try again.";
}

/**
 * Lateral Reach Camera Detector — validates live MediaPipe → Motor Screen integration.
 *
 * Epoch-based async cancellation prevents stale init completions.
 * Idempotent cleanup safe for stop/unmount during async operations.
 *
 * CRITICAL: Lateral Reach engine requires STRICTLY INCREASING frame timestamps.
 */
export class LateralReachCameraDetector {
  private readonly config: Required<LateralReachCameraConfig>;
  private readonly callbacks: LateralReachCameraDetectorCallbacks;

  // Session lifecycle
  private sessionEpoch = 0;
  private currentEpoch = 0;
  private status: LateralReachCameraStatus = "idle";
  private initPhase: LateralReachCameraInitPhase = null;
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

  // Unified command clock - ensures monotonic command stream
  private lastCommandNowMs: number | null = null; // General monotonic for all commands
  private lastFrameNowMs: number | null = null; // Strictly increasing for frame commands

  // Engine state
  private engineConfig: LateralReachConfig | null = null;
  private engineState: LateralReachAttemptState | null = null;
  /** Acquisition-only overlay context — cleared on stop. */
  private acquisitionOverlayTestedSide: UpperLimbSide | null = null;
  private overlayDisplayMode: LateralReachCameraOverlayDisplayMode = "clinical";

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

  // Terminal outcome
  private finalResult: UpperLimbMovementAttemptResult | null = null;

  constructor(
    callbacks: LateralReachCameraDetectorCallbacks,
    config: LateralReachCameraConfig = {},
  ) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Normalize command timestamp for engine command stream.
   *
   * Guarantees:
   * 1. Result >= lastCommandNowMs (general monotonic)
   * 2. For frame commands, result > lastFrameNowMs (strictly increasing)
   *
   * Prevents clock skew when normalized frame timestamps move ahead of raw wall-clock time.
   */
  private normalizeCommandTimestamp(rawTimestamp: number, isFrameCommand: boolean): number {
    return normalizeCommandTimestampForTesting(
      rawTimestamp,
      this.lastCommandNowMs,
      this.lastFrameNowMs,
      isFrameCommand
    );
  }

  getSnapshot(): LateralReachCameraSnapshot {
    return {
      status: this.status,
      initPhase: this.initPhase,
      error: this.error,
      engineSnapshot: this.engineState ? getLateralReachRuntimeSnapshot(this.engineState) : null,
      rightWristVisibility: this.lastRightWristVisibility,
      leftWristVisibility: this.lastLeftWristVisibility,
      rightWristCoords: this.lastRightWristCoords,
      leftWristCoords: this.lastLeftWristCoords,
      testedSide: this.engineConfig?.testedSide ?? "right",
      expectedHorizontalDirectionSign: this.engineConfig?.expectedHorizontalDirectionSign ?? null,
      lastCommandType: this.lastCommandType,
      lastCommandStatus: this.lastCommandStatus,
      lastCommandRejectionReason: this.lastCommandRejectionReason,
      readinessArmed: this.readinessArmed,
      readinessArmedTimeRemaining:
        this.readinessArmed && this.readinessArmedUntilMs
          ? Math.max(0, this.readinessArmedUntilMs - performance.now())
          : null,
      finalResult: this.finalResult,
    };
  }

  private emit(): void {
    this.callbacks.onSnapshot(this.getSnapshot());
  }

  /**
   * Begin a new detector session epoch synchronously.
   * Leaves status at initializing/import before any await.
   */
  private beginSession(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
  ): number {
    const epoch = this.sessionEpoch + 1;
    this.sessionEpoch = epoch;
    this.currentEpoch = epoch;

    this.videoEl = video;
    this.canvasEl = canvas;
    this.engineConfig = null;
    this.engineState = null;
    this.status = "initializing";
    this.initPhase = "import";
    this.error = null;
    this.detectTimestamp = 0;
    this.frameIndex = 0;
    this.lastCommandNowMs = null;
    this.lastFrameNowMs = null;
    this.lastRightWristVisibility = null;
    this.lastLeftWristVisibility = null;
    this.lastRightWristCoords = null;
    this.lastLeftWristCoords = null;
    this.lastCommandType = null;
    this.lastCommandStatus = null;
    this.lastCommandRejectionReason = null;
    this.readinessArmed = false;
    this.readinessArmedUntilMs = null;
    this.readinessStableSinceMs = null;
    this.readinessAlreadySent = false;
    this.finalResult = null;
    this.emit();
    return epoch;
  }

  /**
   * Shared MediaPipe + camera acquisition path.
   * Does not create engine state and does not choose acquiring/running.
   */
  private async acquireCameraAndModel(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    epoch: number,
  ): Promise<void> {
    const isCurrent = () => this.sessionEpoch === epoch;

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

    // canvas reserved for frame-loop overlay; kept for API symmetry with callers
    void canvas;
  }

  private handleAcquisitionFailure(err: unknown, epoch: number): void {
    const isCurrent = () => this.sessionEpoch === epoch;

    if (err instanceof DOMException) {
      console.error("[LateralReachCameraDetector] Camera acquisition DOMException:", {
        name: err.name,
        message: err.message,
        code: err.code,
        constructor: err.constructor.name,
        detectorStream: this.stream ? "exists" : "null",
        detectorStreamTracks: this.stream?.getTracks().map(t => ({
          kind: t.kind,
          readyState: t.readyState,
          enabled: t.enabled,
          label: t.label,
        })) ?? [],
        videoSrcObject: this.videoEl?.srcObject ? "exists" : "null",
        videoSrcObjectTracks: this.videoEl?.srcObject instanceof MediaStream
          ? (this.videoEl.srcObject as MediaStream).getTracks().map(t => ({
              kind: t.kind,
              readyState: t.readyState,
              enabled: t.enabled,
              label: t.label,
            }))
          : [],
        mediaDevicesAvailable: Boolean(navigator.mediaDevices),
      });
    } else {
      console.error("[LateralReachCameraDetector] Camera acquisition error:", err);
    }

    if (this.poseLandmarker && this.currentEpoch === epoch) {
      this.poseLandmarker.close?.();
      this.poseLandmarker = null;
    }

    if (!isCurrent()) return;
    this.stop();
    this.error = mapStartError(err);
    this.status = "error";
    this.emit();
  }

  /**
   * Start camera session with Lateral Reach engine configuration.
   * Async operations protected by epoch cancellation.
   *
   * Observable success sequence remains initializing → running and never
   * emits acquiring (acquisition-only mode uses startAcquisition()).
   */
  async start(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    engineConfig: LateralReachConfig,
  ): Promise<void> {
    // Validate config eagerly BEFORE camera/session mutation.
    const configResult = validateLateralReachConfig(engineConfig);
    if (!configResult.ok) {
      throw new Error(`Invalid Lateral Reach config: ${configResult.reason}`);
    }

    const epoch = this.beginSession(video, canvas);
    // Preserve legacy assignment timing: validated config is held before acquire.
    this.engineConfig = configResult.config;
    const isCurrent = () => this.sessionEpoch === epoch;

    try {
      await this.acquireCameraAndModel(video, canvas, epoch);
      if (!isCurrent()) return;
      if (!this.engineConfig) {
        throw new Error("Failed to create Lateral Reach state: missing engine config");
      }

      // Initialize Lateral Reach engine before first frame / running.
      const stateResult = createLateralReachAttemptState(
        this.engineConfig,
        0, // attemptIndex
        performance.now(), // armedAtMs
      );

      if (!stateResult.ok) {
        throw new Error(`Failed to create Lateral Reach state: ${stateResult.reason}`);
      }
      this.engineState = stateResult.state;

      // Start frame loop
      this.status = "running";
      this.initPhase = null;
      this.emit();

      this.startFrameLoop(video);
    } catch (err) {
      // Capture currency before failure cleanup: stop() advances the epoch.
      const stillCurrent = this.sessionEpoch === epoch;
      this.handleAcquisitionFailure(err, epoch);
      if (!stillCurrent) return;
      throw err;
    }
  }

  /**
   * Acquisition-only camera/MediaPipe start.
   * Fail-closed: legal only from idle; never creates engine state.
   */
  async startAcquisition(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    options?: LateralReachCameraAcquisitionOptions,
  ): Promise<void> {
    // Synchronous fail-closed guard before any await / session mutation.
    if (this.status !== "idle") {
      throw new RangeError(
        'startAcquisition requires status "idle"',
      );
    }

    this.acquisitionOverlayTestedSide = options?.overlayTestedSide ?? null;
    this.overlayDisplayMode = options?.overlayDisplayMode ?? "clinical";

    const epoch = this.beginSession(video, canvas);
    const isCurrent = () => this.sessionEpoch === epoch;

    try {
      await this.acquireCameraAndModel(video, canvas, epoch);
      if (!isCurrent()) return;

      this.status = "acquiring";
      this.initPhase = null;
      this.emit();
      this.startFrameLoop(video);
    } catch (err) {
      const stillCurrent = this.sessionEpoch === epoch;
      this.handleAcquisitionFailure(err, epoch);
      if (!stillCurrent) return;
      throw err;
    }
  }

  /**
   * Activate the Lateral Reach engine on an acquisition-only session.
   * Fail-closed: legal only while acquiring with no active engine.
   */
  startEngine(engineConfig: LateralReachConfig): void {
    if (this.status !== "acquiring" || this.engineState !== null) {
      throw new RangeError(
        'startEngine requires status "acquiring" with no active engine',
      );
    }

    const configResult = validateLateralReachConfig(engineConfig);
    if (!configResult.ok) {
      throw new RangeError(`Invalid Lateral Reach config: ${configResult.reason}`);
    }

    const stateResult = createLateralReachAttemptState(
      configResult.config,
      0,
      performance.now(),
    );
    if (!stateResult.ok) {
      throw new RangeError(
        `Failed to create Lateral Reach state: ${stateResult.reason}`,
      );
    }

    this.engineConfig = configResult.config;
    this.engineState = stateResult.state;
    this.status = "running";
    this.emit();
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
   * Draw pose debug overlay: skeleton, tested wrist, starting zone, target zone.
   * Engineering visualization only - not clinical measurement.
   */
  private drawPoseDebugOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    landmarks: PoseLandmark[] | undefined,
  ): void {
    const testedSide =
      this.engineConfig?.testedSide ?? this.acquisitionOverlayTestedSide ?? "right";
    const testedWristIndex = testedSide === "right" ? 16 : 15;
    const minVisibility = this.engineConfig?.tracking.minWristVisibility ?? 0.3;

    // Draw skeleton connections whenever landmarks are available.
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

    if (!this.engineConfig) {
      if (this.overlayDisplayMode === "patient") {
        return;
      }

      const testedWrist = landmarks?.[testedWristIndex];
      const visibility = testedWrist?.visibility ?? 0;
      const wristTracked = Boolean(testedWrist) && visibility >= minVisibility;
      const trackedStatus = wristTracked ? "TRACKED" : "NOT TRACKED";
      const trackedColor = wristTracked ? "#22d3ee" : "#ef4444";
      ctx.fillStyle = trackedColor;
      ctx.font = "bold 14px monospace";
      this.drawUnmirroredText(
        ctx,
        `Tested wrist (${testedSide.toUpperCase()}): ${trackedStatus}`,
        10,
        25,
        width,
      );
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "11px monospace";
      this.drawUnmirroredText(
        ctx,
        "Pose overlay — for movement observation review",
        10,
        height - 10,
        width,
      );
      return;
    }

    if (this.overlayDisplayMode === "patient") {
      return;
    }

    // Draw starting zone
    const startingZone = this.engineConfig.startingZone;
    const startCenterX = startingZone.point.x * width;
    const startCenterY = startingZone.point.y * height;
    const startRadiusPixels = startingZone.radius * Math.min(width, height);

    // Zone circle
    ctx.beginPath();
    ctx.arc(startCenterX, startCenterY, startRadiusPixels, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(239,159,39,0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center marker
    ctx.beginPath();
    ctx.arc(startCenterX, startCenterY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(239,159,39,0.9)";
    ctx.fill();

    // Zone label (readable despite CSS mirror)
    ctx.fillStyle = "rgba(239,159,39,0.9)";
    ctx.font = "12px monospace";
    this.drawUnmirroredText(ctx, "Starting Zone", startCenterX + startRadiusPixels + 5, startCenterY, width);

    // Draw target zone
    const targetZone = this.engineConfig.fixedTarget;
    const targetCenterX = targetZone.point.x * width;
    const targetCenterY = targetZone.point.y * height;
    const targetRadiusPixels = targetZone.radius * Math.min(width, height);

    // Zone circle
    ctx.beginPath();
    ctx.arc(targetCenterX, targetCenterY, targetRadiusPixels, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(45,212,191,0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center marker
    ctx.beginPath();
    ctx.arc(targetCenterX, targetCenterY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(45,212,191,0.9)";
    ctx.fill();

    // Zone label (readable despite CSS mirror)
    ctx.fillStyle = "rgba(45,212,191,0.9)";
    ctx.font = "12px monospace";
    this.drawUnmirroredText(ctx, "Target", targetCenterX + targetRadiusPixels + 5, targetCenterY, width);

    // Readiness status text
    const minVisibilityForStatus = this.engineConfig.tracking.minWristVisibility;
    let wristTracked = false;
    let wristInZone = false;

    if (landmarks && landmarks.length > 0) {
      const testedWrist = landmarks[testedWristIndex];
      const visibility = testedWrist?.visibility ?? 0;
      wristTracked = visibility >= minVisibilityForStatus;

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
   *
   * CRITICAL: Lateral Reach requires strictly increasing frame timestamps.
   * Each capturedAtMs must be > lastAcceptedFrameNowMs.
   */
  private startFrameLoop(video: HTMLVideoElement): void {
    const epoch = this.currentEpoch;

    const detect = () => {
      // Guard: session still active
      if (this.sessionEpoch !== epoch) return;

      // Guard: acquisition resources ready (engine may be absent in acquiring mode)
      if (!this.poseLandmarker) return;

      // Guard: video ready
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        this.rafId = requestAnimationFrame(detect);
        return;
      }

      try {
        // Monotonic MediaPipe inference timestamp
        this.detectTimestamp = Math.max(this.detectTimestamp + 1, performance.now());

        // Raw acquisition timestamp
        const rawTimestamp = performance.now();

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

        // Slice 19 — resolved once below regardless of branch taken.
        let acquisitionObservationFrame: NormalizedMotionFrame | null = null;

        if (landmarks && landmarks.length > 0) {
          // Create acquisition context (uses raw timestamp for metadata)
          const context: InputAcquisitionContext = {
            frameIndex: this.frameIndex,
            capturedAtMs: rawTimestamp,
            deviceLabel: "front_camera",
          };

          // Normalize via existing BlazePose adapter
          const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);

          // Update laterality diagnostics
          this.updateLateralityDiagnostics(landmarks);

          if (frame) {
            acquisitionObservationFrame = frame;
            // CASE A: Valid frame from adapter
            if (this.engineState) {
              // Normalize timestamp with frame-specific strict-increase constraint
              const frameTimestamp = this.normalizeCommandTimestamp(rawTimestamp, true);

              const engineResult = applyLateralReachCommand(this.engineState, {
                type: "frame",
                nowMs: frameTimestamp,
                frame,
              });

              // BLOCKER 2 FIX: Only update command feedback for rejected frame commands
              if (engineResult.status === "rejected") {
                this.lastCommandType = "frame";
                this.lastCommandStatus = "rejected";
                this.lastCommandRejectionReason = engineResult.reason;
              }

              if (engineResult.status === "applied") {
                this.engineState = engineResult.state;
                // Update unified command clock
                this.lastCommandNowMs = frameTimestamp;
                this.lastFrameNowMs = frameTimestamp;
              }

              // Frame exposure seam: after engine handling, applied or rejected.
              notifyLateralReachCameraFrameObserver(this.callbacks.onFrame, frame);
            } else {
              // Acquisition-only: expose frame with zero engine commands.
              notifyLateralReachCameraFrameObserver(this.callbacks.onFrame, frame);
            }
          } else if (this.engineState) {
            // CASE C: MediaPipe returned landmarks but adapter returned null
            // Normalize timestamp with general monotonic constraint
            const commandTimestamp = this.normalizeCommandTimestamp(rawTimestamp, false);

            const engineResult = applyLateralReachCommand(this.engineState, {
              type: "observationUnavailable",
              nowMs: commandTimestamp,
            });

            // BLOCKER 2 FIX: Only update command feedback for rejected observationUnavailable
            if (engineResult.status === "rejected") {
              this.lastCommandType = "observationUnavailable";
              this.lastCommandStatus = "rejected";
              this.lastCommandRejectionReason = engineResult.reason;
            }

            if (engineResult.status === "applied") {
              this.engineState = engineResult.state;
              // Update general command clock only
              this.lastCommandNowMs = commandTimestamp;
            }
          }
          // Acquisition-only CASE C: no engine command, no onFrame.
        } else {
          // CASE B: MediaPipe returned no pose landmarks
          if (this.engineState) {
            // Normalize timestamp with general monotonic constraint
            const commandTimestamp = this.normalizeCommandTimestamp(rawTimestamp, false);

            const engineResult = applyLateralReachCommand(this.engineState, {
              type: "observationUnavailable",
              nowMs: commandTimestamp,
            });

            // BLOCKER 2 FIX: Only update command feedback for rejected observationUnavailable
            if (engineResult.status === "rejected") {
              this.lastCommandType = "observationUnavailable";
              this.lastCommandStatus = "rejected";
              this.lastCommandRejectionReason = engineResult.reason;
            }

            if (engineResult.status === "applied") {
              this.engineState = engineResult.state;
              // Update general command clock only
              this.lastCommandNowMs = commandTimestamp;
            }
          }
          // Acquisition-only CASE B: no engine command.

          // Clear laterality diagnostics
          this.lastRightWristVisibility = null;
          this.lastLeftWristVisibility = null;
          this.lastRightWristCoords = null;
          this.lastLeftWristCoords = null;
        }

        // Slice 19 — acquisition observation seam: fires once per processed
        // camera tick regardless of engine state, using the raw acquisition
        // timestamp captured above. No timestamp repair, no x inversion, no
        // direction inference.
        notifyLateralReachCameraAcquisitionObserver(
          this.callbacks.onAcquisitionObservation,
          { capturedAtMs: rawTimestamp, frame: acquisitionObservationFrame },
        );

        // Check armed readiness (uses same unified clock)
        this.checkArmedReadiness(rawTimestamp);

        // Emit snapshot
        this.emit();
      } catch (err) {
        console.error("[LateralReachCameraDetector] Frame processing error:", err);
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
    this.lastCommandNowMs = null;
    this.lastFrameNowMs = null;
    this.engineState = null;
    this.engineConfig = null;
    this.acquisitionOverlayTestedSide = null;
    this.overlayDisplayMode = "clinical";
    this.status = "idle";
    this.initPhase = null;

    // Emit final snapshot
    this.emit();
  }

  /**
   * Check armed readiness conditions and send readinessConfirmed if stable in zone.
   */
  private checkArmedReadiness(rawTimestamp: number): void {
    if (!this.readinessArmed || !this.engineState || !this.engineConfig) {
      return;
    }

    // Normalize timestamp for command clock consistency
    const nowMs = this.normalizeCommandTimestamp(rawTimestamp, false);

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

    // Protective pause must be explicitly resumed before readiness can be confirmed.
    if (this.engineState.activePause !== null) {
      this.readinessStableSinceMs = null;
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
      const result = applyLateralReachCommand(this.engineState, {
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
        // Update general command clock
        this.lastCommandNowMs = nowMs;
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

    // Normalize timestamp for command clock consistency
    const nowMs = this.normalizeCommandTimestamp(performance.now(), false);

    const result = applyLateralReachCommand(this.engineState, {
      type: "readinessConfirmed",
      nowMs,
      confirmedBy,
    });

    // Store command outcome for UI feedback
    this.lastCommandType = "readinessConfirmed";
    this.lastCommandStatus = result.status;
    this.lastCommandRejectionReason = result.status === "rejected" ? result.reason : null;

    if (result.status === "applied") {
      this.engineState = result.state;
      // Update general command clock
      this.lastCommandNowMs = nowMs;
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

    // Normalize timestamp for command clock consistency
    const nowMs = this.normalizeCommandTimestamp(performance.now(), false);

    // Engine requires readinessConfirmedAt for resume command
    // Use ISO timestamp for evidentiary attribution
    const readinessConfirmedAt = new Date().toISOString();

    const result = applyLateralReachCommand(this.engineState, {
      type: "resumeRequested",
      nowMs,
      readinessConfirmedAt,
      resumedBy,
    });

    // Store command outcome for UI feedback
    this.lastCommandType = "resumeRequested";
    this.lastCommandStatus = result.status;
    this.lastCommandRejectionReason = result.status === "rejected" ? result.reason : null;

    if (result.status === "applied") {
      this.engineState = result.state;
      // Update general command clock
      this.lastCommandNowMs = nowMs;
    }

    // Always emit - UI needs feedback for both success and rejection
    this.emit();
  }

  /**
   * End the attempt window — explicit terminal action. Sends attemptWindowEnded
   * through the engine and exposes the resulting terminal result via
   * getSnapshot().finalResult.
   */
  endAttemptWindow(): void {
    if (!this.engineState || this.status !== "running") {
      return;
    }

    // Normalize timestamp for command clock consistency
    const nowMs = this.normalizeCommandTimestamp(performance.now(), false);

    const result = applyLateralReachCommand(this.engineState, {
      type: "attemptWindowEnded",
      nowMs,
    });

    // Store command outcome for UI feedback
    this.lastCommandType = "attemptWindowEnded";
    this.lastCommandStatus = result.status;
    this.lastCommandRejectionReason = result.status === "rejected" ? result.reason : null;

    if (result.status === "applied") {
      this.engineState = result.state;
      // Update general command clock
      this.lastCommandNowMs = nowMs;
      this.finalResult = result.attemptResult;
    }

    // Always emit - UI needs feedback for both success and rejection
    this.emit();
  }
}
