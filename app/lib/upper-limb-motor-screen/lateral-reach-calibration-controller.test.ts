/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cancelLateralReachCalibrationAttempt,
  createLateralReachCalibrationController,
  getLateralReachCalibrationOutcome,
  startLateralReachCalibrationAttempt,
  submitLateralReachCalibrationSample,
  type LateralReachCalibrationControllerInput,
  type LateralReachCalibrationControllerSample,
  type LateralReachCalibrationControllerState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";

const START_CONFIG = {
  minStableDurationMs: 100,
  maxJitterRadius: 0.05,
  minStableSampleCount: 3,
  totalTimeoutMs: 1000,
};

const ENDPOINT_CONFIG = {
  minStableDurationMs: 100,
  maxJitterRadius: 0.05,
  minStableSampleCount: 3,
  totalTimeoutMs: 1000,
  minDisplacementFromStart: 0.1,
};

const ZONE_RADII = {
  startingZoneRadius: 0.05,
  fixedTargetRadius: 0.05,
};

function validInput(
  overrides: Partial<LateralReachCalibrationControllerInput> = {},
): LateralReachCalibrationControllerInput {
  return {
    testedSide: "left",
    plan: { screenHorizontalDirection: "positive_x" },
    startCaptureConfig: START_CONFIG,
    endpointCaptureConfig: ENDPOINT_CONFIG,
    noiseFloor: 0.05,
    zoneRadii: ZONE_RADII,
    ...overrides,
  };
}

function sample(
  atMs: number,
  wrist: { x: number; y: number } | null = { x: 0.3, y: 0.5 },
  overrides: Partial<LateralReachCalibrationControllerSample> = {},
): LateralReachCalibrationControllerSample {
  return {
    atMs,
    wrist,
    trackingValid: true,
    framingValid: true,
    ...overrides,
  };
}

function createConfigured(
  overrides: Partial<LateralReachCalibrationControllerInput> = {},
) {
  return createLateralReachCalibrationController(validInput(overrides));
}

function startAttempt(
  overrides: Partial<LateralReachCalibrationControllerInput> = {},
  nowMs = 0,
) {
  return startLateralReachCalibrationAttempt(createConfigured(overrides), nowMs);
}

/** Drive start capture to success with wrist at start point. */
function captureStart(
  state: LateralReachCalibrationControllerState,
  wrist = { x: 0.3, y: 0.5 },
  times = [0, 50, 100],
) {
  let current = state;
  assert.equal(current.phase, "capturing_start");
  for (const t of times) {
    const submitted = submitLateralReachCalibrationSample(
      current,
      sample(t, wrist),
    );
    assert.equal(submitted.disposition, "applied");
    current = submitted.state;
  }
  return current;
}

/** From capturing_endpoint, hold displaced endpoint until capture. */
function captureEndpoint(
  state: LateralReachCalibrationControllerState,
  wrist = { x: 0.55, y: 0.5 },
  baseMs = 200,
) {
  let current = state;
  assert.equal(current.phase, "capturing_endpoint");
  for (const t of [baseMs, baseMs + 50, baseMs + 100]) {
    const submitted = submitLateralReachCalibrationSample(
      current,
      sample(t, wrist),
    );
    assert.equal(submitted.disposition, "applied");
    current = submitted.state;
  }
  return current;
}

