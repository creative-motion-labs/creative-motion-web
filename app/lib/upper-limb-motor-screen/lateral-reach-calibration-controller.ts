/**
 * Lateral Reach — Slice 11: single-attempt one-shot calibration controller.
 *
 * Pure composition root for one pre-movement attempt:
 * Slice 10 plan → Slice 8 intention → start capture → endpoint capture →
 * Slice 6 result assembly (with Slice 9 technical parameters).
 *
 * Ends at LateralReachCalibrationResult or explicit controller cancellation.
 *
 * Does NOT own camera, engine, adapter, tracking/timing, persistence, UI,
 * retries, reset, numeric defaults, or clinical interpretation.
 */

import type { NormalizedPoint } from "@/app/lib/interactive-shoulder/types";
import {
  createLateralReachEndpointCaptureState,
  updateLateralReachEndpointCapture,
  validateLateralReachEndpointCaptureConfig,
  type LateralReachEndpointCaptureConfig,
  type LateralReachEndpointCaptureState,
} from "@/app/lib/interaction-calibration/lateral-reach/endpoint-capture";
import { assembleLateralReachCalibrationResult } from "@/app/lib/interaction-calibration/lateral-reach/result-assembly";
import {
  createLateralReachStartCaptureState,
  updateLateralReachStartCapture,
  validateLateralReachStartCaptureConfig,
  type LateralReachStartCaptureConfig,
  type LateralReachStartCaptureSample,
  type LateralReachStartCaptureState,
} from "@/app/lib/interaction-calibration/lateral-reach/start-capture";
import {
  createLateralReachCalibrationNoiseFloor,
  createLateralReachCalibrationZoneRadii,
  type LateralReachCalibrationZoneRadii,
} from "@/app/lib/interaction-calibration/lateral-reach/technical-parameters";
import type {
  LateralReachCalibrationResult,
  LateralReachNoiseFloorConfig,
} from "@/app/lib/interaction-calibration/lateral-reach/types";
import type { LateralReachCalibrationAttemptIntention } from "@/app/lib/interaction-calibration/lateral-reach/attempt-intention";
import { resolveLateralReachCalibrationAttemptIntentionFromPlan } from "@/app/lib/upper-limb-motor-screen/lateral-reach-attempt-plan";
import {
  isValidUpperLimbSide,
  type UpperLimbSide,
} from "@/app/lib/upper-limb-motor-screen/types";

export type LateralReachCalibrationControllerInput = {
  readonly testedSide: unknown;
  readonly plan: unknown;
  readonly startCaptureConfig: unknown;
  readonly endpointCaptureConfig: unknown;
  readonly noiseFloor: unknown;
  readonly zoneRadii: unknown;
};

export type LateralReachCalibrationControllerSample = LateralReachStartCaptureSample;

export type LateralReachCalibrationControllerOutcome =
  | {
      readonly kind: "result";
      readonly result: LateralReachCalibrationResult;
    }
  | {
      readonly kind: "cancelled";
    };

export type LateralReachCalibrationSampleDisposition =
  | "applied"
  | "ignored_terminal";

type ControllerConfig = {
  readonly testedSide: UpperLimbSide;
  readonly intention: LateralReachCalibrationAttemptIntention;
  readonly startCaptureConfig: LateralReachStartCaptureConfig;
  readonly endpointCaptureConfig: LateralReachEndpointCaptureConfig;
  readonly noiseFloor: LateralReachNoiseFloorConfig;
  readonly zoneRadii: LateralReachCalibrationZoneRadii;
};

export type LateralReachCalibrationControllerState =
  | (ControllerConfig & {
      readonly phase: "configured";
    })
  | (ControllerConfig & {
      readonly phase: "capturing_start";
      readonly startCaptureState: LateralReachStartCaptureState;
    })
  | (ControllerConfig & {
      readonly phase: "capturing_endpoint";
      readonly startWrist: NormalizedPoint;
      readonly endpointCaptureState: LateralReachEndpointCaptureState;
    })
  | (ControllerConfig & {
      readonly phase: "terminal";
      readonly outcome: LateralReachCalibrationControllerOutcome;
    });

function configFields(state: ControllerConfig): ControllerConfig {
  return {
    testedSide: state.testedSide,
    intention: state.intention,
    startCaptureConfig: state.startCaptureConfig,
    endpointCaptureConfig: state.endpointCaptureConfig,
    noiseFloor: state.noiseFloor,
    zoneRadii: state.zoneRadii,
  };
}

/**
 * Eager fail-closed mint of all externally-owned attempt configuration.
 * Validation order is locked: side → plan → start config → endpoint config →
 * zone radii → noise floor.
 */
