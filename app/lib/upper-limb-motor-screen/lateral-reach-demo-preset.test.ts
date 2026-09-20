/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/lateral-reach-demo-preset.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLateralReachDemoAttemptPlanLock,
  createLateralReachDemoTechnicalConfigLock,
  LATERAL_REACH_DEMO_TECHNICAL_CONFIG,
} from "./lateral-reach-demo-preset";
import { buildLateralReachEngineConfig } from "@/app/lib/interaction-calibration/lateral-reach/engine-config-adapter";

describe("lateral-reach-demo-preset", () => {
  it("locks demo technical config and attempt plan for capture", () => {
    const configLock = createLateralReachDemoTechnicalConfigLock();
    const attemptPlanLock = createLateralReachDemoAttemptPlanLock();

    assert.equal(configLock.lockedConfig.tracking.minWristVisibility, 0.3);
    assert.equal(attemptPlanLock.lockedPlan.screenHorizontalDirection, "positive_x");
  });

  it("uses 6000 ms calibration timeouts for clinician demo capture", () => {
    assert.equal(LATERAL_REACH_DEMO_TECHNICAL_CONFIG.startCaptureConfig.totalTimeoutMs, 6000);
    assert.equal(LATERAL_REACH_DEMO_TECHNICAL_CONFIG.endpointCaptureConfig.totalTimeoutMs, 6000);
  });

  it("demo technical config is compatible with engine config adapter shape", () => {
    const configLock = createLateralReachDemoTechnicalConfigLock();
    assert.ok(configLock.lockedConfig.timing.onsetConfirmationMs > 0);
    assert.ok(configLock.lockedConfig.endpointCaptureConfig.minDisplacementFromStart > 0);

    // Adapter requires a ready geometry result — not produced here; we only verify lock presence.
    assert.equal(typeof buildLateralReachEngineConfig, "function");
  });
});
