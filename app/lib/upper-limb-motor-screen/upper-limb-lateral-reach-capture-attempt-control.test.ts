/**
 * Run:
 *   npx tsx --test app/lib/upper-limb-motor-screen/upper-limb-lateral-reach-capture-attempt-control.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { LateralReachCameraSnapshot } from "@/app/lib/cv/lateral-reach-camera-detector";
import type { LateralReachRuntimeSnapshot } from "@/app/lib/upper-limb-motor-screen/lateral-reach-engine";
import type { UpperLimbMovementAttemptResult } from "@/app/lib/upper-limb-motor-screen/types";
import {
  canClinicianFinishLateralReachAttempt,
  CLINICIAN_LATERAL_REACH_PREVIEW_MIRROR_TRANSFORM,
  formatLateralReachPatientArmLabel,
  getPatientCalibrationFailureMessage,
  isLateralReachPatientPositionReady,
  resolveLateralReachPatientMovementStatus,
  resolveLateralReachPatientPositionStatus,
  resolveLateralReachTrackingGuidance,
  shouldAdvanceClinicianAttemptResult,
  shouldAutoFinalizeLateralReachPatientAttempt,
} from "./upper-limb-lateral-reach-capture-attempt-control";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function engineSnapshot(
  overrides: Partial<LateralReachRuntimeSnapshot> = {},
): LateralReachRuntimeSnapshot {
  return {
    attemptIndex: 0,
    phase: "outbound",
    terminal: false,
    hasActivePause: false,
    targetReached: false,
    dwellConfirmed: false,
    returnToStartCompleted: false,
    protectivePauseCount: 0,
    ...overrides,
  };
}

function attemptResult(
  overrides: Partial<UpperLimbMovementAttemptResult> = {},
): UpperLimbMovementAttemptResult {
  return {
    attemptIndex: 0,
    taskId: "lateralReach",
    testedSide: "right",
    startedAtMs: 0,
    completedAtMs: 1000,
    completionState: "incomplete",
    targetReached: false,
    dwellConfirmed: false,
    returnToStartCompleted: false,
    reachTimeMs: null,
    returnTimeMs: null,
    totalMovementTimeMs: null,
    normalizedPathLength: null,
    pathEfficiency: null,
    peakShoulderAngleDeg: null,
    peakElbowExtensionDeg: null,
    trunkDisplacementObserved: null,
    withinConfiguredLimitThroughout: null,
    trackingQualitySummary: "unknown",
    protectivePauseCount: 0,
    protectivePauseDurationMs: 0,
    protectivePauseEvents: [],
    factualNotes: [],
    ...overrides,
  };
}

describe("canClinicianFinishLateralReachAttempt", () => {
  it("blocks Finish during awaiting_readiness", () => {
    assert.equal(
      canClinicianFinishLateralReachAttempt(
        "running",
        engineSnapshot({ phase: "awaiting_readiness" }),
      ),
      false,
    );
  });

  it("blocks Finish during ready_confirmed_awaiting_onset", () => {
    assert.equal(
      canClinicianFinishLateralReachAttempt(
        "running",
        engineSnapshot({ phase: "ready_confirmed_awaiting_onset" }),
      ),
      false,
    );
  });

  it("allows Finish during outbound after movement onset", () => {
    assert.equal(
      canClinicianFinishLateralReachAttempt("running", engineSnapshot({ phase: "outbound" })),
      true,
    );
  });

  it("blocks Finish when the engine is already terminal", () => {
    assert.equal(
      canClinicianFinishLateralReachAttempt(
        "running",
        engineSnapshot({ phase: "outbound", terminal: true }),
      ),
      false,
    );
  });

  it("blocks Finish when the detector is not running", () => {
    assert.equal(
      canClinicianFinishLateralReachAttempt(
        "acquiring",
        engineSnapshot({ phase: "outbound" }),
      ),
      false,
    );
  });
});

describe("shouldAdvanceClinicianAttemptResult", () => {
  it("rejects not_started results from advancing to review/save", () => {
    assert.equal(
      shouldAdvanceClinicianAttemptResult(
        attemptResult({ completionState: "not_started" }),
      ),
      false,
    );
  });

  it("allows incomplete results after real movement onset", () => {
    assert.equal(
      shouldAdvanceClinicianAttemptResult(
        attemptResult({ completionState: "incomplete" }),
      ),
      true,
    );
  });
});

describe("clinician capture shell wiring", () => {
  it("uses visual-only scaleX(-1) on the visible canvas preview", () => {
    const source = readFileSync(
      join(
        ROOT,
        "app/components/clinician/upper-limb-motor-screen/UpperLimbLateralReachCaptureSession.tsx",
      ),
      "utf8",
    );
    assert.equal(CLINICIAN_LATERAL_REACH_PREVIEW_MIRROR_TRANSFORM, "scaleX(-1)");
    assert.match(source, /CLINICIAN_LATERAL_REACH_PREVIEW_MIRROR_TRANSFORM/);
    assert.match(source, /absolute inset-0 h-full w-full object-cover opacity-0/);
    assert.match(source, /absolute inset-0 h-full w-full object-cover/);
    assert.match(source, /variant === "patient"/);

    const patientPage = readFileSync(
      join(ROOT, "app/patient/assessment/[token]/page.tsx"),
      "utf8",
    );
    assert.match(patientPage, /variant="patient"/);
    assert.match(patientPage, /submitRemoteUlmsSessionResult/);
    assert.doesNotMatch(source, /Finish Test/);
    assert.doesNotMatch(source, /canEndAttemptWindow/);
    assert.match(source, /canClinicianFinishLateralReachAttempt/);
    assert.match(source, /shouldAdvanceClinicianAttemptResult/);
  });
});

describe("resolveLateralReachTrackingGuidance", () => {
  it("prompts for framing when no pose signal is available", () => {
    const message = resolveLateralReachTrackingGuidance(
      {
        status: "acquiring",
        initPhase: null,
        error: null,
        engineSnapshot: null,
        rightWristVisibility: null,
        leftWristVisibility: null,
        rightWristCoords: null,
        leftWristCoords: null,
        testedSide: "right",
        expectedHorizontalDirectionSign: null,
        lastCommandType: null,
        lastCommandStatus: null,
        lastCommandRejectionReason: null,
        readinessArmed: false,
        readinessArmedTimeRemaining: null,
        finalResult: null,
      },
      "right",
    );
    assert.match(message ?? "", /upper body/i);
  });

  it("returns null when tested wrist visibility is sufficient", () => {
    const message = resolveLateralReachTrackingGuidance(
      {
        status: "acquiring",
        initPhase: null,
        error: null,
        engineSnapshot: null,
        rightWristVisibility: 0.9,
        leftWristVisibility: 0.2,
        rightWristCoords: { x: 0.3, y: 0.5 },
        leftWristCoords: null,
        testedSide: "right",
        expectedHorizontalDirectionSign: null,
        lastCommandType: null,
        lastCommandStatus: null,
        lastCommandRejectionReason: null,
        readinessArmed: false,
        readinessArmedTimeRemaining: null,
        finalResult: null,
      },
      "right",
    );
    assert.equal(message, null);
  });
});

function acquiringSnapshot(
  overrides: Partial<LateralReachCameraSnapshot> = {},
): LateralReachCameraSnapshot {
  return {
    status: "acquiring",
    initPhase: null,
    error: null,
    engineSnapshot: null,
    rightWristVisibility: 0.9,
    leftWristVisibility: 0.2,
    rightWristCoords: { x: 0.3, y: 0.5 },
    leftWristCoords: null,
    testedSide: "right",
    expectedHorizontalDirectionSign: null,
    lastCommandType: null,
    lastCommandStatus: null,
    lastCommandRejectionReason: null,
    readinessArmed: false,
    readinessArmedTimeRemaining: null,
    finalResult: null,
    ...overrides,
  };
}

describe("patient lateral reach copy", () => {
  it("formats arm labels for patient instructions", () => {
    assert.equal(formatLateralReachPatientArmLabel("right"), "right arm");
    assert.equal(formatLateralReachPatientArmLabel("left"), "left arm");
  });

  it("reports position detected when tracking is ready", () => {
    assert.equal(
      resolveLateralReachPatientPositionStatus(acquiringSnapshot(), "right"),
      "Position detected",
    );
    assert.equal(isLateralReachPatientPositionReady(acquiringSnapshot(), "right"), true);
  });

  it("auto-finalizes when return to start is confirmed by the engine", () => {
    assert.equal(
      shouldAutoFinalizeLateralReachPatientAttempt(
        engineSnapshot({
          phase: "completed_pending_finalization",
          returnToStartCompleted: true,
        }),
      ),
      true,
    );
    assert.equal(
      shouldAutoFinalizeLateralReachPatientAttempt(
        engineSnapshot({ phase: "returning", returnToStartCompleted: false }),
      ),
      false,
    );
  });

  it("maps engine phases to patient movement guidance", () => {
    assert.equal(
      resolveLateralReachPatientMovementStatus({
        snapshot: acquiringSnapshot({
          status: "running",
          engineSnapshot: engineSnapshot({ phase: "outbound" }),
        }),
        testedSide: "right",
        calibrationPhase: null,
        testStarted: true,
        movementActive: true,
      }),
      "Raise your right arm to the side",
    );
    assert.equal(
      resolveLateralReachPatientMovementStatus({
        snapshot: acquiringSnapshot({
          status: "running",
          engineSnapshot: engineSnapshot({ phase: "dwelling" }),
        }),
        testedSide: "right",
        calibrationPhase: null,
        testStarted: true,
        movementActive: true,
      }),
      "Keep going to your maximum comfortable reach",
    );
    assert.equal(
      resolveLateralReachPatientMovementStatus({
        snapshot: acquiringSnapshot({
          status: "running",
          engineSnapshot: engineSnapshot({ phase: "returning" }),
        }),
        testedSide: "right",
        calibrationPhase: null,
        testStarted: true,
        movementActive: true,
      }),
      "Now return your right arm to the starting position",
    );
  });
});
