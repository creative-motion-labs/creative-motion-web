/**
 * Run: npx tsx --test app/lib/cv/shoulder-abduction-reach-pose-detector.test.ts
 *
 * Camera/MediaPipe lifecycle (`start()`) is not unit tested here — matching
 * the existing convention for every other `*-pose-detector.ts` class in
 * this codebase (see `single-leg-stance-pose-detector.test.ts`), which
 * covers only the synchronous, non-browser-dependent surface. Frame
 * processing is exercised directly via the private `processFrame` method
 * to prove the measured-event and compensation-signal logic without a real
 * camera.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import { MIN_PRESENT_VISIBILITY } from "@/app/lib/cv/motion-quality-confidence";
import type { BodyFramingState } from "@/app/lib/cv/body-framing-evaluator";
import {
  ShoulderAbductionReachPoseDetector,
  type ShoulderAbductionReachMeasuredEvent,
} from "./shoulder-abduction-reach-pose-detector";

// BlazePose indices used by SHOULDER_ABDUCTION_REACH_CORE_JOINTS via the
// acquisition adapter: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

function blankLandmarks(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
}

/** Right arm at rest (small hip-shoulder-elbow angle), no trunk drift. */
function restingLandmarks(): PoseLandmark[] {
  const lm = blankLandmarks();
  lm[R_HIP] = { x: 0.5, y: 0.6, visibility: 0.95 };
  lm[R_SHOULDER] = { x: 0.5, y: 0.35, visibility: 0.95 };
  lm[R_ELBOW] = { x: 0.5, y: 0.55, visibility: 0.95 };
  lm[R_WRIST] = { x: 0.5, y: 0.7, visibility: 0.9 };
  lm[L_HIP] = { x: 0.4, y: 0.6, visibility: 0.9 };
  lm[L_SHOULDER] = { x: 0.4, y: 0.35, visibility: 0.9 };
  lm[L_ELBOW] = { x: 0.4, y: 0.55, visibility: 0.9 };
  lm[L_WRIST] = { x: 0.4, y: 0.7, visibility: 0.9 };
  return lm;
}

/** Right arm raised to peak abduction, trunk unchanged (no compensation). */
function peakAbductionLandmarks(): PoseLandmark[] {
  const lm = restingLandmarks();
  lm[R_ELBOW] = { x: 0.75, y: 0.35, visibility: 0.95 };
  lm[R_WRIST] = { x: 0.95, y: 0.35, visibility: 0.9 };
  return lm;
}

/** Right arm raised to peak abduction while the trunk (hip->shoulder) drifts — compensation. */
function peakAbductionWithTrunkLeanLandmarks(): PoseLandmark[] {
  const lm = peakAbductionLandmarks();
  lm[R_SHOULDER] = { x: 0.62, y: 0.35, visibility: 0.95 };
  return lm;
}

function driveFrames(
  detector: ShoulderAbductionReachPoseDetector,
  landmarksSequence: Array<PoseLandmark[] | null>,
): void {
  const internals = detector as unknown as {
    processFrame: (landmarks: PoseLandmark[] | null, capturedAtMs: number) => void;
  };
  landmarksSequence.forEach((landmarks, i) => {
    internals.processFrame(landmarks, 1_000 + i * 33);
  });
}

/**
 * Drives the detector's own session-start boundary. `start()` itself needs a camera and
 * MediaPipe, so the reset it performs is exercised directly — the same private-access
 * convention `driveFrames` uses for `processFrame`. A test below asserts `start()` still
 * calls it, so this cannot drift into a parallel reset path.
 */
function startNewDetectorSession(detector: ShoulderAbductionReachPoseDetector): void {
  const internals = detector as unknown as { resetSessionState: () => void };
  internals.resetSessionState();
}

type LiveDetectInternals = {
  previewActive: boolean;
  videoEl: HTMLVideoElement | null;
  canvasEl: HTMLCanvasElement | null;
  poseLandmarker: PoseLandmarkerInstance | null;
  lastProcessedVideoTimeS: number | null;
  detectTimestamp: number;
  animFrameId: number;
  framesTotal: number;
  tickLiveVideoFrame: (options?: { scheduleNext?: boolean }) => void;
};

