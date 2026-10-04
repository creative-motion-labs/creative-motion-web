import type { TargetHitEvent } from "./types";

export type TargetContactConsumptionState = {
  consumedTargetIds: Set<string>;
};

export function createTargetContactConsumptionState(): TargetContactConsumptionState {
  return { consumedTargetIds: new Set<string>() };
}

export function resetTargetContactConsumptionState(state: TargetContactConsumptionState): void {
  state.consumedTargetIds.clear();
}

export function isTargetContactAlreadyConsumed(
  state: TargetContactConsumptionState,
  targetId: string,
): boolean {
  return state.consumedTargetIds.has(targetId);
}

export function markTargetContactConsumed(
  state: TargetContactConsumptionState,
  targetId: string,
): void {
  state.consumedTargetIds.add(targetId);
}

export function logOrchestratorCvTargetContactDev(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[orchestrator-cv-target-contact:${tag}]`, payload);
}

export type TargetContactTickOutcome = {
  /** Contact to forward to session input, demo callbacks, HUD, and adaptive — at most once per targetId. */
  contactToProcess: TargetHitEvent | null;
  skippedDuplicate: boolean;
};

/**
 * Ensures one lifecycle `targetContact` produces one downstream handling pass even if
 * dispatch reports the same target again while the wrist remains in the hit zone.
 */
export function resolveTargetContactForTick(
  state: TargetContactConsumptionState,
  contact: TargetHitEvent | null | undefined,
  context: { renderSeq: number },
): TargetContactTickOutcome {
  if (!contact) {
    return { contactToProcess: null, skippedDuplicate: false };
  }
  const targetId = contact.targetId;
  if (isTargetContactAlreadyConsumed(state, targetId)) {
    logOrchestratorCvTargetContactDev("skip-duplicate", {
      targetId,
      renderSeq: context.renderSeq,
    });
    return { contactToProcess: null, skippedDuplicate: true };
  }
  markTargetContactConsumed(state, targetId);
  logOrchestratorCvTargetContactDev("process", {
    targetId,
    renderSeq: context.renderSeq,
  });
  return { contactToProcess: contact, skippedDuplicate: false };
}
