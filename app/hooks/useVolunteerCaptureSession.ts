"use client";

/**
 * Volunteer capture session — camera/detector lifecycle with in-memory capture sink.
 * Persistence is handled separately via useVolunteerResearchPersistence (Slice 8B.3).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ShoulderAbductionReachPoseDetector,
  type ShoulderAbductionReachPoseDetectorSnapshot,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { ShoulderAbductionReachRejectedCapture } from "@/app/lib/ml-research/shoulder-abduction-reach/rep-recorder";
import {
  createVolunteerInMemoryCaptureSink,
  type VolunteerInMemoryCaptureSink,
} from "@/app/volunteer/shoulder-abduction-reach/volunteer-capture-sink";
import {
  createCameraRequestController,
  disposeDetectorIfStale,
  disposePreviewStreamIfStale,
  stopDetectorInstance,
  stopMediaStreamTracks,
  type CameraRequestController,
} from "@/app/volunteer/shoulder-abduction-reach/volunteer-camera-request-control";
import {
  isCaptureComplete,
  VOLUNTEER_TARGET_REPS,
  type VolunteerProtocolCondition,
} from "@/app/volunteer/shoulder-abduction-reach/volunteer-protocol";

const IN_MEMORY_PARTICIPANT_ID = "volunteer-local-participant";
const IN_MEMORY_SESSION_ID = "volunteer-local-session";

export type UseVolunteerCaptureSessionOptions = {
  side: ShoulderAbductionReachSide;
  protocolCondition: VolunteerProtocolCondition;
  onRepCaptured?: (record: ShoulderAbductionReachRepCaptureRecord) => void;
  onTargetReached?: () => void;
};

export function useVolunteerCaptureSession({
  side,
  protocolCondition,
  onRepCaptured,
  onTargetReached,
}: UseVolunteerCaptureSessionOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<ShoulderAbductionReachPoseDetector | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const requestControllerRef = useRef<CameraRequestController>(createCameraRequestController());

  const captureBlockGenerationRef = useRef(0);
  const protocolConditionRef = useRef(protocolCondition);
  protocolConditionRef.current = protocolCondition;

  const onRepCapturedRef = useRef(onRepCaptured);
  onRepCapturedRef.current = onRepCaptured;
  const onTargetReachedRef = useRef(onTargetReached);
  onTargetReachedRef.current = onTargetReached;

  const capturedCountRef = useRef(0);
  const targetReachedRef = useRef(false);

  const captureSinkRef = useRef<VolunteerInMemoryCaptureSink | null>(null);
  if (!captureSinkRef.current) {
    captureSinkRef.current = createVolunteerInMemoryCaptureSink({
      participantId: IN_MEMORY_PARTICIPANT_ID,
      sessionId: IN_MEMORY_SESSION_ID,
      side,
      getProtocolCondition: () => protocolConditionRef.current,
      getCaptureBlockGeneration: () => captureBlockGenerationRef.current,
      onRepCaptured: (record) => {
        if (capturedCountRef.current >= VOLUNTEER_TARGET_REPS) {
          return;
        }
        if (targetReachedRef.current) {
          return;
        }
        onRepCapturedRef.current?.(record);
        capturedCountRef.current += 1;
        applyState(() => setCapturedCount(capturedCountRef.current));
        const reachedTarget = isCaptureComplete(capturedCountRef.current);
        if (reachedTarget) {
          targetReachedRef.current = true;
          onTargetReachedRef.current?.();
        }
      },
      onRepRejected: (rejected) => {
        if (requestControllerRef.current.shouldApplyState()) {
          setRejectedCount((count) => count + 1);
          setLastRejection(rejected);
        }
      },
    });
  }

  const [cameraPreviewActive, setCameraPreviewActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ShoulderAbductionReachPoseDetectorSnapshot | null>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [lastRejection, setLastRejection] = useState<ShoulderAbductionReachRejectedCapture | null>(null);

  const applyState = useCallback((apply: () => void) => {
    if (requestControllerRef.current.shouldApplyState()) {
      apply();
    }
  }, []);

  const stopPreviewStream = useCallback(() => {
    const controller = requestControllerRef.current;
    controller.invalidatePreview();
    stopMediaStreamTracks(previewStreamRef.current);
    previewStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    applyState(() => setCameraPreviewActive(false));
  }, [applyState]);

  const stopDetector = useCallback(() => {
    const controller = requestControllerRef.current;
    controller.invalidateDetector();
    stopDetectorInstance(detectorRef.current);
    detectorRef.current = null;
    applyState(() => setRunning(false));
  }, [applyState]);

  const stopAll = useCallback(() => {
    stopDetector();
    stopPreviewStream();
  }, [stopDetector, stopPreviewStream]);

  const resetCaptureBlock = useCallback(() => {
    captureBlockGenerationRef.current += 1;
    captureSinkRef.current?.resetRecorder();
    capturedCountRef.current = 0;
    targetReachedRef.current = false;
    applyState(() => {
      setCapturedCount(0);
      setRejectedCount(0);
      setLastRejection(null);
      setSnapshot(null);
      setError(null);
    });
  }, [applyState]);

  const enableCameraPreview = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const controller = requestControllerRef.current;
    stopPreviewStream();
    const generation = controller.beginPreviewRequest();
    applyState(() => setError(null));

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      if (!controller.isPreviewCurrent(generation)) {
        stopMediaStreamTracks(stream);
        return;
      }

      previewStreamRef.current = stream;
      video.srcObject = stream;

      try {
        await video.play();
      } catch (playError) {
        disposePreviewStreamIfStale(stream, controller, generation);
        if (controller.isPreviewCurrent(generation)) {
          previewStreamRef.current = null;
          video.srcObject = null;
        }
        throw playError;
      }

      if (!controller.isPreviewCurrent(generation)) {
        disposePreviewStreamIfStale(stream, controller, generation);
        if (previewStreamRef.current === stream) {
          previewStreamRef.current = null;
        }
        if (video.srcObject === stream) {
          video.srcObject = null;
        }
        return;
      }

      applyState(() => setCameraPreviewActive(true));
    } catch (err) {
      if (!controller.isPreviewCurrent(generation)) {
        return;
      }
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission was denied. Please allow camera access and try again."
          : err instanceof Error
            ? err.message
            : "Failed to access the camera.";
      applyState(() => {
        setError(message);
        setCameraPreviewActive(false);
      });
    }
  }, [applyState, stopPreviewStream]);

  const startCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const controller = requestControllerRef.current;
    stopDetector();
    stopPreviewStream();
    const generation = controller.beginDetectorRequest();
    applyState(() => {
      setStarting(true);
      setError(null);
    });

    const sink = captureSinkRef.current;
    if (!sink) return;

    let detector: ShoulderAbductionReachPoseDetector | null = null;

    try {
      detector = new ShoulderAbductionReachPoseDetector(
        {
          onSnapshot: (nextSnapshot) => {
            if (controller.isDetectorCurrent(generation)) {
              applyState(() => setSnapshot(nextSnapshot));
            }
          },
          onDevFrameCaptured: (frame) => {
            if (controller.isDetectorCurrent(generation)) {
              sink.handleFrame(frame);
            }
          },
        },
        side,
      );

      if (!controller.isDetectorCurrent(generation)) {
        disposeDetectorIfStale(detector, controller, generation);
        return;
      }

      detectorRef.current = detector;
      await detector.start(video, canvas);

      if (!controller.isDetectorCurrent(generation)) {
        disposeDetectorIfStale(detector, controller, generation);
        if (detectorRef.current === detector) {
          detectorRef.current = null;
        }
        return;
      }

      applyState(() => setRunning(true));
    } catch (err) {
      if (detector) {
        disposeDetectorIfStale(detector, controller, generation);
        if (detectorRef.current === detector) {
          detectorRef.current = null;
        }
      }
      if (controller.isDetectorCurrent(generation)) {
        applyState(() => {
          setError(err instanceof Error ? err.message : "Failed to start capture session.");
          setRunning(false);
        });
      }
    } finally {
      if (controller.isDetectorCurrent(generation)) {
        applyState(() => setStarting(false));
      }
    }
  }, [applyState, side, stopDetector, stopPreviewStream]);

  const reattachCameraPreview = useCallback(async () => {
    const video = videoRef.current;
    const stream = previewStreamRef.current;
    if (!video || !stream) return;

    const controller = requestControllerRef.current;
    const generation = controller.beginPreviewRequest();
    applyState(() => setError(null));

    try {
      video.srcObject = stream;

      try {
        await video.play();
      } catch (playError) {
        if (controller.isPreviewCurrent(generation)) {
          video.srcObject = null;
        }
        throw playError;
      }

      if (!controller.isPreviewCurrent(generation)) {
        if (video.srcObject === stream) {
          video.srcObject = null;
        }
        return;
      }

      applyState(() => setCameraPreviewActive(true));
    } catch (err) {
      if (!controller.isPreviewCurrent(generation)) {
        return;
      }
      applyState(() => {
        setError(err instanceof Error ? err.message : "Failed to show camera preview.");
        setCameraPreviewActive(false);
      });
    }
  }, [applyState]);

  const resetSession = useCallback(() => {
    requestControllerRef.current.invalidateAll();
    stopAll();
    resetCaptureBlock();
  }, [stopAll, resetCaptureBlock]);

  useEffect(() => {
    const controller = requestControllerRef.current;
    return () => {
      controller.markUnmounted();
      stopDetectorInstance(detectorRef.current);
      detectorRef.current = null;
      stopMediaStreamTracks(previewStreamRef.current);
      previewStreamRef.current = null;
      captureBlockGenerationRef.current += 1;
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    cameraPreviewActive,
    starting,
    running,
    error,
    snapshot,
    capturedCount,
    rejectedCount,
    lastRejection,
    enableCameraPreview,
    reattachCameraPreview,
    startCapture,
    stopDetector,
    stopAll,
    resetSession,
    /** @internal Behavioral tests only */
    __testOnly: {
      getCaptureSink: () => captureSinkRef.current,
      getCaptureBlockGeneration: () => captureBlockGenerationRef.current,
      bumpCaptureBlockGeneration: () => {
        captureBlockGenerationRef.current += 1;
      },
    },
  };
}