describe("createLateralReachCalibrationController", () => {
  it("returns configured for valid input", () => {
    const state = createConfigured();
    assert.equal(state.phase, "configured");
    assert.equal(getLateralReachCalibrationOutcome(state), null);
  });

  it("rejects invalid testedSide with exact RangeError", () => {
    assert.throws(
      () => createConfigured({ testedSide: "bilateral" }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === 'testedSide must be exactly "left" or "right"',
    );
  });

  it("rejects invalid plan with Slice 10 RangeError", () => {
    assert.throws(
      () => createConfigured({ plan: { screenHorizontalDirection: "forward" } }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          'screenHorizontalDirection must be exactly "positive_x" or "negative_x"',
    );
  });

  it("rejects invalid start config as RangeError(reason)", () => {
    assert.throws(
      () => createConfigured({ startCaptureConfig: {} }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "minStableDurationMs_must_be_finite_number",
    );
  });

  it("rejects invalid endpoint config as RangeError(reason)", () => {
    assert.throws(
      () =>
        createConfigured({
          endpointCaptureConfig: {
            ...ENDPOINT_CONFIG,
            minDisplacementFromStart: 0,
          },
        }),
      (err: unknown) =>
        err instanceof RangeError &&
        typeof err.message === "string" &&
        err.message.includes("minDisplacementFromStart"),
    );
  });

  it("rejects invalid zone radii with Slice 9 RangeError", () => {
    assert.throws(
      () =>
        createConfigured({
          zoneRadii: { startingZoneRadius: 0, fixedTargetRadius: 0.05 },
        }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "startingZoneRadius must be a finite number greater than 0",
    );
  });

  it("rejects invalid noise floor with Slice 9 RangeError", () => {
    assert.throws(
      () => createConfigured({ noiseFloor: 0 }),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "minDirectionAlignedMagnitude must be a finite number greater than 0",
    );
  });

  it("validates configuration before capture begins", () => {
    assert.throws(() => createConfigured({ noiseFloor: -1 }));
    // No capturing state can exist if construction failed.
  });
});

describe("explicit start", () => {
  it("does not auto-start; sample while configured throws", () => {
    const state = createConfigured();
    assert.throws(
      () => submitLateralReachCalibrationSample(state, sample(0)),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "calibration samples require an active capture state",
    );
  });

  it("starts with finite nowMs into capturing_start", () => {
    const state = startAttempt({}, 10);
    assert.equal(state.phase, "capturing_start");
    if (state.phase === "capturing_start") {
      assert.equal(state.startCaptureState.startedAtMs, 10);
    }
  });

  it("preserves Slice 2 nowMs RangeError", () => {
    assert.throws(
      () => startAttempt({}, Number.NaN),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message === "nowMs must be a finite number",
    );
  });

  it("rejects second start from capturing_start/endpoint/terminal", () => {
    const capturing = startAttempt();
    assert.throws(
      () => startLateralReachCalibrationAttempt(capturing, 1),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "calibration attempt can only be started from configured state",
    );

    const afterStart = captureStart(capturing);
    assert.equal(afterStart.phase, "capturing_endpoint");
    assert.throws(
      () => startLateralReachCalibrationAttempt(afterStart, 1),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "calibration attempt can only be started from configured state",
    );

    const cancelled = cancelLateralReachCalibrationAttempt(capturing);
    assert.throws(
      () => startLateralReachCalibrationAttempt(cancelled, 1),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "calibration attempt can only be started from configured state",
    );
  });
});

describe("Slice 10 direction integration", () => {
  it("positive_x and negative_x resolve through Slice 10; side never decides", () => {
    const posLeft = createConfigured({
      testedSide: "left",
      plan: { screenHorizontalDirection: "positive_x" },
    });
    const posRight = createConfigured({
      testedSide: "right",
      plan: { screenHorizontalDirection: "positive_x" },
    });
    assert.equal(posLeft.intention.expectedHorizontalDirectionSign, 1);
    assert.equal(posRight.intention.expectedHorizontalDirectionSign, 1);
    assert.equal(
      posLeft.intention.expectedHorizontalDirectionSign,
      posRight.intention.expectedHorizontalDirectionSign,
    );

    const negLeft = createConfigured({
      testedSide: "left",
      plan: { screenHorizontalDirection: "negative_x" },
    });
    const negRight = createConfigured({
      testedSide: "right",
      plan: { screenHorizontalDirection: "negative_x" },
    });
    assert.equal(negLeft.intention.expectedHorizontalDirectionSign, -1);
    assert.equal(negRight.intention.expectedHorizontalDirectionSign, -1);
  });
});

describe("start capture progression", () => {
  it("collecting remains capturing_start", () => {
    const state = startAttempt();
    const submitted = submitLateralReachCalibrationSample(state, sample(0));
    assert.equal(submitted.disposition, "applied");
    assert.equal(submitted.state.phase, "capturing_start");
  });

  it("captured transitions once; endpoint startedAtMs equals transition sample.atMs", () => {
    const state = captureStart(startAttempt(), { x: 0.3, y: 0.5 }, [0, 50, 100]);
    assert.equal(state.phase, "capturing_endpoint");
    if (state.phase === "capturing_endpoint") {
      assert.equal(state.endpointCaptureState.startedAtMs, 100);
      assert.equal(state.startWrist.x, 0.3);
      assert.equal(state.endpointCaptureState.lastAcceptedAtMs, null);
    }
  });

  it("preserves start failure reasons exactly", () => {
    // Timeout with no usable samples → start_timeout + insufficient_start_samples
    const state = startAttempt({
      startCaptureConfig: {
        minStableDurationMs: 100,
        maxJitterRadius: 0.05,
        minStableSampleCount: 3,
        totalTimeoutMs: 100,
      },
    });
    const submitted = submitLateralReachCalibrationSample(
      state,
      sample(100, null, { trackingValid: false }),
    );
    assert.equal(submitted.state.phase, "terminal");
    const outcome = getLateralReachCalibrationOutcome(submitted.state);
    assert.ok(outcome && outcome.kind === "result");
    if (outcome && outcome.kind === "result") {
      assert.equal(outcome.result.captureOutcome, "failed");
      assert.equal(outcome.result.geometryOutcome, "not_applicable");
      assert.ok(outcome.result.failureReasons.includes("start_timeout"));
    }
  });
});

describe("endpoint capture progression", () => {
  it("collecting remains capturing_endpoint", () => {
    const afterStart = captureStart(startAttempt());
    const submitted = submitLateralReachCalibrationSample(
      afterStart,
      sample(150, { x: 0.55, y: 0.5 }),
    );
    assert.equal(submitted.disposition, "applied");
    assert.equal(submitted.state.phase, "capturing_endpoint");
  });

  it("endpoint failure preserves reasons via Slice 6", () => {
    const afterStart = captureStart(
      startAttempt({
        endpointCaptureConfig: {
          minStableDurationMs: 100,
          maxJitterRadius: 0.05,
          minStableSampleCount: 3,
          totalTimeoutMs: 100,
          minDisplacementFromStart: 0.5,
        },
      }),
    );
    // Stay near start so displacement never satisfies; timeout.
    const submitted = submitLateralReachCalibrationSample(
      afterStart,
      sample(200, { x: 0.3, y: 0.5 }),
    );
    // May need to hit exact timeout - submit at startedAtMs+totalTimeoutMs
    // endpoint startedAtMs is 100; timeout 100 → fail at 200
    let state = submitted.state;
    if (state.phase === "capturing_endpoint") {
      state = submitLateralReachCalibrationSample(
        state,
        sample(200, { x: 0.3, y: 0.5 }),
      ).state;
    }
    assert.equal(state.phase, "terminal");
    const outcome = getLateralReachCalibrationOutcome(state);
    assert.ok(outcome && outcome.kind === "result");
    if (outcome && outcome.kind === "result") {
      assert.equal(outcome.result.captureOutcome, "failed");
      assert.ok(
        outcome.result.failureReasons.includes("calibration_timeout") ||
          outcome.result.failureReasons.includes(
            "displacement_indistinguishable_from_noise",
          ) ||
          outcome.result.failureReasons.includes("endpoint_hold_not_confirmed"),
      );
    }
  });

  it("captured path preserves geometry-ready Slice 6 result", () => {
    const terminal = captureEndpoint(captureStart(startAttempt()));
    assert.equal(terminal.phase, "terminal");
    const outcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(outcome && outcome.kind === "result");
    if (outcome && outcome.kind === "result") {
      assert.equal(outcome.result.captureOutcome, "valid");
      assert.equal(outcome.result.geometryOutcome, "ready");
      if (outcome.result.geometryOutcome === "ready") {
        assert.equal(outcome.result.frozenGeometry.startingZone.point.x, 0.3);
        assert.ok(outcome.result.frozenGeometry.fixedTarget.point.x > 0.3);
      }
    }
  });

  it("preserves wrong-direction as capture failed via Slice 6", () => {
    // positive_x intention but move left (decreasing x)
    const afterStart = captureStart(
      startAttempt({ plan: { screenHorizontalDirection: "positive_x" } }),
    );
    const terminal = captureEndpoint(afterStart, { x: 0.1, y: 0.5 });
    const outcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(outcome && outcome.kind === "result");
    if (outcome && outcome.kind === "result") {
      assert.equal(outcome.result.captureOutcome, "failed");
      assert.ok(
        outcome.result.failureReasons.includes("wrong_direction_reach"),
      );
    }
  });

  it("preserves noise-floor / insufficient magnitude failures", () => {
    const afterStart = captureStart(
      startAttempt({
        noiseFloor: 0.5,
        endpointCaptureConfig: {
          ...ENDPOINT_CONFIG,
          minDisplacementFromStart: 0.05,
        },
      }),
    );
    // Small positive displacement below noise floor 0.5
    const terminal = captureEndpoint(afterStart, { x: 0.4, y: 0.5 });
    const outcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(outcome && outcome.kind === "result");
    if (outcome && outcome.kind === "result") {
      assert.equal(outcome.result.captureOutcome, "failed");
      assert.ok(
        outcome.result.failureReasons.includes(
          "displacement_indistinguishable_from_noise",
        ),
      );
    }
  });

  it("preserves geometry-not-constructible when radii force overlap", () => {
    const afterStart = captureStart(
      startAttempt({
        zoneRadii: {
          startingZoneRadius: 0.4,
          fixedTargetRadius: 0.4,
        },
      }),
    );
    const terminal = captureEndpoint(afterStart, { x: 0.55, y: 0.5 });
    const outcome = getLateralReachCalibrationOutcome(terminal);
    assert.ok(outcome && outcome.kind === "result");
    if (outcome && outcome.kind === "result") {
      assert.equal(outcome.result.captureOutcome, "valid");
      assert.equal(outcome.result.geometryOutcome, "not_constructible");
    }
  });
});

describe("cancellation", () => {
  it("cancels capturing_start and capturing_endpoint to cancelled", () => {
    const startPhase = startAttempt();
    const cancelledStart = cancelLateralReachCalibrationAttempt(startPhase);
    assert.equal(cancelledStart.phase, "terminal");
    assert.deepEqual(getLateralReachCalibrationOutcome(cancelledStart), {
      kind: "cancelled",
    });

    const endpointPhase = captureStart(startAttempt());
    const cancelledEndpoint =
      cancelLateralReachCalibrationAttempt(endpointPhase);
    assert.deepEqual(getLateralReachCalibrationOutcome(cancelledEndpoint), {
      kind: "cancelled",
    });
  });

  it("rejects cancel from configured and terminal", () => {
    const configured = createConfigured();
    assert.throws(
      () => cancelLateralReachCalibrationAttempt(configured),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "calibration attempt can only be cancelled while capture is active",
    );

    const terminal = cancelLateralReachCalibrationAttempt(startAttempt());
    assert.throws(
      () => cancelLateralReachCalibrationAttempt(terminal),
      (err: unknown) =>
        err instanceof RangeError &&
        err.message ===
          "calibration attempt can only be cancelled while capture is active",
    );
  });
});

describe("post-terminal stream", () => {
  it("ignores samples after success/failure/cancel without mutation", () => {
    const success = captureEndpoint(captureStart(startAttempt()));
    const afterSuccess = submitLateralReachCalibrationSample(
      success,
      sample(999, { x: 0.9, y: 0.9 }),
    );
    assert.equal(afterSuccess.disposition, "ignored_terminal");
    assert.equal(afterSuccess.state, success);
    assert.deepEqual(
      getLateralReachCalibrationOutcome(afterSuccess.state),
      getLateralReachCalibrationOutcome(success),
    );

    const failed = captureEndpoint(
      captureStart(
        startAttempt({ plan: { screenHorizontalDirection: "positive_x" } }),
      ),
      { x: 0.1, y: 0.5 },
    );
    const afterFail = submitLateralReachCalibrationSample(failed, sample(999));
    assert.equal(afterFail.disposition, "ignored_terminal");
    assert.equal(afterFail.state, failed);

    const cancelled = cancelLateralReachCalibrationAttempt(startAttempt());
    const afterCancel = submitLateralReachCalibrationSample(
      cancelled,
      sample(999),
    );
    assert.equal(afterCancel.disposition, "ignored_terminal");
    assert.equal(afterCancel.state, cancelled);
  });
});

describe("single-attempt and determinism", () => {
  it("has no retry/reset; fresh controller required after terminal", () => {
    const source = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "lateral-reach-calibration-controller.ts",
      ),
      "utf8",
    );
    assert.equal(/export function reset/.test(source), false);
    assert.equal(/export function retry/.test(source), false);
    assert.equal(/export function restart/.test(source), false);

    const terminal = cancelLateralReachCalibrationAttempt(startAttempt());
    assert.throws(() => startLateralReachCalibrationAttempt(terminal, 0));
    const fresh = createConfigured();
    assert.equal(fresh.phase, "configured");
  });

  it("identical inputs produce identical terminal results", () => {
    function runOnce() {
      return captureEndpoint(captureStart(startAttempt()));
    }
    const a = getLateralReachCalibrationOutcome(runOnce());
    const b = getLateralReachCalibrationOutcome(runOnce());
    assert.deepEqual(a, b);
  });
});

describe("source contracts", () => {
  const source = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "lateral-reach-calibration-controller.ts",
    ),
    "utf8",
  );

  it("uses Slice 10 resolver and forbids bypass/barrel/engine/camera", () => {
    assert.equal(
      source.includes("resolveLateralReachCalibrationAttemptIntentionFromPlan"),
      true,
    );
    assert.equal(
      source.includes("createLateralReachCalibrationAttemptIntention"),
      false,
    );
    assert.equal(
      /from\s+["']@\/app\/lib\/interaction-calibration\/lateral-reach["']/.test(
        source,
      ),
      false,
    );
    assert.equal(source.includes("lateral-reach-engine"), false);
    assert.equal(source.includes("engine-config-adapter"), false);
    assert.equal(source.includes("validateLateralReachConfig"), false);
    assert.equal(source.includes("buildLateralReachEngineConfig"), false);
    assert.equal(source.includes("MediaPipe"), false);
    assert.equal(source.includes("performance.now"), false);
    assert.equal(source.includes("Math.sign"), false);
    assert.equal(source.includes("targetPlacement"), false);
    assert.equal(source.includes("DEFAULT_"), false);
    assert.equal(
      /left\s*→|right\s*→|testedSide\s*===?\s*["']left["']\s*\?/.test(source),
      false,
    );
  });
});
