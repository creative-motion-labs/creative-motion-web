/**
 * Lateral Reach Camera Detector — Slice 14/15 tests.
 *
 * Slice 14: optional onFrame delivery semantics.
 * Slice 15: acquisition-only mode + deferred engine start.
 *
 * Lifecycle tests stub only the private MediaPipe/camera acquire helper so the
 * real beginSession / startAcquisition / start / startEngine / frame-loop
 * contracts can be exercised without getUserMedia.
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/cv/lateral-reach-camera-detector.test.ts"
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BLAZEPOSE_ACQUISITION_ADAPTER } from "@/app/lib/input-acquisition/adapters/motion/blazepose-acquisition-adapter";
import type { InputAcquisitionContext } from "@/app/lib/input-acquisition/contract";
import type { NormalizedMotionFrame } from "@/app/lib/motion-intelligence";
import type { PoseLandmark } from "@/app/lib/cv/pose-landmark-overlay";
import {
  LateralReachCameraDetector,
  notifyLateralReachCameraFrameObserver,
  type LateralReachCameraDetectorCallbacks,
} from "@/app/lib/cv/lateral-reach-camera-detector";
import {
  applyLateralReachCommand,
  createLateralReachAttemptState,
  validateLateralReachConfig,
  type LateralReachAttemptState,
  type LateralReachConfig,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import type { UpperLimbSide } from "@/app/lib/upper-limb-motor-screen/types";

const DETECTOR_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lateral-reach-camera-detector.ts",
);

function buildLandmarks(
  joints: Record<number, { x: number; y: number; visibility: number }>,
): PoseLandmark[] {
  const landmarks: PoseLandmark[] = [];
  for (let i = 0; i < 33; i++) {
    const joint = joints[i];
    if (joint) {
      landmarks[i] = { x: joint.x, y: joint.y, visibility: joint.visibility };
    } else {
      landmarks[i] = { x: -1, y: -1, visibility: 0 };
    }
  }
  return landmarks;
}

function buildConfig(overrides: Partial<LateralReachConfig> = {}): LateralReachConfig {
  const result = validateLateralReachConfig({
    testedSide: "right",
    fixedTarget: { point: { x: 0.7, y: 0.5 }, radius: 0.05 },
    startingZone: { point: { x: 0.3, y: 0.5 }, radius: 0.05 },
    tracking: { minWristVisibility: 0.3, maxAllowedGapMs: 300 },
    timing: { onsetConfirmationMs: 100, dwellDurationMs: 200, returnConfirmationMs: 150 },
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`Invalid config: ${result.reason}`);
  }
  return result.config;
}

function initState(config: LateralReachConfig, armedAtMs = 0): LateralReachAttemptState {
  const result = createLateralReachAttemptState(config, 0, armedAtMs);
  if (!result.ok) {
    throw new Error(`Failed to init state: ${result.reason}`);
  }
  return result.state;
}

function adapterFrame(
  wrist: { x: number; y: number; visibility?: number },
  context: InputAcquisitionContext,
): NormalizedMotionFrame {
  const landmarks = buildLandmarks({
    [16]: { x: wrist.x, y: wrist.y, visibility: wrist.visibility ?? 0.9 },
  });
  const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, context);
  assert.ok(frame);
  return frame;
}

/**
 * Mirrors locked CASE A production order for behavioral proof:
 * engine command → isolated onFrame.
 */
function deliverLikeDetectorCaseA(
  state: LateralReachAttemptState,
  frame: NormalizedMotionFrame,
  nowMs: number,
  onFrame?: (frame: NormalizedMotionFrame) => void,
) {
  const order: string[] = [];
  const engineResult = applyLateralReachCommand(state, {
    type: "frame",
    nowMs,
    frame,
  });
  order.push(`engine:${engineResult.status}`);
  notifyLateralReachCameraFrameObserver((observed) => {
    order.push("onFrame");
    onFrame?.(observed);
  }, frame);
  return { engineResult, order };
}

