/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/types.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findForbiddenSafetyVocabularyKeys,
  isCompletionStateConsistentWithEvents,
  isSafetyVocabularyFree,
  isValidClinicalStopReason,
  isValidClinicalStopReportedByRole,
  isValidProtectivePauseReason,
  isValidProtectivePauseResumeActor,
  isValidUpperLimbAttemptCompletionState,
  isValidUpperLimbClinicianReviewOutcome,
  isValidUpperLimbMotorScreenClinicianReview,
  isValidUpperLimbSide,
  isValidUpperLimbTaskId,
  validateUpperLimbMotorScreenSessionResultSafety,
} from "@/app/lib/upper-limb-motor-screen/types";

describe("closed-enum guards", () => {
  it("accepts left and right as valid sides, rejects bilateral", () => {
    assert.equal(isValidUpperLimbSide("left"), true);
    assert.equal(isValidUpperLimbSide("right"), true);
    assert.equal(isValidUpperLimbSide("bilateral"), false);
    assert.equal(isValidUpperLimbSide("unknown"), false);
  });

  it("accepts the three defined task ids only", () => {
    assert.equal(isValidUpperLimbTaskId("forwardReach"), true);
    assert.equal(isValidUpperLimbTaskId("lateralReach"), true);
    assert.equal(isValidUpperLimbTaskId("elbowExtension"), true);
    assert.equal(isValidUpperLimbTaskId("handToMouth"), false);
  });

  it("accepts only the approved review outcomes", () => {
    assert.equal(isValidUpperLimbClinicianReviewOutcome("approved"), true);
    assert.equal(isValidUpperLimbClinicianReviewOutcome("approved_with_limitations"), true);
    assert.equal(isValidUpperLimbClinicianReviewOutcome("rejected"), true);
    assert.equal(isValidUpperLimbClinicianReviewOutcome("insufficient_data"), true);
    assert.equal(isValidUpperLimbClinicianReviewOutcome("automatically_approved"), false);
  });

  it("accepts only the approved completion states", () => {
    for (const state of [
      "completed",
      "incomplete",
      "interrupted",
      "stopped",
      "not_assessable",
      "not_started",
    ]) {
      assert.equal(isValidUpperLimbAttemptCompletionState(state), true);
    }
    assert.equal(isValidUpperLimbAttemptCompletionState("technical_pause"), false);
    assert.equal(isValidUpperLimbAttemptCompletionState("paused"), false);
  });

  it("accepts every approved clinical-stop reason", () => {
    const reasons = [
      "new_or_sudden_neurological_symptoms",
      "new_severe_or_increasing_pain",
      "chest_pain",
      "unusual_shortness_of_breath",
      "severe_dizziness_or_loss_of_consciousness",
      "loss_of_sitting_balance",
      "inability_to_follow_instructions",
      "patient_requested_stop",
      "clinician_or_caregiver_safety_concern",
      "escalated_from_configured_limit_review",
    ];
    for (const reason of reasons) {
      assert.equal(isValidClinicalStopReason(reason), true);
    }
    assert.equal(isValidClinicalStopReason("tracking_loss"), false);
  });

  it("accepts only patient, clinician, caregiver as clinical-stop reporters", () => {
    assert.equal(isValidClinicalStopReportedByRole("patient"), true);
    assert.equal(isValidClinicalStopReportedByRole("clinician"), true);
    assert.equal(isValidClinicalStopReportedByRole("caregiver"), true);
    assert.equal(isValidClinicalStopReportedByRole("system"), false);
  });

  it("accepts tracking_or_environment and configured_limit protective-pause reasons", () => {
    assert.equal(
      isValidProtectivePauseReason({ category: "tracking_or_environment", detail: "wrist_landmark_lost" }),
      true,
    );
    assert.equal(
      isValidProtectivePauseReason({ category: "configured_limit", detail: "configured_limit_exceeded" }),
      true,
    );
    assert.equal(
      isValidProtectivePauseReason({ category: "configured_limit", detail: "tracking_lost" }),
      false,
    );
    assert.equal(
      isValidProtectivePauseReason({ category: "clinical", detail: "chest_pain" }),
      false,
    );
  });

  it("never allows 'system' as a protective-pause resume actor", () => {
    assert.equal(isValidProtectivePauseResumeActor("patient"), true);
    assert.equal(isValidProtectivePauseResumeActor("clinician"), true);
    assert.equal(isValidProtectivePauseResumeActor("supervisor"), true);
    assert.equal(isValidProtectivePauseResumeActor("system"), false);
    assert.equal(isValidProtectivePauseResumeActor("auto"), false);
  });
});

