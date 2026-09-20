/**
 * Run: npx tsx --test app/lib/interactive-shoulder/presentation-mirror.test.ts
 *
 * Issue #277 — the D1 diagonal appeared mirrored/reversed, confirmed in live RIGHT-side
 * camera QA.
 *
 * Root cause: every therapeutic-geometry module in this slice is authored in a MIRRORED
 * (selfie) preview space where SCREEN RIGHT is the patient's own RIGHT side — a
 * convention `adaptive/target-level-geometry.ts` states explicitly and `mirrorX`,
 * `resolveSideBiasedBounds` and `resolveTargetLevelPosition` all implement. The camera
 * preview was never actually mirrored, and MediaPipe reports raw image space, where a
 * patient facing the camera has their anatomical RIGHT on the IMAGE LEFT. The hand
 * marker and the hit test both read the raw wrist so they agreed with each other, while
 * the authored path landed on the opposite side.
 *
 * These tests drive the REAL detector with deterministic landmarks for a patient facing
 * the camera, and check the REAL resolved geometry — no camera, no MediaPipe, no DOM.
 * All four cases Aisha asked for are covered: RIGHT D1, LEFT D1, Reach the Light RIGHT,
 * Reach the Light LEFT.
 *
 * ORIENTATION FIXTURE. A person facing an unmirrored camera appears reversed to the
 * viewer, so their anatomical RIGHT side occupies the LOW-x half of the raw image. Every
 * fixture below is built that way, and that single fact is what the whole issue turns
 * on — so it is asserted directly in the first test rather than left implicit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  ShoulderAbductionReachPoseDetector,
  type ShoulderAbductionReachPoseDetectorSnapshot,
} from "@/app/lib/cv/shoulder-abduction-reach-pose-detector";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import {
  MIRRORED_PREVIEW_TRANSFORM,
  toMirroredPreviewPoint,
} from "./presentation-mirror";
import { resolveActiveMotionPattern } from "./motion-patterns/motion-pattern-registry";
import { D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE } from "./motion-patterns/d1-inspired-diagonal-reach-pattern";
import { samplePathAtProgress } from "./motion-patterns/bezier-path";
import {
  DEFAULT_SAFE_TARGET_BOUNDS,
  generateTherapeuticTarget,
} from "./target-generator";
import { isWristInsideTarget, DEFAULT_TARGET_HIT_CONFIG } from "./target-hit";
import { resolveTargetLevelPosition } from "./adaptive/target-level-geometry";

/* ── Raw-image fixtures for a patient facing the camera ────────────────────── */

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

/**
 * Raw MediaPipe landmarks for a patient facing the camera, with each wrist placed
 * where the caller asks IN RAW IMAGE SPACE.
 *
 * The patient's anatomical RIGHT is on the LOW-x side, which is what an unmirrored
 * camera actually produces — deliberately the opposite of the mirrored fixtures the
 * detector's own unit tests use, because that mirrored assumption is the bug.
 */
function facingCameraLandmarks(options: {
  rightWrist: { x: number; y: number };
  leftWrist: { x: number; y: number };
}): PoseLandmark[] {
  const lm: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  // Anatomical RIGHT on the LOW-x half of the raw image.
  lm[R_SHOULDER] = { x: 0.4, y: 0.35, visibility: 0.95 };
  lm[R_HIP] = { x: 0.42, y: 0.62, visibility: 0.95 };
  lm[R_ELBOW] = { x: 0.34, y: 0.48, visibility: 0.95 };
  lm[R_WRIST] = { x: options.rightWrist.x, y: options.rightWrist.y, visibility: 0.92 };
  // Anatomical LEFT on the HIGH-x half.
  lm[L_SHOULDER] = { x: 0.6, y: 0.35, visibility: 0.95 };
  lm[L_HIP] = { x: 0.58, y: 0.62, visibility: 0.95 };
  lm[L_ELBOW] = { x: 0.66, y: 0.48, visibility: 0.95 };
  lm[L_WRIST] = { x: options.leftWrist.x, y: options.leftWrist.y, visibility: 0.92 };
  return lm;
}

