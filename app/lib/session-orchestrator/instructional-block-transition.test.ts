/**
 * Run: npx tsx --test app/lib/session-orchestrator/instructional-block-transition.test.ts
 *
 * Regression tests for Stroke ULRF Warm-up → Reach the Light transitions.
 * Reproduces the E2E failure mode: instructional duration elapses but the
 * orchestrator never calls completeCurrentBlock() when trackerLost enters
 * safetyHold with zero grace.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toSessionDefinition } from "@/app/lib/rehab-programs/rehab-program-runtime-adapter";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import { mapShoulderMeasuredEventToSessionInput } from "@/app/lib/session-orchestrator/adapters/shoulder-session-adapter";
import { SessionOrchestrator } from "./session-orchestrator";

const T0 = 2_500_000;
const STROKE_DEF = toSessionDefinition(STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1);
const WARM_UP = STROKE_DEF.blocks[0]!;
const REACH_LIGHT = STROKE_DEF.blocks[1]!;
const WARM_UP_SECONDS = WARM_UP.targetDurationSeconds ?? 0;

function startCatalogSessionWithCountdownPause(o: SessionOrchestrator, nowMs: number): number {
  o.start(nowMs);
  o.beginCalibration(nowMs);
  o.completeCalibration(nowMs);
  o.pause(nowMs);
  const resumedAt = nowMs + 4_000;
  o.resume(resumedAt);
  return resumedAt;
}

function tickEveryMs(
  o: SessionOrchestrator,
  fromMs: number,
  toMs: number,
  stepMs = 16,
): void {
  for (let t = fromMs; t <= toMs; t += stepMs) {
    o.tick(t);
  }
}

describe("instructional block transition — Stroke ULRF session 1", () => {
  it("1. warm-up reaches target duration and advances exactly once to Reach the Light", () => {
    const o = new SessionOrchestrator(STROKE_DEF);
    const resumedAt = startCatalogSessionWithCountdownPause(o, T0);

    tickEveryMs(o, resumedAt, resumedAt + WARM_UP_SECONDS * 1_000);

    const endAt = resumedAt + WARM_UP_SECONDS * 1_000;
    const snap = o.getSnapshot(endAt);
    const summary = o.getSessionPerformanceSummary(endAt);
    assert.equal(snap.sessionState, "active");
    assert.equal(snap.currentBlock?.blockId, REACH_LIGHT.blockId);
    assert.equal(summary.blocksCompleted, 1);
    assert.equal(summary.blockResults[0]?.blockId, WARM_UP.blockId);
    assert.equal(summary.blockResults[0]?.completionReason, "duration");
  });

  it("2. brief tracker loss during warm-up does not permanently block transition", () => {
    const o = new SessionOrchestrator(STROKE_DEF);
    const resumedAt = startCatalogSessionWithCountdownPause(o, T0);
    const lostAt = resumedAt + 30_000;

    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({ type: "trackerLost", capturedAtMs: lostAt }),
      lostAt,
    );
    const recoveredAt = lostAt + 2_000;
    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({ type: "trackerReady", capturedAtMs: recoveredAt }),
      recoveredAt,
    );

    tickEveryMs(o, resumedAt, resumedAt + WARM_UP_SECONDS * 1_000 + 5_000);

    const snap = o.getSnapshot(resumedAt + WARM_UP_SECONDS * 1_000 + 5_000);
    assert.equal(
      snap.currentBlock?.blockId,
      REACH_LIGHT.blockId,
      "warm-up must complete by duration even after trackerLost during instructional block",
    );
    assert.notEqual(snap.sessionState, "safetyHold");
  });

  it("2b. sustained tracker loss during warm-up still completes by duration (E2E stuck-at-00:00 repro)", () => {
    const o = new SessionOrchestrator(STROKE_DEF);
    const resumedAt = startCatalogSessionWithCountdownPause(o, T0);
    const lostAt = resumedAt + 55_000;

    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({ type: "trackerLost", capturedAtMs: lostAt }),
      lostAt,
    );

    tickEveryMs(o, resumedAt, resumedAt + WARM_UP_SECONDS * 1_000 + 5_000);

    const endAt = resumedAt + WARM_UP_SECONDS * 1_000 + 5_000;
    const snap = o.getSnapshot(endAt);
    assert.equal(
      snap.currentBlock?.blockId,
      REACH_LIGHT.blockId,
      "warm-up must advance when duration elapses even if trackerLost never recovered",
    );
    assert.notEqual(snap.currentBlock?.blockId, WARM_UP.blockId);
  });

  it("3. movement-target block still enters tracker-loss safety hold with zero grace", () => {
    const o = new SessionOrchestrator(STROKE_DEF);
    const resumedAt = startCatalogSessionWithCountdownPause(o, T0);

    tickEveryMs(o, resumedAt, resumedAt + WARM_UP_SECONDS * 1_000);

    const onReach = resumedAt + WARM_UP_SECONDS * 1_000 + 1_000;
    assert.equal(o.getSnapshot(onReach).currentBlock?.blockId, REACH_LIGHT.blockId);

    o.reportInputEvent(
      mapShoulderMeasuredEventToSessionInput({ type: "trackerLost", capturedAtMs: onReach }),
      onReach,
    );
    o.tick(onReach);

    const snap = o.getSnapshot(onReach);
    assert.equal(snap.sessionState, "safetyHold");
    assert.equal(snap.safetyHoldReason, "trackerLost");
    assert.equal(snap.currentBlock?.blockId, REACH_LIGHT.blockId);
  });

  it("4. pause then resume still completes warm-up duration and advances", () => {
    const o = new SessionOrchestrator(STROKE_DEF);
    const resumedAt = startCatalogSessionWithCountdownPause(o, T0);
    const pauseAt = resumedAt + 30_000;

    tickEveryMs(o, resumedAt, pauseAt);
    o.pause(pauseAt);

    const resumeAt = pauseAt + 10_000;
    o.resume(resumeAt);
    tickEveryMs(o, resumeAt, resumeAt + WARM_UP_SECONDS * 1_000);

    const endAt = resumeAt + WARM_UP_SECONDS * 1_000;
    const snap = o.getSnapshot(endAt);
    const summary = o.getSessionPerformanceSummary(endAt);
    assert.equal(snap.currentBlock?.blockId, REACH_LIGHT.blockId);
    assert.equal(summary.blocksCompleted, 1);
  });

  it("5. warm-up duration completion emits exactly one block result", () => {
    const o = new SessionOrchestrator(STROKE_DEF);
    const resumedAt = startCatalogSessionWithCountdownPause(o, T0);

    const endAt = resumedAt + WARM_UP_SECONDS * 1_000;
    for (let t = resumedAt; t <= endAt + 5_000; t += 16) {
      o.tick(t);
    }

    const summary = o.getSessionPerformanceSummary(endAt + 5_000);
    const warmUpResults = summary.blockResults.filter((r) => r.blockId === WARM_UP.blockId);
    assert.equal(warmUpResults.length, 1);
    assert.equal(summary.blockResults[0]?.completionReason, "duration");
  });
});
