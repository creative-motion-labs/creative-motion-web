/**
 * Stable Forward Reach assignment idempotency and in-flight guards.
 * Pure logic — safe to unit test without rendering.
 */

export type ForwardReachAssignmentAttemptBeginResult =
  | { ok: true; requestId: string; generation: number }
  | { ok: false; reason: "in_flight" };

export type ForwardReachAssignmentAttemptState = {
  fingerprint: string | null;
  requestId: string | null;
  inFlight: boolean;
  generation: number;
};

export type ForwardReachAssignmentAttemptController = {
  beginSubmitAttempt: (fingerprint: string) => ForwardReachAssignmentAttemptBeginResult;
  completeSuccess: (fingerprint: string) => void;
  completeFailure: () => void;
  completeConflict: () => void;
  resetAssignmentKey: () => void;
  resetAll: () => void;
  invalidateGeneration: () => number;
  isInFlight: () => boolean;
  getGeneration: () => number;
  getState: () => ForwardReachAssignmentAttemptState;
};

export function createForwardReachAssignmentAttemptController(options?: {
  generateUuid?: () => string;
}): ForwardReachAssignmentAttemptController {
  const generateUuid = options?.generateUuid ?? (() => crypto.randomUUID());

  let fingerprint: string | null = null;
  let requestId: string | null = null;
  let inFlight = false;
  let generation = 0;

  function invalidateGeneration(): number {
    generation += 1;
    return generation;
  }

  function resetAssignmentKey(): void {
    fingerprint = null;
    requestId = null;
  }

  function resetAll(): void {
    resetAssignmentKey();
    inFlight = false;
    invalidateGeneration();
  }

  function beginSubmitAttempt(currentFingerprint: string): ForwardReachAssignmentAttemptBeginResult {
    if (inFlight) {
      return { ok: false, reason: "in_flight" };
    }
    inFlight = true;
    if (fingerprint !== currentFingerprint || requestId === null) {
      fingerprint = currentFingerprint;
      requestId = generateUuid();
    }
    return { ok: true, requestId, generation };
  }

  function completeSuccess(currentFingerprint: string): void {
    if (fingerprint === currentFingerprint) {
      resetAssignmentKey();
    }
    inFlight = false;
  }

  function completeFailure(): void {
    inFlight = false;
  }

  function completeConflict(): void {
    inFlight = false;
  }

  return {
    beginSubmitAttempt,
    completeSuccess,
    completeFailure,
    completeConflict,
    resetAssignmentKey,
    resetAll,
    invalidateGeneration,
    isInFlight: () => inFlight,
    getGeneration: () => generation,
    getState: () => ({ fingerprint, requestId, inFlight, generation }),
  };
}
