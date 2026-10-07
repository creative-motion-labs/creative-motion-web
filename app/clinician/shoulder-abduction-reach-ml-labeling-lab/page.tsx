"use client";

/**
 * Shoulder Abduction Reach — dev-only therapist-blind labeling lab.
 * RASQ ML bridge, First Labeling Slice (2026-08-19).
 *
 * DEV-ONLY. Replays already-captured repetitions (landmarks only — no
 * video, no images, none was ever captured) as a skeleton animation so a
 * rater can record their own independent visual judgment. Deliberately
 * blind to: the existing rule-based compensation flag, every derived
 * numeric feature (peak trunk drift ratio, peak angle, peak angular
 * velocity), and `simulationCondition` — none of these are ever sent by the
 * API this page talks to (`capture-reader.ts` redacts them server-side), so
 * there is nothing for this page to accidentally display. `participantId`
 * is likewise never sent to the browser — it is looked up and stamped onto
 * the label server-side only, in the POST route, and the labels the GET
 * route echoes back are projected through
 * `projectShoulderAbductionReachLabelForRater` to strip it.
 *
 * Rater independence is enforced by the API, not by this page: the GET
 * endpoint requires `raterId` and structurally can only return that rater's
 * own labels (see `label-client.ts` / the route's doc comment), so there is
 * no client-side filtering step that could be bypassed or forgotten.
 *
 * No ML training happens here. This is data-infrastructure only: schema +
 * local writer + dev API + skeleton replay UI.
 *
 * ANATOMICAL VISUAL GUIDE OVERLAY (Option A, added 2026-08-19): the replay
 * canvas also draws neutral anatomical reference geometry (static vertical
 * midline, live shoulder line, live pelvic line, live trunk axis, optional
 * wrist trail) via `drawAnatomicalGuideOverlay` in `skeleton-replay.ts`.
 * This is pure geometry only — no orientation or rotation classification of
 * any kind, no movement-plane classification, no compensation score or
 * threshold, no color-coded pass/fail. The `Show anatomical guides`
 * checkbox is a local display preference (default on) — it is never sent
 * to the API and never part of a submitted label.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLabelingSessions,
  fetchSessionForLabeling,
  postShoulderAbductionReachLabel,
} from "@/app/lib/ml-research/shoulder-abduction-reach/label-client";
import type {
  ShoulderAbductionCaptureSessionSummary,
  ShoulderAbductionReachRepForLabeling,
} from "@/app/lib/ml-research/shoulder-abduction-reach/capture-reader";
import {
  SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS,
  SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS,
  SHOULDER_ABDUCTION_REACH_LABEL_CONFIDENCE_LEVELS,
  type ShoulderAbductionReachCompensationLabel,
  type ShoulderAbductionReachExclusionFlag,
  type ShoulderAbductionReachLabelConfidence,
  type ShoulderAbductionReachLabelSubmission,
} from "@/app/lib/ml-research/shoulder-abduction-reach/label-schema";
import {
  computeInitialBodyMidline,
  computeReplayDurationMs,
  computeWristTrail,
  drawAnatomicalGuideOverlay,
  drawShoulderAbductionSkeletonFrame,
  resolveFrameIndexForElapsedMs,
  type StaticBodyMidline,
} from "@/app/lib/ml-research/shoulder-abduction-reach/skeleton-replay";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 480;
const RATER_ID_STORAGE_KEY = "rasq_ml_rater_id";

/** For this first slice, the labeling tool defaults to the validated retest session. */
const DEFAULT_LABELING_SESSION_ID = "dev-session-2026-08-18T23-18-39-738Z";

const COMPENSATION_LABEL_TEXT: Record<ShoulderAbductionReachCompensationLabel, string> = {
  NO_COMPENSATION: "No compensation",
  MILD_COMPENSATION: "Mild compensation",
  CLEAR_COMPENSATION: "Clear compensation",
};