function mockVideo(): HTMLVideoElement {
  return {
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
    paused: false,
    play: async () => {},
    addEventListener: () => {},
    srcObject: null,
  } as unknown as HTMLVideoElement;
}

function mockCanvas(): HTMLCanvasElement {
  const ctx = {
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };
  return { getContext: () => ctx } as unknown as HTMLCanvasElement;
}

type LiveInternals = {
  previewActive: boolean;
  videoEl: HTMLVideoElement | null;
  canvasEl: HTMLCanvasElement | null;
  poseLandmarker: unknown;
  tickLiveVideoFrame: (options?: { scheduleNext?: boolean }) => void;
  resetSessionState: () => void;
};

/**
 * Runs the REAL detector over a raw-image pose and returns the published snapshot, so
 * these tests read the wrist the runtime would actually receive rather than a
 * hand-written stand-in.
 */
function publishedSnapshotFor(
  side: ShoulderAbductionReachSide,
  landmarks: PoseLandmark[],
): ShoulderAbductionReachPoseDetectorSnapshot {
  const snapshots: ShoulderAbductionReachPoseDetectorSnapshot[] = [];
  const detector = new ShoulderAbductionReachPoseDetector(
    { onSnapshot: (snap) => snapshots.push(snap) },
    side,
  );
  const internals = detector as unknown as LiveInternals;
  const video = mockVideo();
  internals.resetSessionState();
  internals.videoEl = video;
  internals.canvasEl = mockCanvas();
  internals.previewActive = true;
  internals.poseLandmarker = { detectForVideo: () => ({ landmarks: [landmarks] }) };

  // Ticks until the detector actually publishes. The publication cadence is owned by
  // #276 and is deliberately not assumed here, so this harness is correct whether the
  // detector emits every frame or every fifteenth.
  for (let frame = 1; frame <= 20 && snapshots.length === 0; frame += 1) {
    video.currentTime = frame / 30;
    internals.tickLiveVideoFrame({ scheduleNext: false });
  }

  const latest = snapshots[snapshots.length - 1];
  assert.ok(latest, "the detector must publish a snapshot for a tracked frame");
  return latest;
}

/** The wrist as the Interactive Shoulder runtime positions it — measured, then mirrored. */
function previewWristFor(
  side: ShoulderAbductionReachSide,
  landmarks: PoseLandmark[],
): { x: number; y: number } {
  const snap = publishedSnapshotFor(side, landmarks);
  const measured = snap.primaryWristNormalized;
  assert.ok(measured, "the fixture must produce a tracked wrist");
  const preview = toMirroredPreviewPoint(measured);
  assert.ok(preview);
  return preview;
}

/** Where the D1 path ends — the up-and-out end of the diagonal, which side-identifies it. */
function d1PathEnds(side: ShoulderAbductionReachSide) {
  const pattern = resolveActiveMotionPattern(
    D1_INSPIRED_DIAGONAL_REACH_FEEDBACK_PROFILE,
    side,
  );
  assert.ok(pattern, "D1 must resolve for both sides");
  return {
    start: samplePathAtProgress(pattern.sampledPath, 0),
    end: samplePathAtProgress(pattern.sampledPath, 1),
  };
}

/** A reaching pose: the named arm is raised up and out to that side of the body. */
const REACHING = {
  right: facingCameraLandmarks({
    // Patient's right arm out to THEIR right → further into the low-x half, raised.
    rightWrist: { x: 0.22, y: 0.24 },
    leftWrist: { x: 0.6, y: 0.66 },
  }),
  left: facingCameraLandmarks({
    rightWrist: { x: 0.4, y: 0.66 },
    // Patient's left arm out to THEIR left → further into the high-x half, raised.
    leftWrist: { x: 0.78, y: 0.24 },
  }),
} as const;

