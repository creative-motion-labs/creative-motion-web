/**
 * Therapist-prescribed unilateral treatment side for clinical plan sessions.
 *
 * Distinct from:
 * - assessment-observed/affected side (assessment structured_data.side)
 * - runtime-resolved Interactive Shoulder side (resolveInteractiveShoulderSide)
 * - volunteer protocol side (VOLUNTEER_PILOT_SIDE)
 * - camera/model laterality
 */

export const CLINICAL_PRESCRIBED_SIDES = ["left", "right"] as const;

export type ClinicalPrescribedSide = (typeof CLINICAL_PRESCRIBED_SIDES)[number];

export type ClinicalPrescribedSideValidationResult =
  | { ok: true; value: ClinicalPrescribedSide | null }
  | { ok: false; error: string };

const BILATERAL_REJECTION =
  "bilateral is not a valid prescribed side for unilateral clinical sessions.";
const INVALID_SIDE_REJECTION = "prescribedSide must be left or right.";

function isClinicalPrescribedSide(value: string): value is ClinicalPrescribedSide {
  return value === "left" || value === "right";
}

/**
 * Parses an optional therapist-authored prescribed side.
 * Missing/undefined/null → null (not yet explicitly prescribed).
 * Never coerces invalid values to right.
 */
export function parseClinicalPrescribedSide(
  value: unknown,
): ClinicalPrescribedSideValidationResult {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: INVALID_SIDE_REJECTION };
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, error: INVALID_SIDE_REJECTION };
  }

  if (trimmed === "bilateral") {
    return { ok: false, error: BILATERAL_REJECTION };
  }

  if (trimmed !== value) {
    return { ok: false, error: INVALID_SIDE_REJECTION };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "bilateral") {
    return { ok: false, error: BILATERAL_REJECTION };
  }

  if (isClinicalPrescribedSide(normalized)) {
    if (normalized !== trimmed) {
      return { ok: false, error: INVALID_SIDE_REJECTION };
    }
    return { ok: true, value: normalized };
  }

  return { ok: false, error: INVALID_SIDE_REJECTION };
}

/** Maps a stored plan_sessions.prescribed_side value to the public API contract. */
export function serializeClinicalPrescribedSideFromDb(
  value: string | null | undefined,
): ClinicalPrescribedSide | null {
  if (value === null || value === undefined) {
    return null;
  }
  return isClinicalPrescribedSide(value) ? value : null;
}

export type PlanSessionPrescriptionInput = {
  sessionNumber: number;
  prescribedSide: ClinicalPrescribedSide | null;
};

export type PlanSessionPrescriptionValidationResult =
  | { ok: true; value: PlanSessionPrescriptionInput[] }
  | { ok: false; error: string };