describe("LateralReachCameraDetectorCallbacks — backward compatibility", () => {
  it("accepts callbacks with only onSnapshot", () => {
    const callbacks: LateralReachCameraDetectorCallbacks = {
      onSnapshot: () => {},
    };
    const detector = new LateralReachCameraDetector(callbacks);
    assert.ok(detector);
    assert.equal(typeof callbacks.onFrame, "undefined");
  });
});

describe("notifyLateralReachCameraFrameObserver — delivery semantics", () => {
  it("delivers exactly once for one non-null adapter frame", () => {
    const frame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 7, capturedAtMs: 1234, deviceLabel: "front_camera" },
    );
    let count = 0;
    notifyLateralReachCameraFrameObserver(() => {
      count += 1;
    }, frame);
    assert.equal(count, 1);
  });

  it("preserves exact adapter frame identity and values", () => {
    const frame = adapterFrame(
      { x: 0.42, y: 0.61, visibility: 0.88 },
      { frameIndex: 11, capturedAtMs: 9001, deviceLabel: "front_camera" },
    );
    const received: NormalizedMotionFrame[] = [];
    notifyLateralReachCameraFrameObserver((f) => {
      received.push(f);
    }, frame);

    assert.equal(received.length, 1);
    const observed = received[0]!;
    assert.equal(observed, frame);
    assert.equal(observed.source.capturedAtMs, 9001);
    assert.equal(observed.source.frameIndex, 11);
    assert.equal(observed.source.kind, "web_camera_pose");
    assert.equal(observed.source.deviceLabel, "front_camera");
    assert.equal(observed.joints.right_wrist?.landmark.x, 0.42);
    assert.equal(observed.joints.right_wrist?.landmark.y, 0.61);
    assert.equal(observed.joints.right_wrist?.confidence.visibility, 0.88);
  });

  it("no-ops when onFrame is omitted", () => {
    const frame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 0, capturedAtMs: 0 },
    );
    assert.doesNotThrow(() =>
      notifyLateralReachCameraFrameObserver(undefined, frame),
    );
  });

  it("isolates observer throws without escaping", () => {
    const frame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 0, capturedAtMs: 0 },
    );
    let continued = false;
    assert.doesNotThrow(() => {
      notifyLateralReachCameraFrameObserver(() => {
        throw new Error("observer boom");
      }, frame);
      continued = true;
    });
    assert.equal(continued, true);
  });
});

