/**
 * Run: npx tsx --test app/lib/interactive-shoulder/orchestrator-cv-detector-snapshot-commit.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ShoulderAbductionReachPoseDetectorSnapshot } from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import {
  evaluatePoseDetectorUiCommit,
  normalizePoseDetectorSnapshotForUiCommit,
  normalizedPoseDetectorUiCommitEqual,
  POSE_DETECTOR_UI_COMMIT_MIN_INTERVAL_MS,
  type NormalizedPoseDetectorUiCommit,
} from "./orchestrator-cv-pose-detector-ui-commit";

function baseSnapshot(): ShoulderAbductionReachPoseDetectorSnapshot {
  return {
    trackingStatus: "tracking",
    trackingQuality: "good",
    bodyFramingState: "good_distance",
    primarySide: "right",
    primaryPhase: "resting",
    primaryRepCount: 0,
    primaryPeakAngleDegrees: null,
    bilateralAngleDifferenceDegrees: null,
    compensationFlagged: false,
    framesWithPose: 10,
    framesTotal: 12,
    initPhase: null,
    previewActive: true,
    trackingError: null,
    primaryWristNormalized: { x: 0.5, y: 0.5 },
    primaryShoulderNormalized: { x: 0.4, y: 0.4 },
    primaryElbowNormalized: { x: 0.45, y: 0.45 },
    estimatedArmLengthNormalized: 0.12,
  };
}

function simulateRafCommits(input: {
  frames: ShoulderAbductionReachPoseDetectorSnapshot[];
  startMs?: number;
  stepMs?: number;
}): { commits: number; parentCallbacks: number } {
  let committed: NormalizedPoseDetectorUiCommit | null = null;
  let lastCommitAtMs = 0;
  let live: ShoulderAbductionReachPoseDetectorSnapshot | null = null;
  let commits = 0;
  let parentCallbacks = 0;
  const startMs = input.startMs ?? 0;
  const stepMs = input.stepMs ?? 8;

  input.frames.forEach((frame, index) => {
    live = frame;
    const nowMs = startMs + index * stepMs;
    const evaluation = evaluatePoseDetectorUiCommit({
      live,
      committedNormalized: committed,
      lastCommitAtMs,
      nowMs,
    });
    if (evaluation.kind === "commit") {
      committed = evaluation.normalized;
      lastCommitAtMs = nowMs;
      commits += 1;
      parentCallbacks += 1;
    }
  });

  return { commits, parentCallbacks };
}

describe("orchestrator cv detector snapshot commit", () => {
  it("120 identical frames produce exactly one UI commit", () => {
    const frames = Array.from({ length: 120 }, () => ({
      ...baseSnapshot(),
      primaryWristNormalized: { x: 0.5, y: 0.5 },
    }));
    const result = simulateRafCommits({ frames, stepMs: 16 });
    assert.equal(result.commits, 1);
    assert.equal(result.parentCallbacks, 1);
  });

  it("changing frame counters only does not produce additional UI commits", () => {
    const frames: ShoulderAbductionReachPoseDetectorSnapshot[] = [baseSnapshot()];
    for (let i = 1; i < 120; i += 1) {
      frames.push({
        ...baseSnapshot(),
        framesWithPose: 10 + i,
        framesTotal: 12 + i,
        primaryRepCount: i,
        primaryPhase: i % 2 === 0 ? "resting" : "active",
        compensationFlagged: i % 3 === 0,
      });
    }
    const result = simulateRafCommits({ frames, stepMs: 16 });
    assert.equal(result.commits, 1);
  });

  it("one real visible wrist change after settle produces exactly one additional commit", () => {
    const frames: ShoulderAbductionReachPoseDetectorSnapshot[] = [];
    for (let i = 0; i < 40; i += 1) {
      frames.push(baseSnapshot());
    }
    frames.push({
      ...baseSnapshot(),
      primaryWristNormalized: { x: 0.62, y: 0.48 },
    });
    for (let i = 0; i < 40; i += 1) {
      frames.push({
        ...baseSnapshot(),
        primaryWristNormalized: { x: 0.62, y: 0.48 },
        framesTotal: 500 + i,
      });
    }

    let committed: NormalizedPoseDetectorUiCommit | null = null;
    let lastCommitAtMs = 0;
    let live: ShoulderAbductionReachPoseDetectorSnapshot | null = null;
    let commits = 0;

    frames.forEach((frame, index) => {
      live = frame;
      const nowMs = index * 80;
      const evaluation = evaluatePoseDetectorUiCommit({
        live,
        committedNormalized: committed,
        lastCommitAtMs,
        nowMs,
      });
      if (evaluation.kind === "commit") {
        committed = evaluation.normalized;
        lastCommitAtMs = nowMs;
        commits += 1;
      }
    });

    assert.equal(commits, 2, "initial commit plus one visible wrist change");
  });

  it("respects the UI commit throttle between visible changes", () => {
    const a = baseSnapshot();
    const b = { ...a, primaryWristNormalized: { x: 0.51, y: 0.5 } };
    const first = evaluatePoseDetectorUiCommit({
      live: a,
      committedNormalized: null,
      lastCommitAtMs: 0,
      nowMs: 0,
    });
    assert.equal(first.kind, "commit");

    const throttled = evaluatePoseDetectorUiCommit({
      live: b,
      committedNormalized: first.kind === "commit" ? first.normalized : null,
      lastCommitAtMs: 0,
      nowMs: POSE_DETECTOR_UI_COMMIT_MIN_INTERVAL_MS - 1,
    });
    assert.equal(throttled.kind, "skip");
    assert.equal(throttled.kind === "skip" ? throttled.reason : "", "throttled");

    const allowed = evaluatePoseDetectorUiCommit({
      live: b,
      committedNormalized: first.kind === "commit" ? first.normalized : null,
      lastCommitAtMs: 0,
      nowMs: POSE_DETECTOR_UI_COMMIT_MIN_INTERVAL_MS,
    });
    assert.equal(allowed.kind, "commit");
  });

  it("normalizes fresh objects with identical UI fields as equal", () => {
    const a = normalizePoseDetectorSnapshotForUiCommit(baseSnapshot());
    const b = normalizePoseDetectorSnapshotForUiCommit({
      ...baseSnapshot(),
      framesTotal: 9999,
      framesWithPose: 8888,
    });
    assert.equal(normalizedPoseDetectorUiCommitEqual(a, b), true);
  });

  it("ships ref ingest and evaluatePoseDetectorUiCommit in OrchestratorCvSessionCore", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx"),
      "utf8",
    );
    assert.match(source, /ingestLiveDetectorSnapshotRef\.current\(snap\)/);
    assert.match(source, /evaluatePoseDetectorUiCommit/);
    assert.match(source, /committedPoseDetectorUiRef\.current = normalized/);
    assert.match(source, /poseDetectorReactSnapshotUnchanged/);
    assert.match(source, /commitPoseDetectorUiIfChangedRef\.current\(now\)/);
  });
});
