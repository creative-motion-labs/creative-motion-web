/**
 * Patient CV camera stream helpers — preview reliability only.
 * No pose/rep logic.
 */

export const PATIENT_CAMERA_NO_FRAMES_ERROR = "CAMERA_NO_DECODED_FRAMES";

export const PATIENT_CAMERA_NO_FRAMES_MESSAGE =
  "Camera opened but no video frames detected. Try restarting camera.";

export type MediaStreamTrackDiagnostics = {
  kind: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
  label: string;
};

export type PatientCameraDiagnostics = {
  phase: string;
  hasSrcObject: boolean;
  videoReadyState: number;
  videoWidth: number;
  videoHeight: number;
  clientWidth: number;
  clientHeight: number;
  paused: boolean;
  currentTime: number;
  lastFrameTimestamp: number | null;
  streamActive: boolean;
  tracks: MediaStreamTrackDiagnostics[];
  canvasWidth: number;
  canvasHeight: number;
  canvasClientWidth: number;
  canvasClientHeight: number;
  containerClientWidth: number;
  containerClientHeight: number;
  drawImageWouldSucceed: boolean;
  previewRenderable: boolean;
};

export function getMediaStreamTrackDiagnostics(
  stream: MediaStream | null | undefined,
): MediaStreamTrackDiagnostics[] {
  if (!stream) return [];
  return stream.getVideoTracks().map((track) => ({
    kind: track.kind,
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted,
    label: track.label,
  }));
}

/** HAVE_CURRENT_DATA — avoids HTMLMediaElement in Node test runs. */
const VIDEO_HAVE_CURRENT_DATA = 2;

export function isVideoPreviewRenderable(video: HTMLVideoElement | null): boolean {
  if (!video?.srcObject) return false;
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return false;
  if (video.readyState < VIDEO_HAVE_CURRENT_DATA) return false;
  const stream = video.srcObject as MediaStream;
  const tracks = stream.getVideoTracks();
  if (tracks.length === 0) return false;
  return tracks.some((track) => track.readyState === "live" && track.enabled);
}

export function wouldDrawImageSucceed(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  return video.videoWidth > 0 && video.videoHeight > 0 && !video.paused;
}

export function collectPatientCameraDiagnostics(
  phase: string,
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
  container: HTMLElement | null,
): PatientCameraDiagnostics {
  const stream =
    video?.srcObject instanceof MediaStream ? (video.srcObject as MediaStream) : null;
  const tracks = getMediaStreamTrackDiagnostics(stream);

  return {
    phase,
    hasSrcObject: Boolean(video?.srcObject),
    videoReadyState: video?.readyState ?? -1,
    videoWidth: video?.videoWidth ?? 0,
    videoHeight: video?.videoHeight ?? 0,
    clientWidth: video?.clientWidth ?? 0,
    clientHeight: video?.clientHeight ?? 0,
    paused: video?.paused ?? true,
    currentTime: video?.currentTime ?? 0,
    lastFrameTimestamp:
      video && video.videoWidth > 0 ? performance.now() : null,
    streamActive: Boolean(stream?.active),
    tracks,
    canvasWidth: canvas?.width ?? 0,
    canvasHeight: canvas?.height ?? 0,
    canvasClientWidth: canvas?.clientWidth ?? 0,
    canvasClientHeight: canvas?.clientHeight ?? 0,
    containerClientWidth: container?.clientWidth ?? 0,
    containerClientHeight: container?.clientHeight ?? 0,
    drawImageWouldSucceed: wouldDrawImageSucceed(video),
    previewRenderable: isVideoPreviewRenderable(video),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the video element has a non-zero layout box (not display:none). */
export async function waitForVideoElementLayout(
  video: HTMLVideoElement,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (video.clientWidth > 0 && video.clientHeight > 0) return;
    await delay(50);
  }
}

/** Wait until decoded frame dimensions are available — required before pose detect. */
export async function waitForDecodedVideoFrames(
  video: HTMLVideoElement,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 8_000;
  const pollMs = options?.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      if (video.readyState >= VIDEO_HAVE_CURRENT_DATA) return;
    }
    if (video.paused && video.srcObject) {
      try {
        await video.play();
      } catch {
        /* autoplay retry */
      }
    }
    await delay(pollMs);
  }

  throw new Error(PATIENT_CAMERA_NO_FRAMES_ERROR);
}

/**
 * Release MediaStream and detach from video element.
 *
 * CRITICAL: Stops ALL tracks from BOTH the provided stream AND video.srcObject
 * to prevent orphaned tracks from blocking subsequent getUserMedia calls.
 *
 * Idempotent and safe for repeated calls.
 */
export function releaseMediaStream(
  stream: MediaStream | null | undefined,
  video?: HTMLVideoElement | null,
): void {
  // Stop tracks from video.srcObject FIRST (may differ from stream parameter)
  if (video?.srcObject instanceof MediaStream) {
    const videoStream = video.srcObject as MediaStream;
    videoStream.getTracks().forEach((track) => track.stop());
  }

  // Stop tracks from provided stream parameter
  stream?.getTracks().forEach((track) => track.stop());

  // Detach video element
  if (video) {
    video.srcObject = null;
  }
}