/* ── 0. The orientation fact the whole issue rests on ──────────────────────── */

describe("#277 raw camera orientation", () => {
  it("places the patient's anatomical right on the LOW-x half of the raw image", () => {
    const snap = publishedSnapshotFor("right", REACHING.right);
    assert.ok(snap.primaryWristNormalized);
    assert.ok(
      snap.primaryWristNormalized.x < 0.5,
      "a patient facing an unmirrored camera has their right hand on the image LEFT — " +
        "this is the premise the authored geometry contradicted",
    );
  });

  it("reflects a measured point into preview space, and is self-inverse", () => {
    const point = { x: 0.22, y: 0.24 };
    const once = toMirroredPreviewPoint(point);
    assert.deepEqual(once, { x: 0.78, y: 0.24 });
    const twice = toMirroredPreviewPoint(once);
    assert.ok(twice);
    assert.ok(
      Math.abs(twice.x - point.x) < 1e-9 && twice.y === point.y,
      "applying the mirror twice must return the original point (to float precision), " +
        "so a double application cannot leave a half-flip",
    );
    assert.equal(toMirroredPreviewPoint(null), null);
  });
});

/* ── 1 & 2. RIGHT D1 and LEFT D1 ───────────────────────────────────────────── */

describe("#277 D1 diagonal is no longer reversed", () => {
  it("RIGHT D1 — the path opens toward the same screen side as the right hand", () => {
    const wrist = previewWristFor("right", REACHING.right);
    const { start, end } = d1PathEnds("right");

    assert.ok(
      wrist.x > 0.5,
      `in the mirrored preview the right hand must be on screen RIGHT, saw x=${wrist.x}`,
    );
    assert.ok(
      end.x > 0.5,
      `the D1 up-and-out end must be on screen RIGHT for a right side, saw x=${end.x}`,
    );
    assert.ok(
      end.x > start.x,
      "D1 must travel from across the body toward the affected side",
    );
    assert.ok(end.y < start.y, "D1 must travel upward (y grows downward)");
    // The reported symptom, stated directly: the reaching hand and the far end of the
    // therapeutic path must be on the SAME side of the screen.
    assert.ok(
      Math.sign(wrist.x - 0.5) === Math.sign(end.x - 0.5),
      "reversed D1 regression: the hand and the path end are on opposite screen sides",
    );
  });

  it("LEFT D1 — the path opens toward the same screen side as the left hand", () => {
    const wrist = previewWristFor("left", REACHING.left);
    const { start, end } = d1PathEnds("left");

    assert.ok(
      wrist.x < 0.5,
      `in the mirrored preview the left hand must be on screen LEFT, saw x=${wrist.x}`,
    );
    assert.ok(
      end.x < 0.5,
      `the D1 up-and-out end must be on screen LEFT for a left side, saw x=${end.x}`,
    );
    assert.ok(end.x < start.x, "D1 must travel from across the body toward the affected side");
    assert.ok(end.y < start.y, "D1 must travel upward (y grows downward)");
    assert.ok(
      Math.sign(wrist.x - 0.5) === Math.sign(end.x - 0.5),
      "reversed D1 regression: the hand and the path end are on opposite screen sides",
    );
  });

  it("keeps the two sides genuine mirror images of each other", () => {
    const right = d1PathEnds("right");
    const left = d1PathEnds("left");
    assert.ok(Math.abs(right.end.x - (1 - left.end.x)) < 1e-9);
    assert.ok(Math.abs(right.start.x - (1 - left.start.x)) < 1e-9);
    assert.equal(right.end.y, left.end.y, "mirroring must not disturb the vertical path");
  });
});

/* ── 3 & 4. Reach the Light RIGHT and LEFT ─────────────────────────────────── */

