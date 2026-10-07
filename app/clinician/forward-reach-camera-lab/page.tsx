"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ForwardReachCameraDetector,
  type ForwardReachCameraSnapshot,
} from "@/app/lib/cv/forward-reach-camera-detector";
import { validateForwardReachConfig } from "@/app/lib/upper-limb-motor-screen/forward-reach-engine";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

export default function ForwardReachCameraLabPage() {
  const [snapshot, setSnapshot] = useState<ForwardReachCameraSnapshot | null>(null);
  const [testedSide, setTestedSide] = useState<UpperLimbSide>("right");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<ForwardReachCameraDetector | null>(null);
  const startInProgressRef = useRef(false);

  // Initialize detector instance
  useEffect(() => {
    const detector = new ForwardReachCameraDetector({
      onSnapshot: (newSnapshot) => setSnapshot(newSnapshot),
    });
    detectorRef.current = detector;

    return () => {
      detector.stop();
      detectorRef.current = null;
    };
  }, []);

  const handleStart = useCallback(async () => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!detector || !video || !canvas || startInProgressRef.current || snapshot?.status === "running") {
      return;
    }

    startInProgressRef.current = true;

    try {
      // Build Forward Reach config
      const configResult = validateForwardReachConfig({
        testedSide,
        fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
        startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
        tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
        timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
      });

      if (!configResult.ok) {
        throw new Error(`Invalid config: ${configResult.reason}`);
      }

      await detector.start(video, canvas, configResult.config);
    } catch (err) {
      console.error("Failed to start camera:", err);
    } finally {
      startInProgressRef.current = false;
    }
  }, [testedSide, snapshot?.status]);

  const handleStop = useCallback(() => {
    detectorRef.current?.stop();
  }, []);

  const handleArmReadiness = useCallback(() => {
    detectorRef.current?.armReadiness();
  }, []);

  const handleDisarmReadiness = useCallback(() => {
    detectorRef.current?.disarmReadiness();
  }, []);

  const handleResume = useCallback(() => {
    detectorRef.current?.resumeAfterPause("clinician");
  }, []);

  const showVideo = snapshot?.status === "running" || snapshot?.initPhase === "camera";
  const canArmReadiness =
    snapshot?.status === "running" &&
    snapshot?.engineSnapshot &&
    (snapshot.engineSnapshot.phase === "idle" || snapshot.engineSnapshot.phase === "awaiting_readiness") &&
    !snapshot.engineSnapshot.terminal &&
    !snapshot.readinessArmed;
  const canResume =
    snapshot?.status === "running" &&
    snapshot?.engineSnapshot?.hasActivePause &&
    snapshot?.engineSnapshot?.phase !== "idle" &&
    snapshot?.engineSnapshot?.phase !== "awaiting_readiness" &&
    !snapshot?.engineSnapshot?.terminal;

  return (
    <main className="min-h-screen bg-[#0B1220] px-6 py-8 text-[#F9FAFB]">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#1D9E75]">
          Creative Motion Lab · RASQ
        </p>
        <h1 className="mt-2 text-xl font-medium text-[#F9FAFB]">
          Forward Reach Live Camera Spike
        </h1>
        <p className="mt-1 text-xs text-[#EF9F27]">
          Unlinked Experimental Clinician Lab
        </p>

        {/* Safety Disclaimer */}
        <div
          className="mt-5 rounded-[10px] border border-[#EF9F27] p-4"
          style={{ background: "rgba(239,159,39,0.08)", borderWidth: "0.5px" }}
        >
          <p className="text-xs leading-[1.8] text-[#FCD34D]">
            ⚠ Internal Development Environment
            <br />
            <br />
            This is an experimental integration spike for therapist and engineering review.
            <br />
            <br />
            <strong>Phase boundaries:</strong>
            <br />
            • Live camera input via MediaPipe Pose
            <br />
            • No patient data persistence
            <br />
            • No clinical assessment workflow
            <br />
            • No API integration
            <br />
            • No Supabase storage
            <br />
            <br />
            This lab validates software integration only. It does not constitute clinical
            measurement, patient assessment, or diagnostic evaluation. All observations require
            therapist review.
            <br />
            <br />
            <strong>Laterality experiment:</strong> This spike verifies whether MediaPipe
            anatomical joint identity (left_wrist/right_wrist) corresponds correctly to the
            selected tested side for front-facing camera input.
          </p>
        </div>

        {/* Error Display */}
        {snapshot?.error && (
          <div className="mt-4 rounded-[8px] border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
            <p>{snapshot.error}</p>
            {snapshot.status === "error" && (
              <button
                type="button"
                onClick={handleStart}
                disabled={startInProgressRef.current}
                className="mt-3 rounded-[7px] border border-rose-400/30 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/10 disabled:opacity-50"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="mt-6 space-y-4">
          {/* Tested Side Selection */}
          {snapshot?.status !== "running" && (
            <div className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
              <p className="text-sm font-medium text-[#F9FAFB]">Tested Side</p>
              <p className="mt-1 text-xs text-[#6B7280]">
                Select which anatomical side to track
              </p>
              <div className="mt-3 flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="testedSide"
                    value="right"
                    checked={testedSide === "right"}
                    onChange={() => setTestedSide("right")}
                    className="h-4 w-4 text-[#1D9E75]"
                  />
                  <span className="text-sm text-[#F9FAFB]">Right</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="testedSide"
                    value="left"
                    checked={testedSide === "left"}
                    onChange={() => setTestedSide("left")}
                    className="h-4 w-4 text-[#1D9E75]"
                  />
                  <span className="text-sm text-[#F9FAFB]">Left</span>
                </label>
              </div>
            </div>
          )}

          {/* Start/Stop Buttons */}
          {snapshot?.status !== "running" ? (
            <button
              type="button"
              disabled={snapshot?.status === "initializing" || startInProgressRef.current}
              onClick={handleStart}
              className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165] disabled:opacity-50"
            >
              {snapshot?.status === "initializing"
                ? snapshot.initPhase === "import"
                  ? "Loading pose library..."
                  : snapshot.initPhase === "model"
                    ? "Loading pose model..."
                    : "Starting camera..."
                : "Start Session"}
            </button>
          ) : (
            <div className="flex gap-3">
              {canArmReadiness && (
                <button
                  type="button"
                  onClick={handleArmReadiness}
                  className="rounded-[7px] bg-[#1D9E75] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165]"
                >
                  Arm Readiness
                </button>
              )}
              {snapshot?.readinessArmed && (
                <button
                  type="button"
                  onClick={handleDisarmReadiness}
                  className="rounded-[7px] bg-[#EF4444] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#DC2626]"
                >
                  Cancel Armed Readiness
                </button>
              )}
              {canResume && (
                <button
                  type="button"
                  onClick={handleResume}
                  className="rounded-[7px] bg-[#EF9F27] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#D68D1F]"
                >
                  Resume After Pause
                </button>
              )}
              <button
                type="button"
                onClick={handleStop}
                className="rounded-[7px] border border-[#1E2D42] bg-transparent px-4 py-2.5 text-sm font-semibold text-[#9CA3AF] transition hover:text-white"
              >
                Stop Session
              </button>
            </div>
          )}
        </div>

        {/* Video Preview */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
          aria-hidden
        />
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="mt-4 w-full rounded-[8px] border border-[#1E2D42] bg-[#0B1220]"
          style={{
            display: showVideo ? "block" : "none",
            transform: "scaleX(-1)", // Visual mirror only
          }}
        />

        {/* Laterality Diagnostics */}
        {snapshot?.status === "running" && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              Laterality Diagnostics
            </p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Verify anatomical correspondence between raised arm and MediaPipe joint
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Selected Tested Side:</span>{" "}
                <span className="font-semibold text-[#F9FAFB]">
                  {snapshot.testedSide.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Right Wrist */}
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <p className="font-semibold text-[#F9FAFB]">
                    Right Wrist <span className="text-[#6B7280]">(index 16)</span>
                  </p>
                  <div className="mt-2 space-y-1">
                    <div>
                      <span className="text-[#9CA3AF]">Visibility:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.rightWristVisibility !== null
                          ? snapshot.rightWristVisibility.toFixed(2)
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized X:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.rightWristCoords?.x.toFixed(3) ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized Y:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.rightWristCoords?.y.toFixed(3) ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Left Wrist */}
                <div className="rounded-[8px] border border-[#1E2D42] bg-[#0B1220] p-3">
                  <p className="font-semibold text-[#F9FAFB]">
                    Left Wrist <span className="text-[#6B7280]">(index 15)</span>
                  </p>
                  <div className="mt-2 space-y-1">
                    <div>
                      <span className="text-[#9CA3AF]">Visibility:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.leftWristVisibility !== null
                          ? snapshot.leftWristVisibility.toFixed(2)
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized X:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.leftWristCoords?.x.toFixed(3) ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Normalized Y:</span>{" "}
                      <span className="font-mono text-[#F9FAFB]">
                        {snapshot.leftWristCoords?.y.toFixed(3) ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[#1E2D42]">
                <div>
                  <span className="text-[#9CA3AF]">Preview Visual Mirroring:</span>{" "}
                  <span className="font-semibold text-[#F9FAFB]">
                    YES (CSS scaleX(-1))
                  </span>
                </div>
                <div className="mt-1">
                  <span className="text-[#9CA3AF]">Coordinate Transform:</span>{" "}
                  <span className="font-semibold text-[#F9FAFB]">NO</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Armed Readiness Status */}
        {snapshot?.readinessArmed && (
          <div className="mt-6 rounded-[10px] border border-[#EF9F27] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#EF9F27]">
              Armed Readiness Active
            </p>
            <p className="mt-1 text-xs text-[#9CA3AF]">
              Move the tested wrist into the starting zone. Readiness will confirm automatically when stable.
            </p>

            {snapshot.readinessArmedTimeRemaining !== null && (
              <div className="mt-3 text-xs">
                <span className="text-[#9CA3AF]">Time remaining:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {Math.ceil(snapshot.readinessArmedTimeRemaining / 1000)}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* Command Feedback */}
        {snapshot?.status === "running" && snapshot.lastCommandType && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              Last Command
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Type:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.lastCommandType}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Status:</span>{" "}
                <span
                  className={`font-semibold ${
                    snapshot.lastCommandStatus === "applied"
                      ? "text-[#1D9E75]"
                      : "text-rose-400"
                  }`}
                >
                  {snapshot.lastCommandStatus?.toUpperCase()}
                </span>
              </div>

              {snapshot.lastCommandStatus === "rejected" &&
                snapshot.lastCommandRejectionReason && (
                  <>
                    {/* User-friendly guidance */}
                    <div className="mt-3 rounded-[8px] border border-rose-400/25 bg-rose-400/10 p-3">
                      <p className="font-semibold text-rose-200">
                        {snapshot.lastCommandRejectionReason === "readiness_requires_wrist_in_starting_zone" &&
                          "Move the tested wrist into the starting zone, then confirm readiness."}
                        {snapshot.lastCommandRejectionReason === "resume_requires_readiness_confirmation" &&
                          "Confirm readiness first before resuming."}
                        {snapshot.lastCommandRejectionReason === "readiness_not_applicable_in_current_phase" &&
                          "Readiness can only be confirmed during idle or awaiting_readiness phase."}
                        {snapshot.lastCommandRejectionReason === "no_active_pause_to_resume" &&
                          "No active pause to resume."}
                        {!["readiness_requires_wrist_in_starting_zone", "resume_requires_readiness_confirmation", "readiness_not_applicable_in_current_phase", "no_active_pause_to_resume"].includes(
                          snapshot.lastCommandRejectionReason,
                        ) &&
                          "Command could not be executed at this time."}
                      </p>
                    </div>

                    {/* Engineering diagnostic */}
                    <div className="mt-2 text-[10px] text-[#6B7280]">
                      Engine reason: {snapshot.lastCommandRejectionReason}
                    </div>
                  </>
                )}
            </div>
          </div>
        )}

        {/* Readiness Guidance */}
        {snapshot?.status === "running" &&
          snapshot.engineSnapshot &&
          (snapshot.engineSnapshot.phase === "idle" ||
            snapshot.engineSnapshot.phase === "awaiting_readiness") && (
            <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
              <p className="text-sm font-semibold text-[#F9FAFB]">
                Readiness Requirements
              </p>
              <p className="mt-1 text-xs text-[#6B7280]">
                Position the tested wrist in the starting zone
              </p>

              <div className="mt-4 space-y-2 text-xs">
                <div>
                  <span className="text-[#9CA3AF]">Tested Side:</span>{" "}
                  <span className="font-semibold text-[#F9FAFB]">
                    {snapshot.testedSide.toUpperCase()}
                  </span>
                </div>

                <div>
                  <span className="text-[#9CA3AF]">
                    {snapshot.testedSide === "right" ? "Right" : "Left"} Wrist Visibility:
                  </span>{" "}
                  <span className="font-mono text-[#F9FAFB]">
                    {snapshot.testedSide === "right"
                      ? snapshot.rightWristVisibility?.toFixed(2) ?? "—"
                      : snapshot.leftWristVisibility?.toFixed(2) ?? "—"}
                  </span>
                </div>

                <div>
                  <span className="text-[#9CA3AF]">
                    {snapshot.testedSide === "right" ? "Right" : "Left"} Wrist Position (x, y):
                  </span>{" "}
                  <span className="font-mono text-[#F9FAFB]">
                    {snapshot.testedSide === "right"
                      ? snapshot.rightWristCoords
                        ? `(${snapshot.rightWristCoords.x.toFixed(3)}, ${snapshot.rightWristCoords.y.toFixed(3)})`
                        : "—"
                      : snapshot.leftWristCoords
                        ? `(${snapshot.leftWristCoords.x.toFixed(3)}, ${snapshot.leftWristCoords.y.toFixed(3)})`
                        : "—"}
                  </span>
                </div>

                <div className="pt-2 border-t border-[#1E2D42]">
                  <div className="text-[#9CA3AF]">
                    Starting Zone (engineering reference):
                  </div>
                  <div className="mt-1 font-mono text-[#F9FAFB]">
                    Center: (0.300, 0.500)
                  </div>
                  <div className="font-mono text-[#F9FAFB]">Radius: 0.050</div>
                </div>
              </div>
            </div>
          )}

        {/* Engine State */}
        {snapshot?.engineSnapshot && (
          <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
            <p className="text-sm font-semibold text-[#F9FAFB]">
              Forward Reach Engine State
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <div>
                <span className="text-[#9CA3AF]">Phase:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.phase}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Terminal:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.terminal ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Active Pause:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.hasActivePause ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Target Reached:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.targetReached ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Return Completed:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.returnToStartCompleted ? "Yes" : "No"}
                </span>
              </div>
              <div>
                <span className="text-[#9CA3AF]">Protective Pause Count:</span>{" "}
                <span className="font-mono text-[#F9FAFB]">
                  {snapshot.engineSnapshot.protectivePauseCount}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Safety Footer */}
        <div className="mt-8 rounded-[8px] border border-[#1E2D42] bg-[#0F1825] p-4">
          <p className="text-[11px] leading-relaxed text-[#6B7280]">
            <strong className="text-[#9CA3AF]">Output semantics:</strong> Screen-space wrist
            movement timing and path from live camera. Software movement-state transitions:
            readiness, onset, outbound, dwelling, return. Protective pause behavior when tracking
            quality insufficient. This does not measure range of motion, assess movement quality,
            grade impairment, or provide diagnostic information.
          </p>
        </div>

        {/* Back Link */}
        <div className="mt-6 text-center">
          <Link
            href="/clinician/assessments"
            className="inline-flex items-center gap-1.5 text-xs text-[#5DCAA5] hover:text-[#1D9E75]"
          >
            <span aria-hidden>←</span>
            Back to Assessment Center
          </Link>
        </div>
      </div>
    </main>
  );
}