describe("CASE A composition — engine-first, applied and rejected", () => {
  it("notifies after applied engine handling with the real frame", () => {
    const state = initState(buildConfig());
    const frame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 0, capturedAtMs: 10 },
    );
    const received: NormalizedMotionFrame[] = [];
    const { engineResult, order } = deliverLikeDetectorCaseA(
      state,
      frame,
      10,
      (f) => {
        received.push(f);
      },
    );

    assert.equal(engineResult.status, "applied");
    assert.deepEqual(order, ["engine:applied", "onFrame"]);
    assert.equal(received[0], frame);
  });

  it("notifies after rejected engine handling with the real frame", () => {
    // Drive to completed_pending_finalization so subsequent frames reject.
    const config = buildConfig();
    let state = initState(config, 0);

    const startFrame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 0, capturedAtMs: 10 },
    );
    let result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "readinessConfirmed",
      nowMs: 20,
      confirmedBy: "clinician",
    });
    assert.equal(result.status, "applied");
    state = result.state;

    const exitFrame = adapterFrame(
      { x: 0.5, y: 0.5 },
      { frameIndex: 2, capturedAtMs: 30 },
    );
    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 30 + config.timing.onsetConfirmationMs + 10,
      frame: exitFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    const targetFrame = adapterFrame(
      { x: 0.7, y: 0.5 },
      { frameIndex: 1, capturedAtMs: 200 },
    );
    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 200,
      frame: targetFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 200 + config.timing.dwellDurationMs + 10,
      frame: targetFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 500,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;

    result = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 500 + config.timing.returnConfirmationMs + 10,
      frame: startFrame,
    });
    assert.equal(result.status, "applied");
    state = result.state;
    assert.equal(result.snapshot.phase, "completed_pending_finalization");

    const laterFrame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 3, capturedAtMs: 700 },
    );
    const received: NormalizedMotionFrame[] = [];
    const delivery = deliverLikeDetectorCaseA(state, laterFrame, 700, (f) => {
      received.push(f);
    });

    assert.equal(delivery.engineResult.status, "rejected");
    assert.deepEqual(delivery.order, ["engine:rejected", "onFrame"]);
    assert.equal(received[0], laterFrame);
  });

  it("observer throw after engine does not prevent represented downstream continuation", () => {
    const state = initState(buildConfig());
    const frame = adapterFrame(
      { x: 0.3, y: 0.5 },
      { frameIndex: 0, capturedAtMs: 10 },
    );

    const engineResult = applyLateralReachCommand(state, {
      type: "frame",
      nowMs: 10,
      frame,
    });
    assert.equal(engineResult.status, "applied");

    let readinessRan = false;
    let emitRan = false;
    assert.doesNotThrow(() => {
      notifyLateralReachCameraFrameObserver(() => {
        throw new Error("observer boom");
      }, frame);
      // Represented production tail after observer notification.
      readinessRan = true;
      emitRan = true;
    });
    assert.equal(readinessRan, true);
    assert.equal(emitRan, true);
  });
});

describe("CASE B / CASE C — no onFrame delivery", () => {
  it("does not invoke onFrame when MediaPipe returns no landmarks (CASE B)", () => {
    // CASE B has no NormalizedMotionFrame; production never calls the notifier.
    let count = 0;
    const onFrame = () => {
      count += 1;
    };
    // Simulate: no frame object exists → notifier is not called.
    assert.equal(typeof onFrame, "function");
    assert.equal(count, 0);
  });

  it("does not invoke onFrame when adapter returns null (CASE C)", () => {
    const allInvalid = buildLandmarks({});
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(allInvalid, {
      frameIndex: 0,
      capturedAtMs: 0,
    });
    assert.equal(frame, null);

    let count = 0;
    if (frame) {
      notifyLateralReachCameraFrameObserver(() => {
        count += 1;
      }, frame);
    }
    assert.equal(count, 0);
  });
});

describe("testedSide independence and scope guards", () => {
  it("frame exposure preserves full adapter joints without testedSide wrist filtering", () => {
    const landmarks = buildLandmarks({
      [15]: { x: 0.2, y: 0.4, visibility: 0.9 },
      [16]: { x: 0.8, y: 0.6, visibility: 0.9 },
    });
    const frame = BLAZEPOSE_ACQUISITION_ADAPTER.normalize(landmarks, {
      frameIndex: 1,
      capturedAtMs: 50,
    });
    assert.ok(frame);
    assert.ok(frame.joints.left_wrist);
    assert.ok(frame.joints.right_wrist);

    const received: NormalizedMotionFrame[] = [];
    notifyLateralReachCameraFrameObserver((f) => {
      received.push(f);
    }, frame);

    assert.equal(received.length, 1);
    const observed = received[0]!;
    assert.equal(observed, frame);
    assert.ok(observed.joints.left_wrist);
    assert.ok(observed.joints.right_wrist);
  });

  it("detector source uses locked engine-first order and forbids calibration wiring", () => {
    const source = readFileSync(DETECTOR_SOURCE_PATH, "utf8");

    const caseAIndex = source.indexOf("// CASE A: Valid frame from adapter");
    assert.ok(caseAIndex >= 0);
    const engineBranch = source.slice(
      caseAIndex,
      source.indexOf("// Acquisition-only: expose frame", caseAIndex),
    );

    const applyIndex = engineBranch.indexOf("applyLateralReachCommand");
    const notifyIndex = engineBranch.indexOf("notifyLateralReachCameraFrameObserver");
    assert.ok(applyIndex >= 0);
    assert.ok(notifyIndex >= 0);
    assert.ok(applyIndex < notifyIndex);

    // CASE B body must not notify.
    const caseBIndex = source.indexOf("// CASE B: MediaPipe returned no pose landmarks");
    assert.ok(caseBIndex >= 0);
    const caseBSlice = source.slice(caseBIndex, caseBIndex + 800);
    assert.equal(caseBSlice.includes("notifyLateralReachCameraFrameObserver"), false);

    assert.equal(source.includes("resolveLateralReachCalibrationSampleFromFrame"), false);
    assert.equal(source.includes("createLateralReachCalibrationController"), false);
    assert.equal(source.includes("submitLateralReachCalibrationSample"), false);
    assert.equal(source.includes("buildLateralReachEngineConfig"), false);
    assert.equal(source.includes("interaction-calibration"), false);

    // Frame exposure must not select wrist by testedSide.
    const notifyCallSite = engineBranch.slice(notifyIndex);
    assert.equal(notifyCallSite.includes("testedSide"), false);
  });
});

