"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createAssessment, saveResult } from "../lib/api";
import {
  AclSingleLegSquatTracker,
  isAclSingleLegSquatTest,
  type NormLandmark,
} from "../lib/body-axis-acl-squat";
import { assessmentsRepository } from "../lib/repositories";
import {
  analysePostureFrame,
  aggregatePostureResults,
  type PostureCheckResult,
  type PostureDataSufficiency,
} from "../lib/posture-analyzer";
import PostureReport from "../components/PostureReport";

type SessionState = "idle" | "ready" | "running" | "stopped";

const MEDIAPIPE_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm";
const MEDIAPIPE_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const POSE_LOAD_TIMEOUT_MS = 45_000;
const ACL_MIN_POSE_FRAMES = 8;

/** BlazePose 33-landmark topology for overlay lines (MediaPipe-compatible indices). */
const POSE_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [28, 32],
];

/** Rotating tips when stance-leg visibility is weak (synced with ACL tracker output). */
const ACL_GUIDANCE_TIPS = [
  "Keep full right leg visible",
  "Move slightly back",
  "Improve lighting",
] as const;

/**
 * Map normalized landmarks to the displayed `<video>` rect (same transform as CSS `object-cover`).
 */
function drawPoseLandmarksOnCanvas(
  ctx: CanvasRenderingContext2D,
  landmarks: NormLandmark[],
  video: HTMLVideoElement
) {
  const cw = Math.max(1, Math.floor(video.clientWidth));
  const ch = Math.max(1, Math.floor(video.clientHeight));
  const canvas = ctx.canvas;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }

  const vw = Math.max(1, video.videoWidth || cw);
  const vh = Math.max(1, video.videoHeight || ch);
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (cw - dw) * 0.5;
  const oy = (ch - dh) * 0.5;

  const map = (lm: NormLandmark) => ({
    x: ox + lm.x * dw,
    y: oy + lm.y * dh,
  });

  ctx.clearRect(0, 0, cw, ch);
  ctx.strokeStyle = "rgba(34, 211, 238, 0.9)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of POSE_EDGES) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    const A = map(pa);
    const B = map(pb);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(34, 211, 238, 0.6)";
  for (const lm of landmarks) {
    if (!lm) continue;
    const p = map(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function BodyAxisAIPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const patientId = searchParams.get("patientId") || "UNKNOWN";
  const patientName = searchParams.get("patientName") || "Unknown Patient";
  const test = searchParams.get("test") || "posture";
  const assessmentId = searchParams.get("assessmentId") || "AX-1001";

  const assessment = useMemo(
    () => assessmentsRepository.getById(assessmentId),
    [assessmentId]
  );
  const hasLinkedAssessment = Boolean(assessment);
  const displayPatientId = patientId === "UNKNOWN" ? "Not provided" : patientId;
  const displayPatientName =
    patientName === "Unknown Patient" ? "Not provided" : patientName;

  const aclMode = isAclSingleLegSquatTest(test) || test === "squat";
  const postureMode = test === "posture";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const sessionStateRef = useRef<SessionState>("idle");
  const aclTrackerRef = useRef(new AclSingleLegSquatTracker());
  const poseLandmarkerRef = useRef<{
    detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks?: NormLandmark[][] };
    close: () => void;
  } | null>(null);
  const poseRafRef = useRef<number | null>(null);
  const aclPoseFramesThisRunRef = useRef(0);
  /** Last `detectForVideo` timestamp (MediaPipe VIDEO mode must increase monotonically). */
  const aclMpVideoTimestampRef = useRef(0);
  /** Wall-clock session bounds for duration (strict end − start). */
  const sessionWallStartMsRef = useRef<number | null>(null);
  const lastSessionDurationSecondsRef = useRef(0);
  const postureFrameResultsRef = useRef<PostureCheckResult[]>([]);
  const [poseReloadNonce, setPoseReloadNonce] = useState(0);

  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);

  const [visibilityStatus, setVisibilityStatus] = useState("Waiting for camera");
  const [distanceStatus, setDistanceStatus] = useState("Stand 1.5 to 2 meters away");
  const [movementScore, setMovementScore] = useState<number | null>(null);
  const [reportSummary, setReportSummary] = useState("");
  const [postureDataSufficiency, setPostureDataSufficiency] =
    useState<PostureDataSufficiency>("sufficient");
  const [sessionMessage, setSessionMessage] = useState("");

  const [aclPoseStatus, setAclPoseStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [aclPoseError, setAclPoseError] = useState("");
  const [aclLiveOk, setAclLiveOk] = useState(true);
  const [aclRepDisplay, setAclRepDisplay] = useState(0);
  const [aclErrorsDisplay, setAclErrorsDisplay] = useState({
    v: 0,
    h: 0,
    t: 0,
  });
  const [aclStanceLegVisPoor, setAclStanceLegVisPoor] = useState(false);
  const [aclGuidanceIdx, setAclGuidanceIdx] = useState(0);
  const [postureLiveLabel, setPostureLiveLabel] = useState("Waiting for data");

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    if (!aclMode || !aclStanceLegVisPoor || sessionState !== "running") return;
    const id = window.setInterval(() => {
      setAclGuidanceIdx((i) => (i + 1) % ACL_GUIDANCE_TIPS.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, [aclMode, aclStanceLegVisPoor, sessionState]);

  useEffect(() => {
    if (!aclMode && !postureMode) {
      setAclPoseStatus("idle");
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    setAclPoseStatus("loading");
    setAclPoseError("");

    (async () => {
      try {
        // True runtime import so Turbopack/webpack do not rewrite or stall the CDN URL.
        const importModule = new Function("u", "return import(u)") as (
          u: string
        ) => Promise<unknown>;

        const loadModule = importModule(MEDIAPIPE_CDN);
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  "Pose model load timed out (CDN). Check network, firewall, or try Retry."
                )
              ),
            POSE_LOAD_TIMEOUT_MS
          );
        });

        const mod = (await Promise.race([loadModule, timeout])) as {
          FilesetResolver: { forVisionTasks: (base: string) => Promise<unknown> };
          RunningMode?: { VIDEO: string };
          PoseLandmarker: {
            createFromOptions: (
              fileset: unknown,
              options: {
                baseOptions: { modelAssetPath: string; delegate: string };
                runningMode: string;
                numPoses: number;
              }
            ) => Promise<{
              detectForVideo: (v: HTMLVideoElement, t: number) => {
                landmarks?: NormLandmark[][];
              };
              close: () => void;
            }>;
          };
        };

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (cancelled) return;

        const { FilesetResolver, PoseLandmarker, RunningMode } = mod;
        const videoRunningMode = RunningMode?.VIDEO ?? "VIDEO";

        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
        const landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: POSE_MODEL,
            delegate: "CPU",
          },
          runningMode: videoRunningMode,
          numPoses: 1,
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        poseLandmarkerRef.current = landmarker;
        setAclPoseStatus("ready");
      } catch (e) {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!cancelled) {
          setAclPoseStatus("error");
          setAclPoseError(
            e instanceof Error ? e.message : "Could not load pose model from CDN."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
    };
  }, [aclMode, postureMode, poseReloadNonce]);

  useEffect(() => {
    if ((!aclMode && !postureMode) || !cameraReady || aclPoseStatus !== "ready") {
      if (poseRafRef.current !== null) {
        cancelAnimationFrame(poseRafRef.current);
        poseRafRef.current = null;
      }
      return;
    }

    const video = videoRef.current;
    const lm = poseLandmarkerRef.current;
    if (!video || !lm) return;

    /** Live getUserMedia streams often keep `video.currentTime` at 0; MediaPipe samples gate on time advancing, which would skip every frame after the first. */
    const isLiveCameraStream = Boolean(streamRef.current);

    let lastVideoTime = -1;
    let poseLogBudget = 5;

    const tick = () => {
      if (video.readyState >= 2) {
        const t = video.currentTime;
        const newDecodedFrame = t !== lastVideoTime;
        if (!isLiveCameraStream && !newDecodedFrame) {
          poseRafRef.current = requestAnimationFrame(tick);
          return;
        }
        if (newDecodedFrame) lastVideoTime = t;

        try {
          let detectTimestampMs = aclMpVideoTimestampRef.current;
          const now = performance.now();
          if (now <= detectTimestampMs) detectTimestampMs += 0.001;
          else detectTimestampMs = now;
          const res = lm.detectForVideo(video, detectTimestampMs);
          aclMpVideoTimestampRef.current = detectTimestampMs;
          const frame = res.landmarks?.[0];
          const canvas = poseCanvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx && video.clientWidth > 0 && video.clientHeight > 0) {
            if (frame?.length) {
              drawPoseLandmarksOnCanvas(ctx, frame, video);
            } else {
              const cw = Math.max(1, Math.floor(video.clientWidth));
              const ch = Math.max(1, Math.floor(video.clientHeight));
              if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw;
                canvas.height = ch;
              }
              ctx.clearRect(0, 0, cw, ch);
            }
          }
          if (frame?.length) {
            if (poseLogBudget > 0) {
              poseLogBudget -= 1;
              console.log(
                "[BodyAxisAI] Pose detected:",
                frame.length,
                "landmarks"
              );
            }
            if (sessionStateRef.current === "running") {
              if (aclMode) {
                aclPoseFramesThisRunRef.current += 1;
                const out = aclTrackerRef.current.process(frame, performance.now());
                setAclLiveOk(out.liveOk);
                setAclStanceLegVisPoor(
                  Boolean(out.landmarksValidThisFrame && out.stanceLegVisPoor)
                );
                syncAclDisplayFromTracker();
              } else if (postureMode) {
                const pr = analysePostureFrame(frame);
                if (pr) {
                  postureFrameResultsRef.current.push(pr);
                  setPostureLiveLabel(pr.label);
                }
              }
            }
          }
        } catch (err) {
          console.error("[BodyAxisAI] detectForVideo failed:", err);
        }
      }

      poseRafRef.current = requestAnimationFrame(tick);
    };

    poseRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (poseRafRef.current !== null) {
        cancelAnimationFrame(poseRafRef.current);
        poseRafRef.current = null;
      }
    };
  }, [aclMode, postureMode, cameraReady, aclPoseStatus]);

  useEffect(() => {
    return () => {
      stopTimer();
      stopCamera();
      if (poseRafRef.current !== null) {
        cancelAnimationFrame(poseRafRef.current);
        poseRafRef.current = null;
      }
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
    };
  }, []);

  async function enableCamera() {
    try {
      setCameraError("");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraReady(true);
      setSessionState("ready");
      setVisibilityStatus("Body visible in frame");
      setDistanceStatus("Good distance");
    } catch (error) {
      console.error(error);
      setCameraError("Unable to access camera. Please allow camera permission.");
      setCameraReady(false);
      setSessionState("idle");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  function startTimer() {
    stopTimer();

    timerRef.current = window.setInterval(() => {
      const startMs = sessionWallStartMsRef.current;
      if (startMs === null) return;
      setSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function syncAclDisplayFromTracker() {
    setAclRepDisplay(aclTrackerRef.current.repCount);
    setAclErrorsDisplay({
      v: aclTrackerRef.current.valgusCount,
      h: aclTrackerRef.current.hipDropCount,
      t: aclTrackerRef.current.trunkLeanCount,
    });
  }

  /**
   * Final detect+process burst using the same monotonic VIDEO timestamps as the RAF loop.
   * A single `performance.now()` flush can reuse/stale-gate MediaPipe and miss the latest pose.
   */
  function flushAclPoseToTrackerFinal(iterations = 8) {
    const video = videoRef.current;
    const lm = poseLandmarkerRef.current;
    if (!video || !lm || video.readyState < 2) return;
    try {
      for (let i = 0; i < iterations; i++) {
        let ts = aclMpVideoTimestampRef.current;
        const now = performance.now();
        if (now <= ts) ts += 0.001;
        else ts = now;
        const res = lm.detectForVideo(video, ts);
        aclMpVideoTimestampRef.current = ts;
        const frame = res.landmarks?.[0];
        if (frame?.length) {
          aclTrackerRef.current.process(frame, performance.now());
        }
      }
    } catch (e) {
      console.error("[BodyAxisAI] flushAclPoseToTrackerFinal:", e);
    }
  }

  function handleStartSession() {
    if (!cameraReady) {
      setSessionMessage("Enable camera or upload video before starting the session.");
      return;
    }

    if (aclMode && aclPoseStatus !== "ready") {
      setSessionMessage(
        aclPoseStatus === "loading"
          ? "Pose engine is still loading. Wait until ready before starting."
          : "Pose engine is not ready. Check network (CDN) and refresh, then try again."
      );
      return;
    }

    setSessionMessage("");
    setMovementScore(null);
    setReportSummary("");
    setSeconds(0);
    sessionWallStartMsRef.current = Date.now();
    lastSessionDurationSecondsRef.current = 0;
    if (aclMode) {
      aclTrackerRef.current.reset();
      aclPoseFramesThisRunRef.current = 0;
      setAclRepDisplay(0);
      setAclErrorsDisplay({ v: 0, h: 0, t: 0 });
      setAclLiveOk(true);
      setAclStanceLegVisPoor(false);
      setAclGuidanceIdx(0);
    }
    if (postureMode) {
      postureFrameResultsRef.current = [];
      setPostureDataSufficiency("sufficient");
      setPostureLiveLabel("Analysing posture…");
    }
    setSessionState("running");
    startTimer();
  }

  function handleStopSession() {
    sessionStateRef.current = "stopped";
    stopTimer();
    setSessionState("stopped");

    const sessionEndMs = Date.now();
    const sessionStartMs = sessionWallStartMsRef.current ?? sessionEndMs;
    const durationSec = Math.max(0, Math.floor((sessionEndMs - sessionStartMs) / 1000));
    lastSessionDurationSecondsRef.current = durationSec;
    setSeconds(durationSec);

    if (aclMode && aclPoseStatus === "ready") {
      flushAclPoseToTrackerFinal();
    }

    setAclStanceLegVisPoor(false);
    setAclGuidanceIdx(0);

    if (aclMode) {
      if (aclPoseStatus !== "ready") {
        setMovementScore(null);
        setReportSummary(
          "Pose tracking was not ready for this session. Wait until the pose model shows Ready, then start again."
        );
        console.log("[BodyAxisAI] FINAL TRACKER SNAPSHOT (pose not ready — skipped flush path)");
        console.log("[BodyAxisAI] FINAL REPORT VALUES", { score: null, summary: "not ready" });
        console.log("[BodyAxisAI] SESSION START TIME", sessionStartMs);
        console.log("[BodyAxisAI] SESSION END TIME", sessionEndMs);
        console.log("[BodyAxisAI] FINAL DURATION SECONDS", durationSec);
        return;
      }

      const frames = aclPoseFramesThisRunRef.current;
      if (frames < ACL_MIN_POSE_FRAMES) {
        setMovementScore(null);
        setReportSummary(
          `Not enough pose frames captured (${frames}/${ACL_MIN_POSE_FRAMES} minimum). Stay in frame with good lighting, run the session for a few seconds, then stop.`
        );
        const tr = aclTrackerRef.current;
        setAclRepDisplay(tr.repCount);
        setAclErrorsDisplay({
          v: tr.valgusCount,
          h: tr.hipDropCount,
          t: tr.trunkLeanCount,
        });
        console.log("[BodyAxisAI] FINAL TRACKER SNAPSHOT", {
          repCount: tr.repCount,
          valgusCount: tr.valgusCount,
          hipDropCount: tr.hipDropCount,
          trunkLeanCount: tr.trunkLeanCount,
        });
        console.log("[BodyAxisAI] FINAL REPORT VALUES", { score: null, summary: "insufficient frames" });
        console.log("[BodyAxisAI] SESSION START TIME", sessionStartMs);
        console.log("[BodyAxisAI] SESSION END TIME", sessionEndMs);
        console.log("[BodyAxisAI] FINAL DURATION SECONDS", durationSec);
        return;
      }

      const tr = aclTrackerRef.current;
      const snapshot = {
        repCount: tr.repCount,
        valgusCount: tr.valgusCount,
        hipDropCount: tr.hipDropCount,
        trunkLeanCount: tr.trunkLeanCount,
      };
      setAclRepDisplay(snapshot.repCount);
      setAclErrorsDisplay({
        v: snapshot.valgusCount,
        h: snapshot.hipDropCount,
        t: snapshot.trunkLeanCount,
      });

      const score = tr.finalScore();
      let summary: string;
      if (score === null) {
        setMovementScore(0);
        summary = tr.summaryLineNoReps();
      } else {
        setMovementScore(score);
        summary = tr.summaryLine(score);
      }
      setReportSummary(summary);

      console.log("[BodyAxisAI] FINAL TRACKER SNAPSHOT", snapshot);
      console.log("[BodyAxisAI] FINAL REPORT VALUES", { score, summary });
    } else if (postureMode) {
      const agg = aggregatePostureResults(postureFrameResultsRef.current);
      // score/label semantics unchanged for persistence; sufficiency gates report UI.
      setMovementScore(agg.score);
      setReportSummary(agg.summary);
      setPostureDataSufficiency(agg.dataSufficiency);
      console.log(
        "[BodyAxisAI] POSTURE FINAL",
        agg.score,
        agg.label,
        agg.dataSufficiency
      );
    } else {
      const score = generateMockScore(test, durationSec);
      const summary = generateReportSummary(test, score, durationSec);
      setMovementScore(score);
      setReportSummary(summary);
      console.log("[BodyAxisAI] FINAL TRACKER SNAPSHOT", null);
      console.log("[BodyAxisAI] FINAL REPORT VALUES", { score, summary });
    }
    console.log("[BodyAxisAI] SESSION START TIME", sessionStartMs);
    console.log("[BodyAxisAI] SESSION END TIME", sessionEndMs);
    console.log("[BodyAxisAI] FINAL DURATION SECONDS", durationSec);
  }

  function handleUploadVideoClick() {
    fileInputRef.current?.click();
  }

  function handleVideoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !videoRef.current) return;

    stopCamera();

    const objectUrl = URL.createObjectURL(file);
    videoRef.current.srcObject = null;
    videoRef.current.src = objectUrl;
    videoRef.current.play().catch(console.error);

    setCameraReady(true);
    setSessionState("ready");
    setVisibilityStatus("Uploaded video ready");
    setDistanceStatus("Review uploaded movement");
  }

  async function handleFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    }
  }

  async function handleSubmitAssessment() {
    try {
      setLoading(true);

      if (!assessment) {
        throw new Error("Assessment not found");
      }

      const existingTests = Array.isArray(assessment.selectedTests)
        ? assessment.selectedTests
        : [];

      const updatedTests = existingTests.includes(test)
        ? existingTests
        : [...existingTests, test];

      const sessionDurationSec = lastSessionDurationSecondsRef.current;

      const finalScore = aclMode
        ? movementScore
        : (movementScore ?? generateMockScore(test, sessionDurationSec));

      if (typeof finalScore !== "number" || !Number.isFinite(finalScore)) {
        throw new Error("No valid score to submit for this session.");
      }

      const finalSummary = aclMode
        ? reportSummary.trim()
        : reportSummary.trim() ||
          generateReportSummary(test, finalScore, sessionDurationSec);

      assessmentsRepository.update({
        ...assessment,
        patientId,
        status: "completed",
        selectedTests: updatedTests,
        score: finalScore,
        durationSeconds: sessionDurationSec,
        reportSummary: finalSummary,
        completedAt: new Date().toISOString(),
      });

      if (patientId && patientId !== "UNKNOWN") {
        try {
          const numericPatientId = parseInt(patientId, 10);
          if (!isNaN(numericPatientId)) {
            const assessment = await createAssessment({
              patient_id: numericPatientId,
              type: "Body Axis AI Session",
              selected_tests: [test],
              mode: "Live Camera",
              status: "completed",
              notes: null,
            });
            await saveResult({
              patient_id: numericPatientId,
              assessment_id: assessment.id,
              test_name: test,
              score: finalScore,
              summary: finalSummary,
            });
          }
        } catch (err) {
          setSessionMessage(
            err instanceof Error
              ? err.message
              : "Could not save assessment to the server. Please try again."
          );
          return;
        }
      }

      stopTimer();
      stopCamera();

      router.push(
        `/assessment/success?patientId=${encodeURIComponent(
          patientId
        )}&assessmentId=${encodeURIComponent(assessmentId)}`
      );
    } catch (error) {
      console.error(error);
      setSessionMessage("Failed to submit assessment. Please verify linked assessment context and try again.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    sessionState === "stopped" &&
    hasLinkedAssessment &&
    (!aclMode || movementScore !== null);

  const lastPostureFrame = postureFrameResultsRef.current.at(-1) ?? null;

  return (
    <main className="min-h-screen bg-[#071a2f] px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 rounded-[28px] border border-cyan-300/18 bg-gradient-to-br from-cyan-500/8 via-white/[0.04] to-white/[0.02] p-6 shadow-[0_10px_24px_rgba(0,0,0,0.14)] backdrop-blur-md">
          <p className="mb-3 inline-block rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-1 text-sm text-cyan-200">
            Body Axis AI Session
          </p>

          <h1 className="text-3xl font-bold text-cyan-300 md:text-4xl">
            {formatTestTitle(test)}
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75 md:text-base">
            Guided movement capture session with structured timing, standardized instructions,
            and linked submission to the clinician workflow.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <MetaBadge label={`Patient: ${displayPatientName}`} />
            <MetaBadge label={`ID: ${displayPatientId}`} />
            <MetaBadge label={`Assessment: ${assessmentId}`} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-3xl border border-cyan-300/18 bg-white/[0.04] p-6 shadow-[0_10px_24px_rgba(0,0,0,0.14)] backdrop-blur-md">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold text-white">Assessment Session</h2>
              <SessionStateBadge state={sessionState} />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="text-lg font-semibold text-cyan-200">
                Instructions
              </h3>

              <ul className="mt-4 space-y-2 text-sm leading-7 text-slate-300">
                <li>1. {getInstructionByTest(test)}</li>
                <li>2. Keep your full body visible in the camera frame.</li>
                <li>3. Maintain approximately 1.5 to 2 meters distance.</li>
                <li>4. Start session, perform movement, then stop and submit.</li>
              </ul>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <StatusCard label="Visibility" value={visibilityStatus} />
              <StatusCard label="Distance" value={distanceStatus} />
              <StatusCard label="Elapsed Time" value={`${seconds}s`} />
            </div>

            <div className="mt-6 overflow-hidden rounded-3xl border border-dashed border-cyan-400/30 bg-cyan-400/5">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <p className="text-sm font-medium text-cyan-300">
                  Session Capture
                </p>

                <button
                  type="button"
                  onClick={handleFullscreen}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white transition hover:bg-white/10"
                >
                  Full Screen
                </button>
              </div>

              <div
                className={`relative aspect-video bg-black ${
                  aclMode && sessionState === "running" && aclPoseStatus === "ready"
                    ? aclLiveOk
                      ? "ring-4 ring-emerald-500/55"
                      : "ring-4 ring-rose-500/60"
                    : postureMode && sessionState === "running" && aclPoseStatus === "ready"
                      ? postureLiveLabel === "Good alignment"
                        ? "ring-4 ring-emerald-500/55"
                        : postureLiveLabel === "Postural deviation observed"
                          ? "ring-4 ring-rose-500/60"
                          : "ring-4 ring-amber-500/55"
                      : ""
                }`}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  controls={false}
                  className="h-full w-full object-cover"
                />

                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-sm text-slate-300">
                    {cameraError || "Enable camera or upload a video to begin capture."}
                  </div>
                )}

                {sessionState === "running" && (
                  <div className="absolute left-4 top-4 rounded-full bg-red-500/90 px-3 py-1 text-xs font-semibold text-white">
                    LIVE
                  </div>
                )}

                <canvas
                  ref={poseCanvasRef}
                  className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
                  aria-hidden
                />

                {aclStanceLegVisPoor && sessionState === "running" && (
                  <div className="pointer-events-none absolute bottom-12 left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-lg bg-black/65 px-3 py-1.5 text-center text-[11px] font-medium text-amber-100">
                    {ACL_GUIDANCE_TIPS[aclGuidanceIdx % ACL_GUIDANCE_TIPS.length]}
                  </div>
                )}

                {postureMode && sessionState === "running" && aclPoseStatus === "ready" && postureLiveLabel !== "Analysing posture…" && (
                  <div className="pointer-events-none absolute bottom-12 left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-lg bg-black/65 px-3 py-1.5 text-center text-[11px] font-medium text-cyan-100">
                    {postureLiveLabel}
                  </div>
                )}

                <div className="absolute bottom-4 left-4 rounded-xl bg-black/60 px-4 py-2 text-sm text-white">
                  Elapsed: {seconds}s
                </div>
              </div>
            </div>

            {postureMode && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/85">
                <p className="font-semibold text-cyan-200">Posture Analysis (live)</p>
                <p className="mt-2 text-xs text-white/60">
                  Pose:{" "}
                  {aclPoseStatus === "loading"
                    ? "Loading MediaPipe (CDN)…"
                    : aclPoseStatus === "ready"
                      ? "Tracking alignment"
                      : aclPoseStatus === "error"
                        ? "Error — check network and retry."
                        : "Idle"}
                </p>
                {sessionState === "running" && aclPoseStatus === "ready" && (
                  <p
                    className={`mt-2 text-xs font-medium ${
                      postureLiveLabel === "Good alignment"
                        ? "text-emerald-200"
                        : postureLiveLabel === "Mild asymmetry detected"
                          ? "text-amber-200"
                          : "text-rose-200"
                    }`}
                  >
                    {postureLiveLabel}
                  </p>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                  <StatusCard
                    label="Shoulder Alignment"
                    value={lastPostureFrame ? `${lastPostureFrame.shoulderTilt.toFixed(1)}°` : "—"}
                  />
                  <StatusCard
                    label="Head Position"
                    value={lastPostureFrame ? (lastPostureFrame.headOffset < 0.03 ? "Centered" : "Offset") : "—"}
                  />
                  <StatusCard
                    label="Trunk Alignment"
                    value={lastPostureFrame ? (lastPostureFrame.trunkOffset < 0.03 ? "Aligned" : "Shifted") : "—"}
                  />
                  <StatusCard
                    label="Hip Symmetry"
                    value={lastPostureFrame ? `${lastPostureFrame.hipTilt.toFixed(1)}°` : "—"}
                  />
                </div>
              </div>
            )}

            {(aclMode || postureMode) && aclPoseStatus === "error" && (
              <div className="mt-4 rounded-2xl border border-rose-300/35 bg-rose-500/10 p-4 text-sm text-rose-100">
                <p className="font-semibold text-rose-200">Pose model failed to load</p>
                <p className="mt-2 text-white/85">{aclPoseError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSessionMessage("");
                    setPoseReloadNonce((n) => n + 1);
                  }}
                  className="mt-3 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  Retry pose load
                </button>
              </div>
            )}

            {aclMode && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/85">
                <p className="font-semibold text-cyan-200">Single-Leg Squat (live)</p>
                <p className="mt-2 text-xs text-white/60">
                  Pose:{" "}
                  {aclPoseStatus === "loading"
                    ? "Loading MediaPipe (CDN)…"
                    : aclPoseStatus === "ready"
                      ? "Tracking (stance: right leg)"
                      : aclPoseStatus === "error"
                        ? `Error — use Retry above or check network.`
                        : "Idle"}
                </p>
                {aclStanceLegVisPoor && sessionState === "running" && (
                  <p className="mt-2 text-xs leading-relaxed text-amber-200/95">
                    {ACL_GUIDANCE_TIPS[aclGuidanceIdx % ACL_GUIDANCE_TIPS.length]}
                  </p>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                  <StatusCard label="Reps" value={String(aclRepDisplay)} />
                  <StatusCard label="Valgus (reps)" value={String(aclErrorsDisplay.v)} />
                  <StatusCard label="Hip drop (reps)" value={String(aclErrorsDisplay.h)} />
                  <StatusCard label="Trunk lean (reps)" value={String(aclErrorsDisplay.t)} />
                </div>
                {sessionState === "running" && aclPoseStatus === "ready" && (
                  <p
                    className={`mt-3 text-xs font-medium ${
                      aclLiveOk ? "text-emerald-200" : "text-rose-200"
                    }`}
                  >
                    {aclLiveOk
                      ? "Movement acceptable (no error flags this frame)."
                      : "Error pattern detected — adjust alignment and control."}
                  </p>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleVideoUpload}
              className="hidden"
            />

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={enableCamera}
                className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Enable Camera
              </button>

              <button
                type="button"
                onClick={handleUploadVideoClick}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
              >
                Upload Video
              </button>

              <button
                type="button"
                onClick={handleStartSession}
                disabled={
                  !cameraReady ||
                  sessionState === "running" ||
                  (aclMode && aclPoseStatus !== "ready")
                }
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start Session
              </button>

              <button
                type="button"
                onClick={handleStopSession}
                disabled={sessionState !== "running"}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Stop Session
              </button>
            </div>

            {sessionMessage && (
              <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                {sessionMessage}
              </div>
            )}

            {sessionState === "stopped" && (
              <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
                <h3 className="text-lg font-semibold text-emerald-200">
                  Session Report
                </h3>

                <p className="mt-3 text-sm leading-7 text-white/80">
                  {reportSummary || "Session completed. Review summary metrics and submit assessment."}
                </p>

                <div
                  className={`mt-4 grid gap-4 ${aclMode ? "md:grid-cols-3" : "md:grid-cols-2"}`}
                >
                  <StatusCard
                    label="Score"
                    value={
                      postureMode && postureDataSufficiency === "insufficient"
                        ? "Insufficient data"
                        : movementScore !== null
                          ? `${movementScore}%`
                          : "Not available"
                    }
                  />
                  <StatusCard label="Duration" value={`${seconds}s`} />
                  {aclMode && (
                    <StatusCard label="Reps" value={String(aclRepDisplay)} />
                  )}
                </div>
              </div>
            )}

            {sessionState === "stopped" && postureMode && (
              <PostureReport
                score={movementScore}
                assessmentId={assessmentId}
                patientId={displayPatientId}
                patientName={displayPatientName}
                lastFrame={lastPostureFrame}
                reportSummary={reportSummary}
                dataSufficiency={postureDataSufficiency}
              />
            )}
          </section>

          <aside className="rounded-3xl border border-cyan-300/18 bg-white/[0.04] p-6 shadow-[0_10px_24px_rgba(0,0,0,0.14)] backdrop-blur-md">
            <h2 className="mb-5 text-2xl font-semibold text-white">
              Assessment Info
            </h2>

            <div className="space-y-4">
              <InfoBox label="Patient Name" value={displayPatientName} />
              <InfoBox label="File Number" value={displayPatientId} />
              <InfoBox label="Assessment ID" value={assessmentId} />
              <InfoBox label="Test Type" value={formatTestTitle(test)} />
              <InfoBox
                label="Linked Assessment"
                value={hasLinkedAssessment ? "Connected" : "Not linked"}
              />
            </div>

            {!hasLinkedAssessment && (
              <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                No linked assessment record found. You can run the session, but submission requires a valid assessment context.
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmitAssessment}
              disabled={!canSubmit || loading}
              className="mt-6 w-full rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Submit Assessment"}
            </button>

            <button
              type="button"
              onClick={() => router.back()}
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
            >
              Back
            </button>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm text-slate-400">Session State</p>
              <p className="mt-2 font-medium text-white capitalize">
                {sessionState}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function InfoBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 font-medium text-white">{value}</p>
    </div>
  );
}

function StatusCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 font-medium text-white">{value}</p>
    </div>
  );
}

function MetaBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-cyan-300/15 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
      {label}
    </span>
  );
}

function SessionStateBadge({ state }: { state: SessionState }) {
  const stateClass =
    state === "running"
      ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
      : state === "stopped"
        ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
        : state === "ready"
          ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
          : "border-white/15 bg-white/[0.04] text-white/80";

  return (
    <span className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${stateClass}`}>
      {state}
    </span>
  );
}

function formatTestTitle(test: string) {
  switch (test) {
    case "single_leg_squat":
      return "Single-Leg Squat (ACL)";
    case "gait":
      return "Gait Assessment";
    case "balance":
      return "Balance Assessment";
    case "squat":
      return "Squat Assessment";
    case "posture":
      return "Postural Assessment";
    case "rom":
      return "ROM Assessment";
    case "reach":
      return "Reach Test";
    case "sit_to_stand":
      return "Sit-to-Stand Assessment";
    case "compensation":
      return "Compensation Analysis";
    default:
      return "Assessment";
  }
}

function getInstructionByTest(test: string) {
  switch (test) {
    case "single_leg_squat":
      return "Stand on your RIGHT leg only. Perform controlled single-leg squats: stand tall, lower until the stance knee bends, then return to standing. Keep the full body in frame (frontal view works best).";
    case "gait":
      return "Walk naturally for a few seconds while gait symmetry and trunk control are reviewed.";
    case "balance":
      return "Hold the required balance position while stability and postural control are reviewed.";
    case "squat":
      return "Perform a controlled squat while alignment, compensation, and movement quality are reviewed.";
    case "posture":
      return "Stand naturally while posture alignment and body symmetry are assessed.";
    case "rom":
      return "Perform the guided joint movement while estimated range of motion is reviewed.";
    case "reach":
      return "Perform the reach task while functional control and movement strategy are reviewed.";
    case "sit_to_stand":
      return "Perform sit-to-stand while lower-limb control and transitional movement are reviewed.";
    case "compensation":
      return "Perform the required task while compensatory movement patterns are reviewed.";
    default:
      return "Follow the on-screen instructions while the system captures movement performance.";
  }
}

function generateMockScore(test: string, durationSeconds: number) {
  const base =
    test === "balance"
      ? 82
      : test === "gait"
      ? 84
      : test === "squat"
      ? 86
      : test === "posture"
      ? 88
      : test === "rom"
      ? 80
      : 85;

  return Math.min(95, Math.max(70, base + Math.floor(durationSeconds / 8)));
}

function generateReportSummary(
  test: string,
  score: number,
  durationSeconds: number
) {
  return `${formatTestTitle(
    test
  )} completed successfully. Session duration was ${durationSeconds} seconds with an estimated movement score of ${score}%.`;
}

export default function BodyAxisAIPage() {
  return (
    <Suspense fallback={<div className="p-6 text-white">Loading session...</div>}>
      <BodyAxisAIPageContent />
    </Suspense>
  );
}