export function createLateralReachCalibrationController(
  input: LateralReachCalibrationControllerInput,
): LateralReachCalibrationControllerState {
  if (!isValidUpperLimbSide(input.testedSide)) {
    throw new RangeError('testedSide must be exactly "left" or "right"');
  }

  const intention = resolveLateralReachCalibrationAttemptIntentionFromPlan(
    input.plan,
  );

  const startValidation = validateLateralReachStartCaptureConfig(
    input.startCaptureConfig,
  );
  if (!startValidation.ok) {
    throw new RangeError(startValidation.reason);
  }

  const endpointValidation = validateLateralReachEndpointCaptureConfig(
    input.endpointCaptureConfig,
  );
  if (!endpointValidation.ok) {
    throw new RangeError(endpointValidation.reason);
  }

  const zoneRadii = createLateralReachCalibrationZoneRadii(input.zoneRadii);
  const noiseFloor = createLateralReachCalibrationNoiseFloor(input.noiseFloor);

  return {
    phase: "configured",
    testedSide: input.testedSide,
    intention,
    startCaptureConfig: startValidation.config,
    endpointCaptureConfig: endpointValidation.config,
    noiseFloor,
    zoneRadii,
  };
}

export function startLateralReachCalibrationAttempt(
  state: LateralReachCalibrationControllerState,
  nowMs: number,
): LateralReachCalibrationControllerState {
  if (state.phase !== "configured") {
    throw new RangeError(
      "calibration attempt can only be started from configured state",
    );
  }

  const startCaptureState = createLateralReachStartCaptureState(
    nowMs,
    state.startCaptureConfig,
  );

  return {
    ...configFields(state),
    phase: "capturing_start",
    startCaptureState,
  };
}

export function submitLateralReachCalibrationSample(
  state: LateralReachCalibrationControllerState,
  sample: LateralReachCalibrationControllerSample,
): {
  state: LateralReachCalibrationControllerState;
  disposition: LateralReachCalibrationSampleDisposition;
} {
  if (state.phase === "configured") {
    throw new RangeError("calibration samples require an active capture state");
  }

  if (state.phase === "terminal") {
    return { state, disposition: "ignored_terminal" };
  }

  if (state.phase === "capturing_start") {
    const update = updateLateralReachStartCapture(
      state.startCaptureState,
      sample,
    );

    if (update.status === "collecting") {
      return {
        state: {
          ...configFields(state),
          phase: "capturing_start",
          startCaptureState: update.state,
        },
        disposition: "applied",
      };
    }

    if (update.status === "failed") {
      const result = assembleLateralReachCalibrationResult({
        testedSide: state.testedSide,
        stage: "start_failed",
        failureReasons: update.failureReasons,
      });
      return {
        state: {
          ...configFields(state),
          phase: "terminal",
          outcome: { kind: "result", result },
        },
        disposition: "applied",
      };
    }

    // status === "captured"
    const endpointCaptureState = createLateralReachEndpointCaptureState(
      sample.atMs,
      update.startWrist,
      state.endpointCaptureConfig,
    );

    return {
      state: {
        ...configFields(state),
        phase: "capturing_endpoint",
        startWrist: update.startWrist,
        endpointCaptureState,
      },
      disposition: "applied",
    };
  }

  // phase === "capturing_endpoint"
  const update = updateLateralReachEndpointCapture(
    state.endpointCaptureState,
    sample,
  );

  if (update.status === "collecting") {
    return {
      state: {
        ...configFields(state),
        phase: "capturing_endpoint",
        startWrist: state.startWrist,
        endpointCaptureState: update.state,
      },
      disposition: "applied",
    };
  }

  if (update.status === "failed") {
    const result = assembleLateralReachCalibrationResult({
      testedSide: state.testedSide,
      stage: "endpoint_failed",
      startWrist: state.startWrist,
      failureReasons: update.failureReasons,
    });
    return {
      state: {
        ...configFields(state),
        phase: "terminal",
        outcome: { kind: "result", result },
      },
      disposition: "applied",
    };
  }

  // status === "captured"
  const result = assembleLateralReachCalibrationResult({
    testedSide: state.testedSide,
    stage: "captured",
    startWrist: state.startWrist,
    heldEndpoint: update.heldEndpoint,
    intention: state.intention,
    noiseFloor: state.noiseFloor,
    zoneRadii: state.zoneRadii,
  });

  return {
    state: {
      ...configFields(state),
      phase: "terminal",
      outcome: { kind: "result", result },
    },
    disposition: "applied",
  };
}

export function cancelLateralReachCalibrationAttempt(
  state: LateralReachCalibrationControllerState,
): LateralReachCalibrationControllerState {
  if (
    state.phase !== "capturing_start" &&
    state.phase !== "capturing_endpoint"
  ) {
    throw new RangeError(
      "calibration attempt can only be cancelled while capture is active",
    );
  }

  return {
    ...configFields(state),
    phase: "terminal",
    outcome: { kind: "cancelled" },
  };
}

export function getLateralReachCalibrationOutcome(
  state: LateralReachCalibrationControllerState,
): LateralReachCalibrationControllerOutcome | null {
  if (state.phase !== "terminal") {
    return null;
  }
  return state.outcome;
}