type PoseLandmarkerInstance = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => { landmarks?: PoseLandmark[][] };
  close?: () => void;
};

function installRafCapture(): {
  callbacks: FrameRequestCallback[];
  restore: () => void;
} {
  const callbacks: FrameRequestCallback[] = [];
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  return {
    callbacks,
    restore: () => {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

function createMockVideo(currentTimeS: number): HTMLVideoElement {
  return {
    currentTime: currentTimeS,
    videoWidth: 640,
    videoHeight: 480,
    paused: false,
    play: async () => {},
    addEventListener: () => {},
    srcObject: null,
  } as HTMLVideoElement;
}

function createMockCanvas(): HTMLCanvasElement {
  return {
    getContext: () => ({ clearRect: () => {} }),
  } as unknown as HTMLCanvasElement;
}

function bootstrapLiveDetectSession(
  detector: ShoulderAbductionReachPoseDetector,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  landmarker: PoseLandmarkerInstance,
): LiveDetectInternals {
  startNewDetectorSession(detector);
  const internals = detector as unknown as LiveDetectInternals;
  internals.videoEl = video;
  internals.canvasEl = canvas;
  internals.previewActive = true;
  internals.poseLandmarker = landmarker;
  return internals;
}

/**
 * Mirrors the one assignment the live capture loop makes after evaluating body framing.
 * That loop lives inside `start()` and needs a camera plus MediaPipe, so the value it
 * caches is set directly here — the same private-access convention `driveFrames` and
 * `startNewDetectorSession` already use. A test below pins the real assignment in
 * `start()`, so this cannot drift into a state production never reaches.
 */
function applyBodyFramingState(
  detector: ShoulderAbductionReachPoseDetector,
  framing: BodyFramingState,
): void {
  const internals = detector as unknown as { lastBodyFramingState: BodyFramingState };
  internals.lastBodyFramingState = framing;
}

describe("ShoulderAbductionReachPoseDetector", () => {
  it("constructor defaults primarySide to right", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} });
    assert.equal(detector.getSnapshot().primarySide, "right");
  });

  it("getDerivedMetrics returns shoulder-abduction-reach exercise id", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "left");
    const metrics = detector.getDerivedMetrics();
    assert.equal(metrics.exerciseId, "shoulder-abduction-reach");
    assert.equal(metrics.primarySide, "left");
    assert.equal(metrics.repCount, 0);
  });

  it("counts a completed rep and emits a repCompleted measured event", () => {
    const events: ShoulderAbductionReachMeasuredEvent[] = [];
    const detector = new ShoulderAbductionReachPoseDetector(
      { onSnapshot: () => {}, onMeasuredEvent: (e) => events.push(e) },
      "right",
    );

    driveFrames(detector, [
      restingLandmarks(),
      restingLandmarks(),
      peakAbductionLandmarks(),
      peakAbductionLandmarks(),
      restingLandmarks(),
      restingLandmarks(),
    ]);

    const snapshot = detector.getSnapshot();
    assert.equal(snapshot.primaryRepCount, 1);
    const repEvents = events.filter((e) => e.type === "repCompleted");
    assert.equal(repEvents.length, 1);
    assert.equal(repEvents[0].side, "right");
    assert.equal(repEvents[0].repCount, 1);
  });

  it("onDevFrameCaptured is optional and omitting it leaves behavior unchanged (regression)", () => {
    // Every other test in this file already omits onDevFrameCaptured and passes — this
    // test exists purely to name that guarantee explicitly for the RASQ ML bridge.
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    driveFrames(detector, [restingLandmarks(), peakAbductionLandmarks(), restingLandmarks()]);
    assert.equal(detector.getSnapshot().trackingStatus, "idle");
  });

  it("onDevFrameCaptured fires once per usable frame with the primary side's phase/rep state", () => {
    const captured: Array<{ capturedAtMs: number; phase: string; repCount: number }> = [];
    const detector = new ShoulderAbductionReachPoseDetector(
      {
        onSnapshot: () => {},
        onDevFrameCaptured: (input) => {
          assert.ok(input.frame.joints.right_shoulder, "the full NormalizedMotionFrame is passed through");
          assert.ok(!("peakAngleDegrees" in input), "Slice 1.1: peak angle is no longer passed through here");
          captured.push({ capturedAtMs: input.capturedAtMs, phase: input.phase, repCount: input.repCount });
        },
      },
      "right",
    );

    driveFrames(detector, [restingLandmarks(), peakAbductionLandmarks(), null, restingLandmarks()]);

    // 3 usable frames (the null frame has no landmarks, so no NormalizedMotionFrame exists for it).
    assert.equal(captured.length, 3);
    assert.equal(captured[0].phase, "resting");
    // A single frame past resting always lands in "raising" first (the phase FSM only
    // moves straight to "peak_abduction" from an existing "raising" state) — see
    // tickShoulderAbductionReachPhase's "resting"/"unknown" case.
    assert.equal(captured[1].phase, "raising");
    assert.equal(captured[0].capturedAtMs, 1_000);
    assert.equal(captured[1].capturedAtMs, 1_033);
  });

  it("emits compensationDetected only once trunk drift crosses threshold, and compensationCleared on return", () => {
    const events: ShoulderAbductionReachMeasuredEvent[] = [];
    const detector = new ShoulderAbductionReachPoseDetector(
      { onSnapshot: () => {}, onMeasuredEvent: (e) => events.push(e) },
      "right",
    );

    driveFrames(detector, [
      restingLandmarks(),
      restingLandmarks(),
      peakAbductionWithTrunkLeanLandmarks(),
      peakAbductionWithTrunkLeanLandmarks(),
      peakAbductionWithTrunkLeanLandmarks(),
      restingLandmarks(),
      restingLandmarks(),
    ]);

    const detected = events.filter((e) => e.type === "compensationDetected");
    const cleared = events.filter((e) => e.type === "compensationCleared");
    assert.equal(detected.length, 1, "flags exactly once, not once per frame while still flagged");
    assert.equal(cleared.length, 1);
  });

  it("does not flag compensation when the arm reaches peak without trunk drift", () => {
    const events: ShoulderAbductionReachMeasuredEvent[] = [];
    const detector = new ShoulderAbductionReachPoseDetector(
      { onSnapshot: () => {}, onMeasuredEvent: (e) => events.push(e) },
      "right",
    );

    driveFrames(detector, [
      restingLandmarks(),
      restingLandmarks(),
      peakAbductionLandmarks(),
      restingLandmarks(),
    ]);

    assert.equal(events.filter((e) => e.type === "compensationDetected").length, 0);
  });

  it("emits trackerLost after sustained missing landmarks, and trackerRecovered when they return", () => {
    const events: ShoulderAbductionReachMeasuredEvent[] = [];
    const detector = new ShoulderAbductionReachPoseDetector({
      onSnapshot: () => {},
      onMeasuredEvent: (e) => events.push(e),
    });

    const sequence: Array<PoseLandmark[] | null> = [
      restingLandmarks(),
      ...Array.from({ length: 12 }, () => null),
      restingLandmarks(),
    ];
    driveFrames(detector, sequence);

    assert.equal(events.filter((e) => e.type === "trackerLost").length, 1);
    assert.equal(events.filter((e) => e.type === "trackerRecovered").length, 1);
  });

  it("canSaveMetrics is false before the minimum session duration", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} });
    assert.equal(detector.canSaveMetrics(), false);
  });

  it("does not know about session duration, blocks, or completion — measurement source only", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} });
    const publicMembers = Object.getOwnPropertyNames(ShoulderAbductionReachPoseDetector.prototype);
    for (const forbidden of ["sessionComplete", "nextBlock", "workRestSchedule", "programProgression"]) {
      assert.equal(
        publicMembers.includes(forbidden),
        false,
        `detector must not expose ${forbidden} — that is Session Orchestrator scope`,
      );
    }
    void detector;
  });

  it("populates primaryWristNormalized for the configured primary side with normalized coordinates", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_WRIST] = { x: 0.62, y: 0.41, visibility: 0.95 };
    landmarks[L_WRIST] = { x: 0.18, y: 0.77, visibility: 0.95 };

    driveFrames(detector, [landmarks]);

    const wrist = detector.getSnapshot().primaryWristNormalized;
    assert.ok(wrist);
    assert.equal(wrist.x, 0.62);
    assert.equal(wrist.y, 0.41);
    assert.ok(wrist.x >= 0 && wrist.x <= 1);
    assert.ok(wrist.y >= 0 && wrist.y <= 1);
  });

  it("returns the primary-side wrist, not the opposite wrist", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "left");
    const landmarks = restingLandmarks();
    landmarks[L_WRIST] = { x: 0.22, y: 0.58, visibility: 0.95 };
    landmarks[R_WRIST] = { x: 0.81, y: 0.33, visibility: 0.95 };

    driveFrames(detector, [landmarks]);

    const wrist = detector.getSnapshot().primaryWristNormalized;
    assert.deepEqual(wrist, { x: 0.22, y: 0.58 });
  });

  it("sets primaryWristNormalized to null when the primary wrist is below the present visibility rule", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_WRIST] = {
      x: 0.62,
      y: 0.41,
      visibility: MIN_PRESENT_VISIBILITY - 0.05,
    };

    driveFrames(detector, [landmarks]);

    assert.equal(detector.getSnapshot().primaryWristNormalized, null);
  });

  it("sets primaryWristNormalized to null when the primary wrist landmark is missing from the frame", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_WRIST] = { x: 0.62, y: 0.41, visibility: 0 };

    driveFrames(detector, [landmarks]);

    assert.equal(detector.getSnapshot().primaryWristNormalized, null);
  });

  // ── CHANGE-002: adaptive target-placement geometry inputs ───────────────────
  // These expose affected-side joint positions and an on-screen reach scale.
  // None of them is a clinical measurement.

  it("exposes the primary-side shoulder and elbow for the right side", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };
    landmarks[R_ELBOW] = { x: 0.55, y: 0.5, visibility: 0.95 };
    landmarks[R_WRIST] = { x: 0.55, y: 0.8, visibility: 0.9 };

    driveFrames(detector, [landmarks]);
    const snapshot = detector.getSnapshot();

    assert.deepEqual(snapshot.primaryShoulderNormalized, { x: 0.55, y: 0.3 });
    assert.deepEqual(snapshot.primaryElbowNormalized, { x: 0.55, y: 0.5 });
    // shoulder->elbow 0.2 plus elbow->wrist 0.3.
    assert.ok(snapshot.estimatedArmLengthNormalized !== null);
    assert.ok(
      Math.abs((snapshot.estimatedArmLengthNormalized ?? 0) - 0.5) < 1e-9,
      `expected ~0.5, received ${snapshot.estimatedArmLengthNormalized}`,
    );
  });

  it("exposes the left-side joints, not the right, when the primary side is left", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "left");
    const landmarks = restingLandmarks();
    landmarks[L_SHOULDER] = { x: 0.45, y: 0.3, visibility: 0.95 };
    landmarks[L_ELBOW] = { x: 0.45, y: 0.4, visibility: 0.95 };
    landmarks[L_WRIST] = { x: 0.45, y: 0.5, visibility: 0.9 };
    landmarks[R_SHOULDER] = { x: 0.9, y: 0.1, visibility: 0.95 };

    driveFrames(detector, [landmarks]);
    const snapshot = detector.getSnapshot();

    assert.deepEqual(snapshot.primaryShoulderNormalized, { x: 0.45, y: 0.3 });
    assert.deepEqual(snapshot.primaryElbowNormalized, { x: 0.45, y: 0.4 });
    assert.ok(
      Math.abs((snapshot.estimatedArmLengthNormalized ?? 0) - 0.2) < 1e-9,
      `expected ~0.2, received ${snapshot.estimatedArmLengthNormalized}`,
    );
  });

  it("reports a null arm-length estimate when the primary elbow is below the presence rule", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_ELBOW] = { x: 0.55, y: 0.5, visibility: MIN_PRESENT_VISIBILITY - 0.05 };

    driveFrames(detector, [landmarks]);
    const snapshot = detector.getSnapshot();

    assert.equal(snapshot.primaryElbowNormalized, null);
    assert.equal(snapshot.estimatedArmLengthNormalized, null);
    // The shoulder is still reported — only the estimate is withheld.
    assert.ok(snapshot.primaryShoulderNormalized);
  });

  it("retains the last adaptive geometry across a dropped frame, matching wrist behaviour", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };

    driveFrames(detector, [landmarks]);
    const withPose = detector.getSnapshot();

    driveFrames(detector, [null]);
    const afterDrop = detector.getSnapshot();

    // A single frame without landmarks must not blank the anchor — this is the
    // pre-existing contract for primaryWristNormalized, and the new adaptive
    // fields deliberately follow it rather than introducing a second policy.
    assert.deepEqual(afterDrop.primaryWristNormalized, withPose.primaryWristNormalized);
    assert.deepEqual(afterDrop.primaryShoulderNormalized, withPose.primaryShoulderNormalized);
    assert.deepEqual(afterDrop.primaryElbowNormalized, withPose.primaryElbowNormalized);
    assert.equal(
      afterDrop.estimatedArmLengthNormalized,
      withPose.estimatedArmLengthNormalized,
    );
    assert.deepEqual(afterDrop.primaryShoulderNormalized, { x: 0.55, y: 0.3 });
  });

  it("keeps primaryWristNormalized behaviour unchanged alongside the new fields", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_WRIST] = { x: 0.62, y: 0.41, visibility: 0.95 };

    driveFrames(detector, [landmarks]);
    const snapshot = detector.getSnapshot();

    assert.deepEqual(snapshot.primaryWristNormalized, { x: 0.62, y: 0.41 });
  });

  // ── Review fix (PR #200): cached geometry must not cross a session boundary ──
  // The cache is deliberately held across dropped frames *inside* a session, so the
  // session start is the only place that can clear it.

  it("populates both cached geometry values during a session", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };
    landmarks[R_ELBOW] = { x: 0.55, y: 0.5, visibility: 0.95 };
    landmarks[R_WRIST] = { x: 0.55, y: 0.8, visibility: 0.9 };

    driveFrames(detector, [landmarks]);
    const snapshot = detector.getSnapshot();

    assert.deepEqual(snapshot.primaryWristNormalized, { x: 0.55, y: 0.8 });
    assert.deepEqual(snapshot.primaryShoulderNormalized, { x: 0.55, y: 0.3 });
    assert.deepEqual(snapshot.primaryElbowNormalized, { x: 0.55, y: 0.5 });
    assert.ok(snapshot.estimatedArmLengthNormalized !== null);
  });

  it("clears the cached wrist and arm geometry when a new session starts", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };
    landmarks[R_ELBOW] = { x: 0.55, y: 0.5, visibility: 0.95 };
    landmarks[R_WRIST] = { x: 0.55, y: 0.8, visibility: 0.9 };

    // A previous session that tracked successfully populates both caches.
    driveFrames(detector, [landmarks, landmarks]);
    assert.ok(detector.getSnapshot().primaryWristNormalized);
    assert.ok(detector.getSnapshot().primaryShoulderNormalized);

    startNewDetectorSession(detector);
    const fresh = detector.getSnapshot();

    assert.equal(fresh.primaryWristNormalized, null);
    assert.equal(fresh.primaryShoulderNormalized, null);
    assert.equal(fresh.primaryElbowNormalized, null);
    assert.equal(fresh.estimatedArmLengthNormalized, null);
  });

  it("clears the caches even when the previous session ended mid-tracking-loss", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };

    // Partially tracked session: landmarks, then a loss that deliberately keeps the cache.
    driveFrames(detector, [landmarks, null, null]);
    assert.deepEqual(detector.getSnapshot().primaryShoulderNormalized, { x: 0.55, y: 0.3 });

    startNewDetectorSession(detector);

    assert.equal(detector.getSnapshot().primaryShoulderNormalized, null);
    assert.equal(detector.getSnapshot().primaryWristNormalized, null);
  });

  it("cannot expose the previous session's geometry before the new session's first valid frame", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const first = restingLandmarks();
    first[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };
    first[R_WRIST] = { x: 0.55, y: 0.8, visibility: 0.9 };

    driveFrames(detector, [first]);
    startNewDetectorSession(detector);

    // Frames without landmarks must not resurrect the previous session's values.
    driveFrames(detector, [null, null, null]);
    assert.equal(detector.getSnapshot().primaryWristNormalized, null);
    assert.equal(detector.getSnapshot().primaryShoulderNormalized, null);

    // Nor may a frame whose primary joints fail the presence rule.
    const invisible = blankLandmarks();
    driveFrames(detector, [invisible]);
    assert.equal(detector.getSnapshot().primaryWristNormalized, null);
    assert.equal(detector.getSnapshot().primaryShoulderNormalized, null);

    // Only the new session's own valid landmarks may populate the caches.
    const second = restingLandmarks();
    second[R_SHOULDER] = { x: 0.41, y: 0.22, visibility: 0.95 };
    second[R_WRIST] = { x: 0.44, y: 0.66, visibility: 0.9 };
    driveFrames(detector, [second]);

    assert.deepEqual(detector.getSnapshot().primaryShoulderNormalized, { x: 0.41, y: 0.22 });
    assert.deepEqual(detector.getSnapshot().primaryWristNormalized, { x: 0.44, y: 0.66 });
  });

  it("leaves same-session tracking-loss behaviour unchanged", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };

    driveFrames(detector, [landmarks]);
    const withPose = detector.getSnapshot();

    // Well beyond TRACKER_LOST_CONSECUTIVE_FRAMES: losing the tracker mid-session still
    // holds the last known geometry. Only a new session clears it.
    driveFrames(detector, Array.from({ length: 15 }, () => null));
    const afterLoss = detector.getSnapshot();

    assert.equal(afterLoss.trackingStatus, "lost");
    assert.deepEqual(afterLoss.primaryWristNormalized, withPose.primaryWristNormalized);
    assert.deepEqual(afterLoss.primaryShoulderNormalized, withPose.primaryShoulderNormalized);
    assert.deepEqual(afterLoss.primaryElbowNormalized, withPose.primaryElbowNormalized);
    assert.equal(afterLoss.estimatedArmLengthNormalized, withPose.estimatedArmLengthNormalized);
  });

  // ── Review fix (PR #204): body framing must not cross a session boundary ────
  // `lastBodyFramingState` is written only on a frame that produced landmarks, so — like
  // the cached geometry above — it survives dropped frames inside a session. The session
  // start is therefore the only place that can return it to "checking".

  it("a session can move the body framing state away from checking", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    assert.equal(detector.getSnapshot().bodyFramingState, "checking");

    applyBodyFramingState(detector, "move_closer");

    assert.equal(detector.getSnapshot().bodyFramingState, "move_closer");
  });

  it("resets the body framing state to checking when a new session starts", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    applyBodyFramingState(detector, "move_back");
    assert.equal(detector.getSnapshot().bodyFramingState, "move_back");

    startNewDetectorSession(detector);

    assert.equal(detector.getSnapshot().bodyFramingState, "checking");
  });

  it("clears the framing state alongside the cached geometry at the session boundary", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    const landmarks = restingLandmarks();
    landmarks[R_SHOULDER] = { x: 0.55, y: 0.3, visibility: 0.95 };
    landmarks[R_ELBOW] = { x: 0.55, y: 0.5, visibility: 0.95 };
    landmarks[R_WRIST] = { x: 0.55, y: 0.8, visibility: 0.9 };

    // A previous session that both tracked and evaluated framing.
    driveFrames(detector, [landmarks, landmarks]);
    applyBodyFramingState(detector, "good_distance");
    const previous = detector.getSnapshot();
    assert.equal(previous.bodyFramingState, "good_distance");
    assert.ok(previous.primaryWristNormalized);
    assert.ok(previous.primaryShoulderNormalized);

    startNewDetectorSession(detector);
    const fresh = detector.getSnapshot();

    // One boundary clears all of it — the framing reset does not replace or weaken the
    // geometry reset that was already there.
    assert.equal(fresh.bodyFramingState, "checking");
    assert.equal(fresh.primaryWristNormalized, null);
    assert.equal(fresh.primaryShoulderNormalized, null);
    assert.equal(fresh.primaryElbowNormalized, null);
    assert.equal(fresh.estimatedArmLengthNormalized, null);
  });

  it("cannot expose the previous session's framing state before new framing input arrives", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    applyBodyFramingState(detector, "low_visibility");

    startNewDetectorSession(detector);

    // Frame processing does not evaluate framing, so neither dropped frames nor tracked
    // ones may resurrect the previous session's guidance.
    driveFrames(detector, [null, null]);
    assert.equal(detector.getSnapshot().bodyFramingState, "checking");

    driveFrames(detector, [restingLandmarks()]);
    assert.equal(detector.getSnapshot().bodyFramingState, "checking");

    // Only the new session's own framing evaluation may move it.
    applyBodyFramingState(detector, "good_distance");
    assert.equal(detector.getSnapshot().bodyFramingState, "good_distance");
  });

  it("leaves same-session framing behaviour unchanged", () => {
    const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
    driveFrames(detector, [restingLandmarks()]);
    applyBodyFramingState(detector, "move_closer");

    // Well beyond TRACKER_LOST_CONSECUTIVE_FRAMES: losing the tracker mid-session still
    // holds the last evaluated framing, exactly as it holds the last geometry.
    driveFrames(detector, Array.from({ length: 15 }, () => null));
    const afterLoss = detector.getSnapshot();

    assert.equal(afterLoss.trackingStatus, "lost");
    assert.equal(afterLoss.bodyFramingState, "move_closer");
  });

  it("writes the framing state from the real start() capture loop", () => {
    // The framing value is set privately in the tests above because the live loop needs a
    // camera. That is only valid while the live capture tick still caches the evaluated
    // framing into the same field the reset clears and the snapshot reads.
    const tickSource = (
      ShoulderAbductionReachPoseDetector.prototype as unknown as {
        tickLiveVideoFrame: () => void;
      }
    ).tickLiveVideoFrame.toString();
    assert.match(
      tickSource,
      /this\.lastBodyFramingState\s*=\s*framing/,
      "tickLiveVideoFrame must cache the evaluated body framing — the tests set the same field directly",
    );
  });

  it("runs the session reset from the real start() lifecycle entry point", () => {
    // The reset is exercised privately above because `start()` needs a camera. That is
    // only valid while `start()` — the detector's single session boundary — still calls
    // it; otherwise the tests would be guarding a parallel reset path that never runs.
    const startSource = ShoulderAbductionReachPoseDetector.prototype.start.toString();
    assert.match(
      startSource,
      /this\.resetSessionState\(\)/,
      "start() must perform the session reset — the detector has no second lifecycle boundary",
    );
  });

  it("deduplicates video frames by currentTime before calling detectForVideo (behavioral)", () => {
    const detectForVideoCalls: number[] = [];
    const landmarker: PoseLandmarkerInstance = {
      detectForVideo: (video) => {
        detectForVideoCalls.push(video.currentTime);
        return { landmarks: [restingLandmarks()] };
      },
    };

    const video = createMockVideo(0);
    const canvas = createMockCanvas();
    const raf = installRafCapture();
    try {
      const detector = new ShoulderAbductionReachPoseDetector({ onSnapshot: () => {} }, "right");
      const internals = bootstrapLiveDetectSession(detector, video, canvas, landmarker);

      // First decoded frame at currentTime=0 -> one inference.
      internals.tickLiveVideoFrame({ scheduleNext: false });
      assert.deepEqual(detectForVideoCalls, [0]);

      // Same currentTime on the next rAF tick -> skip inference.
      internals.tickLiveVideoFrame({ scheduleNext: false });
      assert.deepEqual(detectForVideoCalls, [0]);

      // Video clock advances -> process the new frame.
      video.currentTime = 0.033;
      internals.tickLiveVideoFrame({ scheduleNext: false });
      assert.deepEqual(detectForVideoCalls, [0, 0.033]);

      // New session clears the dedup memory and allows the same currentTime again.
      startNewDetectorSession(detector);
      internals.videoEl = video;
      internals.canvasEl = canvas;
      internals.previewActive = true;
      internals.poseLandmarker = landmarker;
      video.currentTime = 0;
      internals.tickLiveVideoFrame({ scheduleNext: false });
      assert.deepEqual(detectForVideoCalls, [0, 0.033, 0]);

      // Production loop still schedules another rAF tick after a duplicate skip.
      internals.tickLiveVideoFrame({ scheduleNext: true });
      assert.equal(raf.callbacks.length, 1);
    } finally {
      raf.restore();
    }
  });
});
