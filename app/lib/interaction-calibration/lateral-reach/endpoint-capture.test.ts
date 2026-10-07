/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/endpoint-capture.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LATERAL_REACH_CAPTURE_FAILURE_REASONS } from "@/app/lib/interaction-calibration/lateral-reach/types";
import {
  createLateralReachEndpointCaptureState,
  updateLateralReachEndpointCapture,
  validateLateralReachEndpointCaptureConfig,
  type LateralReachEndpointCaptureConfig,
  type LateralReachEndpointCaptureSample,
  type LateralReachEndpointCaptureState,
} from "@/app/lib/interaction-calibration/lateral-reach/endpoint-capture";

const START = { x: 0.3, y: 0.5 };

const BASE_CONFIG: LateralReachEndpointCaptureConfig = {
  minStableDurationMs: 1000,
  maxJitterRadius: 0.03,
  minStableSampleCount: 3,
  totalTimeoutMs: 5000,
  minDisplacementFromStart: 0.1,
};

function validConfig(
  overrides: Partial<LateralReachEndpointCaptureConfig> = {},
): LateralReachEndpointCaptureConfig {
  return { ...BASE_CONFIG, ...overrides };
}

function sample(
  atMs: number,
  overrides: Partial<LateralReachEndpointCaptureSample> = {},
): LateralReachEndpointCaptureSample {
  return {
    atMs,
    wrist: { x: 0.5, y: 0.5 },
    trackingValid: true,
    framingValid: true,
    ...overrides,
  };
}

function create(
  nowMs = 0,
  start = START,
  config: LateralReachEndpointCaptureConfig = validConfig(),
): LateralReachEndpointCaptureState {
  return createLateralReachEndpointCaptureState(nowMs, start, config);
}

describe("validateLateralReachEndpointCaptureConfig", () => {
  it("accepts a valid config including small positive minDisplacementFromStart", () => {
    const result = validateLateralReachEndpointCaptureConfig(
      validConfig({ minDisplacementFromStart: 0.0001 }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.config.minDisplacementFromStart, 0.0001);
    }
  });

  it("rejects null and arrays and non-objects", () => {
    assert.equal(validateLateralReachEndpointCaptureConfig(null).ok, false);
    assert.equal(validateLateralReachEndpointCaptureConfig([]).ok, false);
    assert.equal(validateLateralReachEndpointCaptureConfig("x").ok, false);
  });

  it("rejects missing or wrong field types", () => {
    assert.equal(validateLateralReachEndpointCaptureConfig({}).ok, false);
    assert.equal(
      validateLateralReachEndpointCaptureConfig({
        ...BASE_CONFIG,
        minStableDurationMs: "1",
      }).ok,
      false,
    );
  });

  it("rejects NaN / Infinity / -Infinity on every numeric field", () => {
    for (const field of [
      "minStableDurationMs",
      "maxJitterRadius",
      "minStableSampleCount",
      "totalTimeoutMs",
      "minDisplacementFromStart",
    ] as const) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const result = validateLateralReachEndpointCaptureConfig({
          ...BASE_CONFIG,
          [field]: bad,
        });
        assert.equal(result.ok, false, `${field}=${String(bad)}`);
        if (!result.ok) {
          assert.match(result.reason, new RegExp(`${field}_must_be_finite_number`));
        }
      }
    }
  });

  it("rejects negative minStableDurationMs and maxJitterRadius", () => {
    assert.equal(
      validateLateralReachEndpointCaptureConfig(validConfig({ minStableDurationMs: -1 })).ok,
      false,
    );
    assert.equal(
      validateLateralReachEndpointCaptureConfig(validConfig({ maxJitterRadius: -0.01 })).ok,
      false,
    );
  });

  it("rejects fractional and <1 minStableSampleCount", () => {
    assert.equal(
      validateLateralReachEndpointCaptureConfig(validConfig({ minStableSampleCount: 1.5 })).ok,
      false,
    );
    assert.equal(
      validateLateralReachEndpointCaptureConfig(validConfig({ minStableSampleCount: 0 })).ok,
      false,
    );
  });

  it("rejects totalTimeoutMs < minStableDurationMs", () => {
    assert.equal(
      validateLateralReachEndpointCaptureConfig(
        validConfig({ minStableDurationMs: 100, totalTimeoutMs: 99 }),
      ).ok,
      false,
    );
  });

  it("rejects minDisplacementFromStart = 0 and negative", () => {
    const zero = validateLateralReachEndpointCaptureConfig(
      validConfig({ minDisplacementFromStart: 0 }),
    );
    assert.equal(zero.ok, false);
    if (!zero.ok) {
      assert.equal(zero.reason, "minDisplacementFromStart_must_be_positive");
    }
    const neg = validateLateralReachEndpointCaptureConfig(
      validConfig({ minDisplacementFromStart: -0.1 }),
    );
    assert.equal(neg.ok, false);
    if (!neg.ok) {
      assert.equal(neg.reason, "minDisplacementFromStart_must_be_positive");
    }
  });

  it("validator never throws on invalid candidates", () => {
    assert.doesNotThrow(() => validateLateralReachEndpointCaptureConfig(undefined));
    assert.doesNotThrow(() => validateLateralReachEndpointCaptureConfig({ minDisplacementFromStart: Number.NaN }));
  });
});

