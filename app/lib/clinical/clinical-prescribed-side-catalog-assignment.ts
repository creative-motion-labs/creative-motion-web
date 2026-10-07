/**
 * Stable catalog assignment idempotency and in-flight guards (C2 safety fix).
 * Pure logic — safe to unit test without rendering.
 */
import type { CatalogPlanSessionPayloadRow } from "@/app/lib/clinical/clinical-prescribed-side-plan-draft";

export type CatalogAssignmentFingerprintInput = {
  patientId: string;
  treatmentProgramId: string;
  assessmentId: string | null;
  sessionPrescriptions: readonly CatalogPlanSessionPayloadRow[];
};

/** Deterministic fingerprint for one logical catalog assignment attempt. */
export function buildCatalogAssignmentFingerprint(
  input: CatalogAssignmentFingerprintInput,
): string {
  const sorted = [...input.sessionPrescriptions].sort(
    (a, b) => a.sessionNumber - b.sessionNumber,
  );
  const sessionPart = sorted
    .map((row) => `${row.sessionNumber}:${row.prescribedSide}`)
    .join(",");
  const assessment = input.assessmentId ?? "";
  return [
    `patient=${input.patientId}`,
    `program=${input.treatmentProgramId}`,
    `assessment=${assessment}`,
    `sessions=${sessionPart}`,
  ].join("|");
}

export type CatalogAssignmentAttemptBeginResult =
  | { ok: true; requestId: string; generation: number }
  | { ok: false; reason: "in_flight" };

export type CatalogAssignmentAttemptState = {
  fingerprint: string | null;
  requestId: string | null;
  inFlight: boolean;
  generation: number;
};

export type CatalogAssignmentAttemptController = {
  beginSubmitAttempt: (fingerprint: string) => CatalogAssignmentAttemptBeginResult;
  completeSuccess: (fingerprint: string) => void;
  completeFailure: () => void;
  completeConflict: () => void;
  resetAssignmentKey: () => void;
  resetAll: () => void;
  invalidateGeneration: () => number;
  isInFlight: () => boolean;
  getGeneration: () => number;
  getState: () => CatalogAssignmentAttemptState;
};

export function createCatalogAssignmentAttemptController(options?: {
  generateUuid?: () => string;
}): CatalogAssignmentAttemptController {
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

  function beginSubmitAttempt(currentFingerprint: string): CatalogAssignmentAttemptBeginResult {
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
