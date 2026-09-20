/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/forward-reach-assignment-idempotency.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildForwardReachAssignmentFingerprint,
} from "./assignment-request-payload";
import {
  buildForwardReachAssignmentCreatePayload,
  createEmptyForwardReachAssignmentForm,
  type ForwardReachAssignmentFormState,
} from "./forward-reach-assignment-client";
import { createForwardReachAssignmentAttemptController } from "./forward-reach-assignment-idempotency";

const PATIENT_A = "11111111-1111-1111-1111-111111111111";
const PATIENT_B = "22222222-2222-2222-2222-222222222222";

function validForm(overrides: Partial<ForwardReachAssignmentFormState> = {}): ForwardReachAssignmentFormState {
  return {
    ...createEmptyForwardReachAssignmentForm(),
    affectedSide: "right",
    testedSide: "right",
    startingSittingPosition: "chair_with_armrests",
    backTrunkSupport: "full_back_support",
    affectedArmSupport: "armrest",
    baselinePainScore: "2",
    permittedMovementRangeKind: "not_applicable",
    permittedMovementRangeDescription: "",
    caregiverSupervisionRequirement: "not_required",
    deliveryMode: "in_clinic",
    patientSpecificStopCriteria: "",
    eligible: true,
    attempts: "5",
    restPeriodSeconds: "30",
    targetDirection: "forward",
    targetHeight: "shoulder height",
    targetDistance: "arm's length",
    ...overrides,
  };
}

function fingerprintFor(patientId: string, form: ForwardReachAssignmentFormState = validForm()) {
  const payload = buildForwardReachAssignmentCreatePayload(patientId, form);
  assert.ok(payload);
  return buildForwardReachAssignmentFingerprint(payload);
}

describe("forward-reach-assignment-idempotency", () => {
  it("1. lost successful response followed by retry reuses the request ID", () => {
    const ids: string[] = [];
    const controller = createForwardReachAssignmentAttemptController({
      generateUuid: () => {
        ids.push(`uuid-${ids.length + 1}`);
        return `uuid-${ids.length}`;
      },
    });
    const fp = fingerprintFor(PATIENT_A);
    const first = controller.beginSubmitAttempt(fp);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    controller.completeFailure();
    const retry = controller.beginSubmitAttempt(fp);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(first.requestId, retry.requestId);
    assert.equal(ids.length, 1);
  });

  it("2. retryable failure retains the request ID", () => {
    const controller = createForwardReachAssignmentAttemptController({
      generateUuid: () => "stable-uuid",
    });
    const fp = fingerprintFor(PATIENT_A);
    controller.beginSubmitAttempt(fp);
    controller.completeFailure();
    const retry = controller.beginSubmitAttempt(fp);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.requestId, "stable-uuid");
  });

  it("3. confirmed success clears the request ID", () => {
    const controller = createForwardReachAssignmentAttemptController({
      generateUuid: () => "stable-uuid",
    });
    const fp = fingerprintFor(PATIENT_A);
    controller.beginSubmitAttempt(fp);
    controller.completeSuccess(fp);
    assert.equal(controller.getState().requestId, null);
    assert.equal(controller.getState().fingerprint, null);
  });

  it("4. meaningful payload or patient change mints a new ID", () => {
    let counter = 0;
    const controller = createForwardReachAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const fpA = fingerprintFor(PATIENT_A);
    const fpB = fingerprintFor(PATIENT_B);
    const fpChangedSide = fingerprintFor(PATIENT_A, validForm({ testedSide: "left" }));

    const a = controller.beginSubmitAttempt(fpA);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    controller.completeFailure();

    const b = controller.beginSubmitAttempt(fpB);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.notEqual(a.requestId, b.requestId);

    controller.completeFailure();
    const changed = controller.beginSubmitAttempt(fpChangedSide);
    assert.equal(changed.ok, true);
    if (!changed.ok) return;
    assert.notEqual(b.requestId, changed.requestId);
  });

  it("8. rapid double-submit blocks the second attempt", () => {
    const controller = createForwardReachAssignmentAttemptController();
    const fp = fingerprintFor(PATIENT_A);
    const first = controller.beginSubmitAttempt(fp);
    assert.equal(first.ok, true);
    const second = controller.beginSubmitAttempt(fp);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.reason, "in_flight");
  });

  it("11. not_applicable omits description from fingerprint", () => {
    const withHiddenDescription = fingerprintFor(
      PATIENT_A,
      validForm({
        permittedMovementRangeKind: "not_applicable",
        permittedMovementRangeDescription: "should-not-affect-fingerprint",
      }),
    );
    const withoutDescription = fingerprintFor(
      PATIENT_A,
      validForm({
        permittedMovementRangeKind: "not_applicable",
        permittedMovementRangeDescription: "",
      }),
    );
    assert.equal(withHiddenDescription, withoutDescription);
  });

  it("13. sequential bilateral assignments use different keys after success", () => {
    let counter = 0;
    const controller = createForwardReachAssignmentAttemptController({
      generateUuid: () => `uuid-${++counter}`,
    });
    const right = fingerprintFor(PATIENT_A, validForm({ testedSide: "right" }));
    const left = fingerprintFor(PATIENT_A, validForm({ testedSide: "left" }));

    const first = controller.beginSubmitAttempt(right);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    controller.completeSuccess(right);

    const second = controller.beginSubmitAttempt(left);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.notEqual(first.requestId, second.requestId);
  });
});