describe("createLateralReachEndpointCaptureState", () => {
  it("rejects non-finite nowMs with RangeError", () => {
    assert.throws(() => create(Number.NaN), RangeError);
    assert.throws(() => create(Number.POSITIVE_INFINITY), RangeError);
    assert.throws(() => create(Number.NEGATIVE_INFINITY), RangeError);
  });

  it("rejects non-finite startWrist coordinates with RangeError", () => {
    assert.throws(
      () => createLateralReachEndpointCaptureState(0, { x: Number.NaN, y: 0.5 }, validConfig()),
      (err: unknown) =>
        err instanceof RangeError && err.message === "startWrist must have finite x and y",
    );
    assert.throws(
      () => createLateralReachEndpointCaptureState(0, { x: 0.3, y: Number.NaN }, validConfig()),
      RangeError,
    );
    assert.throws(
      () =>
        createLateralReachEndpointCaptureState(
          0,
          { x: Number.POSITIVE_INFINITY, y: 0.5 },
          validConfig(),
        ),
      RangeError,
    );
    assert.throws(
      () =>
        createLateralReachEndpointCaptureState(
          0,
          { x: 0.3, y: Number.NEGATIVE_INFINITY },
          validConfig(),
        ),
      RangeError,
    );
  });

  it("isolates startWrist and config from caller mutation", () => {
    const start = { x: 0.3, y: 0.5 };
    const config = validConfig();
    const state = createLateralReachEndpointCaptureState(0, start, config);
    start.x = 0.99;
    config.maxJitterRadius = 999;
    config.minDisplacementFromStart = 999;
    assert.equal(state.startWrist.x, 0.3);
    assert.equal(state.config.maxJitterRadius, BASE_CONFIG.maxJitterRadius);
    assert.equal(state.config.minDisplacementFromStart, BASE_CONFIG.minDisplacementFromStart);
    assert.equal(state.lastAcceptedAtMs, null);
    assert.equal(state.stableSinceMs, null);
    assert.deepEqual(state.currentStableSamples, []);
    assert.equal(state.maxStableSampleCountSeen, 0);
    assert.equal(state.maxDisplacementFromStartSeen, 0);
  });
});

describe("timestamp contracts", () => {
  it("ignores non-finite / before-start / decreasing timestamps with same state reference", () => {
    const state = create(100);
    let result = updateLateralReachEndpointCapture(state, sample(Number.NaN));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
    }

    result = updateLateralReachEndpointCapture(state, sample(50));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
    }

    result = updateLateralReachEndpointCapture(state, sample(110, { wrist: { x: 0.5, y: 0.5 } }));
    assert.equal(result.status, "collecting");
    const accepted =
      result.status === "collecting" ? result.state : state;
    assert.equal(accepted.lastAcceptedAtMs, 110);

    result = updateLateralReachEndpointCapture(accepted, sample(105));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, accepted);
      assert.equal(result.state.lastAcceptedAtMs, 110);
    }
  });

  it("accepted tracking-invalid sample advances lastAcceptedAtMs", () => {
    const state = create();
    const result = updateLateralReachEndpointCapture(
      state,
      sample(25, { trackingValid: false, wrist: null }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.lastAcceptedAtMs, 25);
      assert.equal(result.state.sawTrackingInvalid, true);
      assert.equal(result.state.sawSpatialReset, false);
    }
  });
});