const SESSION_PRESCRIPTION_ALLOWED_KEYS = new Set(["sessionNumber", "prescribedSide"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses optional per-session prescribed sides from a clinician plan-create body.
 * Returns an empty array when `sessions` is absent — backward compatible.
 */
export function parsePlanSessionPrescriptionsFromBody(
  sessions: unknown,
): PlanSessionPrescriptionValidationResult {
  if (sessions === undefined || sessions === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(sessions)) {
    return { ok: false, error: "sessions must be an array when provided." };
  }

  const parsed: PlanSessionPrescriptionInput[] = [];
  const seenSessionNumbers = new Set<number>();

  for (const entry of sessions) {
    if (!isPlainObject(entry)) {
      return { ok: false, error: "Each session prescription must be an object." };
    }

    for (const key of Object.keys(entry)) {
      if (!SESSION_PRESCRIPTION_ALLOWED_KEYS.has(key)) {
        return { ok: false, error: `Unknown session prescription field: ${key}.` };
      }
    }

    const sessionNumber = entry.sessionNumber;
    if (typeof sessionNumber !== "number" || !Number.isInteger(sessionNumber) || sessionNumber < 1) {
      return { ok: false, error: "sessionNumber must be a positive integer." };
    }

    if (seenSessionNumbers.has(sessionNumber)) {
      return { ok: false, error: "Duplicate sessionNumber in session prescriptions." };
    }
    seenSessionNumbers.add(sessionNumber);

    const sideResult = parseClinicalPrescribedSide(entry.prescribedSide);
    if (!sideResult.ok) {
      return sideResult;
    }

    if (sideResult.value === null) {
      continue;
    }

    parsed.push({ sessionNumber, prescribedSide: sideResult.value });
  }

  return { ok: true, value: parsed };
}

export type CatalogPlanSessionPrescriptionRpcRow = {
  sessionNumber: number;
  prescribedSide: ClinicalPrescribedSide;
};

/** JSON shape passed to create_plan_from_catalog_program.p_session_prescribed_sides. */
export function toCatalogRpcSessionPrescribedSides(
  prescriptions: readonly PlanSessionPrescriptionInput[],
): CatalogPlanSessionPrescriptionRpcRow[] {
  return prescriptions
    .filter((row): row is PlanSessionPrescriptionInput & { prescribedSide: ClinicalPrescribedSide } =>
      row.prescribedSide !== null,
    )
    .map((row) => ({
      sessionNumber: row.sessionNumber,
      prescribedSide: row.prescribedSide,
    }));
}

export type GuidedPlanSessionWriteInput = {
  sessionNumber: number;
  prescribedSide?: unknown;
};

export type GuidedPlanSessionWriteValidationResult =
  | { ok: true; prescribedSideBySessionNumber: Map<number, ClinicalPrescribedSide> }
  | { ok: false; error: string };

/** Validates optional prescribedSide values on guided plan session inputs. */
export function validateGuidedPlanSessionPrescriptions(
  sessions: readonly GuidedPlanSessionWriteInput[],
): GuidedPlanSessionWriteValidationResult {
  const prescribedSideBySessionNumber = new Map<number, ClinicalPrescribedSide>();

  for (const session of sessions) {
    if (session.prescribedSide === undefined) {
      continue;
    }

    const parsed = parseClinicalPrescribedSide(session.prescribedSide);
    if (!parsed.ok) {
      return parsed;
    }

    if (parsed.value !== null) {
      prescribedSideBySessionNumber.set(session.sessionNumber, parsed.value);
    }
  }

  return { ok: true, prescribedSideBySessionNumber };
}

/** True when at least one session carries an explicit left/right prescription. */
export function requiresPrescribedSideStorageCapability(
  prescribedSideBySessionNumber: ReadonlyMap<number, ClinicalPrescribedSide>,
): boolean {
  return prescribedSideBySessionNumber.size > 0;
}

export type GuidedPlanSessionInsertRow = {
  plan_id: string;
  provider_id: string;
  patient_id: string;
  session_number: number;
  title: string;
  exercises: unknown;
  status: string;
  prescribed_side?: ClinicalPrescribedSide;
};

/**
 * Builds plan_sessions insert rows for guided plan creation.
 * Omits prescribed_side entirely unless a non-null side was validated
 * for that session — pre-migration databases never see the column.
 */
export function buildGuidedPlanSessionInsertRows(params: {
  planId: string;
  providerId: string;
  patientId: string;
  sessions: readonly { sessionNumber: number; title: string; exercises: unknown }[];
  prescribedSideBySessionNumber: ReadonlyMap<number, ClinicalPrescribedSide>;
}): GuidedPlanSessionInsertRow[] {
  return params.sessions.map((session) => {
    const row: GuidedPlanSessionInsertRow = {
      plan_id: params.planId,
      provider_id: params.providerId,
      patient_id: params.patientId,
      session_number: session.sessionNumber,
      title: session.title,
      exercises: session.exercises,
      status: "upcoming",
    };

    const prescribedSide = params.prescribedSideBySessionNumber.get(session.sessionNumber);
    if (prescribedSide !== undefined) {
      row.prescribed_side = prescribedSide;
    }

    return row;
  });
}
