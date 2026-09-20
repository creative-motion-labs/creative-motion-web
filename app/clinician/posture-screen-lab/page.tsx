"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PostureDemoScenarioId } from "@/app/lib/posture-screen/posture-demo-fixtures";
import {
  createPostureLabPlayback,
  formatPostureLabAggregatePanelDisplay,
  POSTURE_LAB_SCENARIO_OPTIONS,
  stepPostureLabPlayback,
  type PostureLabPlaybackState,
} from "@/app/lib/posture-screen/posture-lab-playback";

const PLAYBACK_STEP_MS = 220;

export default function PostureScreenLabPage() {
  const [scenarioId, setScenarioId] =
    useState<PostureDemoScenarioId>("aligned");
  const [playback, setPlayback] = useState<PostureLabPlaybackState | null>(
    null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackTimerRef = useRef<number | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPlayback(null);
    setIsPlaying(false);
  }, [scenarioId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function clearPlaybackTimer() {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }

  function handleStart() {
    clearPlaybackTimer();
    setIsPlaying(false);
    setPlayback(createPostureLabPlayback(scenarioId));
  }

  const handleStep = useCallback(() => {
    setPlayback((current) => {
      if (!current || current.complete) return current;
      const next = stepPostureLabPlayback(current);
      if (next.complete) setIsPlaying(false);
      return next;
    });
  }, []);

  function handlePlay() {
    if (!playback || playback.complete) return;
    setIsPlaying(true);
  }

  function handlePause() {
    setIsPlaying(false);
    clearPlaybackTimer();
  }

  function handleReset() {
    clearPlaybackTimer();
    setIsPlaying(false);
    setPlayback(null);
  }

  useEffect(() => {
    if (!isPlaying || !playback || playback.complete) {
      clearPlaybackTimer();
      return;
    }

    playbackTimerRef.current = window.setTimeout(() => {
      handleStep();
    }, PLAYBACK_STEP_MS);

    return () => clearPlaybackTimer();
  }, [isPlaying, playback, handleStep]);

  const scenarioMeta =
    POSTURE_LAB_SCENARIO_OPTIONS.find((o) => o.id === scenarioId) ?? null;
  const isSessionActive = playback !== null;
  const hasMoreFrames = playback !== null && !playback.complete;
  const lastMeasured = playback?.lastOutcome ?? null;
  const aggregatePanel = playback
    ? formatPostureLabAggregatePanelDisplay(playback)
    : null;

  return (
    <div className="min-h-screen bg-[#0B1220] text-white">
      <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3">
        <div className="mx-auto max-w-7xl">
          <p className="text-center text-sm font-semibold text-amber-200">
            Internal Lab Only — not a clinical assessment tool
          </p>
          <p className="mt-1 text-center text-xs text-amber-300/70">
            For therapist review only — scripted fixtures, no live camera
          </p>
        </div>
      </div>

      <div className="border-b border-[#1E2D42] px-6 py-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-white">
            Posture Screen — Deterministic Clinician Lab
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Phase-2B scripted playback through the Motion Intelligence acquisition
            adapter and posture frame bridge. No camera, no persistence, not a
            validated clinical assessment.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">
                Configuration
              </h2>

              <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                <p className="text-xs text-blue-200/90">
                  Landmark sequences are synthetic. Measured tilt values remain
                  separate from AI interpretation. Empty or unusable capture
                  shows &quot;Insufficient data&quot; instead of legacy score
                  placeholders.
                </p>
              </div>

              <label className="mb-2 block text-sm font-medium text-white/70">
                Scenario
              </label>
              <select
                value={scenarioId}
                onChange={(e) =>
                  setScenarioId(e.target.value as PostureDemoScenarioId)
                }
                disabled={isSessionActive}
                className="w-full rounded-lg border border-[#1E2D42] bg-[#0B1220] px-4 py-2.5 text-sm font-medium text-white transition hover:border-[#2A3E5A] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {POSTURE_LAB_SCENARIO_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {scenarioMeta && (
                <p className="mt-2 text-xs text-white/40">
                  {scenarioMeta.description}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Playback</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={isSessionActive}
                  className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={handleStep}
                  disabled={!isSessionActive || !hasMoreFrames || isPlaying}
                  className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-400 transition hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Step
                </button>
                <button
                  type="button"
                  onClick={isPlaying ? handlePause : handlePlay}
                  disabled={!isSessionActive || !hasMoreFrames}
                  className="rounded-lg border border-purple-500/50 bg-purple-500/10 px-4 py-2.5 text-sm font-semibold text-purple-400 transition hover:bg-purple-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!isSessionActive}
                  className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-400 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            </div>

            {playback && (
              <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  Session state
                </h2>
                <div className="space-y-3 text-sm">
                  <StateRow label="Scenario" value={scenarioMeta?.label ?? scenarioId} />
                  <StateRow
                    label="Frame progress"
                    value={`${playback.nextFrameIndex} / ${playback.frameCount}`}
                  />
                  <StateRow
                    label="Successful frames"
                    value={String(playback.frameResults.length)}
                  />
                  <StateRow
                    label="Complete"
                    value={playback.complete ? "Yes" : "No"}
                  />
                  <StateRow
                    label="Data sufficiency"
                    value={playback.aggregate.dataSufficiency}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {playback ? (
              <>
                <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Clinical display (gated)
                  </h2>
                  <div className="space-y-3 text-sm">
                    <StateRow
                      label="Displayed score"
                      value={playback.presentation.displayedScore}
                    />
                    <StateRow
                      label="Displayed classification"
                      value={playback.presentation.displayedClassification}
                    />
                    <StateRow
                      label="Expose legacy clinical fields"
                      value={
                        playback.presentation.exposeLegacyClinicalFields
                          ? "Yes"
                          : "No"
                      }
                    />
                  </div>
                  {playback.presentation.isInsufficient && (
                    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                      <p className="text-xs text-amber-200/90">
                        Capture is insufficient for therapist review display.
                        Legacy aggregate placeholders (score 75 / Mild
                        asymmetry) are not shown as clinical findings.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Aggregate (measured pipeline)
                  </h2>
                  <div className="space-y-3 text-sm">
                    <StateRow
                      label="Aggregate score (raw)"
                      value={aggregatePanel?.scoreDisplay ?? "—"}
                    />
                    <StateRow
                      label="Aggregate label (raw)"
                      value={aggregatePanel?.labelDisplay ?? "—"}
                    />
                    <StateRow
                      label="Bridge outcomes"
                      value={
                        playback.bridgeOutcomes
                          .map((r) => (r ? String(r.score) : "null"))
                          .join(", ") || "—"
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Latest frame (measured)
                  </h2>
                  {lastMeasured ? (
                    <div className="space-y-3 text-sm">
                      <StateRow
                        label="Shoulder tilt (deg)"
                        value={lastMeasured.shoulderTilt.toFixed(2)}
                      />
                      <StateRow
                        label="Hip tilt (deg)"
                        value={lastMeasured.hipTilt.toFixed(2)}
                      />
                      <StateRow
                        label="Head offset (norm)"
                        value={lastMeasured.headOffset.toFixed(4)}
                      />
                      <StateRow
                        label="Trunk offset (norm)"
                        value={lastMeasured.trunkOffset.toFixed(4)}
                      />
                      <StateRow
                        label="Frame score"
                        value={String(lastMeasured.score)}
                      />
                      <StateRow label="Frame label" value={lastMeasured.label} />
                    </div>
                  ) : (
                    <p className="text-sm text-white/50">
                      {playback.nextFrameIndex === 0
                        ? "No frames stepped yet."
                        : "Latest bridge outcome was null (unusable landmarks)."}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-[#1E2D42] bg-[#0F1825] p-6">
                <h2 className="mb-2 text-lg font-semibold text-white">
                  Ready
                </h2>
                <p className="text-sm text-white/50">
                  Choose a scenario and press Start to begin deterministic
                  playback. Use Step for single frames or Play to auto-advance.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#1E2D42]/60 pb-2 last:border-0 last:pb-0">
      <span className="text-white/50">{label}</span>
      <span className="text-right font-medium text-white/90">{value}</span>
    </div>
  );
}
