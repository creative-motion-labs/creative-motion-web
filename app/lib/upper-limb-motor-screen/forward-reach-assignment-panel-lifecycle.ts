/**
 * Pure guards for Forward Reach assignment panel lifecycle (patient scope / generation).
 */

import type { ForwardReachAssignmentCreateSuccess } from "./forward-reach-assignment-client";
import type { ForwardReachAssignmentFormState, ForwardReachFormFieldError } from "./forward-reach-assignment-client";
import { createEmptyForwardReachAssignmentForm } from "./forward-reach-assignment-client";

export function shouldIgnoreForwardReachAssignmentResult(options: {
  scopeAtStart: number;
  currentScope: number;
  generationAtStart: number;
  currentGeneration: number;
  aborted: boolean;
}): boolean {
  if (options.aborted) return true;
  if (options.scopeAtStart !== options.currentScope) return true;
  if (options.generationAtStart !== options.currentGeneration) return true;
  return false;
}

export type ForwardReachAssignmentUiSnapshot = {
  form: ForwardReachAssignmentFormState;
  fieldErrors: ForwardReachFormFieldError[];
  submitError: string | null;
  submitting: boolean;
  created: ForwardReachAssignmentCreateSuccess | null;
};

export function createEmptyForwardReachAssignmentUi(): ForwardReachAssignmentUiSnapshot {
  return {
    form: createEmptyForwardReachAssignmentForm(),
    fieldErrors: [],
    submitError: null,
    submitting: false,
    created: null,
  };
}

export function resetForwardReachAssignmentUiForPatientChange(): ForwardReachAssignmentUiSnapshot {
  return createEmptyForwardReachAssignmentUi();
}