describe("isValidUpperLimbMotorScreenClinicianReview", () => {
  it("accepts a pending review with no reviewed-only fields present", () => {
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "pending",
      }),
      true,
    );
  });

  it("rejects a pending review that carries reviewedBy, reviewedAt, or reviewOutcome", () => {
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "pending",
        reviewedBy: "dr-example",
      }),
      false,
    );
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "pending",
        reviewedAt: "2026-07-30T10:00:00.000Z",
      }),
      false,
    );
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "pending",
        reviewOutcome: "approved",
      }),
      false,
    );
  });

  it("requires reviewedBy, reviewedAt, and reviewOutcome when status is reviewed", () => {
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "reviewed",
        reviewedBy: "dr-example",
        reviewedAt: "2026-07-30T10:00:00.000Z",
        reviewOutcome: "approved",
      }),
      true,
    );

    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "reviewed",
        reviewedAt: "2026-07-30T10:00:00.000Z",
        reviewOutcome: "approved",
      }),
      false,
    );
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "reviewed",
        reviewedBy: "dr-example",
        reviewOutcome: "approved",
      }),
      false,
    );
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "reviewed",
        reviewedBy: "dr-example",
        reviewedAt: "2026-07-30T10:00:00.000Z",
      }),
      false,
    );
  });

  it("accepts every approved reviewOutcome when reviewed", () => {
    for (const reviewOutcome of [
      "approved",
      "approved_with_limitations",
      "rejected",
      "insufficient_data",
    ]) {
      assert.equal(
        isValidUpperLimbMotorScreenClinicianReview({
          id: "review-1",
          sessionResultId: "result-1",
          status: "reviewed",
          reviewedBy: "dr-example",
          reviewedAt: "2026-07-30T10:00:00.000Z",
          reviewOutcome,
        }),
        true,
      );
    }
  });

  it("rejects an invalid reviewOutcome even when the other reviewed fields are present", () => {
    assert.equal(
      isValidUpperLimbMotorScreenClinicianReview({
        id: "review-1",
        sessionResultId: "result-1",
        status: "reviewed",
        reviewedBy: "dr-example",
        reviewedAt: "2026-07-30T10:00:00.000Z",
        reviewOutcome: "cleared",
      }),
      false,
    );
  });
});

describe("isCompletionStateConsistentWithEvents", () => {
  it("requires stopped whenever a clinical stop touched the attempt", () => {
    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "stopped",
        hasClinicalStop: true,
        hasRuntimeInterruption: false,
      }),
      true,
    );
    for (const completionState of [
      "completed",
      "incomplete",
      "interrupted",
      "not_assessable",
      "not_started",
    ] as const) {
      assert.equal(
        isCompletionStateConsistentWithEvents({
          completionState,
          hasClinicalStop: true,
          hasRuntimeInterruption: false,
        }),
        false,
      );
    }
  });

  it("requires interrupted for an unexpected non-clinical termination, regardless of task", () => {
    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "interrupted",
        hasClinicalStop: false,
        hasRuntimeInterruption: true,
      }),
      true,
    );
    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "not_assessable",
        hasClinicalStop: false,
        hasRuntimeInterruption: true,
      }),
      false,
    );
  });

  it("does not constrain completion state when only protective pauses occurred", () => {
    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "completed",
        hasClinicalStop: false,
        hasRuntimeInterruption: false,
      }),
      true,
    );
    assert.equal(
      isCompletionStateConsistentWithEvents({
        completionState: "not_assessable",
        hasClinicalStop: false,
        hasRuntimeInterruption: false,
      }),
      true,
    );
  });
});

function validSessionResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-result-1",
    assignmentId: "assignment-1",
    status: "finalized",
    taskCompletion: [{ taskId: "forwardReach", testedSide: "right", completionState: "completed" }],
    attempts: [
      {
        attemptIndex: 0,
        taskId: "forwardReach",
        testedSide: "right",
        startedAtMs: 0,
        completedAtMs: 1200,
        completionState: "completed",
        targetReached: true,
        dwellConfirmed: true,
        returnToStartCompleted: true,
        reachTimeMs: 600,
        returnTimeMs: 600,
        totalMovementTimeMs: 1200,
        normalizedPathLength: 0.4,
        pathEfficiency: 0.9,
        peakShoulderAngleDeg: 70,
        peakElbowExtensionDeg: 160,
        trunkDisplacementObserved: false,
        withinConfiguredLimitThroughout: true,
        trackingQualitySummary: "good",
        protectivePauseCount: 0,
        protectivePauseDurationMs: 0,
        protectivePauseEvents: [],
        factualNotes: [],
      },
    ],
    technicalTrackingQuality: {
      overallQuality: "good",
      protectivePauseCount: 0,
      protectivePauseDurationMsTotal: 0,
      longestPauseGapMs: 0,
    },
    interruptions: {
      clinicalStopEvents: [],
      protectivePauseEvents: [],
    },
    observedMovementFeatures: {
      trunkCompensationObserved: false,
      asymmetryNotes: [],
    },
    ...overrides,
  };
}

