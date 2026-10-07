"use client";

/**
 * Shoulder Abduction Reach — dev-only ML research capture lab.
 * RASQ ML bridge, Slice 1 (2026-08-19); orphaned-detector fix in Slice 1.1
 * (2026-08-19).
 *
 * DEV-ONLY. Not a patient-facing or clinician-workflow page — it is a
 * standalone camera-lab tool (matching this codebase's existing
 * `*-camera-lab` convention) for internal volunteers to produce the
 * technical-development ML dataset described in the Slice 1 project
 * report. It instantiates `ShoulderAbductionReachPoseDetector` directly
 * (not through the exercise-cv-registry, and not through
 * `OrchestratorCvSessionCore`), so it touches zero existing patient-session
 * code. Refuses to render outside development, matching the guard on
 * `/api/dev/ml-research/shoulder-abduction-reach-capture`.
 *
 * Slice 1.1 root-cause note (cross-side overlap): `start()` previously
 * created a brand-new `ShoulderAbductionReachPoseDetector` and overwrote
 * `detectorRef.current` WITHOUT stopping whatever detector was already
 * there. A real live-capture session showed a left-side and a right-side
 * repetition covering nearly the same wall-clock interval — traced to
 * exactly this: clicking Start again (e.g. after switching the side
 * dropdown) left the PREVIOUS detector's camera/inference loop running in
 * the background, orphaned but still reading the same shared `<video>`
 * element and still calling its own (stale) sink closure, so one physical
 * movement could be observed and recorded by two independent capture
 * pipelines at once. `start()` now always stops any existing detector
 * first, and the side/participant controls are disabled while a session is
 * running so they cannot be changed out from under a live detector either.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ShoulderAbductionReachPoseDetector,
  type ShoulderAbductionReachPoseDetectorSnapshot,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import {
  createDevRepCaptureSink,
  postDevRepCaptureRecord,
} from "@/app/lib/ml-research/shoulder-abduction-reach/dev-capture-sink";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";
import type { ShoulderAbductionReachRejectedCapture } from "@/app/lib/ml-research/shoulder-abduction-reach/rep-recorder";

function generateDevSessionId(): string {
  return `dev-session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export default function ShoulderAbductionReachMlCaptureLabPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<ShoulderAbductionReachPoseDetector | null>(null);

  const [participantId, setParticipantId] = useState("dev-participant-001");
  const [side, setSide] = useState<ShoulderAbductionReachSide>("right");
  const [devSessionId] = useState(generateDevSessionId);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ShoulderAbductionReachPoseDetectorSnapshot | null>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [lastFilePath, setLastFilePath] = useState<string | null>(null);
  const [lastRejection, setLastRejection] = useState<ShoulderAbductionReachRejectedCapture | null>(null);

  const handleRepCaptured = useCallback((record: ShoulderAbductionReachRepCaptureRecord) => {
    setCapturedCount((count) => count + 1);
    void postDevRepCaptureRecord(record).then((result) => {
      if (result.ok && result.filePath) {
        setLastFilePath(result.filePath);
      }
    });
  }, []);

  const handleRepRejected = useCallback((rejected: ShoulderAbductionReachRejectedCapture) => {
    setRejectedCount((count) => count + 1);
    setLastRejection(rejected);
  }, []);

  const sink = useMemo(
    () =>
      createDevRepCaptureSink({
        participantId,
        devSessionId,
        side,
        onRepCaptured: handleRepCaptured,
        onRepRejected: handleRepRejected,
      }),
    [participantId, devSessionId, side, handleRepCaptured, handleRepRejected],
  );

  const stop = useCallback(() => {
    detectorRef.current?.stop();
    detectorRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    // Always stop any previously running detector before starting a new one — the
    // Slice 1.1 root cause of cross-side overlap and stub repetitions was exactly this
    // guard being missing, leaving an orphaned detector running against the same shared
    // <video> element. Safe to call even if nothing is running (detectorRef is null).
    stop();
    setStarting(true);
    setError(null);
    try {
      const detector = new ShoulderAbductionReachPoseDetector(
        {
          onSnapshot: setSnapshot,
          onDevFrameCaptured: sink.handleFrame,
        },
        side,
      );
      detectorRef.current = detector;
      await detector.start(videoRef.current, canvasRef.current);
      setRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start capture session.");
      setRunning(false);
    } finally {
      setStarting(false);
    }
  }, [side, sink, stop]);

  if (process.env.NODE_ENV !== "development") {
    return <p style={{ padding: 24 }}>This tool is only available in development.</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, fontFamily: "sans-serif" }}>
      <h1>Shoulder Abduction Reach — ML Capture Lab (dev-only)</h1>
      <p>
        Internal research tool. Captured repetitions are written locally to{" "}
        <code>dev-data/rasq-ml/shoulder-abduction/</code> only — nothing here reaches Supabase or
        production storage.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <label>
          Participant ID:{" "}
          <input
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            disabled={running}
            title={running ? "Stop the current session before changing this" : undefined}
          />
        </label>
        <label>
          Side:{" "}
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as ShoulderAbductionReachSide)}
            disabled={running}
            title={running ? "Stop the current session before switching sides" : undefined}
          >
            <option value="right">right</option>
            <option value="left">left</option>
          </select>
        </label>
      </div>
      {running ? (
        <p style={{ color: "#9CA3AF", fontSize: 13 }}>
          Session running — stop it before changing participant or side, to avoid two
          overlapping capture instances.
        </p>
      ) : null}

      <div style={{ position: "relative", width: 640, height: 480, background: "#000" }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%" }} />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
        <button type="button" onClick={start} disabled={starting || running}>
          Start
        </button>
        <button type="button" onClick={stop} disabled={!running}>
          Stop
        </button>
      </div>

      {error ? <p style={{ color: "red" }}>{error}</p> : null}

      <dl>
        <dt>Dev session ID</dt>
        <dd>{devSessionId}</dd>
        <dt>Tracking status</dt>
        <dd>{snapshot?.trackingStatus ?? "idle"}</dd>
        <dt>Live rep count (from detector)</dt>
        <dd>{snapshot?.primaryRepCount ?? 0}</dd>
        <dt>Repetitions captured to disk</dt>
        <dd>{capturedCount}</dd>
        <dt>Rejected stubs (too few frames / poor tracking)</dt>
        <dd>
          {rejectedCount}
          {lastRejection ? ` — last: ${lastRejection.reason} (${lastRejection.frameCount} frames, ${lastRejection.durationMs}ms)` : ""}
        </dd>
        <dt>Last written file</dt>
        <dd>{lastFilePath ?? "—"}</dd>
      </dl>
    </div>
  );
}
