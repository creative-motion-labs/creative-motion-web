/**
 * Clinician demo preset for Lateral Reach live capture.
 * Locks the same structured values used by lab validation fixtures — not production policy.
 */

import {
  lockLateralReachLabAttemptPlan,
  type LabAttemptPlanLock,
} from "@/app/clinician/lateral-reach-camera-lab/attempt-plan-intake";
import {
  lockLateralReachLabTechnicalConfig,
  type LabTechnicalConfigLock,
} from "@/app/clinician/lateral-reach-camera-lab/technical-config-intake";

/** Demo-only technical configuration for in-clinic lateral reach observation. */
export const LATERAL_REACH_DEMO_TECHNICAL_CONFIG = {
  startCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 10,
    totalTimeoutMs: 6000,
  },
  endpointCaptureConfig: {
    minStableDurationMs: 500,
    maxJitterRadius: 0.02,
    minStableSampleCount: 10,
    totalTimeoutMs: 6000,
    minDisplacementFromStart: 0.15,
  },
  zoneRadii: {
    startingZoneRadius: 0.05,
    fixedTargetRadius: 0.05,
  },
  noiseFloor: {
    minDirectionAlignedMagnitude: 0.08,
  },
  tracking: {
    minWristVisibility: 0.3,
    maxAllowedGapMs: 300,
  },
  timing: {
    onsetConfirmationMs: 100,
    dwellDurationMs: 200,
    returnConfirmationMs: 150,
  },
} as const;

export const LATERAL_REACH_DEMO_SCREEN_HORIZONTAL_DIRECTION = "positive_x" as const;

export function createLateralReachDemoTechnicalConfigLock(): LabTechnicalConfigLock {
  return lockLateralReachLabTechnicalConfig(LATERAL_REACH_DEMO_TECHNICAL_CONFIG);
}

export function createLateralReachDemoAttemptPlanLock(): LabAttemptPlanLock {
  return lockLateralReachLabAttemptPlan(LATERAL_REACH_DEMO_SCREEN_HORIZONTAL_DIRECTION);
}
