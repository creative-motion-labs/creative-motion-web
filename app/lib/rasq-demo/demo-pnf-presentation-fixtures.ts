import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  ShoulderAbductionReachPoseDetector,
  type ShoulderAbductionReachPoseDetectorSnapshot,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import { toMirroredPreviewPoint } from "@/app/lib/interactive-shoulder/presentation-mirror";

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

/** Illustration start: right hand low on anatomical right (raw image = low x). */
export const PNF_DEMO_START_LANDMARKS = facingCameraLandmarks({
  rightWrist: { x: 0.38, y: 0.68 },
  leftWrist: { x: 0.62, y: 0.66 },
});

/** Illustration end: right hand toward left shoulder (raw image = higher x, higher on body). */
export const PNF_DEMO_END_LANDMARKS = facingCameraLandmarks({
  rightWrist: { x: 0.64, y: 0.26 },
  leftWrist: { x: 0.64, y: 0.58 },
});

export function facingCameraLandmarks(options: {
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
  lm[R_ELBOW] = { x: 0.34, y: 0.52, visibility: 0.95 };
  lm[R_WRIST] = { x: options.rightWrist.x, y: options.rightWrist.y, visibility: 0.92 };
  lm[L_SHOULDER] = { x: 0.6, y: 0.35, visibility: 0.95 };
  lm[L_HIP] = { x: 0.58, y: 0.62, visibility: 0.95 };
  lm[L_ELBOW] = { x: 0.66, y: 0.48, visibility: 0.95 };
  lm[L_WRIST] = { x: options.leftWrist.x, y: options.leftWrist.y, visibility: 0.92 };
  return lm;
}

type LiveInternals = {
  previewActive: boolean;
  videoEl: HTMLVideoElement | null;
  canvasEl: HTMLCanvasElement | null;
  poseLandmarker: unknown;
  tickLiveVideoFrame: (options?: { scheduleNext?: boolean }) => void;
  resetSessionState: () => void;
};

function mockVideo(): HTMLVideoElement {
  return {
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
    paused: false,
    play: async () => {},
    addEventListener: () => {},
    srcObject: null,
  } as unknown as HTMLVideoElement;
}

function mockCanvas(): HTMLCanvasElement {
  const ctx = {
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };
  return { getContext: () => ctx } as unknown as HTMLCanvasElement;
}

export function publishedSnapshotFor(
  side: ShoulderAbductionReachSide,
  landmarks: PoseLandmark[],
): ShoulderAbductionReachPoseDetectorSnapshot {
  const snapshots: ShoulderAbductionReachPoseDetectorSnapshot[] = [];
  const detector = new ShoulderAbductionReachPoseDetector(
    { onSnapshot: (snap) => snapshots.push(snap) },
    side,
  );
  const internals = detector as unknown as LiveInternals;
  const video = mockVideo();
  internals.resetSessionState();
  internals.videoEl = video;
  internals.canvasEl = mockCanvas();
  internals.previewActive = true;
  internals.poseLandmarker = { detectForVideo: () => ({ landmarks: [landmarks] }) };

  for (let frame = 1; frame <= 20 && snapshots.length === 0; frame += 1) {
    video.currentTime = frame / 30;
    internals.tickLiveVideoFrame({ scheduleNext: false });
  }

  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    throw new Error("detector did not publish a snapshot");
  }
  return latest;
}

/** Wrist in mirrored preview space — same conversion as OrchestratorCvSessionCore RAF dispatch. */
export function previewWristFromFacingCameraLandmarks(
  side: ShoulderAbductionReachSide,
  landmarks: PoseLandmark[],
): { x: number; y: number } {
  const snap = publishedSnapshotFor(side, landmarks);
  const measured = snap.primaryWristNormalized;
  if (!measured) {
    throw new Error("fixture must produce a tracked primary wrist");
  }
  const preview = toMirroredPreviewPoint(measured);
  if (!preview) {
    throw new Error("mirror conversion failed");
  }
  return preview;
}
