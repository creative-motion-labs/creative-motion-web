/**
 * Slice 16 — lab attempt-plan intake behavioral tests.
 *
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/attempt-plan-intake.test.ts"
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createLateralReachCalibrationAttemptIntention } from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";
import { resolveLateralReachCalibrationAttemptIntentionFromPlan } from "@/app/lib/upper-limb-motor-screen/lateral-reach-attempt-plan";
import {
  canLockLateralReachLabAttemptPlan,
  lockLateralReachLabAttemptPlan,
  tryLockLateralReachLabAttemptPlan,
} from "@/app/clinician/lateral-reach-camera-lab/attempt-plan-intake";

describe("lockLateralReachLabAttemptPlan — Slice 10 resolver path", () => {
  it("positive_x resolves through the real Slice 10 resolver to +1", () => {
    const lock = lockLateralReachLabAttemptPlan("positive_x");
    assert.deepEqual(lock.lockedPlan, {
      screenHorizontalDirection: "positive_x",
    });
    assert.deepEqual(
      lock.lockedIntention,
      createLateralReachCalibrationAttemptIntention(1),
    );
    assert.deepEqual(
      lock.lockedIntention,
      resolveLateralReachCalibrationAttemptIntentionFromPlan({
        screenHorizontalDirection: "positive_x",
      }),
    );
  });

  it("negative_x resolves through the real Slice 10 resolver to -1", () => {
    const lock = lockLateralReachLabAttemptPlan("negative_x");
    assert.deepEqual(lock.lockedPlan, {
      screenHorizontalDirection: "negative_x",
    });
    assert.deepEqual(
      lock.lockedIntention,
      createLateralReachCalibrationAttemptIntention(-1),
    );
    assert.deepEqual(
      lock.lockedIntention,
      resolveLateralReachCalibrationAttemptIntentionFromPlan({
        screenHorizontalDirection: "negative_x",
      }),
    );
  });

  it("lock function does not accept testedSide and sign is side-independent", () => {
    assert.equal(lockLateralReachLabAttemptPlan.length, 1);
    const a = lockLateralReachLabAttemptPlan("positive_x");
    const b = lockLateralReachLabAttemptPlan("positive_x");
    assert.equal(a.lockedIntention.expectedHorizontalDirectionSign, 1);
    assert.equal(b.lockedIntention.expectedHorizontalDirectionSign, 1);
    assert.deepEqual(a.lockedIntention, b.lockedIntention);
  });

  it("lock snapshots the plan; later selection reassignment cannot mutate it", () => {
    let selection: "positive_x" | "negative_x" | null = "positive_x";
    const lock = lockLateralReachLabAttemptPlan(selection);
    selection = "negative_x";
    assert.equal(lock.lockedPlan.screenHorizontalDirection, "positive_x");
    assert.equal(lock.lockedIntention.expectedHorizontalDirectionSign, 1);

    // Mutating a new selection object must not alias into the locked plan.
    const editable = { screenHorizontalDirection: "positive_x" as const };
    const lock2 = lockLateralReachLabAttemptPlan(
      editable.screenHorizontalDirection,
    );
    (editable as { screenHorizontalDirection: string }).screenHorizontalDirection =
      "negative_x";
    assert.equal(lock2.lockedPlan.screenHorizontalDirection, "positive_x");
    assert.notEqual(
      lock2.lockedPlan,
      editable as unknown as typeof lock2.lockedPlan,
    );
  });

  it("missing selection fails closed with no lock", () => {
    assert.throws(
      () => lockLateralReachLabAttemptPlan(null),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message.includes("screenHorizontalDirection"),
    );
    assert.throws(() => lockLateralReachLabAttemptPlan(undefined), RangeError);
    assert.equal(canLockLateralReachLabAttemptPlan(null), false);
  });

  it("invalid direction fails closed through existing resolver semantics", () => {
    assert.throws(
      () => lockLateralReachLabAttemptPlan("forward"),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          'screenHorizontalDirection must be exactly "positive_x" or "negative_x"',
    );
    assert.throws(
      () =>
        resolveLateralReachCalibrationAttemptIntentionFromPlan({
          screenHorizontalDirection: "forward",
        }),
      RangeError,
    );
  });
});

describe("tryLockLateralReachLabAttemptPlan — fail-closed re-lock", () => {
  it("failed re-lock does not corrupt a previously valid lock", () => {
    const previous = lockLateralReachLabAttemptPlan("positive_x");
    const failed = tryLockLateralReachLabAttemptPlan("left", previous);
    assert.equal(failed.ok, false);
    if (failed.ok) throw new Error("expected failure");
    assert.equal(failed.previousLock, previous);
    assert.equal(
      failed.previousLock?.lockedPlan.screenHorizontalDirection,
      "positive_x",
    );
    assert.equal(
      failed.previousLock?.lockedIntention.expectedHorizontalDirectionSign,
      1,
    );

    const ok = tryLockLateralReachLabAttemptPlan("negative_x", previous);
    assert.equal(ok.ok, true);
    if (!ok.ok) throw new Error("expected success");
    assert.equal(ok.lock.lockedPlan.screenHorizontalDirection, "negative_x");
    assert.equal(ok.lock.lockedIntention.expectedHorizontalDirectionSign, -1);
  });
});

describe("Slice 16 scope guards — lab intake / page", () => {
  it("intake helper stays lab-local and uses Slice 10 only for sign minting", () => {
    const source = readFileSync(
      path.join(__dirname, "attempt-plan-intake.ts"),
      "utf8",
    );
    assert.match(
      source,
      /resolveLateralReachCalibrationAttemptIntentionFromPlan/,
    );
    assert.equal(source.includes("createLateralReachCalibrationController"), false);
    assert.equal(
      source.includes("resolveLateralReachCalibrationSampleFromFrame"),
      false,
    );
    assert.equal(source.includes("buildLateralReachEngineConfig"), false);
    assert.equal(source.includes("startEngine"), false);
    assert.equal(source.includes("targetPlacement"), false);
    assert.equal(source.includes("testedSide"), false);
    assert.equal(source.includes("scaleX"), false);
    assert.equal(source.includes("1 - x"), false);
    assert.equal(source.includes("expectedHorizontalDirectionSign: 1"), false);
    assert.equal(source.includes("expectedHorizontalDirectionSign: -1"), false);
  });

  it("legacy handleStart path stays free of attempt-plan intake and engine handoff wiring", () => {
    const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    assert.match(source, /tryLockLateralReachLabAttemptPlan|lockLateralReachLabAttemptPlan/);
    assert.match(source, /positive_x/);
    assert.match(source, /negative_x/);
    assert.match(source, /Positive normalized X/);
    assert.match(source, /Negative normalized X/);
    assert.equal(source.includes("createLateralReachCalibrationController"), false);
    assert.equal(
      source.includes("resolveLateralReachCalibrationSampleFromFrame"),
      false,
    );
    assert.equal(source.includes("targetPlacement"), false);
    // Legacy start path must remain present and independent of both the
    // locked attempt plan and the later calibration → engine handoff wiring.
    // Slice 20 intentionally added buildLateralReachEngineConfig/startEngine
    // elsewhere on the page (the explicit engine-handoff button/handler), so
    // those are no longer forbidden page-wide — only within handleStart's
    // own body, which this callback never touches.
    assert.match(source, /detector\.start\(/);
    const handleStartMatch = source.match(
      /const handleStart = useCallback\(async \(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/,
    );
    assert.ok(handleStartMatch, "handleStart callback should remain present");
    assert.equal(handleStartMatch[0].includes("attemptPlanLock"), false);
    assert.equal(handleStartMatch[0].includes("lockedPlan"), false);
    assert.equal(handleStartMatch[0].includes("screenHorizontalDirection"), false);
    assert.equal(handleStartMatch[0].includes("buildLateralReachEngineConfig"), false);
    assert.equal(handleStartMatch[0].includes("startEngine"), false);
  });
});
