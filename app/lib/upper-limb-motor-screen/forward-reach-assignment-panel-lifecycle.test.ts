/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/forward-reach-assignment-panel-lifecycle.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyForwardReachAssignmentUi,
  resetForwardReachAssignmentUiForPatientChange,
  shouldIgnoreForwardReachAssignmentResult,
} from "./forward-reach-assignment-panel-lifecycle";

describe("forward-reach-assignment-panel-lifecycle", () => {
  it("9. patient change reset clears form, success, and error state", () => {
    const empty = createEmptyForwardReachAssignmentUi();
    const reset = resetForwardReachAssignmentUiForPatientChange();
    assert.deepEqual(reset.form, empty.form);
    assert.deepEqual(reset.fieldErrors, []);
    assert.equal(reset.submitError, null);
    assert.equal(reset.submitting, false);
    assert.equal(reset.created, null);
  });

  it("10. late Patient A responses are ignored after scope or generation change", () => {
    assert.equal(
      shouldIgnoreForwardReachAssignmentResult({
        scopeAtStart: 1,
        currentScope: 2,
        generationAtStart: 0,
        currentGeneration: 0,
        aborted: false,
      }),
      true,
    );
    assert.equal(
      shouldIgnoreForwardReachAssignmentResult({
        scopeAtStart: 1,
        currentScope: 1,
        generationAtStart: 0,
        currentGeneration: 1,
        aborted: false,
      }),
      true,
    );
    assert.equal(
      shouldIgnoreForwardReachAssignmentResult({
        scopeAtStart: 1,
        currentScope: 1,
        generationAtStart: 0,
        currentGeneration: 0,
        aborted: true,
      }),
      true,
    );
    assert.equal(
      shouldIgnoreForwardReachAssignmentResult({
        scopeAtStart: 1,
        currentScope: 1,
        generationAtStart: 0,
        currentGeneration: 0,
        aborted: false,
      }),
      false,
    );
  });
});
