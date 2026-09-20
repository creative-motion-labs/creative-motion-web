/**
 * Clinician plan-builder draft state and request payload mapping for prescribedSide (C2).
 * Pure logic — safe to unit test without rendering.
 */
import type { ClinicalPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side";
import type { StoredExercise } from "@/app/lib/exercise-prescription";
import { API_ERRORS } from "@/app/lib/api/safe-errors";
import {
  catalogSessionRequiresPrescribedSide,
  guidedSessionRequiresPrescribedSide,
} from "@/app/lib/clinical/clinical-prescribed-side-applicability";

export const PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE =
  "Side selection is temporarily unavailable. Please try again later.";

export const PRESCRIBED_SIDE_REQUIRED_MESSAGE =
  "Select a prescribed treatment side (Left or Right) for each Interactive Shoulder session.";

export const CATALOG_ASSIGNMENT_IDEMPOTENCY_CONFLICT_MESSAGE =
  "This assignment request conflicts with a previous submission. Review the patient's plans before retrying.";

export type SessionPrescribedSideDraft = ClinicalPrescribedSide | null | undefined;

export type GuidedPlanSessionDraftInput = {
  sessionNumber: number;
  title: string;
  exercises: readonly StoredExercise[];
  prescribedSide?: SessionPrescribedSideDraft;
};

export type CatalogPlanSessionDraftInput = {
  sessionNumber: number;
  title: string;
  blocks: readonly { movementId: string | null }[];
  prescribedSide?: SessionPrescribedSideDraft;
};

export type GuidedPlanSessionPayloadRow = {
  sessionNumber: number;
  title: string;
  exercises: unknown;
  prescribedSide?: ClinicalPrescribedSide;
};

export type CatalogPlanSessionPayloadRow = {
  sessionNumber: number;
  prescribedSide: ClinicalPrescribedSide;
};

export function formatPrescribedSideForReview(
  side: SessionPrescribedSideDraft,
): "Left" | "Right" | "Not specified" {
  if (side === "left") return "Left";
  if (side === "right") return "Right";
  return "Not specified";
}

export function isApplicableGuidedSession(
  session: Pick<GuidedPlanSessionDraftInput, "exercises">,
): boolean {
  return guidedSessionRequiresPrescribedSide(session.exercises);
}

export function isApplicableCatalogSession(
  session: Pick<CatalogPlanSessionDraftInput, "blocks">,
): boolean {
  return catalogSessionRequiresPrescribedSide(session.blocks);
}

/** Clears prescribedSide when the session no longer includes Interactive Shoulder. */
export function reconcileGuidedSessionPrescribedSide<T extends GuidedPlanSessionDraftInput>(
  session: T,
): T {
  if (!isApplicableGuidedSession(session)) {
    const next = { ...session };
    delete next.prescribedSide;
    return next;
  }
  return session;
}

export function reconcileCatalogSessionPrescribedSide<T extends CatalogPlanSessionDraftInput>(
  session: T,
): T {
  if (!isApplicableCatalogSession(session)) {
    const next = { ...session };
    delete next.prescribedSide;
    return next;
  }
  return session;
}

export type PrescribedSideSubmitValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateGuidedPrescribedSideDraftForSubmit(
  sessions: readonly GuidedPlanSessionDraftInput[],
): PrescribedSideSubmitValidationResult {
  for (const session of sessions) {
    if (!isApplicableGuidedSession(session)) continue;
    if (session.prescribedSide !== "left" && session.prescribedSide !== "right") {
      return { ok: false, error: PRESCRIBED_SIDE_REQUIRED_MESSAGE };
    }
  }
  return { ok: true };
}

export function validateCatalogPrescribedSideDraftForSubmit(
  sessions: readonly CatalogPlanSessionDraftInput[],
): PrescribedSideSubmitValidationResult {
  for (const session of sessions) {
    if (!isApplicableCatalogSession(session)) continue;
    if (session.prescribedSide !== "left" && session.prescribedSide !== "right") {
      return { ok: false, error: PRESCRIBED_SIDE_REQUIRED_MESSAGE };
    }
  }
  return { ok: true };
}

/**
 * Explicit allowlist mapper for POST /api/plans session rows.
 * Omits prescribedSide for non-applicable sessions and never sends null.
 */
export function buildGuidedPlanSessionsPayload(
  sessions: readonly GuidedPlanSessionDraftInput[],
): GuidedPlanSessionPayloadRow[] {
  return sessions.map((session) => {
    const row: GuidedPlanSessionPayloadRow = {
      sessionNumber: session.sessionNumber,
      title: session.title,
      exercises: session.exercises,
    };
    if (
      isApplicableGuidedSession(session) &&
      (session.prescribedSide === "left" || session.prescribedSide === "right")
    ) {
      row.prescribedSide = session.prescribedSide;
    }
    return row;
  });
}

/**
 * Explicit allowlist mapper for POST /api/plans/from-catalog-program sessions.
 * Includes only applicable sessions with validated left/right values.
 */
export function buildCatalogPlanSessionsPayload(
  sessions: readonly CatalogPlanSessionDraftInput[],
): CatalogPlanSessionPayloadRow[] {
  const payload: CatalogPlanSessionPayloadRow[] = [];
  for (const session of sessions) {
    if (!isApplicableCatalogSession(session)) continue;
    if (session.prescribedSide === "left" || session.prescribedSide === "right") {
      payload.push({
        sessionNumber: session.sessionNumber,
        prescribedSide: session.prescribedSide,
      });
    }
  }
  return payload;
}

export function mapPlanAssignHttpError(
  status: number,
  body: { error?: string },
): string {
  if (status === 409) {
    return CATALOG_ASSIGNMENT_IDEMPOTENCY_CONFLICT_MESSAGE;
  }
  if (status === 503 && body.error === API_ERRORS.SERVICE_UNAVAILABLE) {
    return PRESCRIBED_SIDE_UNAVAILABLE_MESSAGE;
  }
  return body.error ?? "Failed to assign plan.";
}

/** Rejects values that must not cross the UI mapper boundary. */
export function parseUiPrescribedSideSelection(
  value: unknown,
): ClinicalPrescribedSide | null {
  if (value === "left" || value === "right") {
    return value;
  }
  return null;
}
