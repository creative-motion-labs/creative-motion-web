/**
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/interaction-calibration/lateral-reach/start-capture.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LATERAL_REACH_CAPTURE_FAILURE_REASONS } from "@/app/lib/interaction-calibration/lateral-reach/types";
import {
  createLateralReachStartCaptureState,
  updateLateralReachStartCapture,
  validateLateralReachStartCaptureConfig,
  type LateralReachStartCaptureConfig,
  type LateralReachStartCaptureSample,
  type LateralReachStartCaptureState,
} from "@/app/lib/interaction-calibration/lateral-reach/start-capture";

const BASE_CONFIG: LateralReachStartCaptureConfig = {
  minStableDurationMs: 1000,
  maxJitterRadius: 0.03,
  minStableSampleCount: 3,
  totalTimeoutMs: 5000,
};

function validConfig(
  overrides: Partial<LateralReachStartCaptureConfig> = {},
): LateralReachStartCaptureConfig {
  return { ...BASE_CONFIG, ...overrides };
}

function sample(
  atMs: number,
  overrides: Partial<LateralReachStartCaptureSample> = {},
): LateralReachStartCaptureSample {
  return {
    atMs,
    wrist: { x: 0.3, y: 0.5 },
    trackingValid: true,
    framingValid: true,
    ...overrides,
  };
}

function collectUntil(
  state: LateralReachStartCaptureState,
  samples: LateralReachStartCaptureSample[],
) {
  let current = state;
  let last = updateLateralReachStartCapture(current, samples[0]!);
  for (let i = 0; i < samples.length; i++) {
    last = updateLateralReachStartCapture(current, samples[i]!);
    if (last.status !== "collecting") return last;
    current = last.state;
  }
  return last;
}

describe("validateLateralReachStartCaptureConfig", () => {
  it("accepts a valid config", () => {
    const result = validateLateralReachStartCaptureConfig(validConfig());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.config, BASE_CONFIG);
    }
  });

  it("rejects non-object input", () => {
    assert.equal(validateLateralReachStartCaptureConfig(null).ok, false);
    assert.equal(validateLateralReachStartCaptureConfig("x").ok, false);
    assert.equal(validateLateralReachStartCaptureConfig([]).ok, false);
  });

  it("rejects NaN / Infinity / -Infinity on every numeric field", () => {
    for (const field of [
      "minStableDurationMs",
      "maxJitterRadius",
      "minStableSampleCount",
      "totalTimeoutMs",
    ] as const) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const result = validateLateralReachStartCaptureConfig(
          validConfig({ [field]: bad } as Partial<LateralReachStartCaptureConfig>),
        );
        assert.equal(result.ok, false, `${field}=${bad} must be rejected`);
      }
    }
  });

  it("rejects negative minStableDurationMs", () => {
    const result = validateLateralReachStartCaptureConfig(validConfig({ minStableDurationMs: -1 }));
    assert.equal(result.ok, false);
  });

  it("rejects negative maxJitterRadius", () => {
    const result = validateLateralReachStartCaptureConfig(validConfig({ maxJitterRadius: -0.01 }));
    assert.equal(result.ok, false);
  });

  it("rejects minStableSampleCount < 1", () => {
    const result = validateLateralReachStartCaptureConfig(validConfig({ minStableSampleCount: 0 }));
    assert.equal(result.ok, false);
  });

  it("rejects non-integer minStableSampleCount", () => {
    const result = validateLateralReachStartCaptureConfig(
      validConfig({ minStableSampleCount: 2.5 }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects totalTimeoutMs < minStableDurationMs", () => {
    const result = validateLateralReachStartCaptureConfig(
      validConfig({ minStableDurationMs: 2000, totalTimeoutMs: 1000 }),
    );
    assert.equal(result.ok, false);
  });
});

describe("createLateralReachStartCaptureState", () => {
  it("rejects NaN nowMs with RangeError", () => {
    assert.throws(
      () => createLateralReachStartCaptureState(Number.NaN, validConfig()),
      RangeError,
    );
  });

  it("rejects Infinity nowMs", () => {
    assert.throws(
      () => createLateralReachStartCaptureState(Number.POSITIVE_INFINITY, validConfig()),
      RangeError,
    );
  });

  it("rejects -Infinity nowMs", () => {
    assert.throws(
      () => createLateralReachStartCaptureState(Number.NEGATIVE_INFINITY, validConfig()),
      RangeError,
    );
  });

  it("freezes a config snapshot isolated from caller mutation", () => {
    const config = validConfig({ maxJitterRadius: 0.03 });
    const state = createLateralReachStartCaptureState(0, config);
    config.maxJitterRadius = 999;
    assert.equal(state.config.maxJitterRadius, 0.03);
  });

  it("fresh create produces independent attempt state", () => {
    const a = createLateralReachStartCaptureState(0, validConfig());
    const b = createLateralReachStartCaptureState(100, validConfig());
    assert.notEqual(a, b);
    assert.equal(a.startedAtMs, 0);
    assert.equal(b.startedAtMs, 100);
  });
});

describe("stability window progression", () => {
  it("first usable sample opens a one-sample stable window", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const result = updateLateralReachStartCapture(state, sample(10));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.stableSinceMs, 10);
      assert.equal(result.state.currentStableSamples.length, 1);
      assert.deepEqual(result.state.currentStableSamples[0], { x: 0.3, y: 0.5 });
      assert.equal(result.state.lastAcceptedAtMs, 10);
      assert.equal(result.state.maxStableSampleCountSeen, 1);
    }
  });

  it("in-tolerance sample extends the same anchored window", () => {
    let state = createLateralReachStartCaptureState(0, validConfig());
    let result = updateLateralReachStartCapture(state, sample(10, { wrist: { x: 0.3, y: 0.5 } }));
    assert.equal(result.status, "collecting");
    state = result.state;
    result = updateLateralReachStartCapture(
      state,
      sample(20, { wrist: { x: 0.31, y: 0.5 } }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.stableSinceMs, 10);
      assert.equal(result.state.currentStableSamples.length, 2);
      assert.equal(result.state.sawSpatialReset, false);
    }
  });

  it("jitter sample sets sawSpatialReset and re-anchors immediately", () => {
    let state = createLateralReachStartCaptureState(0, validConfig());
    let result = updateLateralReachStartCapture(state, sample(10, { wrist: { x: 0.3, y: 0.5 } }));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(
      state,
      sample(20, { wrist: { x: 0.5, y: 0.5 } }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.sawSpatialReset, true);
      assert.equal(result.state.stableSinceMs, 20);
      assert.equal(result.state.currentStableSamples.length, 1);
      assert.deepEqual(result.state.currentStableSamples[0], { x: 0.5, y: 0.5 });
    }
  });

  it("invalid tracking resets active window and preserves startedAtMs", () => {
    let state = createLateralReachStartCaptureState(0, validConfig());
    let result = updateLateralReachStartCapture(state, sample(10));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(
      state,
      sample(20, { trackingValid: false, wrist: null }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.startedAtMs, 0);
      assert.equal(result.state.stableSinceMs, null);
      assert.equal(result.state.currentStableSamples.length, 0);
      assert.equal(result.state.sawTrackingInvalid, true);
      assert.equal(result.state.lastAcceptedAtMs, 20);
      assert.equal(result.state.maxStableSampleCountSeen, 1);
    }
  });

  it("invalid framing resets active window with framing evidence", () => {
    let state = createLateralReachStartCaptureState(0, validConfig());
    let result = updateLateralReachStartCapture(state, sample(10));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(
      state,
      sample(20, { framingValid: false }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.stableSinceMs, null);
      assert.equal(result.state.currentStableSamples.length, 0);
      assert.equal(result.state.sawFramingInvalid, true);
      assert.equal(result.state.lastAcceptedAtMs, 20);
    }
  });

  it("records both tracking and framing evidence on the same processed sample", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const result = updateLateralReachStartCapture(
      state,
      sample(10, { trackingValid: false, framingValid: false, wrist: null }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.sawTrackingInvalid, true);
      assert.equal(result.state.sawFramingInvalid, true);
    }
  });
});

describe("capture success criteria", () => {
  it("remains collecting when duration is satisfied but count is insufficient", () => {
    const config = validConfig({ minStableDurationMs: 100, minStableSampleCount: 3 });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(state, sample(0, { wrist: { x: 0.3, y: 0.5 } }));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(100, { wrist: { x: 0.3, y: 0.5 } }));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.currentStableSamples.length, 2);
      assert.ok(100 - 0 >= config.minStableDurationMs);
    }
  });

  it("remains collecting when count is satisfied but duration is insufficient", () => {
    const config = validConfig({ minStableDurationMs: 1000, minStableSampleCount: 3 });
    const state = createLateralReachStartCaptureState(0, config);
    const result = collectUntil(state, [
      sample(0, { wrist: { x: 0.3, y: 0.5 } }),
      sample(10, { wrist: { x: 0.3, y: 0.5 } }),
      sample(20, { wrist: { x: 0.3, y: 0.5 } }),
    ]);
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.currentStableSamples.length, 3);
      assert.ok(20 - 0 < config.minStableDurationMs);
    }
  });

  it("captures when both duration and count are satisfied", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      maxJitterRadius: 0.05,
    });
    const state = createLateralReachStartCaptureState(0, config);
    const result = collectUntil(state, [
      sample(0, { wrist: { x: 0.2, y: 0.5 } }),
      sample(50, { wrist: { x: 0.21, y: 0.5 } }),
      sample(100, { wrist: { x: 0.22, y: 0.5 } }),
    ]);
    assert.equal(result.status, "captured");
    if (result.status === "captured") {
      assert.equal(result.startWrist.x, (0.2 + 0.21 + 0.22) / 3);
      assert.equal(result.startWrist.y, 0.5);
    }
  });

  it("maxStableSampleCountSeen is max across windows, never sum", () => {
    const config = validConfig({
      minStableDurationMs: 10_000,
      minStableSampleCount: 10,
      maxJitterRadius: 0.01,
    });
    let state = createLateralReachStartCaptureState(0, config);
    // window A: 3 samples
    for (const t of [0, 10, 20]) {
      const result = updateLateralReachStartCapture(
        state,
        sample(t, { wrist: { x: 0.3, y: 0.5 } }),
      );
      assert.equal(result.status, "collecting");
      state = result.state;
    }
    assert.equal(state.maxStableSampleCountSeen, 3);
    // jitter re-anchor then 2 samples in window B
    let result = updateLateralReachStartCapture(
      state,
      sample(30, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(
      state,
      sample(40, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    assert.equal(state.maxStableSampleCountSeen, 3);
    assert.equal(state.currentStableSamples.length, 2);
    assert.equal(state.sawSpatialReset, true);
  });

  it("captured startWrist mean uses only the post-reset window", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 3,
      maxJitterRadius: 0.05,
      totalTimeoutMs: 5000,
    });
    let state = createLateralReachStartCaptureState(0, config);

    // Window A — clearly distinct coordinates (must not affect final mean)
    for (const t of [0, 10, 20]) {
      const result = updateLateralReachStartCapture(
        state,
        sample(t, { wrist: { x: 0.25, y: 0.25 } }),
      );
      assert.equal(result.status, "collecting");
      state = result.state;
    }
    assert.equal(state.currentStableSamples.length, 3);

    // Spatial reset: immediately re-anchors on this sample (start of Window B)
    let result = updateLateralReachStartCapture(
      state,
      sample(30, { wrist: { x: 0.5, y: 0.75 } }),
    );
    assert.equal(result.status, "collecting");
    state = result.state;
    assert.equal(state.sawSpatialReset, true);
    assert.equal(state.currentStableSamples.length, 1);
    assert.equal(state.currentStableSamples[0]?.x, 0.5);
    assert.equal(state.currentStableSamples[0]?.y, 0.75);

    // Window B — hand-verifiable exact coordinates; duration + count both satisfied
    result = updateLateralReachStartCapture(
      state,
      sample(80, { wrist: { x: 0.5, y: 0.75 } }),
    );
    assert.equal(result.status, "collecting");
    state = result.state;
    result = updateLateralReachStartCapture(
      state,
      sample(130, { wrist: { x: 0.5, y: 0.75 } }),
    );
    assert.equal(result.status, "captured");
    if (result.status === "captured") {
      // Window B only: three identical points → mean (0.5, 0.75)
      assert.equal(result.startWrist.x, 0.5);
      assert.equal(result.startWrist.y, 0.75);
      // Explicitly prove Window A samples are absent from the final mean
      assert.notEqual(result.startWrist.x, 0.25);
      assert.notEqual(result.startWrist.y, 0.25);
      assert.notEqual(result.startWrist.x, (0.25 + 0.25 + 0.25 + 0.5 + 0.5 + 0.5) / 6);
      assert.notEqual(result.startWrist.y, (0.25 + 0.25 + 0.25 + 0.75 + 0.75 + 0.75) / 6);
    }
  });
});

describe("timeout and failure reasons", () => {
  it("timeout with no sufficiently populated window includes insufficient_start_samples", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 3,
      totalTimeoutMs: 100,
    });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(state, sample(0));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(100));
    // exact deadline with only 2 samples → max count < 3
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.deepEqual(result.failureReasons, ["start_timeout", "insufficient_start_samples"]);
      assert.equal(result.failureReasons.includes("start_unstable"), false);
    }
  });

  it("timeout after sufficient-count jitter reset includes start_unstable only", () => {
    const config = validConfig({
      minStableDurationMs: 5000,
      minStableSampleCount: 3,
      maxJitterRadius: 0.01,
      totalTimeoutMs: 200,
    });
    let state = createLateralReachStartCaptureState(0, config);
    for (const t of [0, 10, 20]) {
      const result = updateLateralReachStartCapture(
        state,
        sample(t, { wrist: { x: 0.3, y: 0.5 } }),
      );
      state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    }
    assert.equal(state.maxStableSampleCountSeen, 3);
    let result = updateLateralReachStartCapture(
      state,
      sample(30, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    assert.equal(state.sawSpatialReset, true);
    result = updateLateralReachStartCapture(state, sample(200));
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.ok(result.failureReasons.includes("start_timeout"));
      assert.ok(result.failureReasons.includes("start_unstable"));
      assert.equal(result.failureReasons.includes("insufficient_start_samples"), false);
    }
  });

  it("tracking and framing reasons co-occur additively when evidenced", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 50,
    });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(
      state,
      sample(0, { trackingValid: false, framingValid: false, wrist: null }),
    );
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(50));
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.deepEqual(result.failureReasons, [
        "start_timeout",
        "wrist_tracking_invalid",
        "framing_not_acceptable",
        "insufficient_start_samples",
      ]);
    }
  });

  it("exact deadline that satisfies capture returns captured", () => {
    const config = validConfig({
      minStableDurationMs: 100,
      minStableSampleCount: 2,
      totalTimeoutMs: 100,
    });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(state, sample(0));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(100));
    assert.equal(result.status, "captured");
  });

  it("exact deadline that does not satisfy capture returns failed", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
    });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(state, sample(0));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(100));
    assert.equal(result.status, "failed");
  });

  it("strictly-after-deadline sample is not processed and cannot capture", () => {
    const config = validConfig({
      minStableDurationMs: 10,
      minStableSampleCount: 1,
      totalTimeoutMs: 100,
    });
    const state = createLateralReachStartCaptureState(0, config);
    // No prior samples; after-deadline sample would capture if processed (1 sample, duration 0).
    const result = updateLateralReachStartCapture(state, sample(101));
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.ok(result.failureReasons.includes("start_timeout"));
      assert.ok(result.failureReasons.includes("insufficient_start_samples"));
    }
  });

  it("strictly-late sample with malformed wrist fails by timeout before ignore logic", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
    });
    const state = createLateralReachStartCaptureState(0, config);
    assert.equal(state.sawTrackingInvalid, false);
    assert.equal(state.sawFramingInvalid, false);

    // If malformed-wrist ignore ran before timeout, this would return collecting + same state.
    const result = updateLateralReachStartCapture(
      state,
      sample(101, {
        trackingValid: true,
        wrist: { x: Number.NaN, y: 0.5 },
      }),
    );

    assert.equal(result.status, "failed");
    assert.notEqual(result.status, "collecting");
    if (result.status === "failed") {
      assert.ok(result.failureReasons.includes("start_timeout"));
      // Late sample content must not contribute tracking/framing evidence
      assert.equal(result.failureReasons.includes("wrist_tracking_invalid"), false);
      assert.equal(result.failureReasons.includes("framing_not_acceptable"), false);
    }
  });
});

describe("timestamp and malformed-input contracts", () => {
  it("ignores NaN sample.atMs and returns the exact same state", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const result = updateLateralReachStartCapture(state, sample(Number.NaN));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
    }
  });

  it("ignores decreasing timestamps and returns the exact same state", () => {
    let state = createLateralReachStartCaptureState(0, validConfig());
    let result = updateLateralReachStartCapture(state, sample(50));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(40));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
      assert.equal(result.state.lastAcceptedAtMs, 50);
    }
  });

  it("ignores first timestamp before startedAtMs; later legal sample still opens window", () => {
    const state = createLateralReachStartCaptureState(100, validConfig());
    let result = updateLateralReachStartCapture(state, sample(50));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
    }
    result = updateLateralReachStartCapture(state, sample(110));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.stableSinceMs, 110);
      assert.equal(result.state.currentStableSamples.length, 1);
    }
  });

  it("processed tracking-invalid sample advances lastAcceptedAtMs", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const result = updateLateralReachStartCapture(
      state,
      sample(25, { trackingValid: false, wrist: null }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state.lastAcceptedAtMs, 25);
    }
  });

  it("ignored malformed timestamp does not advance lastAcceptedAtMs", () => {
    let state = createLateralReachStartCaptureState(0, validConfig());
    let result = updateLateralReachStartCapture(state, sample(10));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(Number.POSITIVE_INFINITY));
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
      assert.equal(result.state.lastAcceptedAtMs, 10);
    }
  });

  it("timeout still works after ignored malformed timestamps", () => {
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 100,
    });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(state, sample(Number.NaN));
    assert.equal(result.status, "collecting");
    state = result.state;
    result = updateLateralReachStartCapture(state, sample(0));
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(5)); // decreasing relative? 5 > 0 ok
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(Number.NEGATIVE_INFINITY));
    assert.equal(result.status, "collecting");
    assert.equal(result.state, state);
    result = updateLateralReachStartCapture(state, sample(100));
    assert.equal(result.status, "failed");
  });

  it("ignores non-finite wrist x when trackingValid is true", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const result = updateLateralReachStartCapture(
      state,
      sample(10, { wrist: { x: Number.NaN, y: 0.5 }, trackingValid: true }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
      assert.equal(result.state.sawTrackingInvalid, false);
    }
  });

  it("ignores non-finite wrist y when trackingValid is true", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const result = updateLateralReachStartCapture(
      state,
      sample(10, {
        wrist: { x: 0.3, y: Number.POSITIVE_INFINITY },
        trackingValid: true,
      }),
    );
    assert.equal(result.status, "collecting");
    if (result.status === "collecting") {
      assert.equal(result.state, state);
    }
  });

  it("caller mutation of an admitted wrist object does not mutate stored samples", () => {
    const state = createLateralReachStartCaptureState(0, validConfig());
    const wrist = { x: 0.3, y: 0.5 };
    const result = updateLateralReachStartCapture(
      state,
      sample(10, { wrist }),
    );
    assert.equal(result.status, "collecting");
    wrist.x = 0.99;
    if (result.status === "collecting") {
      assert.equal(result.state.currentStableSamples[0]?.x, 0.3);
    }
  });
});

describe("vocabulary boundary", () => {
  it("does not introduce new capture failure vocabulary", () => {
    const allowed = new Set<string>(LATERAL_REACH_CAPTURE_FAILURE_REASONS);
    const config = validConfig({
      minStableDurationMs: 1000,
      minStableSampleCount: 5,
      totalTimeoutMs: 10,
    });
    let state = createLateralReachStartCaptureState(0, config);
    let result = updateLateralReachStartCapture(
      state,
      sample(0, { trackingValid: false, framingValid: false, wrist: null }),
    );
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    // force spatial reset history with enough samples then timeout
    for (const t of [1, 2, 3]) {
      result = updateLateralReachStartCapture(
        state,
        sample(t, { wrist: { x: 0.3, y: 0.5 } }),
      );
      state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    }
    result = updateLateralReachStartCapture(
      state,
      sample(4, { wrist: { x: 0.9, y: 0.5 } }),
    );
    state = (result as { status: "collecting"; state: LateralReachStartCaptureState }).state;
    result = updateLateralReachStartCapture(state, sample(10));
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      for (const reason of result.failureReasons) {
        assert.ok(allowed.has(reason), `unexpected reason ${reason}`);
      }
    }
  });
});