describe("#277 Reach the Light targets land on the reaching side", () => {
  const generate = (side: ShoulderAbductionReachSide, random: () => number) =>
    generateTherapeuticTarget({
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      side,
      nowMs: 1_000,
      sequence: 1,
      random,
    });

  // `resolveSideBiasedBounds` is a deliberately SOFT bias: each side gets 55% of the
  // frame, so the two ranges overlap by a sliver across the midline. These assert the
  // property that actually matters — which way the bias leans relative to the reaching
  // hand — rather than a hard half-frame partition the generator never promised.
  const DRAWS = [0, 0.25, 0.5, 0.75, 0.999];

  it("Reach the Light RIGHT — targets are biased toward the right hand's screen side", () => {
    const wrist = previewWristFor("right", REACHING.right);
    assert.ok(wrist.x > 0.5, "the right hand must be on screen RIGHT in the mirrored preview");
    for (const r of DRAWS) {
      assert.ok(
        generate("right", () => r).x > generate("left", () => r).x,
        `right-side placement must sit right of left-side placement for random=${r}`,
      );
    }
    const centre = (generate("right", () => 0).x + generate("right", () => 0.999).x) / 2;
    assert.ok(centre > 0.5, `right-side range must be centred on screen RIGHT, saw ${centre}`);
  });

  it("Reach the Light LEFT — targets are biased toward the left hand's screen side", () => {
    const wrist = previewWristFor("left", REACHING.left);
    assert.ok(wrist.x < 0.5, "the left hand must be on screen LEFT in the mirrored preview");
    const centre = (generate("left", () => 0).x + generate("left", () => 0.999).x) / 2;
    assert.ok(centre < 0.5, `left-side range must be centred on screen LEFT, saw ${centre}`);
  });

  it("keeps Reach the Light reachable — targets sit toward the reaching hand", () => {
    // Guards the "D1 fixed but Reach the Light reversed" failure mode: a bias pointing
    // away from the reaching arm would put every target across the patient's body.
    for (const side of ["right", "left"] as const) {
      const wrist = previewWristFor(side, REACHING[side]);
      const centre = (generate(side, () => 0).x + generate(side, () => 0.999).x) / 2;
      assert.ok(
        Math.sign(centre - 0.5) === Math.sign(wrist.x - 0.5),
        `${side}: target bias and reaching hand must lean to the same screen side`,
      );
    }
  });
});

/* ── Adaptive shoulder-anchored placement (the other side-dependent path) ──── */

describe("#277 adaptive shoulder-anchored placement opens toward the affected side", () => {
  // Adaptive difficulty is off by default in production, but it is the OTHER piece of
  // target geometry that depends on side, and it is anchored on a MEASURED shoulder —
  // so it is the most likely place for a half-applied mirror to hide.
  const place = (side: ShoulderAbductionReachSide, anchor: { x: number; y: number }) =>
    resolveTargetLevelPosition({
      affectedSide: side,
      shoulderAnchorNormalized: anchor,
      reachRadiusNormalized: 0.22,
      levelDegrees: 90,
      minimumLevelDegrees: 20,
      maximumLevelDegrees: 140,
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      applySideBias: false,
    });

  it("places a right-side target lateral to the mirrored right shoulder", () => {
    const snap = publishedSnapshotFor("right", REACHING.right);
    const anchor = toMirroredPreviewPoint(snap.primaryShoulderNormalized);
    assert.ok(anchor, "the fixture must produce a tracked shoulder");
    const result = place("right", anchor);
    assert.equal(result.available, true);
    assert.ok(
      result.available && result.position.x > anchor.x,
      "a 90 degree right-side placement must sit lateral to the shoulder, toward screen right",
    );
  });

  it("places a left-side target lateral to the mirrored left shoulder", () => {
    const snap = publishedSnapshotFor("left", REACHING.left);
    const anchor = toMirroredPreviewPoint(snap.primaryShoulderNormalized);
    assert.ok(anchor, "the fixture must produce a tracked shoulder");
    const result = place("left", anchor);
    assert.equal(result.available, true);
    assert.ok(
      result.available && result.position.x < anchor.x,
      "a 90 degree left-side placement must sit lateral to the shoulder, toward screen left",
    );
  });
});

