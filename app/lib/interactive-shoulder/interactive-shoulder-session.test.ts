/**
 * Run: npx tsx --test app/lib/interactive-shoulder/interactive-shoulder-session.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDevMouseSimulationEnabled,
  normalizedPointFromMouseEvent,
} from "./dev-mouse-simulation";
import {
  INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID,
  isInteractiveShoulderSessionWired,
} from "./interactive-shoulder-exercise-ids";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "./shoulder-abduction-reach-session-definition";
import {
  DEFAULT_SAFE_TARGET_BOUNDS,
  generateTherapeuticTarget,
  isPointInsideSafeBounds,
} from "./target-generator";
import {
  DEFAULT_TARGET_HIT_CONFIG,
  distanceNormalized,
  isWristInsideTarget,
  shouldRegisterTargetHit,
} from "./target-hit";
import {
  createInitialTargetLifecycle,
  tickTargetLifecycle,
} from "./target-lifecycle";
import {
  mapShoulderMeasuredEventToSessionInput,
  mapTargetHitToSessionInput,
} from "@/app/lib/session-orchestrator/adapters/shoulder-session-adapter";
import { SessionOrchestrator } from "@/app/lib/session-orchestrator/session-orchestrator";
import { isPatientCvCaptureWired } from "@/app/lib/cv/cv-patient-config";

const T0 = 2_000_000;
const deterministicRandom = () => 0.42;

describe("interactive shoulder — wrist-to-target collision", () => {
  it("1. registers a hit when wrist enters the collision radius", () => {
    const target = { x: 0.5, y: 0.4 };
    const wrist = { x: 0.52, y: 0.41 };
    assert.ok(isWristInsideTarget(wrist, target, DEFAULT_TARGET_HIT_CONFIG));
    assert.ok(
      distanceNormalized(wrist, target) <= DEFAULT_TARGET_HIT_CONFIG.collisionRadius,
    );
  });
});

describe("interactive shoulder — duplicate hit prevention", () => {
  it("2. does not register duplicate hits while wrist stays inside the target", () => {
    assert.equal(shouldRegisterTargetHit(false, true, false), true);
    assert.equal(shouldRegisterTargetHit(true, true, false), false);
    assert.equal(shouldRegisterTargetHit(true, true, true), false);

    let state = createInitialTargetLifecycle();
    const targetCenter = { x: 0.55, y: 0.35 };
    state = {
      ...state,
      currentTarget: {
        id: "t1",
        spawnedAtMs: T0,
        ...targetCenter,
      },
      interaction: { ...state.interaction, targetsShown: 1 },
    };

    const inside = { x: targetCenter.x, y: targetCenter.y };
    const first = tickTargetLifecycle(state, {
      wrist: inside,
      nowMs: T0 + 500,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    });
    assert.ok(first.hitEvent);
    assert.equal(first.state.interaction.targetsReached, 1);

    const second = tickTargetLifecycle(first.state, {
      wrist: inside,
      nowMs: T0 + 600,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
    });
    assert.equal(second.hitEvent, null);
    assert.equal(second.state.interaction.targetsReached, 1);
  });
});

describe("interactive shoulder — target lifecycle", () => {
  it("3. spawns a new target after a valid hit", () => {
    let state = createInitialTargetLifecycle();
    state = tickTargetLifecycle(state, {
      wrist: null,
      nowMs: T0,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: deterministicRandom,
    }).state;
    const firstId = state.currentTarget?.id;
    assert.ok(firstId);

    const hit = tickTargetLifecycle(state, {
      wrist: { x: state.currentTarget!.x, y: state.currentTarget!.y },
      nowMs: T0 + 1_000,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: deterministicRandom,
    });
    assert.ok(hit.hitEvent);
    // CHANGE-008: the hit tick retires the contacted target; the successor is built on the
    // next tick, which is the window the caller uses to adapt difficulty first.
    assert.equal(hit.state.currentTarget, null);

    const successor = tickTargetLifecycle(hit.state, {
      wrist: null,
      nowMs: T0 + 1_016,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: deterministicRandom,
    });
    assert.ok(successor.state.currentTarget);
    assert.notEqual(successor.state.currentTarget.id, firstId);
    assert.equal(successor.state.interaction.targetsShown, 2);
  });

  it("4. keeps generated targets inside configured safe bounds", () => {
    for (let i = 0; i < 20; i++) {
      const target = generateTherapeuticTarget({
        bounds: DEFAULT_SAFE_TARGET_BOUNDS,
        side: i % 2 === 0 ? "right" : "left",
        nowMs: T0 + i,
        sequence: i + 1,
        random: () => (i * 0.07) % 1,
      });
      assert.ok(isPointInsideSafeBounds(target, DEFAULT_SAFE_TARGET_BOUNDS));
    }
  });
});

describe("interactive shoulder — orchestrator safety integration", () => {
  function startedShoulderOrchestrator(nowMs = T0): SessionOrchestrator {
    const o = new SessionOrchestrator(SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION);
    o.start(nowMs);
    o.beginCalibration(nowMs);
    o.completeCalibration(nowMs);
    return o;
  }

  it("5. tracker loss enters safety hold with zero grace", () => {
    const o = startedShoulderOrchestrator();
    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({
        type: "trackerLost",
        capturedAtMs: T0,
      }),
      T0,
    );
    const snap = o.getSnapshot(T0);
    assert.equal(snap.sessionState, "safetyHold");
    assert.equal(snap.safetyHoldReason, "trackerLost");
  });

  it("6. tracker recovery resumes from safety hold", () => {
    const o = startedShoulderOrchestrator();
    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({
        type: "trackerLost",
        capturedAtMs: T0,
      }),
      T0,
    );
    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({
        type: "trackerRecovered",
        capturedAtMs: T0 + 5_000,
      }),
      T0 + 5_000,
    );
    assert.equal(o.getSnapshot(T0 + 5_000).sessionState, "active");
  });

  it("7. pause freezes block timing", () => {
    const o = startedShoulderOrchestrator();
    o.tick(T0 + 10_000);
    assert.equal(o.getSnapshot(T0 + 10_000).blockElapsedSeconds, 10);
    o.pause(T0 + 10_000);
    assert.equal(o.getSnapshot(T0 + 60_000).blockElapsedSeconds, 10);
    o.resume(T0 + 60_000);
    assert.equal(o.getSnapshot(T0 + 65_000).blockElapsedSeconds, 15);
  });
});

describe("interactive shoulder — result category separation", () => {
  it("8. keeps interaction metrics separate from measured CV data", () => {
    const o = new SessionOrchestrator({
      sessionId: "shoulder-separation",
      title: "Shoulder separation",
      blocks: SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks,
    });
    o.start(T0);
    o.beginCalibration(T0);
    o.completeCalibration(T0);

    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({
        type: "repCompleted",
        capturedAtMs: T0 + 1_000,
        side: "right",
        peakAngleDegrees: 82,
      }),
      T0 + 1_000,
    );
    o.reportInputEvent(
      mapTargetHitToSessionInput({
        targetId: "t1",
        capturedAtMs: T0 + 1_000,
        reactionTimeMs: 900,
      }),
      T0 + 1_000,
    );

    const live = o.getSnapshot(T0 + 1_000);
    assert.equal(live.sessionState, "active");
    assert.equal(live.accumulatedBlockResults[0]?.measured.validRepetitions, 1);
    assert.equal(live.accumulatedBlockResults[0]?.interaction.targetsContacted, 1);
    assert.deepEqual(live.accumulatedBlockResults[0]?.measured.rangeValuesDegrees, [82]);
    assert.deepEqual(live.accumulatedBlockResults[0]?.interaction.timingSamplesMs, [900]);

    o.tick(T0 + 91_000);
    const summary = o.getSessionPerformanceSummary(T0 + 91_000).blockResults[0];
    assert.equal(summary.measured.validRepetitions, 1);
    assert.equal(summary.interaction.targetsContacted, 1);
    assert.deepEqual(summary.measured.rangeValuesDegrees, [82]);
    assert.deepEqual(summary.interaction.timingSamplesMs, [900]);
    assert.equal("targetsContacted" in summary.measured, false);
    assert.equal("validRepetitions" in summary.interaction, false);
  });

  it("9. compensation events do not affect interaction target counts", () => {
    let state = createInitialTargetLifecycle();
    state = tickTargetLifecycle(state, {
      wrist: null,
      nowMs: T0,
      side: "right",
      bounds: DEFAULT_SAFE_TARGET_BOUNDS,
      random: deterministicRandom,
    }).state;

    const before = state.interaction.targetsReached;
    const o = new SessionOrchestrator({
      sessionId: "comp-test",
      title: "Comp test",
      blocks: SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks,
    });
    o.start(T0);
    o.beginCalibration(T0);
    o.completeCalibration(T0);
    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({
        type: "compensationDetected",
        capturedAtMs: T0 + 500,
      }),
      T0 + 500,
    );
    assert.equal(state.interaction.targetsReached, before);
    assert.equal(o.getSnapshot(T0 + 500).sessionState, "active");
  });

  it("10. rep completion does not automatically count as a target hit", () => {
    const o = new SessionOrchestrator({
      sessionId: "rep-hit-separation",
      title: "Rep hit separation",
      blocks: SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks,
    });
    o.start(T0);
    o.beginCalibration(T0);
    o.completeCalibration(T0);
    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({
        type: "repCompleted",
        capturedAtMs: T0 + 1_000,
        side: "right",
        peakAngleDegrees: 75,
      }),
      T0 + 1_000,
    );
    o.tick(T0 + 91_000);
    const result = o.getSessionPerformanceSummary(T0 + 91_000).blockResults[0];
    assert.equal(result.measured.validRepetitions, 1);
    assert.equal(result.interaction.targetsContacted, 0);
  });
});

describe("interactive shoulder — dev mouse simulation guard", () => {
  it("11. mouse simulation is unavailable outside development mode", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    assert.equal(isDevMouseSimulationEnabled(), false);
    process.env.NODE_ENV = "development";
    assert.equal(isDevMouseSimulationEnabled(), true);
    process.env.NODE_ENV = original;
  });

  it("normalizes mouse coordinates within container bounds", () => {
    const point = normalizedPointFromMouseEvent(
      { clientX: 150, clientY: 100 },
      { left: 100, top: 50, width: 200, height: 200 } as DOMRect,
    );
    assert.deepEqual(point, { x: 0.25, y: 0.25 });
  });
});

describe("interactive shoulder — patient session wiring", () => {
  function resolveExerciseMediaFlags(exerciseId: string) {
    const showInteractiveShoulder =
      isInteractiveShoulderSessionWired(exerciseId);
    const showPatientCv =
      isPatientCvCaptureWired(exerciseId) && !showInteractiveShoulder;
    return { showInteractiveShoulder, showPatientCv };
  }

  it("12. wires upper-limb-reaching-seated without breaking existing CV exercises", () => {
    assert.equal(isInteractiveShoulderSessionWired(INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID), true);
    assert.equal(isInteractiveShoulderSessionWired("shoulder-abduction-reach"), true);
    assert.equal(isInteractiveShoulderSessionWired("sit-to-stand"), false);

    assert.equal(isPatientCvCaptureWired("sit-to-stand"), true);
    assert.equal(isPatientCvCaptureWired(INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID), false);

    const shoulder = resolveExerciseMediaFlags(INTERACTIVE_SHOULDER_LIBRARY_EXERCISE_ID);
    assert.equal(shoulder.showInteractiveShoulder, true);
    assert.equal(shoulder.showPatientCv, false);

    const sts = resolveExerciseMediaFlags("sit-to-stand");
    assert.equal(sts.showInteractiveShoulder, false);
    assert.equal(sts.showPatientCv, true);
  });
});
