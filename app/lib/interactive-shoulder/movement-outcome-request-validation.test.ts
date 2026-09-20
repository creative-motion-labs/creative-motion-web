/**
 * Run:
 *   npx tsx --test app/lib/interactive-shoulder/movement-outcome-request-validation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateInteractiveShoulderMovementOutcomeRequest } from "./movement-outcome-request-validation";

const PLAN_SESSION_ID = "33333333-3333-3333-3333-333333333333";

function blockResult(overrides: Record<string, unknown> = {}) {
  return {
    blockId: "block-1",
    movementId: "shoulder-abduction-reach",
    startedAtMs: 1000,
    completedAtMs: 5000,
    completionReason: "validRepetitions",
    interaction: {
      targetsContacted: 8,
      patternsCompleted: 2,
      timingSamplesMs: [420, 480],
      responseConsistency: 0.82,
      participationDurationSeconds: 40,
    },
    measured: {
      validRepetitions: 8,
      invalidRepetitions: 1,
      rangeValuesDegrees: [92, 95],
      holdDurationSeconds: 2.5,
      movementSpeed: 0.6,
      returnControl: 0.7,
      trackingConfidence: 0.9,
    },
    interpreted: {
      compensationEvents: 1,
      asymmetryObservations: [],
      fatigueTrend: "stable",
      reducedControl: false,
      trackingLimitations: [],
    },
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    planSessionId: PLAN_SESSION_ID,
    sessionState: "completed",
    totalElapsedSeconds: 180,
    blocksCompleted: 1,
    blocksTotal: 1,
    blockResults: [blockResult()],
    ...overrides,
  };
}

describe("validateInteractiveShoulderMovementOutcomeRequest", () => {
  it("accepts a valid, realistic request body", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(validBody());
    assert.equal(result.ok, true, result.ok ? undefined : result.detail);
  });

  it("non-object body -> invalid_request_body", () => {
    assert.equal(validateInteractiveShoulderMovementOutcomeRequest(null).ok, false);
    assert.equal(validateInteractiveShoulderMovementOutcomeRequest("x").ok, false);
    assert.equal(validateInteractiveShoulderMovementOutcomeRequest([]).ok, false);
  });

  it("rejects an unknown top-level field", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ extraField: "nope" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_request_body");
  });

  for (const forbidden of ["prescribedSide", "providerId", "patientId", "planId", "id"]) {
    it(`rejects attacker-supplied ${forbidden} — never accepted from the request body`, () => {
      const result = validateInteractiveShoulderMovementOutcomeRequest(
        validBody({ [forbidden]: "attacker-value" }),
      );
      assert.equal(result.ok, false);
    });
  }

  it("missing/malformed planSessionId -> invalid_plan_session_id", () => {
    assert.equal(
      validateInteractiveShoulderMovementOutcomeRequest(validBody({ planSessionId: "not-a-uuid" })).ok,
      false,
    );
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ planSessionId: "not-a-uuid" }),
    );
    if (!result.ok) assert.equal(result.reason, "invalid_plan_session_id");
  });

  it("a well-formed but mid-session sessionState is accepted at the shape layer — eligibility is the assembler's job", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ sessionState: "active" }),
    );
    assert.equal(result.ok, true);
  });

  it("an unknown sessionState string -> invalid_session_state", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ sessionState: "finished" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_session_state");
  });

  it("negative totalElapsedSeconds -> invalid_elapsed_seconds", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ totalElapsedSeconds: -5 }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_elapsed_seconds");
  });

  it("blocksCompleted greater than blocksTotal -> invalid_block_counts", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ blocksCompleted: 4, blocksTotal: 2 }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_block_counts");
  });

  it("blockResults not an array -> invalid_block_results", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ blockResults: "nope" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_block_results");
  });

  it("a malformed nested measured field -> invalid_block_results with a pointed detail", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({
        blockResults: [blockResult({ measured: { validRepetitions: "eight" } })],
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_block_results");
      assert.ok(result.detail?.includes("measured"));
    }
  });

  it("an invalid completionReason is rejected", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ blockResults: [blockResult({ completionReason: "invented_reason" })] }),
    );
    assert.equal(result.ok, false);
  });

  it("a null completionReason is accepted (block still in progress at capture time is representable)", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ blockResults: [blockResult({ completionReason: null, completedAtMs: null })] }),
    );
    assert.equal(result.ok, true, result.ok ? undefined : result.detail);
  });

  it("an invalid fatigueTrend is rejected", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({
        blockResults: [blockResult({ interpreted: { ...blockResult().interpreted, fatigueTrend: "exhausted" } })],
      }),
    );
    assert.equal(result.ok, false);
  });

  it("preserves the real fields through on success — never fabricates or drops a value", () => {
    const body = validBody();
    const result = validateInteractiveShoulderMovementOutcomeRequest(body);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.planSessionId, PLAN_SESSION_ID);
    assert.equal(result.input.sessionState, "completed");
    assert.equal(result.input.blockResults.length, 1);
    assert.equal(result.input.blockResults[0].measured.validRepetitions, 8);
  });

  it("blockType/title are optional — a body without either still validates (existing block payloads stay valid)", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(validBody());
    assert.equal(result.ok, true, result.ok ? undefined : result.detail);
    if (!result.ok) return;
    assert.equal(result.input.blockResults[0].blockType, undefined);
    assert.equal(result.input.blockResults[0].title, undefined);
  });

  for (const blockType of ["movement-target", "movement-pattern", "instructional"]) {
    it(`accepts and preserves a real blockType: "${blockType}"`, () => {
      const result = validateInteractiveShoulderMovementOutcomeRequest(
        validBody({ blockResults: [blockResult({ blockType, title: "Some Block" })] }),
      );
      assert.equal(result.ok, true, result.ok ? undefined : result.detail);
      if (!result.ok) return;
      assert.equal(result.input.blockResults[0].blockType, blockType);
      assert.equal(result.input.blockResults[0].title, "Some Block");
    });
  }

  it("an unrecognized blockType is rejected — never silently accepted or dropped", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ blockResults: [blockResult({ blockType: "some-future-block-type" })] }),
    );
    assert.equal(result.ok, false);
  });

  it("a non-string title is rejected", () => {
    const result = validateInteractiveShoulderMovementOutcomeRequest(
      validBody({ blockResults: [blockResult({ title: 12345 })] }),
    );
    assert.equal(result.ok, false);
  });
});
