"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  buildElbowExtensionDemoConfig,
  buildAllElbowExtensionScenarios,
} from "@/app/lib/upper-limb-motor-screen/elbow-extension-demo-fixtures";
import {
  applyElbowExtensionCommand,
  createElbowExtensionAttemptState,
  getElbowExtensionRuntimeSnapshot,
  type ElbowExtensionAttemptState,
  type ElbowExtensionRuntimeSnapshot,
} from "@/app/lib/upper-limb-motor-screen/elbow-extension-engine";
import type { UpperLimbMovementAttemptResult, UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

// ── Types ──────────────────────────────────────────────────────────────────

type ScenarioKey =
  | "happyPathWithArmLandmarks"
  | "happyPathWristOnly"
  | "lowVisibility"
  | "wrongDirectionExit"
  | "shortTrackingGap"
  | "longTrackingGapWithHumanResume"
  | "stopBeforeCompletion";

// ── Page ───────────────────────────────────────────────────────────────────

export default function ElbowExtensionLabPage() {
  // Configuration state
  const [testedSide, setTestedSide] = useState<UpperLimbSide>("right");
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("happyPathWithArmLandmarks");

  // Derive config and scenario from testedSide and scenarioKey
  const config = useMemo(() => buildElbowExtensionDemoConfig(testedSide), [testedSide]);
  const scenarios = useMemo(() => buildAllElbowExtensionScenarios(testedSide), [testedSide]);
  const currentScenario = useMemo(() => scenarios[scenarioKey], [scenarios, scenarioKey]);

  // Engine state
  const [attemptState, setAttemptState] = useState<ElbowExtensionAttemptState | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<ElbowExtensionRuntimeSnapshot | null>(null);
  const [attemptResult, setAttemptResult] = useState<UpperLimbMovementAttemptResult | null>(null);
  const [rejectionMessage, setRejectionMessage] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackTimerRef = useRef<number | null>(null);

  // Reset state when configuration changes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setAttemptState(null);
    setCommandIndex(0);
    setSnapshot(null);
    setAttemptResult(null);
    setRejectionMessage(null);
    setIsPlaying(false);
  }, [testedSide, scenarioKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Controls ─────────────────────────────────────────────────────────────

  function handleStart() {
    if (!config || !currentScenario) return;

    const createResult = createElbowExtensionAttemptState(config, 0, 0);
    if (!createResult.ok) {
      console.error("Failed to create attempt state:", createResult.reason);
      return;
    }

    setAttemptState(createResult.state);
    setCommandIndex(0);
    setSnapshot(getElbowExtensionRuntimeSnapshot(createResult.state));
    setAttemptResult(null);
    setRejectionMessage(null);
    setIsPlaying(false);
  }

  const handleStep = useCallback(() => {
    if (!attemptState || !currentScenario || commandIndex >= currentScenario.commands.length) return;

    const command = currentScenario.commands[commandIndex];
    const result = applyElbowExtensionCommand(attemptState, command);

    if (result.status === "applied") {
      const newState = result.state;
      const newSnapshot = getElbowExtensionRuntimeSnapshot(newState);

      setAttemptState(newState);
      setSnapshot(newSnapshot);
      setCommandIndex(commandIndex + 1);
      setRejectionMessage(null);

      // Store the attempt result when the engine produces one
      if (result.attemptResult) {
        setAttemptResult(result.attemptResult);
      }

      // Stop playback when terminal
      if (newSnapshot.terminal) {
        setIsPlaying(false);
      }
    } else {
      // Command rejected — do not advance, stop playback, show warning
      setIsPlaying(false);
      setRejectionMessage(`Command rejected by engine: ${result.reason}`);
    }
  }, [attemptState, currentScenario, commandIndex]);

  function handlePlay() {
    if (!attemptState || !currentScenario || commandIndex >= currentScenario.commands.length) return;
    setIsPlaying(true);
  }

  function handlePause() {
    setIsPlaying(false);
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }

  function handleReset() {
    setAttemptState(null);
    setCommandIndex(0);
    setSnapshot(null);
    setAttemptResult(null);
    setRejectionMessage(null);
    setIsPlaying(false);

    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }

  // Playback loop
  useEffect(() => {
    if (!isPlaying || !attemptState || !currentScenario || commandIndex >= currentScenario.commands.length) {
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      return;
    }

    // Play next step after a brief delay
    playbackTimerRef.current = window.setTimeout(() => {
      handleStep();
    }, 150);

    return () => {
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [isPlaying, commandIndex, attemptState, currentScenario, handleStep]);

  // ── Render ───────────────────────────────────────────────────────────────

  const scenarioOptions: { key: ScenarioKey; label: string }[] = [
    { key: "happyPathWithArmLandmarks", label: "Happy path (with arm landmarks)" },
    { key: "happyPathWristOnly", label: "Happy path (wrist-only)" },
    { key: "lowVisibility", label: "Low visibility" },
    { key: "wrongDirectionExit", label: "Non-target-facing exit" },
    { key: "shortTrackingGap", label: "Short tracking gap" },
    { key: "longTrackingGapWithHumanResume", label: "Long tracking gap with human resume" },
    { key: "stopBeforeCompletion", label: "Stop before completion" },
  ];

  const getScenarioLabel = (key: ScenarioKey): string =>
    scenarioOptions.find((option) => option.key === key)?.label ?? "—";

  const isAttemptActive = attemptState !== null;
  const hasMoreCommands = currentScenario && commandIndex < currentScenario.commands.length;

  return (
    <div className="min-h-screen bg-[#0B1220] text-white">
      {/* Safety banner */}
      <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3">
        <div className="mx-auto max-w-7xl">
          <p className="text-center text-sm font-semibold text-amber-200">
            Internal Lab Only — not a clinical assessment tool
          </p>
          <p className="mt-1 text-center text-xs text-amber-300/70">
            For therapist review only
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="border-b border-[#1E2D42] px-6 py-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-white">Elbow Extension — Motor Screen Engine Demo</h1>
          <p className="mt-1 text-sm text-white/50">
            Deterministic single-wrist screen-space target-acquisition demo with optional 2D elbow-angle observation — no camera, no persistence, not a validated clinical assessment.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto max-w-7xl p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column: Controls */}
          <div className="space-y-6">
            {/* Configuration */}
            <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Configuration</h2>

              {/* Tested side */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-white/70">
                  Tested side
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTestedSide("left")}
                    disabled={isAttemptActive}
                    className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                      testedSide === "left"
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                        : "border-[#1E2D42] bg-[#0B1220] text-white/50 hover:border-[#2A3E5A] hover:text-white/70"
                    } ${isAttemptActive ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    Left
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestedSide("right")}
                    disabled={isAttemptActive}
                    className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                      testedSide === "right"
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                        : "border-[#1E2D42] bg-[#0B1220] text-white/50 hover:border-[#2A3E5A] hover:text-white/70"
                    } ${isAttemptActive ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    Right
                  </button>
                </div>
                <p className="mt-2 text-xs text-white/40">
                  Tested side selects which wrist landmark the engine reads. Both sides currently use the same scripted target scene.
                </p>
              </div>

              {/* Demo nature disclaimer */}
              <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                <p className="text-xs text-blue-200/90">
                  This is a deterministic software demonstration only. Movement coordinates and timestamps are scripted, not captured from a real person. The wrist target task is primary. peakElbowExtensionDeg is an optional 2D geometric observation that does NOT gate task completion. The engine does not measure anatomical ROM, goniometric ROM, full elbow extension, strength, spasticity, impairment, or movement quality.
                </p>
              </div>

              {/* Scenario */}
              <div>
                <label className="mb-2 block text-sm font-medium text-white/70">
                  Scenario
                </label>
                <select
                  value={scenarioKey}
                  onChange={(e) => setScenarioKey(e.target.value as ScenarioKey)}
                  disabled={isAttemptActive}
                  className="w-full rounded-lg border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-medium text-white transition hover:border-[#2A3E5A] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scenarioOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Playback controls */}
            <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Playback</h2>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!config || !currentScenario || isAttemptActive}
                  className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start
                </button>

                <button
                  type="button"
                  onClick={handleStep}
                  disabled={!isAttemptActive || !hasMoreCommands || isPlaying}
                  className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-400 transition hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Step
                </button>

                <button
                  type="button"
                  onClick={isPlaying ? handlePause : handlePlay}
                  disabled={!isAttemptActive || !hasMoreCommands}
                  className="rounded-lg border border-purple-500/50 bg-purple-500/10 px-4 py-2.5 text-sm font-semibold text-purple-400 transition hover:bg-purple-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!isAttemptActive}
                  className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-400 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
              </div>

              {/* Rejection warning */}
              {rejectionMessage && (
                <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3">
                  <p className="text-xs font-semibold text-rose-300">
                    {rejectionMessage}
                  </p>
                </div>
              )}
            </div>

            {/* Current state */}
            {snapshot && (
              <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">Current State</h2>

                <div className="space-y-3 text-sm">
                  <StateRow label="Tested side" value={testedSide} />
                  <StateRow label="Scenario" value={getScenarioLabel(scenarioKey)} />
                  <StateRow label="Command index" value={`${commandIndex} / ${currentScenario?.commands.length ?? 0}`} />
                  <StateRow label="Engine phase" value={snapshot.phase ?? "—"} />
                  <StateRow label="Protective pause" value={snapshot.hasActivePause ? "Active" : "Inactive"} />
                  <StateRow label="Target reached" value={snapshot.targetReached ? "Yes" : "No"} />
                  <StateRow label="Dwell confirmed" value={snapshot.dwellConfirmed ? "Yes" : "No"} />
                  <StateRow label="Return completed" value={snapshot.returnToStartCompleted ? "Yes" : "No"} />
                  <StateRow label="Pause count" value={snapshot.protectivePauseCount} />
                  <StateRow label="Terminal" value={snapshot.terminal ? "Yes" : "No"} />
                </div>
              </div>
            )}
          </div>

          {/* Right column: Terminal result */}
          <div>
            {attemptResult ? (
              <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">Terminal Result</h2>

                <div className="space-y-4">
                  {/* Metadata */}
                  <div className="space-y-2 text-sm">
                    <ResultRow label="Task ID" value={attemptResult.taskId} />
                    <ResultRow label="Tested side" value={attemptResult.testedSide} />
                    <ResultRow label="Task completion state (engine)" value={attemptResult.completionState} />
                  </div>

                  {/* Not-started context */}
                  {attemptResult.completionState === "not_started" && (
                    <>
                      <div className="border-t border-[#1E2D42]" />
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                        <p className="mb-2 text-xs font-semibold text-blue-200">Engine outcome context</p>
                        <div className="space-y-1 text-xs text-blue-200/80">
                          <p>Selected scenario: {getScenarioLabel(scenarioKey)}</p>
                          <p>Last engine phase: {snapshot?.phase ?? "—"}</p>
                          {attemptResult.factualNotes && attemptResult.factualNotes.length > 0 && (
                            <p className="mt-1">
                              {attemptResult.factualNotes.includes("non_target_facing_exit_observed_before_valid_onset")
                                ? "The scripted wrist point crossed outside the configured target-facing boundary before movement onset was confirmed."
                                : scenarioKey === "lowVisibility"
                                ? "The scripted wrist observation remained below the configured visibility threshold."
                                : "The scripted sequence ended before completion criteria were met."}
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="border-t border-[#1E2D42]" />

                  {/* Flags */}
                  <div className="space-y-2 text-sm">
                    <ResultRow label="Target zone entered" value={attemptResult.targetReached !== null ? (attemptResult.targetReached ? "Yes" : "No") : "—"} />
                    <ResultRow label="Dwell confirmed" value={attemptResult.dwellConfirmed !== null ? (attemptResult.dwellConfirmed ? "Yes" : "No") : "—"} />
                    <ResultRow label="Returned within configured zone/time" value={attemptResult.returnToStartCompleted !== null ? (attemptResult.returnToStartCompleted ? "Yes" : "No") : "—"} />
                  </div>

                  <div className="border-t border-[#1E2D42]" />

                  {/* Timing */}
                  <div className="space-y-2 text-sm">
                    <ResultRow label="Simulated reach timing" value={attemptResult.reachTimeMs !== null ? `${attemptResult.reachTimeMs} ms` : "—"} />
                    <ResultRow label="Simulated return timing" value={attemptResult.returnTimeMs !== null ? `${attemptResult.returnTimeMs} ms` : "—"} />
                    <ResultRow label="Simulated total timing" value={attemptResult.totalMovementTimeMs !== null ? `${attemptResult.totalMovementTimeMs} ms` : "—"} />
                  </div>
                  {(attemptResult.reachTimeMs !== null || attemptResult.returnTimeMs !== null || attemptResult.totalMovementTimeMs !== null) && (
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                      <p className="text-xs text-blue-200/80">
                        Timing metrics are computed from scripted timestamps. These are not measurements of real-world movement speed or function.
                      </p>
                    </div>
                  )}

                  <div className="border-t border-[#1E2D42]" />

                  {/* Path metrics */}
                  <div className="space-y-2 text-sm">
                    <ResultRow label="Screen-space path length" value={attemptResult.normalizedPathLength !== null ? attemptResult.normalizedPathLength.toFixed(3) : "—"} />
                    <ResultRow label="Straight-line-to-path ratio" value={attemptResult.pathEfficiency !== null ? attemptResult.pathEfficiency.toFixed(3) : "—"} />
                  </div>
                  {(attemptResult.normalizedPathLength !== null || attemptResult.pathEfficiency !== null) && (
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                      <p className="text-xs text-blue-200/80">
                        Path metrics are computed from scripted 2D screen-space coordinates. These are not measures of real-world reach distance, anatomical movement, or movement quality.
                      </p>
                    </div>
                  )}

                  <div className="border-t border-[#1E2D42]" />

                  {/* Peak elbow extension angle */}
                  <div className="space-y-2 text-sm">
                    <ResultRow
                      label="Peak observed 2D elbow angle"
                      value={attemptResult.peakElbowExtensionDeg !== null ? `${attemptResult.peakElbowExtensionDeg.toFixed(1)}°` : "Not observed"}
                    />
                  </div>
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                    <p className="text-xs text-blue-200/80">
                      Computed from scripted shoulder-elbow-wrist landmarks. This is not anatomical ROM or goniometric measurement. Angle observation does not determine task completion. Task can complete successfully while angle = Not observed.
                    </p>
                  </div>

                  <div className="border-t border-[#1E2D42]" />

                  {/* Protective pauses */}
                  {attemptResult.protectivePauseCount > 0 && (
                    <>
                      <div className="space-y-2 text-sm">
                        <ResultRow label="Protective pause count" value={attemptResult.protectivePauseCount} />
                        <ResultRow label="Protective pause duration" value={`${attemptResult.protectivePauseDurationMs} ms`} />
                      </div>
                      <div className="border-t border-[#1E2D42]" />
                    </>
                  )}

                  {/* Factual notes */}
                  {attemptResult.factualNotes && attemptResult.factualNotes.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-white/70">Factual notes</p>
                      <div className="space-y-1">
                        {attemptResult.factualNotes.map((note, index) => (
                          <p key={index} className="text-xs text-white/50">
                            • {note}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                <p className="text-center text-sm text-white/50">
                  No terminal result yet. Start a scenario and complete the commands to see the result.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────────────────

function StateRow({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-white/70">{label}</span>
      <span className="text-white">{String(value)}</span>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="font-medium text-white/70">{label}</span>
      <span className="text-right text-white">{String(value)}</span>
    </div>
  );
}
