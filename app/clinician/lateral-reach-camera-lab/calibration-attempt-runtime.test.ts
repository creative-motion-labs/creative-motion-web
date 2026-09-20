/**
 * Lateral Reach Camera Lab — Slice 18 TEST: calibration attempt runtime.
 *
 * Validates production helpers for safe calibration startup orchestration.
 * Uses repository-approved Node.js test harness (no vitest, no vi.fn mocks).
 *
 * Run (approved harness):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/clinician/lateral-reach-camera-lab/calibration-attempt-runtime.test.ts"
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkCalibrationStartEligibility,
  checkLegacyStartEligibility,
  consumeActiveCalibrationController,
  createActiveCalibrationControllerOwner,
  createCalibrationRuntimeGate,
  createConfiguredCalibrationController,
  executeCalibrationStartupTransaction,
  invalidateCalibrationRuntime,
  isCalibrationStartupCurrent,
  releaseCalibrationStartup,
  tryBeginCalibrationStartup,
  type StartupDependencies,
} from "./calibration-attempt-runtime";
import type {
  LateralReachCalibrationControllerInput,
  LateralReachCalibrationControllerState,
} from "@/app/lib/upper-limb-motor-screen/lateral-reach-calibration-controller";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_CONTROLLER_INPUT: LateralReachCalibrationControllerInput = {
  testedSide: "right",
  plan: {
    screenHorizontalDirection: "positive_x" as const,
  },
  startCaptureConfig: {
    minStableDurationMs: 100,
    maxJitterRadius: 0.05,
    minStableSampleCount: 3,
    totalTimeoutMs: 1000,
  },
  endpointCaptureConfig: {
    minStableDurationMs: 100,
    maxJitterRadius: 0.05,
    minStableSampleCount: 3,
    totalTimeoutMs: 1000,
    minDisplacementFromStart: 0.1,
  },
  noiseFloor: 0.05,
  zoneRadii: {
    startingZoneRadius: 0.05,
    fixedTargetRadius: 0.05,
  },
};

function buildMockController(phase: string): LateralReachCalibrationControllerState {
  return { phase } as unknown as LateralReachCalibrationControllerState;
}

// ---------------------------------------------------------------------------
// Tests: Runtime gate
// ---------------------------------------------------------------------------

describe("CalibrationRuntimeGate", () => {
  describe("createCalibrationRuntimeGate", () => {
    it("creates gate with generation 0 and no owner", () => {
      const gate = createCalibrationRuntimeGate();
      assert.strictEqual(gate.generation, 0);
      assert.strictEqual(gate.startupOwner, null);
    });
  });

  describe("tryBeginCalibrationStartup", () => {
    it("first begin owns generation 1", () => {
      const gate = createCalibrationRuntimeGate();
      const gen = tryBeginCalibrationStartup(gate);
      assert.strictEqual(gen, 1);
      assert.strictEqual(gate.generation, 1);
      assert.strictEqual(gate.startupOwner, 1);
    });

    it("second begin rejected with null", () => {
      const gate = createCalibrationRuntimeGate();
      const gen1 = tryBeginCalibrationStartup(gate);
      const gen2 = tryBeginCalibrationStartup(gate);

      assert.strictEqual(gen1, 1);
      assert.strictEqual(gen2, null);
    });

    it("rejected begin does not increment generation", () => {
      const gate = createCalibrationRuntimeGate();
      tryBeginCalibrationStartup(gate);
      const beforeGen = gate.generation;
      tryBeginCalibrationStartup(gate);
      assert.strictEqual(gate.generation, beforeGen);
    });
  });

  describe("invalidateCalibrationRuntime", () => {
    it("invalidate increments generation and releases ownership", () => {
      const gate = createCalibrationRuntimeGate();
      tryBeginCalibrationStartup(gate);
      assert.strictEqual(gate.generation, 1);
      assert.strictEqual(gate.startupOwner, 1);

      invalidateCalibrationRuntime(gate);
      assert.strictEqual(gate.generation, 2);
      assert.strictEqual(gate.startupOwner, null);
    });
  });

  describe("isCalibrationStartupCurrent", () => {
    it("current requires both generation AND owner match", () => {
      const gate = createCalibrationRuntimeGate();
      const gen = tryBeginCalibrationStartup(gate)!;

      assert.strictEqual(isCalibrationStartupCurrent(gate, gen), true);
    });

    it("returns false if generation mismatches", () => {
      const gate = createCalibrationRuntimeGate();
      const gen = tryBeginCalibrationStartup(gate)!;
      invalidateCalibrationRuntime(gate);

      assert.strictEqual(isCalibrationStartupCurrent(gate, gen), false);
    });

    it("returns false if owner was released", () => {
      const gate = createCalibrationRuntimeGate();
      const gen = tryBeginCalibrationStartup(gate)!;
      gate.startupOwner = null; // Manual release

      assert.strictEqual(isCalibrationStartupCurrent(gate, gen), false);
    });
  });

  describe("releaseCalibrationStartup", () => {
    it("matching release clears owner", () => {
      const gate = createCalibrationRuntimeGate();
      const gen = tryBeginCalibrationStartup(gate)!;

      releaseCalibrationStartup(gate, gen);
      assert.strictEqual(gate.startupOwner, null);
      assert.strictEqual(gate.generation, 1); // Generation unchanged
    });

    it("old release cannot clear newer owner", () => {
      const gate = createCalibrationRuntimeGate();
      const gen1 = tryBeginCalibrationStartup(gate)!;
      invalidateCalibrationRuntime(gate);
      const gen2 = tryBeginCalibrationStartup(gate)!;

      // Old generation tries to release
      releaseCalibrationStartup(gate, gen1);

      // Newer owner unchanged
      assert.strictEqual(gate.startupOwner, gen2);
    });

    it("release with non-matching generation is no-op", () => {
      const gate = createCalibrationRuntimeGate();
      const gen = tryBeginCalibrationStartup(gate)!;

      releaseCalibrationStartup(gate, gen + 999);
      assert.strictEqual(gate.startupOwner, gen); // Unchanged
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Active controller ownership
// ---------------------------------------------------------------------------

describe("ActiveCalibrationControllerOwner", () => {
  it("creates owner with null controller", () => {
    const owner = createActiveCalibrationControllerOwner();
    assert.strictEqual(owner.current, null);
  });

  it("controller consumed once returns controller", () => {
    const owner = createActiveCalibrationControllerOwner();
    const mockController = buildMockController("capturing_start");
    owner.current = mockController;

    const consumed = consumeActiveCalibrationController(owner);
    assert.strictEqual(consumed, mockController);
    assert.strictEqual(owner.current, null);
  });

  it("second consume returns null", () => {
    const owner = createActiveCalibrationControllerOwner();
    owner.current = buildMockController("capturing_start");

    consumeActiveCalibrationController(owner);
    const second = consumeActiveCalibrationController(owner);

    assert.strictEqual(second, null);
  });

  it("consume with no controller returns null", () => {
    const owner = createActiveCalibrationControllerOwner();
    const result = consumeActiveCalibrationController(owner);
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// Tests: Start eligibility
// ---------------------------------------------------------------------------

describe("checkLegacyStartEligibility", () => {
  it("idle allowed", () => {
    const result = checkLegacyStartEligibility("idle", false, false, false);
    assert.strictEqual(result.allowed, true);
  });

  it("error allowed", () => {
    const result = checkLegacyStartEligibility("error", false, false, false);
    assert.strictEqual(result.allowed, true);
  });

  it("initializing denied", () => {
    const result = checkLegacyStartEligibility("initializing", false, false, false);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "detector_not_idle_or_error");
  });

  it("acquiring denied", () => {
    const result = checkLegacyStartEligibility("acquiring", false, false, false);
    assert.strictEqual(result.allowed, false);
  });

  it("running denied", () => {
    const result = checkLegacyStartEligibility("running", false, false, false);
    assert.strictEqual(result.allowed, false);
  });

  it("denied when legacy start in progress", () => {
    const result = checkLegacyStartEligibility("idle", true, false, false);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "legacy_start_in_progress");
  });

  it("denied when calibration startup owned", () => {
    const result = checkLegacyStartEligibility("idle", false, true, false);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "calibration_startup_in_progress");
  });

  it("denied when active calibration exists", () => {
    const result = checkLegacyStartEligibility("idle", false, false, true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "active_calibration_exists");
  });
});

describe("checkCalibrationStartEligibility", () => {
  it("idle with locks allowed", () => {
    const result = checkCalibrationStartEligibility("idle", false, false, false, true, true);
    assert.strictEqual(result.allowed, true);
  });

  it("error denied", () => {
    const result = checkCalibrationStartEligibility("error", false, false, false, true, true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "detector_not_idle");
  });

  it("initializing denied", () => {
    const result = checkCalibrationStartEligibility(
      "initializing",
      false,
      false,
      false,
      true,
      true,
    );
    assert.strictEqual(result.allowed, false);
  });

  it("acquiring denied", () => {
    const result = checkCalibrationStartEligibility("acquiring", false, false, false, true, true);
    assert.strictEqual(result.allowed, false);
  });

  it("running denied", () => {
    const result = checkCalibrationStartEligibility("running", false, false, false, true, true);
    assert.strictEqual(result.allowed, false);
  });

  it("denied when legacy start in progress", () => {
    const result = checkCalibrationStartEligibility("idle", true, false, false, true, true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "legacy_start_in_progress");
  });

  it("denied when calibration startup owned", () => {
    const result = checkCalibrationStartEligibility("idle", false, true, false, true, true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "calibration_startup_in_progress");
  });

  it("denied when active calibration exists", () => {
    const result = checkCalibrationStartEligibility("idle", false, false, true, true, true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "active_calibration_exists");
  });

  it("denied without attempt plan lock", () => {
    const result = checkCalibrationStartEligibility("idle", false, false, false, false, true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "attempt_plan_not_locked");
  });

  it("denied without technical config lock", () => {
    const result = checkCalibrationStartEligibility("idle", false, false, false, true, false);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "technical_config_not_locked");
  });
});

// ---------------------------------------------------------------------------
// Tests: Configured controller creation
// ---------------------------------------------------------------------------

describe("createConfiguredCalibrationController", () => {
  it("creates configured controller from valid input", () => {
    const controller = createConfiguredCalibrationController(TEST_CONTROLLER_INPUT);
    assert.ok(controller);
    assert.strictEqual(controller.phase, "configured");
  });

  it("throws on invalid testedSide", () => {
    const invalidInput = {
      ...TEST_CONTROLLER_INPUT,
      testedSide: "middle" as typeof TEST_CONTROLLER_INPUT.testedSide,
    };
    assert.throws(() => createConfiguredCalibrationController(invalidInput));
  });
});

// ---------------------------------------------------------------------------
// Tests: Async startup transaction
// ---------------------------------------------------------------------------

describe("executeCalibrationStartupTransaction", () => {
  it("successful activation exactly once", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    const events: string[] = [];
    let acquisitionResolved = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        events.push("startAcquisition");
        acquisitionResolved = true;
      },
      stopDetector: () => {
        events.push("stopDetector");
      },
      getDetectorStatus: () => {
        events.push("getDetectorStatus");
        return "acquiring";
      },
      now: () => {
        events.push("now");
        assert.ok(acquisitionResolved, "now() must be called after acquisition resolves");
        return 1000;
      },
      startController: (controller, nowMs) => {
        assert.strictEqual(controller, configuredController);
        events.push("startController");
        assert.ok(acquisitionResolved, "startController must be called after acquisition");
        assert.strictEqual(nowMs, 1000);
        return buildMockController("capturing_start");
      },
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "active");
    assert.deepStrictEqual(events, [
      "startAcquisition",
      "getDetectorStatus",
      "now",
      "startController",
    ]);
  });

  it("startController not called before acquisition resolves", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let acquisitionResolved = false;
    let startControllerCalled = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        assert.ok(!startControllerCalled, "startController must not be called before acquisition");
        acquisitionResolved = true;
      },
      stopDetector: () => {},
      getDetectorStatus: () => "acquiring",
      now: () => 1000,
      startController: () => {
        startControllerCalled = true;
        assert.ok(acquisitionResolved, "acquisition must resolve first");
        return buildMockController("capturing_start");
      },
    };

    await executeCalibrationStartupTransaction(gate, gen, configuredController, deps);
    assert.ok(startControllerCalled);
  });

  it("now not called before acquisition resolves", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let acquisitionResolved = false;
    let nowCalled = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        assert.ok(!nowCalled, "now() must not be called before acquisition");
        acquisitionResolved = true;
      },
      stopDetector: () => {},
      getDetectorStatus: () => "acquiring",
      now: () => {
        nowCalled = true;
        assert.ok(acquisitionResolved, "acquisition must resolve first");
        return 1000;
      },
      startController: () => buildMockController("capturing_start"),
    };

    await executeCalibrationStartupTransaction(gate, gen, configuredController, deps);
    assert.ok(nowCalled);
  });

  it("acquiring status required", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    const deps: StartupDependencies = {
      startAcquisition: async () => {},
      stopDetector: () => {},
      getDetectorStatus: () => "running", // Wrong status
      now: () => 1000,
      startController: () => buildMockController("capturing_start"),
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "failed");
    if (result.kind === "failed") {
      assert.ok(result.error.includes("acquiring"));
    }
  });

  it("fresh now occurs after acquisition", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    const timeline: string[] = [];

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        timeline.push("acquisition_resolved");
      },
      stopDetector: () => {},
      getDetectorStatus: () => {
        timeline.push("status_checked");
        return "acquiring";
      },
      now: () => {
        timeline.push("now_captured");
        return 1000;
      },
      startController: () => {
        timeline.push("controller_started");
        return buildMockController("capturing_start");
      },
    };

    await executeCalibrationStartupTransaction(gate, gen, configuredController, deps);

    assert.deepStrictEqual(timeline, [
      "acquisition_resolved",
      "status_checked",
      "now_captured",
      "controller_started",
    ]);
  });

  it("stale post-acquisition returns stale", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        // Invalidate while acquisition in flight
        invalidateCalibrationRuntime(gate);
      },
      stopDetector: () => {
        throw new Error("stale must not call stopDetector");
      },
      getDetectorStatus: () => {
        throw new Error("stale must not call getDetectorStatus");
      },
      now: () => {
        throw new Error("stale must not call now");
      },
      startController: () => {
        throw new Error("stale must not call startController");
      },
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "stale");
  });

  it("stale calls no status/now/startController/stop", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    const calls: string[] = [];

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        invalidateCalibrationRuntime(gate);
      },
      stopDetector: () => {
        calls.push("stopDetector");
      },
      getDetectorStatus: () => {
        calls.push("getDetectorStatus");
        return "acquiring";
      },
      now: () => {
        calls.push("now");
        return 1000;
      },
      startController: () => {
        calls.push("startController");
        return buildMockController("capturing_start");
      },
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "stale");
    assert.strictEqual(calls.length, 0);
  });

  it("current acquisition reject stops detector", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let stopCalled = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        throw new Error("acquisition_failed");
      },
      stopDetector: () => {
        stopCalled = true;
      },
      getDetectorStatus: () => "acquiring",
      now: () => 1000,
      startController: () => buildMockController("capturing_start"),
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "failed");
    assert.ok(stopCalled);
  });

  it("stale acquisition reject does not stop detector", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let stopCalled = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        invalidateCalibrationRuntime(gate); // Become stale
        throw new Error("acquisition_failed");
      },
      stopDetector: () => {
        stopCalled = true;
      },
      getDetectorStatus: () => "acquiring",
      now: () => 1000,
      startController: () => buildMockController("capturing_start"),
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "stale");
    assert.ok(!stopCalled);
  });

  it("wrong status while current stops detector", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let stopCalled = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {},
      stopDetector: () => {
        stopCalled = true;
      },
      getDetectorStatus: () => "error", // Wrong status
      now: () => 1000,
      startController: () => buildMockController("capturing_start"),
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "failed");
    assert.ok(stopCalled);
  });

  it("current controller-start throw stops detector", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let stopCalled = false;

    const deps: StartupDependencies = {
      startAcquisition: async () => {},
      stopDetector: () => {
        stopCalled = true;
      },
      getDetectorStatus: () => "acquiring",
      now: () => 1000,
      startController: () => {
        throw new Error("controller_start_failed");
      },
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "failed");
    assert.ok(stopCalled);
  });

  it("stale failure cannot stop newer detector", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen1 = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let stopCallCount = 0;

    const deps: StartupDependencies = {
      startAcquisition: async () => {
        // Simulate newer start taking ownership
        invalidateCalibrationRuntime(gate); // gen: 1→2, owner: 1→null
        const gen2 = tryBeginCalibrationStartup(gate); // gen: 2→3, owner: null→3
        assert.strictEqual(gen2, 3);
        throw new Error("old_acquisition_failed");
      },
      stopDetector: () => {
        stopCallCount++;
      },
      getDetectorStatus: () => "acquiring",
      now: () => 1000,
      startController: () => buildMockController("capturing_start"),
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen1,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "stale");
    assert.strictEqual(stopCallCount, 0); // Must not stop newer detector
    assert.strictEqual(gate.startupOwner, 3); // Newer owner preserved
  });
  it("stale after controller start does not stop newer detector", async () => {
    const gate = createCalibrationRuntimeGate();
    const gen1 = tryBeginCalibrationStartup(gate)!;
    const configuredController = buildMockController("configured");

    let stopCallCount = 0;

    const deps: StartupDependencies = {
      startAcquisition: async () => {},
      stopDetector: () => {
        stopCallCount++;
      },
      getDetectorStatus: () => "acquiring",
      now: () => 1000,
      startController: () => {
        invalidateCalibrationRuntime(gate);
        const gen2 = tryBeginCalibrationStartup(gate);
        assert.strictEqual(gen2, 3);
        return buildMockController("capturing_start");
      },
    };

    const result = await executeCalibrationStartupTransaction(
      gate,
      gen1,
      configuredController,
      deps,
    );

    assert.strictEqual(result.kind, "stale");
    assert.strictEqual(stopCallCount, 0);
    assert.strictEqual(gate.startupOwner, 3);
  });
});