describe("validateUpperLimbMotorScreenSessionResultSafety", () => {
  it("accepts a valid, realistic CV session result", () => {
    const result = validateUpperLimbMotorScreenSessionResultSafety(validSessionResult());
    assert.equal(result.ok, true);
  });

  it("rejects diagnosis at the top level", () => {
    const payload = validSessionResult({ diagnosis: "stroke" });
    const result = validateUpperLimbMotorScreenSessionResultSafety(payload);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.forbiddenKeyPaths.includes("diagnosis"));
  });

  it("rejects fmaScore nested inside an attempt object", () => {
    const payload = validSessionResult();
    (payload.attempts[0] as Record<string, unknown>).fmaScore = 3;
    const result = validateUpperLimbMotorScreenSessionResultSafety(payload);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.forbiddenKeyPaths.some((path) => path.includes("fmaScore")));
    }
  });

  it("rejects recommendation inside an array item", () => {
    const payload = validSessionResult();
    (payload.attempts[0] as Record<string, unknown>).recommendation = "progress to next level";
    const result = validateUpperLimbMotorScreenSessionResultSafety(payload);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.forbiddenKeyPaths.some((path) => path.includes("recommendation")));
    }
  });

  it("rejects clinicianInterpretation nested in the result", () => {
    const payload = validSessionResult({
      observedMovementFeatures: {
        trunkCompensationObserved: false,
        asymmetryNotes: [],
        clinicianInterpretation: { note: "looks fine" },
      },
    });
    const result = validateUpperLimbMotorScreenSessionResultSafety(payload);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.forbiddenKeyPaths.some((path) => path.includes("clinicianInterpretation")));
    }
  });

  it("rejects clinicianReview nested in the result", () => {
    const payload = validSessionResult({
      interruptions: {
        clinicalStopEvents: [],
        protectivePauseEvents: [],
        clinicianReview: { status: "pending" },
      },
    });
    const result = validateUpperLimbMotorScreenSessionResultSafety(payload);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.forbiddenKeyPaths.some((path) => path.includes("clinicianReview")));
    }
  });

  it("does not mutate the input object", () => {
    const payload = validSessionResult();
    const snapshot = JSON.parse(JSON.stringify(payload));
    validateUpperLimbMotorScreenSessionResultSafety(payload);
    assert.deepEqual(payload, snapshot);
  });

  it("rejects non-object top-level candidates", () => {
    for (const candidate of [null, undefined, "a string", 42, []]) {
      const result = validateUpperLimbMotorScreenSessionResultSafety(candidate);
      assert.equal(result.ok, false, `expected ${JSON.stringify(candidate)} to be rejected`);
    }
  });
});

describe("safety vocabulary denylist", () => {
  it("is free of forbidden keys on a legitimate assignment-shaped payload", () => {
    const payload = {
      affectedSide: "right",
      configuration: { deliveryMode: "in_clinic" },
      taskAssignmentGroups: [{ taskId: "forwardReach", testedSide: "right" }],
    };
    assert.equal(isSafetyVocabularyFree(payload), true);
    assert.deepEqual(findForbiddenSafetyVocabularyKeys(payload), []);
  });

  it("does not false-positive on an approved clinical-stop reason value containing 'safety'", () => {
    const payload = {
      interruptions: {
        clinicalStopEvents: [
          {
            reason: "clinician_or_caregiver_safety_concern",
            recordedBy: "clinician",
            reviewRequired: true,
          },
        ],
      },
    };
    assert.equal(isSafetyVocabularyFree(payload), true);
  });

  it("flags forbidden automated-claim keys anywhere in a nested payload", () => {
    assert.equal(isSafetyVocabularyFree({ diagnosis: "stroke" }), false);
    assert.equal(isSafetyVocabularyFree({ fmaScore: 42 }), false);
    assert.equal(isSafetyVocabularyFree({ result: { totalScore: 10 } }), false);
    assert.equal(isSafetyVocabularyFree({ result: { spasticityGrade: "2" } }), false);
    assert.equal(isSafetyVocabularyFree({ clearance: "granted" }), false);
    assert.equal(isSafetyVocabularyFree({ nested: [{ recommendation: "progress" }] }), false);
    assert.equal(isSafetyVocabularyFree({ automaticProgression: true }), false);
  });
});