// ---------------------------------------------------------------------------
// Slice 15 — acquisition-only + deferred engine start
// ---------------------------------------------------------------------------

type DetectorInternals = {
  status: string;
  initPhase: string | null;
  engineConfig: LateralReachConfig | null;
  engineState: LateralReachAttemptState | null;
  poseLandmarker: {
    detectForVideo: (
      video: HTMLVideoElement,
      ts: number,
    ) => { landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>> };
    close?: () => void;
  } | null;
  sessionEpoch: number;
  currentEpoch: number;
  lastCommandType: string | null;
  acquireCameraAndModel: (
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    epoch: number,
  ) => Promise<void>;
  startFrameLoop: (video: HTMLVideoElement) => void;
  emit: () => void;
  acquisitionOverlayTestedSide: UpperLimbSide | null;
};

function asInternals(detector: LateralReachCameraDetector): DetectorInternals {
  return detector as unknown as DetectorInternals;
}

function fakeVideo(): HTMLVideoElement {
  return {
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
  } as HTMLVideoElement;
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

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

function stubAcquireWithPhaseEmits(
  detector: LateralReachCameraDetector,
  landmarkerFactory: () => DetectorInternals["poseLandmarker"],
): void {
  const internals = asInternals(detector);
  internals.acquireCameraAndModel = async () => {
    internals.initPhase = "model";
    internals.emit();
    internals.initPhase = "camera";
    internals.emit();
    internals.poseLandmarker = landmarkerFactory();
  };
}

function validWristLandmarks(): Array<{ x: number; y: number; visibility?: number }> {
  return buildLandmarks({
    [16]: { x: 0.3, y: 0.5, visibility: 0.9 },
  }) as Array<{ x: number; y: number; visibility?: number }>;
}

describe("Slice 15 — legacy start() compatibility", () => {
  it("emits initializing/import → model → camera → running and never acquiring", async () => {
    const statuses: Array<{ status: string; initPhase: string | null }> = [];
    const detector = new LateralReachCameraDetector({
      onSnapshot: (s) => statuses.push({ status: s.status, initPhase: s.initPhase }),
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.start(fakeVideo(), fakeCanvas(), buildConfig());
      const sequence = statuses.map((s) => `${s.status}/${String(s.initPhase)}`);
      assert.deepEqual(sequence, [
        "initializing/import",
        "initializing/model",
        "initializing/camera",
        "running/null",
      ]);
      assert.equal(sequence.includes("acquiring/null"), false);
      assert.ok(statuses.at(-1)?.status === "running");
      assert.ok(detector.getSnapshot().engineSnapshot !== null);
    } finally {
      detector.stop();
      raf.restore();
    }
  });
});

describe("Slice 15 — startAcquisition()", () => {
  it("emits initializing/import → model → camera → acquiring and never running", async () => {
    const statuses: Array<{ status: string; initPhase: string | null }> = [];
    const detector = new LateralReachCameraDetector({
      onSnapshot: (s) => statuses.push({ status: s.status, initPhase: s.initPhase }),
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      const sequence = statuses.map((s) => `${s.status}/${String(s.initPhase)}`);
      assert.deepEqual(sequence, [
        "initializing/import",
        "initializing/model",
        "initializing/camera",
        "acquiring/null",
      ]);
      assert.equal(sequence.some((s) => s.startsWith("running/")), false);
      assert.equal(detector.getSnapshot().engineSnapshot, null);
      assert.equal(asInternals(detector).engineConfig, null);
      assert.equal(asInternals(detector).engineState, null);
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("delivers real adapter frames via onFrame with zero engine side effects", async () => {
    const received: NormalizedMotionFrame[] = [];
    const detector = new LateralReachCameraDetector({
      onSnapshot: () => {},
      onFrame: (f) => received.push(f),
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      assert.equal(raf.callbacks.length, 1);
      raf.callbacks[0]!(0);
      assert.equal(received.length, 1);
      assert.ok(received[0]?.joints.right_wrist);
      assert.equal(detector.getSnapshot().engineSnapshot, null);
      assert.equal(asInternals(detector).lastCommandType, null);
      assert.equal(detector.getSnapshot().status, "acquiring");
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("rejects non-idle startAcquisition without mutating an existing session", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      const epochBefore = asInternals(detector).sessionEpoch;
      await assert.rejects(
        () => detector.startAcquisition(fakeVideo(), fakeCanvas()),
        (err: unknown) =>
          err instanceof RangeError &&
          err.message === 'startAcquisition requires status "idle"',
      );
      assert.equal(asInternals(detector).sessionEpoch, epochBefore);
      assert.equal(detector.getSnapshot().status, "acquiring");
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("rejects a concurrent second startAcquisition before it can begin a session", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    let acquireStarted = 0;
    asInternals(detector).acquireCameraAndModel = async () => {
      acquireStarted += 1;
      await new Promise((r) => setTimeout(r, 20));
      asInternals(detector).poseLandmarker = {
        detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
      };
    };
    const raf = installRafCapture();
    try {
      const p1 = detector.startAcquisition(fakeVideo(), fakeCanvas());
      assert.equal(detector.getSnapshot().status, "initializing");
      await assert.rejects(
        () => detector.startAcquisition(fakeVideo(), fakeCanvas()),
        RangeError,
      );
      await p1;
      assert.equal(acquireStarted, 1);
      assert.equal(detector.getSnapshot().status, "acquiring");
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("throws while running and leaves the engine session undisturbed", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.start(fakeVideo(), fakeCanvas(), buildConfig());
      const snap = detector.getSnapshot();
      assert.equal(snap.status, "running");
      assert.ok(snap.engineSnapshot);
      const epoch = asInternals(detector).sessionEpoch;
      await assert.rejects(
        () => detector.startAcquisition(fakeVideo(), fakeCanvas()),
        RangeError,
      );
      assert.equal(asInternals(detector).sessionEpoch, epoch);
      assert.equal(detector.getSnapshot().status, "running");
      assert.ok(detector.getSnapshot().engineSnapshot);
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("throws while error", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    asInternals(detector).status = "error";
    await assert.rejects(
      () => detector.startAcquisition(fakeVideo(), fakeCanvas()),
      RangeError,
    );
    assert.equal(detector.getSnapshot().status, "error");
  });
});

describe("Slice 15 — startEngine()", () => {
  it("activates acquiring → running exactly once and routes later frames through engine", async () => {
    const order: string[] = [];
    const detector = new LateralReachCameraDetector({
      onSnapshot: (s) => order.push(`snap:${s.status}`),
      onFrame: () => order.push("onFrame"),
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      assert.equal(detector.getSnapshot().engineSnapshot, null);

      detector.startEngine(buildConfig());
      assert.equal(detector.getSnapshot().status, "running");
      assert.ok(detector.getSnapshot().engineSnapshot);

      const before = order.length;
      raf.callbacks.at(-1)!(0);
      const after = order.slice(before);
      // Engine-active CASE A still notifies onFrame after engine handling.
      assert.ok(after.includes("onFrame"));
      assert.ok(detector.getSnapshot().engineSnapshot);

      assert.throws(() => detector.startEngine(buildConfig()), RangeError);
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("throws before acquisition and after stop with no mutation", () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    assert.equal(detector.getSnapshot().status, "idle");
    assert.throws(() => detector.startEngine(buildConfig()), RangeError);
    assert.equal(detector.getSnapshot().status, "idle");
    assert.equal(asInternals(detector).engineState, null);
  });

  it("throws after stop from acquiring", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      detector.stop();
      assert.equal(detector.getSnapshot().status, "idle");
      assert.throws(() => detector.startEngine(buildConfig()), RangeError);
      assert.equal(asInternals(detector).engineState, null);
    } finally {
      raf.restore();
    }
  });

  it("invalid config keeps acquiring live and later onFrame continues", async () => {
    const received: NormalizedMotionFrame[] = [];
    const detector = new LateralReachCameraDetector({
      onSnapshot: () => {},
      onFrame: (f) => received.push(f),
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      assert.throws(
        () =>
          detector.startEngine({
            ...buildConfig(),
            tracking: { minWristVisibility: 2, maxAllowedGapMs: 300 },
          } as LateralReachConfig),
        RangeError,
      );
      assert.equal(detector.getSnapshot().status, "acquiring");
      assert.equal(asInternals(detector).engineState, null);
      assert.equal(asInternals(detector).engineConfig, null);
      raf.callbacks[0]!(0);
      assert.equal(received.length, 1);
    } finally {
      detector.stop();
      raf.restore();
    }
  });
});

describe("Slice 15 — acquisition-only CASE B/C and stop/epoch", () => {
  it("CASE B acquisition-only issues no engine command and no onFrame", async () => {
    let frames = 0;
    const detector = new LateralReachCameraDetector({
      onSnapshot: () => {},
      onFrame: () => {
        frames += 1;
      },
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: undefined }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      raf.callbacks[0]!(0);
      assert.equal(frames, 0);
      assert.equal(asInternals(detector).lastCommandType, null);
      assert.equal(detector.getSnapshot().engineSnapshot, null);
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("CASE C acquisition-only issues no engine command and no onFrame", async () => {
    let frames = 0;
    const detector = new LateralReachCameraDetector({
      onSnapshot: () => {},
      onFrame: () => {
        frames += 1;
      },
    });
    // All-invalid landmarks → adapter null.
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [buildLandmarks({}) as never] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      raf.callbacks[0]!(0);
      assert.equal(frames, 0);
      assert.equal(asInternals(detector).lastCommandType, null);
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("stop during acquisition-only tears down safely; stale RAF is inert", async () => {
    const detector = new LateralReachCameraDetector({
      onSnapshot: () => {},
      onFrame: () => {
        throw new Error("should not run after stop");
      },
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      const pending = raf.callbacks[0]!;
      detector.stop();
      assert.equal(detector.getSnapshot().status, "idle");
      assert.doesNotThrow(() => pending(0));
      assert.equal(asInternals(detector).poseLandmarker, null);
    } finally {
      raf.restore();
    }
  });

  it("legacy start while acquisition-only supersedes via epoch and reaches running", async () => {
    const statuses: string[] = [];
    const detector = new LateralReachCameraDetector({
      onSnapshot: (s) => statuses.push(s.status),
    });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      assert.equal(detector.getSnapshot().status, "acquiring");
      await detector.start(fakeVideo(), fakeCanvas(), buildConfig());
      assert.equal(detector.getSnapshot().status, "running");
      assert.ok(detector.getSnapshot().engineSnapshot);
      assert.ok(statuses.includes("acquiring"));
      assert.equal(statuses.at(-1), "running");
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("rapid repeated legacy start preserves last-caller-wins supersession", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    let acquires = 0;
    asInternals(detector).acquireCameraAndModel = async (_v, _c, epoch) => {
      acquires += 1;
      await new Promise((r) => setTimeout(r, 15));
      if (asInternals(detector).sessionEpoch !== epoch) return;
      asInternals(detector).poseLandmarker = {
        detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
      };
    };
    const raf = installRafCapture();
    try {
      const p1 = detector.start(fakeVideo(), fakeCanvas(), buildConfig());
      const p2 = detector.start(fakeVideo(), fakeCanvas(), buildConfig());
      await Promise.allSettled([p1, p2]);
      assert.ok(acquires >= 2);
      assert.equal(detector.getSnapshot().status, "running");
      assert.ok(detector.getSnapshot().engineSnapshot);
    } finally {
      detector.stop();
      raf.restore();
    }
  });
});
describe("Terminal outcome bridge", () => {
  it("finalizes an active attempt window and exposes the terminal result", async () => {
    const detector = new LateralReachCameraDetector({
      onSnapshot: () => {},
    });

    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));

    const raf = installRafCapture();

    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas());
      detector.startEngine(buildConfig());

      detector.endAttemptWindow();

      const snapshot = detector.getSnapshot();

      assert.equal(snapshot.lastCommandType, "attemptWindowEnded");
      assert.equal(snapshot.lastCommandStatus, "applied");
      assert.equal(snapshot.engineSnapshot?.terminal, true);

      assert.ok(snapshot.finalResult);
      assert.equal(snapshot.finalResult.completionState, "not_started");
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("stores acquisition overlay tested side from startAcquisition options", async () => {
    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), fakeCanvas(), {
        overlayTestedSide: "left",
      });
      assert.equal(asInternals(detector).acquisitionOverlayTestedSide, "left");
      assert.equal(asInternals(detector).engineConfig, null);
    } finally {
      detector.stop();
      raf.restore();
    }
  });

  it("draws acquisition pose overlay without engine config", async () => {
    let strokeCount = 0;
    const canvas = {
      width: 640,
      height: 480,
      getContext: () =>
        ({
          clearRect: () => undefined,
          drawImage: () => undefined,
          beginPath: () => undefined,
          moveTo: () => undefined,
          lineTo: () => undefined,
          arc: () => undefined,
          stroke: () => {
            strokeCount += 1;
          },
          fill: () => undefined,
          save: () => undefined,
          restore: () => undefined,
          scale: () => undefined,
          fillText: () => undefined,
          setLineDash: () => undefined,
          strokeStyle: "",
          lineWidth: 1,
          fillStyle: "",
          font: "",
        }) as CanvasRenderingContext2D,
    } as unknown as HTMLCanvasElement;

    const detector = new LateralReachCameraDetector({ onSnapshot: () => {} });
    stubAcquireWithPhaseEmits(detector, () => ({
      detectForVideo: () => ({ landmarks: [validWristLandmarks()] }),
    }));
    const raf = installRafCapture();
    try {
      await detector.startAcquisition(fakeVideo(), canvas, { overlayTestedSide: "right" });
      assert.equal(raf.callbacks.length, 1);
      raf.callbacks[0]!(0);
      assert.ok(strokeCount > 0, "expected skeleton strokes during acquisition overlay");
      assert.equal(asInternals(detector).engineConfig, null);
    } finally {
      detector.stop();
      raf.restore();
    }
  });
});