/* ── Cross-cutting: one coordinate space for marker, target and hit test ───── */

describe("#277 marker, target and hit test share one coordinate space", () => {
  it("hit-tests the same point the marker is drawn at", () => {
    const wrist = previewWristFor("right", REACHING.right);
    // A target placed exactly on the drawn marker must register as a hit. If the hit
    // test read a differently-mirrored wrist, this would miss by ~2x the offset.
    assert.equal(
      isWristInsideTarget(wrist, { x: wrist.x, y: wrist.y }, DEFAULT_TARGET_HIT_CONFIG),
      true,
      "a target under the rendered marker must be a hit",
    );
    // ...and the un-mirrored (pre-fix) wrist must NOT hit it, proving the assertion
    // above is actually sensitive to the mirror.
    const rawSnapshot = publishedSnapshotFor("right", REACHING.right);
    assert.ok(rawSnapshot.primaryWristNormalized);
    assert.equal(
      isWristInsideTarget(
        rawSnapshot.primaryWristNormalized,
        { x: wrist.x, y: wrist.y },
        DEFAULT_TARGET_HIT_CONFIG,
      ),
      false,
      "the raw measured wrist must not satisfy a preview-space target — otherwise this " +
        "suite could not detect a marker/hit-test space mismatch",
    );
  });

  it("mirrors the preview in the shipped component, video and canvas together", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
      ),
      "utf8",
    );
    assert.equal(MIRRORED_PREVIEW_TRANSFORM, "scaleX(-1)");
    const applications = source.match(
      /style=\{\{ transform: MIRRORED_PREVIEW_TRANSFORM \}\}/g,
    );
    assert.equal(
      applications?.length,
      2,
      "the video and its landmark canvas must carry the SAME transform, or the drawn " +
        "landmarks stop lining up with the mirrored video",
    );
    // The measured points that enter presentation must all be converted.
    assert.match(source, /toMirroredPreviewPoint\(poseSnap\?\.primaryWristNormalized\)/);
    assert.match(source, /toMirroredPreviewPoint\(snapshot\?\.primaryWristNormalized\)/);
    assert.match(source, /toMirroredPreviewPoint\(\s*poseSnap\?\.primaryShoulderNormalized,?\s*\)/);
  });

  it("does not step the cursor's smoothing faster than the detector publishes", () => {
    // #276 protection. `TrackedHandCursor` compares `wrist` by IDENTITY in its effect
    // deps, and that effect advances the smoothing lerp and pushes the motion trail.
    // The orchestrator re-renders at display rate while the detector publishes at
    // camera rate, so mirroring inline in the JSX would hand the cursor a new object
    // every render and step the smoothing twice per camera frame — changing cursor feel
    // and halving the trail's time span. The memo is what prevents that.
    const measured = { x: 0.3, y: 0.4 };
    assert.notEqual(
      toMirroredPreviewPoint(measured),
      toMirroredPreviewPoint(measured),
      "the mirror allocates per call, so memoising it at the cursor is load-bearing",
    );

    const source = readFileSync(
      join(
        process.cwd(),
        "app/components/patient/interactive-shoulder/OrchestratorCvSessionCore.tsx",
      ),
      "utf8",
    );
    assert.match(
      source,
      /const mirroredCursorWrist = useMemo\(\s*\(\) => toMirroredPreviewPoint\(snapshot\?\.primaryWristNormalized\),\s*\[snapshot\?\.primaryWristNormalized\],\s*\)/,
      "the cursor's mirrored point must be memoised on the MEASURED reference, so its " +
        "identity changes once per published measurement and not once per render",
    );
    assert.match(
      source,
      /wrist=\{\s*mirroredCursorWrist \?\?/,
      "the cursor must consume the memoised point, not a fresh inline conversion",
    );
  });
});
