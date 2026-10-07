/**
 * Run:
 *   npx tsx --test app/lib/interactive-shoulder/movement-outcome-assembler.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleInteractiveShoulderMovementOutcomeSnapshot,
  type AssembleInteractiveShoulderMovementOutcomeInput,
} from "./movement-outcome-assembler";
import { INTERACTIVE_SHOULDER_MOVEMENT_OUTCOME_SCHEMA_VERSION } from "./movement-outcome-types";
import type { MovementBlockResult } from "@/app/lib/session-orchestrator/types";

const PLAN_SESSION_ID = "33333333-3333-3333-3333-333333333333";

function blockResult(overrides: Partial<MovementBlockResult> = {}): MovementBlockResult {
  return {
    blockId: "block-1",
    movementId: "shoulder-abduction-reach",
    startedAtMs: 1000,
    completedAtMs: 5000,
    completionReason: "validRepetitions",
    interaction: {
      targetsContacted: 8,
      patternsCompleted: 2,
      timingSamplesMs: [420, 480, 510],
      responseConsistency: 0.82,
      participationDurationSeconds: 40,
    },
    measured: {
      validRepetitions: 8,
      invalidRepetitions: 1,
      rangeValuesDegrees: [92, 95, 97],
      holdDurationSeconds: 2.5,
      movementSpeed: 0.6,
      returnControl: 0.7,
      trackingConfidence: 0.9,
    },
    interpreted: {
      compensationEvents: 1,
      asymmetryObservations: ["slight trunk lean on rep 4"],
      fatigueTrend: "stable",
      reducedControl: false,
      trackingLimitations: [],
    },
    ...overrides,
  };
}

function validInput(
  overrides: Partial<AssembleInteractiveShoulderMovementOutcomeInput> = {},
): AssembleInteractiveShoulderMovementOutcomeInput {
  return {
    planSessionId: PLAN_SESSION_ID,
    prescribedSide: "right",
    sessionState: "completed",
    totalElapsedSeconds: 180,
    blocksCompleted: 3,
    blocksTotal: 3,
    blockResults: [blockResult()],
    ...overrides,
  };
}

describe("assembleInteractiveShoulderMovementOutcomeSnapshot", () => {
  it("round-trips every field faithfully for a completed session", () => {
    const input = validInput();
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.snapshot.planSessionId, PLAN_SESSION_ID);
    assert.equal(result.snapshot.prescribedSide, "right");
    assert.equal(result.snapshot.sessionState, "completed");
    assert.equal(result.snapshot.totalElapsedSeconds, 180);
    assert.equal(result.snapshot.blocksCompleted, 3);
    assert.equal(result.snapshot.blocksTotal, 3);
    assert.deepEqual(result.snapshot.blockResults, input.blockResults);
    assert.equal(result.snapshot.schemaVersion, INTERACTIVE_SHOULDER_MOVEMENT_OUTCOME_SCHEMA_VERSION);
  });

  it("rejects a stopped session — MVP contract requires full completion, corrected per review", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({ sessionState: "stopped", blocksCompleted: 1, blocksTotal: 3 }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "session_not_eligible_for_outcome");
  });

  it("rejects cancelled/errored/safety-held sessions the same way — no partial-session persistence path exists", () => {
    for (const sessionState of ["error", "safetyHold", "paused"] as const) {
      const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
        validInput({ sessionState }),
      );
      assert.equal(result.ok, false, `sessionState "${sessionState}" must be rejected`);
      if (result.ok) continue;
      assert.equal(result.reason, "session_not_eligible_for_outcome");
    }
  });

  it("preserves a null prescribedSide (session not unilaterally prescribed) — never defaults to a side", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({ prescribedSide: null }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.snapshot.prescribedSide, null);
  });

  it("deep-copies block results — mutating the input after assembly does not affect the snapshot", () => {
    const input = validInput();
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    input.blockResults[0].interaction.timingSamplesMs.push(9999);
    input.blockResults[0].measured.rangeValuesDegrees.push(180);
    assert.deepEqual(result.snapshot.blockResults[0].interaction.timingSamplesMs, [420, 480, 510]);
    assert.deepEqual(result.snapshot.blockResults[0].measured.rangeValuesDegrees, [92, 95, 97]);
  });

  it("rejects every mid-session/in-progress sessionState — never produces a snapshot for an unfinished session", () => {
    const midSession = [
      "idle",
      "preparing",
      "calibrating",
      "ready",
      "active",
      "resting",
      "transitioning",
      "paused",
      "safetyHold",
    ] as const;
    for (const sessionState of midSession) {
      const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
        validInput({ sessionState }),
      );
      assert.equal(result.ok, false, `sessionState "${sessionState}" must be rejected`);
      if (result.ok) continue;
      assert.equal(result.reason, "session_not_eligible_for_outcome");
    }
  });

  it("rejects the error state — a runtime failure must not become a persisted outcome", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({ sessionState: "error" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "session_not_eligible_for_outcome");
  });

  it("rejects a blank planSessionId", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({ planSessionId: "" }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_plan_session_id");
  });

  it("rejects a negative totalElapsedSeconds", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({ totalElapsedSeconds: -1 }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_elapsed_seconds");
  });

  it("rejects blocksCompleted greater than blocksTotal", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({ blocksCompleted: 5, blocksTotal: 3 }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid_block_counts");
  });

  it("carries blockType/title through unchanged — the block-level copy is a deep spread, not a hand-picked field list", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(
      validInput({
        blockResults: [blockResult({ blockType: "instructional", title: "Warm-up" })],
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.snapshot.blockResults[0].blockType, "instructional");
    assert.equal(result.snapshot.blockResults[0].title, "Warm-up");
  });

  it("does not invent any clinical score/interpretation field on the assembled snapshot", () => {
    const result = assembleInteractiveShoulderMovementOutcomeSnapshot(validInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const keys = Object.keys(result.snapshot).sort();
    assert.deepEqual(keys, [
      "blockResults",
      "blocksCompleted",
      "blocksTotal",
      "planSessionId",
      "prescribedSide",
      "schemaVersion",
      "sessionState",
      "totalElapsedSeconds",
    ]);
  });
});
