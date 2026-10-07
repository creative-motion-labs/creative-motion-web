/**
 * Pure request-generation helpers for volunteer camera preview and detector startup.
 * Prevents stale async getUserMedia / detector.start callbacks from updating state.
 */

export type MediaStreamLike = {
  getTracks: () => Array<{ stop: () => void }>;
};

export type DetectorLike = {
  stop: () => void;
};

export type CameraRequestController = {
  beginPreviewRequest: () => number;
  beginDetectorRequest: () => number;
  invalidatePreview: () => void;
  invalidateDetector: () => void;
  invalidateAll: () => void;
  markUnmounted: () => void;
  isPreviewCurrent: (generation: number) => boolean;
  isDetectorCurrent: (generation: number) => boolean;
  shouldApplyState: () => boolean;
};

export function stopMediaStreamTracks(stream: MediaStreamLike | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function stopDetectorInstance(detector: DetectorLike | null | undefined): void {
  detector?.stop();
}

export function disposePreviewStreamIfStale(
  stream: MediaStreamLike,
  controller: CameraRequestController,
  generation: number,
): void {
  if (!controller.isPreviewCurrent(generation)) {
    stopMediaStreamTracks(stream);
  }
}

export function disposeDetectorIfStale(
  detector: DetectorLike,
  controller: CameraRequestController,
  generation: number,
): void {
  if (!controller.isDetectorCurrent(generation)) {
    stopDetectorInstance(detector);
  }
}

export function createCameraRequestController(): CameraRequestController {
  let previewGeneration = 0;
  let detectorGeneration = 0;
  let mounted = true;

  const bumpPreview = () => {
    previewGeneration += 1;
  };

  const bumpDetector = () => {
    detectorGeneration += 1;
  };

  return {
    beginPreviewRequest() {
      bumpPreview();
      return previewGeneration;
    },
    beginDetectorRequest() {
      bumpDetector();
      return detectorGeneration;
    },
    invalidatePreview: bumpPreview,
    invalidateDetector: bumpDetector,
    invalidateAll() {
      bumpPreview();
      bumpDetector();
    },
    markUnmounted() {
      mounted = false;
      bumpPreview();
      bumpDetector();
    },
    isPreviewCurrent(generation: number) {
      return mounted && generation === previewGeneration;
    },
    isDetectorCurrent(generation: number) {
      return mounted && generation === detectorGeneration;
    },
    shouldApplyState() {
      return mounted;
    },
  };
}