describe("stability and displacement history", () => {
  it("first usable sample anchors; within jitter extends; outside re-anchors", () => {
    const config = validConfig({ maxJitterRadius: 0.05, minStableDurationMs: 10_000 });
    let state = create(0, START, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    assert.equal(result.status, "collecting");
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.stableSinceMs, 0);
    assert.equal(state.currentStableSamples.length, 1);

    result = updateLateralReachEndpointCapture(
      state,
      sample(10, { wrist: { x: 0.51, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.currentStableSamples.length, 2);
    assert.equal(state.sawSpatialReset, false);

    result = updateLateralReachEndpointCapture(
      state,
      sample(20, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.sawSpatialReset, true);
    assert.equal(state.stableSinceMs, 20);
    assert.equal(state.currentStableSamples.length, 1);
    assert.equal(state.currentStableSamples[0]?.x, 0.9);
  });

  it("tracking/framing reset does not set sawSpatialReset", () => {
    const config = validConfig({ minStableDurationMs: 10_000 });
    let state = create(0, START, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(10, { framingValid: false, wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.sawFramingInvalid, true);
    assert.equal(state.sawSpatialReset, false);
    assert.equal(state.stableSinceMs, null);
    assert.deepEqual(state.currentStableSamples, []);
  });

  it("maxStableSampleCountSeen is historical max, never sum", () => {
    const config = validConfig({
      minStableDurationMs: 10_000,
      minStableSampleCount: 10,
      maxJitterRadius: 0.01,
      minDisplacementFromStart: 0.05,
    });
    let state = create(0, START, config);
    for (const t of [0, 10, 20]) {
      const result = updateLateralReachEndpointCapture(
        state,
        sample(t, { wrist: { x: 0.5, y: 0.5 } }),
      );
      state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    }
    assert.equal(state.maxStableSampleCountSeen, 3);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(30, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(40, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.maxStableSampleCountSeen, 3);
    assert.equal(state.currentStableSamples.length, 2);
  });

  it("maxDisplacementFromStartSeen is historical and survives window reset", () => {
    const config = validConfig({
      minStableDurationMs: 10_000,
      maxJitterRadius: 0.01,
      minDisplacementFromStart: 0.05,
    });
    let state = create(0, START, config);
    // Far sample: displacement |0.9-0.3| = 0.6
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    const peakDisplacement = Math.hypot(0.9 - START.x, 0.5 - START.y);
    assert.equal(state.maxDisplacementFromStartSeen, peakDisplacement);

    // Re-anchor closer: displacement |0.4-0.3| = 0.1; historical max stays peak
    result = updateLateralReachEndpointCapture(
      state,
      sample(10, { wrist: { x: 0.4, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.sawSpatialReset, true);
    assert.equal(state.maxDisplacementFromStartSeen, peakDisplacement);
    assert.ok(state.maxDisplacementFromStartSeen > Math.hypot(0.4 - START.x, 0));
    assert.equal(state.currentStableSamples.length, 1);
  });
});

describe("capture success criteria", () => {
  it("requires all three conditions; partial combinations stay collecting", () => {
    // duration alone (count insufficient)
    let config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(100, { wrist: { x: 0.5, y: 0.5 } }),
    );
    assert.equal(result.status, "collecting");

    // count alone (duration insufficient)
    config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 3,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    state = create(0, START, config);
    result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(10, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(20, { wrist: { x: 0.5, y: 0.5 } }),
    );
    assert.equal(result.status, "collecting");

    // duration+count but insufficient displacement (near start)
    config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    state = create(0, START, config);
    for (const [t, x] of [
      [0, 0.3],
      [50, 0.31],
      [100, 0.32],
    ] as const) {
      result = updateLateralReachEndpointCapture(
        state,
        sample(t, { wrist: { x, y: 0.5 } }),
      );
      if (t < 100) {
        assert.equal(result.status, "collecting");
        state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
      }
    }
    assert.equal(result.status, "collecting");
  });

  it("captures when duration, count, and displacement are all satisfied", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(50, { wrist: { x: 0.51, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(100, { wrist: { x: 0.52, y: 0.5 } }),
    );
    assert.equal(result.status, "captured");
    if (result.status === "captured") {
      assert.equal(result.heldEndpoint.x, (0.5 + 0.51 + 0.52) / 3);
      assert.equal(result.heldEndpoint.y, 0.5);
    }
  });

  it("stable samples at startWrist cannot become an endpoint", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);
    let result: ReturnType<typeof updateLateralReachEndpointCapture> = {
      status: "collecting",
      state,
    };
    for (const t of [0, 50, 100]) {
      result = updateLateralReachEndpointCapture(
        state,
        sample(t, { wrist: { x: START.x, y: START.y } }),
      );
      if (result.status === "collecting") {
        state = result.state;
      }
    }
    assert.equal(result.status, "collecting");
  });

  it("heldEndpoint mean uses only post-reset window; fresh object; wrist clone isolation", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);

    // Prior window near start — must not contaminate mean
    for (const t of [0, 10, 20]) {
      const result = updateLateralReachEndpointCapture(
        state,
        sample(t, { wrist: { x: 0.31, y: 0.5 } }),
      );
      state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    }

    // Spatial reset into displaced Window B (binary-friendly coordinates)
    let result = updateLateralReachEndpointCapture(
      state,
      sample(30, { wrist: { x: 0.5, y: 0.75 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    assert.equal(state.sawSpatialReset, true);

    const wrist = { x: 0.5, y: 0.75 };
    result = updateLateralReachEndpointCapture(state, sample(80, { wrist }));
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    wrist.x = 0.99;
    assert.equal(state.currentStableSamples[1]?.x, 0.5);

    result = updateLateralReachEndpointCapture(
      state,
      sample(130, { wrist: { x: 0.5, y: 0.75 } }),
    );
    assert.equal(result.status, "captured");
    if (result.status === "captured") {
      assert.equal(result.heldEndpoint.x, 0.5);
      assert.equal(result.heldEndpoint.y, 0.75);
      // Fresh object — not the same reference as stored samples
      assert.notEqual(result.heldEndpoint, state.currentStableSamples[0]);
      // Prior window near start excluded
      assert.notEqual(result.heldEndpoint.x, 0.31);
    }
  });

  it("preserves raw normalized coordinates without clamping or mirroring", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 2,
      minDisplacementFromStart: 0.05,
      maxJitterRadius: 0.05,
    });
    let state = create(0, { x: 0.1, y: 0.1 }, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 1.2, y: -0.3 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(100, { wrist: { x: 1.2, y: -0.3 } }),
    );
    assert.equal(result.status, "captured");
    if (result.status === "captured") {
      assert.equal(result.heldEndpoint.x, 1.2);
      assert.equal(result.heldEndpoint.y, -0.3);
      assert.notEqual(result.heldEndpoint.x, 1 - 1.2);
    }
  });
});

describe("timeout ordering and failure reasons", () => {
  it("exact-deadline capture succeeds when all three become satisfied", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 2,
      totalTimeoutMs: 100,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(100, { wrist: { x: 0.5, y: 0.5 } }),
    );
    assert.equal(result.status, "captured");
  });

  it("exact-deadline failure uses post-sample evidence", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 50,
      minDisplacementFromStart: 0.1,
    });
    let state = create(0, START, config);
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { trackingValid: false, wrist: null }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(50, { framingValid: false, wrist: null }),
    );
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.ok(result.failureReasons.includes("calibration_timeout"));
      assert.ok(result.failureReasons.includes("wrist_tracking_invalid"));
      assert.ok(result.failureReasons.includes("framing_not_acceptable"));
    }
  });

  it("strictly-late sample uses pre-sample evidence; late content ignored", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
      minDisplacementFromStart: 0.1,
    });
    const state = create(0, START, config);
    assert.equal(state.sawTrackingInvalid, false);
    assert.equal(state.sawFramingInvalid, false);

    const result = updateLateralReachEndpointCapture(
      state,
      sample(101, {
        trackingValid: false,
        framingValid: false,
        wrist: { x: Number.NaN, y: 0.5 },
      }),
    );
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.ok(result.failureReasons.includes("calibration_timeout"));
      assert.equal(result.failureReasons.includes("wrist_tracking_invalid"), false);
      assert.equal(result.failureReasons.includes("framing_not_acceptable"), false);
      assert.ok(result.failureReasons.includes("displacement_indistinguishable_from_noise"));
    }
  });

  it("strictly-late malformed wrist cannot suppress timeout", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
      minDisplacementFromStart: 0.1,
    });
    const state = create(0, START, config);
    const result = updateLateralReachEndpointCapture(
      state,
      sample(101, {
        trackingValid: true,
        wrist: { x: Number.NaN, y: 0.5 },
      }),
    );
    assert.equal(result.status, "failed");
    assert.notEqual(result.status, "collecting");
    if (result.status === "failed") {
      assert.ok(result.failureReasons.includes("calibration_timeout"));
    }
  });

  it("ignores non-finite wrist before deadline without advancing state", () => {
    const state = create();
    const result = updateLateralReachEndpointCapture(
      state,
      sample(10, { trackingValid: true, wrist: { x: Number.NaN, y: 0.5 } }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
      assert.equal(result.state.sawTrackingInvalid, false);
    }
  });

  it("never-sufficient peak displacement yields displacement_indistinguishable_from_noise", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
      minDisplacementFromStart: 0.2,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);
    // Peak displacement ~0.05 < 0.2
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.35, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(100, { wrist: { x: 0.35, y: 0.5 } }),
    );
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.deepEqual(result.failureReasons, [
        "calibration_timeout",
        "displacement_indistinguishable_from_noise",
      ]);
      assert.equal(
        result.failureReasons.includes("endpoint_hold_not_confirmed"),
        false,
      );
    }
  });

  it("sufficient displacement without hold confirmation yields endpoint_hold_not_confirmed", () => {
    const config = validConfig({
      minStableDurationMs: 5000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
      minDisplacementFromStart: 0.1,
      maxJitterRadius: 0.05,
    });
    let state = create(0, START, config);
    // Peak displacement 0.2 >= 0.1, but hold never confirmed (count/duration)
    let result = updateLateralReachEndpointCapture(
      state,
      sample(0, { wrist: { x: 0.5, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachEndpointCaptureState }).state;
    result = updateLateralReachEndpointCapture(
      state,
      sample(100, { wrist: { x: 0.5, y: 0.5 } }),
    );
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.deepEqual(result.failureReasons, [
        "calibration_timeout",
        "endpoint_hold_not_confirmed",
      ]);
      assert.equal(
        result.failureReasons.includes("displacement_indistinguishable_from_noise"),
        false,
      );
    }
  });

  it("failed results always include calibration_timeout and exactly one terminal reason", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 10,
      minDisplacementFromStart: 0.1,
    });
    const state = create(0, START, config);
    const result = updateLateralReachEndpointCapture(state, sample(10));
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.failureReasons[0], "calibration_timeout");
      const terminal = result.failureReasons.filter(
        (r) =>
          r === "displacement_indistinguishable_from_noise" ||
          r === "endpoint_hold_not_confirmed",
      );
      assert.equal(terminal.length, 1);

      const forbidden = [
        "start_timeout",
        "start_unstable",
        "insufficient_start_samples",
        "wrong_direction_reach",
        "direction_aligned_magnitude_not_positive",
      ];
      for (const reason of forbidden) {
        assert.equal(result.failureReasons.includes(reason as never), false);
      }

      const allowed = new Set<string>(LATERAL_REACH_CAPTURE_FAILURE_REASONS);
      for (const reason of result.failureReasons) {
        assert.ok(allowed.has(reason));
      }
    }
  });
});