const EXCLUSION_FLAG_TEXT: Record<ShoulderAbductionReachExclusionFlag, string> = {
  WRONG_MOVEMENT_PLANE: "Wrong movement plane",
  INCOMPLETE_REPETITION: "Incomplete repetition",
  NOT_REVIEWABLE: "Not reviewable",
};

type LabelChoice =
  | { kind: "compensation"; value: ShoulderAbductionReachCompensationLabel }
  | { kind: "exclusion"; value: ShoulderAbductionReachExclusionFlag }
  | null;

function repKey(rep: { sourceLineIndex: number }): string {
  // sourceLineIndex is unique per capture line — disambiguates repetitionId collisions across sides.
  return String(rep.sourceLineIndex);
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function ShoulderAbductionReachMlLabelingLabPage() {
  const [sessions, setSessions] = useState<ShoulderAbductionCaptureSessionSummary[]>([]);
  const [devSessionId, setDevSessionId] = useState<string | null>(null);
  const [reps, setReps] = useState<ShoulderAbductionReachRepForLabeling[]>([]);
  const [labeledRepIds, setLabeledRepIds] = useState<Set<string>>(new Set());
  const [currentRepIndex, setCurrentRepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Anatomical Visual Guide Overlay (Option A) — a display preference only, never sent to
  // the API and never part of a submitted label. Defaults ON per the approved design.
  const [showGuides, setShowGuides] = useState(true);

  const [labelChoice, setLabelChoice] = useState<LabelChoice>(null);
  const [raterConfidence, setRaterConfidence] = useState<ShoulderAbductionReachLabelConfidence | null>(null);
  const [note, setNote] = useState("");
  const [raterId, setRaterId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(RATER_ID_STORAGE_KEY);
    if (stored) setRaterId(stored);
  }, []);

  useEffect(() => {
    if (raterId) window.localStorage.setItem(RATER_ID_STORAGE_KEY, raterId);
  }, [raterId]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchLabelingSessions();
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "Could not load capture sessions.");
      return;
    }
    setSessions(result.sessions);
    if (!devSessionId) {
      const hasDefault = result.sessions.some((s) => s.devSessionId === DEFAULT_LABELING_SESSION_ID);
      if (hasDefault) {
        setDevSessionId(DEFAULT_LABELING_SESSION_ID);
      } else if (result.sessions.length > 0) {
        setDevSessionId(result.sessions[result.sessions.length - 1].devSessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadSession = useCallback(async (id: string, rater: string) => {
    setLoading(true);
    setError(null);
    const result = await fetchSessionForLabeling(id, rater);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "Could not load this session.");
      return;
    }
    setReps(result.reps);
    const labeledIds = new Set(result.labels.map((l) => String(l.sourceLineIndex)));
    setLabeledRepIds(labeledIds);
    const firstUnlabeled = result.reps.findIndex((rep) => !labeledIds.has(repKey(rep)));
    setCurrentRepIndex(firstUnlabeled >= 0 ? firstUnlabeled : 0);
    setElapsedMs(0);
    setPlaying(false);
  }, []);

  // Only load once both a session and a non-empty rater ID are known — the API requires
  // raterId, and loading without one would either fail or (worse) invite a design that
  // silently falls back to showing everyone's labels.
  useEffect(() => {
    if (devSessionId && raterId.trim()) void loadSession(devSessionId, raterId.trim());
  }, [devSessionId, raterId, loadSession]);

  const currentRep = reps[currentRepIndex] as ShoulderAbductionReachRepForLabeling | undefined;
  const durationMs = useMemo(() => (currentRep ? computeReplayDurationMs(currentRep.frames) : 0), [currentRep]);
  // Computed ONCE per repetition, from the baseline frame only — never recomputed from
  // later frames. This is what keeps the static midline from "following" a trunk lean.
  const staticMidline: StaticBodyMidline | null = useMemo(
    () => (currentRep ? computeInitialBodyMidline(currentRep.frames) : null),
    [currentRep],
  );
  const isCurrentLabeled = currentRep ? labeledRepIds.has(repKey(currentRep)) : false;
  const labeledCount = labeledRepIds.size;

  // Reset per-rep playback + form state whenever the selected repetition changes.
  useEffect(() => {
    setElapsedMs(0);
    setPlaying(false);
    setLabelChoice(null);
    setRaterConfidence(null);
    setNote("");
    setSubmitError(null);
  }, [currentRepIndex, devSessionId]);

  // Playback loop.
  useEffect(() => {
    if (!playing) {
      lastTickRef.current = null;
      return;
    }
    const tick = (nowMs: number) => {
      if (lastTickRef.current !== null) {
        const deltaMs = (nowMs - lastTickRef.current) * playbackRate;
        setElapsedMs((prev) => {
          const next = prev + deltaMs;
          if (next >= durationMs) {
            setPlaying(false);
            return durationMs;
          }
          return next;
        });
      }
      lastTickRef.current = nowMs;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, playbackRate, durationMs]);

  // Draw whenever the elapsed time or the active repetition changes. Frames are replayed
  // strictly in their stored order/timing — resolveFrameIndexForElapsedMs steps through
  // the real captured sequence, nothing is interpolated or invented between frames.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentRep) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frameIndex = resolveFrameIndexForElapsedMs(currentRep.frames, elapsedMs);
    if (frameIndex < 0) return;
    drawShoulderAbductionSkeletonFrame(ctx, currentRep.frames[frameIndex], CANVAS_WIDTH, CANVAS_HEIGHT, {
      side: currentRep.side,
    });
    // Layered on top of the skeleton — pure anatomical reference geometry only (midline,
    // shoulder line, pelvic line, trunk axis, wrist trail). No orientation estimate, no
    // score, no threshold: see skeleton-replay.ts's module doc comment.
    drawAnatomicalGuideOverlay(ctx, currentRep.frames[frameIndex], CANVAS_WIDTH, CANVAS_HEIGHT, {
      show: showGuides,
      staticMidline,
      wristTrail: computeWristTrail(currentRep.frames, currentRep.side, frameIndex),
    });
  }, [elapsedMs, currentRep, showGuides, staticMidline]);

  const stepFrame = useCallback(
    (delta: number) => {
      if (!currentRep) return;
      setPlaying(false);
      const frameIndex = resolveFrameIndexForElapsedMs(currentRep.frames, elapsedMs);
      const nextIndex = Math.min(Math.max(frameIndex + delta, 0), currentRep.frames.length - 1);
      setElapsedMs(currentRep.frames[nextIndex].relativeTimestampMs);
    },
    [currentRep, elapsedMs],
  );

  const restart = useCallback(() => {
    setPlaying(false);
    setElapsedMs(0);
  }, []);

  const goToRep = useCallback((index: number) => {
    setCurrentRepIndex(index);
  }, []);

  const canSubmit = labelChoice !== null && raterConfidence !== null && raterId.trim().length > 0;

  const handleSubmitLabel = useCallback(async () => {
    if (!currentRep || !devSessionId || !labelChoice || !raterConfidence) return;
    if (!raterId.trim()) {
      setSubmitError("Enter your rater ID before submitting a label.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const submission: ShoulderAbductionReachLabelSubmission = {
      devSessionId,
      repetitionId: currentRep.repetitionId,
      sourceLineIndex: currentRep.sourceLineIndex,
      side: currentRep.side,
      raterId: raterId.trim(),
      compensationLabel: labelChoice.kind === "compensation" ? labelChoice.value : null,
      exclusionFlag: labelChoice.kind === "exclusion" ? labelChoice.value : null,
      raterConfidence,
      note: note.trim(),
    };
    const result = await postShoulderAbductionReachLabel(submission);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error ?? "Failed to save label.");
      return;
    }
    const updatedLabeledIds = new Set(labeledRepIds).add(repKey(currentRep));
    setLabeledRepIds(updatedLabeledIds);
    const nextUnlabeled = reps.findIndex((rep, idx) => idx > currentRepIndex && !updatedLabeledIds.has(repKey(rep)));
    if (nextUnlabeled >= 0) setCurrentRepIndex(nextUnlabeled);
  }, [currentRep, devSessionId, labelChoice, raterConfidence, raterId, note, reps, currentRepIndex, labeledRepIds]);

  if (process.env.NODE_ENV !== "development") {
    return <p style={{ padding: 24 }}>This tool is only available in development.</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, fontFamily: "sans-serif" }}>
      <h1>Shoulder Abduction Reach — ML Labeling Lab (dev-only)</h1>
      <p style={{ color: "#4B5563", fontSize: 13, lineHeight: 1.6 }}>
        Internal research tool. This is a skeleton replay of already-captured landmark data — no video or
        images exist to show. This page never shows the rule-based compensation flag, any derived feature
        value (trunk drift ratio, peak angle, peak angular velocity), or any algorithmic interpretation —
        your label should come only from what you see in the replay. This is still technical development
        data, not clinically validated, and these internal test movements are not clinical ground truth.
      </p>
      <p style={{ color: "#4B5563", fontSize: 13, lineHeight: 1.6, background: "#F3F4F6", padding: 10, borderRadius: 6 }}>
        <strong>Movement-plane guidance:</strong> Abduction = arm moving mainly out to the side. If the arm
        is moving mainly forward / up in front of the body (flexion), mark <em>Wrong movement plane</em>.
        The capture is 2D and cannot always distinguish these reliably — if you genuinely can&apos;t tell,
        use <em>Not reviewable</em> rather than guessing.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label>
          Capture session:{" "}
          <select value={devSessionId ?? ""} onChange={(e) => setDevSessionId(e.target.value || null)}>
            {sessions.length === 0 ? <option value="">No sessions found</option> : null}
            {sessions.map((s) => (
              <option key={s.devSessionId} value={s.devSessionId}>
                {s.devSessionId} ({s.repCount} reps)
              </option>
            ))}
          </select>
        </label>
        <label>
          Rater ID:{" "}
          <input value={raterId} onChange={(e) => setRaterId(e.target.value)} placeholder="e.g. therapist-A" />
        </label>
      </div>

      {error ? <p style={{ color: "red" }}>{error}</p> : null}
      {loading ? <p>Loading…</p> : null}
      {!raterId.trim() ? <p style={{ color: "#9CA3AF" }}>Enter a rater ID to load repetitions.</p> : null}

      {!loading && raterId.trim() && reps.length > 0 ? (
        <>
          <p style={{ fontSize: 13, color: "#4B5563" }}>
            {labeledCount} / {reps.length} labeled by {raterId.trim()}
          </p>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, maxWidth: 900 }}>
            {reps.map((rep, idx) => (
              <button
                key={`${rep.sourceLineIndex}-${rep.side}`}
                type="button"
                onClick={() => goToRep(idx)}
                style={{
                  padding: "4px 8px",
                  fontSize: 12,
                  border: idx === currentRepIndex ? "2px solid #1D9E75" : "1px solid #D1D5DB",
                  background: labeledRepIds.has(repKey(rep)) ? "#D1FAE5" : "#fff",
                  cursor: "pointer",
                }}
                title={`${rep.repetitionId} (${rep.side}), ${rep.frameCount} frames`}
              >
                {rep.side === "right" ? "R" : "L"}
                {rep.repetitionIndex} {labeledRepIds.has(repKey(rep)) ? "✓" : ""}
              </button>
            ))}
          </div>

          {currentRep ? (
            <div style={{ display: "flex", gap: 24 }}>
              <div>
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  style={{ background: "#111827", borderRadius: 8 }}
                />
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" onClick={() => stepFrame(-1)}>
                    ⏮ step
                  </button>
                  <button type="button" onClick={() => setPlaying((p) => !p)}>
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button type="button" onClick={() => stepFrame(1)}>
                    step ⏭
                  </button>
                  <button type="button" onClick={restart}>
                    ⟲ Restart
                  </button>
                  <button type="button" onClick={() => setPlaybackRate((r) => (r === 1 ? 0.5 : 1))}>
                    {playbackRate === 1 ? "1x" : "0.5x"}
                  </button>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "#4B5563" }}>
                  <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                  Show anatomical guides
                </label>
                <input
                  type="range"
                  min={0}
                  max={durationMs}
                  value={elapsedMs}
                  onChange={(e) => {
                    setPlaying(false);
                    setElapsedMs(Number(e.target.value));
                  }}
                  style={{ width: CANVAS_WIDTH, marginTop: 8 }}
                />
                <p style={{ fontSize: 12, color: "#6B7280" }}>
                  {formatMs(elapsedMs)} / {formatMs(durationMs)} — {currentRep.repetitionId} — side:{" "}
                  {currentRep.side}, frames: {currentRep.frameCount}
                </p>
                {currentRep.reviewCaution ? (
                  <p style={{ fontSize: 12, color: "#B45309", background: "#FFFBEB", padding: 6, borderRadius: 4 }}>
                    ⚠ REVIEW WITH CAUTION — lower capture quality (short/less-tracked repetition). This is a
                    technical flag about the recording, not a hint about the movement.
                  </p>
                ) : null}
              </div>

              <div style={{ minWidth: 300 }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>
                  Label {isCurrentLabeled ? "(already labeled by you — resubmitting will update it)" : ""}
                </p>
                <p style={{ fontSize: 12, color: "#6B7280", marginTop: 0, marginBottom: 4 }}>Compensation severity</p>
                {SHOULDER_ABDUCTION_REACH_COMPENSATION_LABELS.map((option) => (
                  <label key={option} style={{ display: "block", marginBottom: 4 }}>
                    <input
                      type="radio"
                      name="labelChoice"
                      checked={labelChoice?.kind === "compensation" && labelChoice.value === option}
                      onChange={() => setLabelChoice({ kind: "compensation", value: option })}
                    />{" "}
                    {COMPENSATION_LABEL_TEXT[option]}
                  </label>
                ))}

                <p style={{ fontSize: 12, color: "#6B7280", marginTop: 10, marginBottom: 4 }}>
                  Exclude instead (not reviewable as compensation)
                </p>
                {SHOULDER_ABDUCTION_REACH_EXCLUSION_FLAGS.map((option) => (
                  <label key={option} style={{ display: "block", marginBottom: 4 }}>
                    <input
                      type="radio"
                      name="labelChoice"
                      checked={labelChoice?.kind === "exclusion" && labelChoice.value === option}
                      onChange={() => setLabelChoice({ kind: "exclusion", value: option })}
                    />{" "}
                    {EXCLUSION_FLAG_TEXT[option]}
                  </label>
                ))}

                <p style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>Confidence</p>
                {SHOULDER_ABDUCTION_REACH_LABEL_CONFIDENCE_LEVELS.map((option) => (
                  <label key={option} style={{ display: "block", marginBottom: 4 }}>
                    <input
                      type="radio"
                      name="raterConfidence"
                      checked={raterConfidence === option}
                      onChange={() => setRaterConfidence(option)}
                    />{" "}
                    {option}
                  </label>
                ))}

                <p style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>Note (optional)</p>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} style={{ width: "100%" }} />

                {submitError ? <p style={{ color: "red", fontSize: 13 }}>{submitError}</p> : null}

                <button
                  type="button"
                  onClick={() => void handleSubmitLabel()}
                  disabled={submitting || !canSubmit}
                  style={{ marginTop: 12 }}
                >
                  {submitting ? "Saving…" : "Submit label"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && raterId.trim() && reps.length === 0 && devSessionId ? <p>No repetitions found in this session.</p> : null}
    </div>
  );
}
