/**
 * Run:
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/session-result-request-validation.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateUpperLimbMotorScreenSessionResultRequest } from "./session-result-request-validation";
import type {
  ClinicalStopEvent,
  ProtectivePauseEvent,
  UpperLimbMovementAttemptResult,
  UpperLimbTaskCompletionSummary,
} from "./types";

const ASSIGNMENT_ID = "11111111-1111-1111-1111-111111111111";

function makePauseEvent(overrides: Partial<ProtectivePauseEvent> = {}): ProtectivePauseEvent {
  return {
    reason: { category: "tracking_or_environment", detail: "wrist_landmark_lost" },
    startedAtMs: 100,
    endedAtMs: 400,
    outcome: "resumed",
    readinessConfirmedAt: "2026-08-17T00:00:00.000Z",
    resumedBy: "clinician",
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<UpperLimbMovementAttemptResult> = {}): UpperLimbMovementAttemptResult {
  return {
    attemptIndex: 0,
    taskId: "lateralReach",
    testedSide: "right",
    startedAtMs: 0,
    completedAtMs: 1000,
    completionState: "completed",
    targetReached: true,
    dwellConfirmed: true,
    returnToStartCompleted: true,
    reachTimeMs: 400,
    returnTimeMs: 400,
    totalMovementTimeMs: 1000,
    normalizedPathLength: 0.3,
    pathEfficiency: 0.9,
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

function makeClinicalStopEvent(overrides: Partial<ClinicalStopEvent> = {}): ClinicalStopEvent {
  return {
    reason: "patient_requested_stop",
    recordedAt: "2026-08-17T00:00:00.000Z",
    recordedBy: "patient",
    reviewRequired: true,
    ...overrides,
  };
}

function makeTaskCompletion(overrides: Partial<UpperLimbTaskCompletionSummary> = {}): UpperLimbTaskCompletionSummary {
  return {
    taskId: "lateralReach",
    testedSide: "right",
    completionState: "completed",
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    assignmentId: ASSIGNMENT_ID,
    taskCompletion: [makeTaskCompletion()],
    attempts: [makeAttempt()],
    clinicalStopEvents: [],
    overallTrackingQuality: "unknown",
    longestPauseGapMs: 0,
    trunkCompensationObserved: null,
    asymmetryNotes: [],
    ...overrides,
  };
}

describe("validateUpperLimbMotorScreenSessionResultRequest — valid requests", () => {
  it("accepts a minimal valid body", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(validBody());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.input.assignmentId, ASSIGNMENT_ID);
      assert.equal(result.input.attempts.length, 1);
    }
  });

  it("accepts a body with populated clinicalStopEvents and asymmetryNotes", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({
        clinicalStopEvents: [makeClinicalStopEvent()],
        asymmetryNotes: ["left shoulder elevated during reach"],
        attempts: [makeAttempt({ protectivePauseEvents: [makePauseEvent()], protectivePauseCount: 1 })],
      }),
    );
    assert.equal(result.ok, true);
  });

  it("never accepts id or status from the request — they are not part of the returned input", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ id: "attacker-supplied-id", status: "finalized" }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(!("id" in result.input));
      assert.ok(!("status" in result.input));
    }
  });

  it("does not require non-empty attempts or taskCompletion (assembler's own policy-neutral stance)", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ attempts: [], taskCompletion: [] }),
    );
    assert.equal(result.ok, true);
  });
});

describe("validateUpperLimbMotorScreenSessionResultRequest — rejections", () => {
  it("rejects a non-object body", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest("not-an-object");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_request_body");
  });

  it("rejects a missing assignmentId", () => {
    const { assignmentId: _drop, ...rest } = validBody();
    const result = validateUpperLimbMotorScreenSessionResultRequest(rest);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_assignment_id");
  });

  it("rejects a non-UUID assignmentId", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ assignmentId: "not-a-uuid" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_assignment_id");
  });

  it("rejects an invalid taskCompletion entry", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ taskCompletion: [{ taskId: "not-a-task", testedSide: "right", completionState: "completed" }] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_completion");
  });

  it("rejects attempts that are not an array", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(validBody({ attempts: "nope" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_attempt");
  });

  it("rejects an attempt missing a required numeric field", () => {
    const badAttempt = { ...makeAttempt(), attemptIndex: "zero" };
    const result = validateUpperLimbMotorScreenSessionResultRequest(validBody({ attempts: [badAttempt] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_attempt");
  });

  it("rejects an attempt with an invalid nested protectivePauseEvent", () => {
    // Deliberately runtime-invalid — cast past the closed-union type so the
    // validator's own rejection is what's under test, not the compiler's.
    const badAttempt = makeAttempt({
      protectivePauseEvents: [
        { ...makePauseEvent(), outcome: "not-a-real-outcome" } as unknown as ProtectivePauseEvent,
      ],
    });
    const result = validateUpperLimbMotorScreenSessionResultRequest(validBody({ attempts: [badAttempt] }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_attempt");
  });

  it("rejects a clinicalStopEvent with reviewRequired !== true", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ clinicalStopEvents: [{ ...makeClinicalStopEvent(), reviewRequired: false }] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_clinical_stop_event");
  });

  it("rejects an invalid overallTrackingQuality", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ overallTrackingQuality: "excellent" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_overall_tracking_quality");
  });

  it("rejects a non-numeric longestPauseGapMs", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ longestPauseGapMs: "zero" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_longest_pause_gap_ms");
  });

  it("rejects a non-boolean/non-null trunkCompensationObserved", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ trunkCompensationObserved: "yes" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_trunk_compensation_observed");
  });

  it("rejects a non-string-array asymmetryNotes", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ asymmetryNotes: [1, 2, 3] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_asymmetry_notes");
  });

  it("rejects forbidden safety-vocabulary keys anywhere in the payload", () => {
    const result = validateUpperLimbMotorScreenSessionResultRequest(
      validBody({ clinicianInterpretation: "looks fine" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "forbidden_safety_vocabulary");
  });
});
