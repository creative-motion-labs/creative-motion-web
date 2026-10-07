/**
 * RASQ Upper-Limb Motor Screen — Phase 1 domain contracts.
 *
 * Pure types, closed-enum guards, and small cross-cutting validators only.
 * No CV task logic, no joint-angle math, no persistence, no Session
 * Orchestrator or interactive-shoulder coupling. Assignment, CV session
 * result, and clinician review are three independently-lifecycled objects,
 * linked only by identifier — none of them nests another.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Side / task identifiers
// ---------------------------------------------------------------------------

/** No "bilateral" member. Bilateral testing is two sequential task-assignment groups. */
export const UPPER_LIMB_SIDES = ["left", "right"] as const;
export type UpperLimbSide = (typeof UPPER_LIMB_SIDES)[number];

export function isValidUpperLimbSide(value: unknown): value is UpperLimbSide {
  return typeof value === "string" && (UPPER_LIMB_SIDES as readonly string[]).includes(value);
}

export const UPPER_LIMB_TASK_IDS = ["forwardReach", "lateralReach", "elbowExtension"] as const;
export type UpperLimbTaskId = (typeof UPPER_LIMB_TASK_IDS)[number];

export function isValidUpperLimbTaskId(value: unknown): value is UpperLimbTaskId {
  return typeof value === "string" && (UPPER_LIMB_TASK_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Clinician-controlled configuration
// ---------------------------------------------------------------------------

export const STARTING_SITTING_POSITIONS = [
  "edge_of_bed",
  "chair_with_armrests",
  "chair_without_armrests",
  "wheelchair",
] as const;
export type StartingSittingPosition = (typeof STARTING_SITTING_POSITIONS)[number];

export const BACK_TRUNK_SUPPORT_LEVELS = ["full_back_support", "partial_back_support", "none"] as const;
export type BackTrunkSupportLevel = (typeof BACK_TRUNK_SUPPORT_LEVELS)[number];

export const AFFECTED_ARM_SUPPORT_LEVELS = ["armrest", "lap_support", "sling", "none"] as const;
export type AffectedArmSupportLevel = (typeof AFFECTED_ARM_SUPPORT_LEVELS)[number];

export const CAREGIVER_SUPERVISION_REQUIREMENTS = ["required", "not_required"] as const;
export type CaregiverSupervisionRequirement = (typeof CAREGIVER_SUPERVISION_REQUIREMENTS)[number];

/** MVP delivery-mode policy. remote_self / self / unsupervised / remote are rejected by omission — they are not members of this closed enum. */
export const UPPER_LIMB_DELIVERY_MODES = ["in_clinic", "remote_supervised"] as const;
export type UpperLimbDeliveryMode = (typeof UPPER_LIMB_DELIVERY_MODES)[number];

/** Documentation only — not used by validation logic. Any value absent from UPPER_LIMB_DELIVERY_MODES is already rejected by the closed-enum check. */
export const UPPER_LIMB_KNOWN_REJECTED_DELIVERY_MODES = [
  "remote_self",
  "self",
  "unsupervised",
  "remote",
] as const;

/**
 * "not_applicable" is only valid where a task genuinely has no boundary concept.
 * The boundary's geometric representation is intentionally not modeled in Phase 1 —
 * that belongs to the Task B implementation phase, not this contract.
 */
export type UpperLimbPermittedMovementRange =
  | { kind: "not_applicable" }
  | { kind: "configured"; clinicianDescription: string };

/**
 * Target direction/height/distance taxonomy is not yet clinically confirmed, so
 * these are validated as required, non-empty clinician-authored text rather than
 * an invented enum. Phase 1 does not interpret or compute against these values.
 */
export type UpperLimbTargetPlacement = {
  direction: string;
  height: string;
  distance: string;
};

export type ClinicianControlledConfiguration = {
  startingSittingPosition: StartingSittingPosition;
  backTrunkSupport: BackTrunkSupportLevel;
  affectedArmSupport: AffectedArmSupportLevel;
  /** 0-10 integer scale, required — no default. */
  baselinePainScore: number;
  permittedMovementRange: UpperLimbPermittedMovementRange;
  caregiverSupervisionRequirement: CaregiverSupervisionRequirement;
  deliveryMode: UpperLimbDeliveryMode;
  /** Explicit array, may be empty — emptiness must be an explicit clinician choice, never an omitted field. */
  patientSpecificStopCriteria: string[];
};

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export const UPPER_LIMB_ASSIGNMENT_STATUSES = ["assigned", "started", "completed", "cancelled"] as const;
export type UpperLimbAssignmentStatus = (typeof UPPER_LIMB_ASSIGNMENT_STATUSES)[number];

export type UpperLimbTaskAssignmentGroup = {
  taskId: UpperLimbTaskId;
  testedSide: UpperLimbSide;
  eligible: boolean;
  attempts: number;
  restPeriodSeconds: number;
  targetPlacement: UpperLimbTargetPlacement;
};

export type UpperLimbMotorScreenAssignment = {
  id: string;
  screenDefinitionId: string;
  status: UpperLimbAssignmentStatus;
  assignedAt: string;
  assignedBy: string;
  /** Separate from every taskAssignmentGroups[].testedSide — never conflated. */
  affectedSide: UpperLimbSide;
  configuration: ClinicianControlledConfiguration;
  taskAssignmentGroups: UpperLimbTaskAssignmentGroup[];
};

// ---------------------------------------------------------------------------
// Clinical stop
// ---------------------------------------------------------------------------

export const CLINICAL_STOP_REASONS = [
  "new_or_sudden_neurological_symptoms",
  "new_severe_or_increasing_pain",
  "chest_pain",
  "unusual_shortness_of_breath",
  "severe_dizziness_or_loss_of_consciousness",
  "loss_of_sitting_balance",
  "inability_to_follow_instructions",
  "patient_requested_stop",
  "clinician_or_caregiver_safety_concern",
  "escalated_from_configured_limit_review",
] as const;
export type ClinicalStopReason = (typeof CLINICAL_STOP_REASONS)[number];

export function isValidClinicalStopReason(value: unknown): value is ClinicalStopReason {
  return typeof value === "string" && (CLINICAL_STOP_REASONS as readonly string[]).includes(value);
}

export const CLINICAL_STOP_REPORTED_BY_ROLES = ["patient", "clinician", "caregiver"] as const;
export type ClinicalStopReportedByRole = (typeof CLINICAL_STOP_REPORTED_BY_ROLES)[number];

export function isValidClinicalStopReportedByRole(value: unknown): value is ClinicalStopReportedByRole {
  return typeof value === "string" && (CLINICAL_STOP_REPORTED_BY_ROLES as readonly string[]).includes(value);
}

/** reviewRequired is always true — this event is never auto-cleared. */
export type ClinicalStopEvent = {
  reason: ClinicalStopReason;
  recordedAt: string;
  recordedBy: ClinicalStopReportedByRole;
  reviewRequired: true;
};

// ---------------------------------------------------------------------------
// Protective pause
// ---------------------------------------------------------------------------

export const PROTECTIVE_PAUSE_CATEGORIES = ["tracking_or_environment", "configured_limit"] as const;
export type ProtectivePauseCategory = (typeof PROTECTIVE_PAUSE_CATEGORIES)[number];

export const TRACKING_OR_ENVIRONMENT_REASON_DETAILS = [
  "shoulder_landmark_lost",
  "elbow_landmark_lost",
  "wrist_landmark_lost",
  "significant_occlusion",
  "inadequate_camera_angle",
  "inadequate_lighting",
  "insufficient_tracking_quality",
] as const;
export type TrackingOrEnvironmentReasonDetail = (typeof TRACKING_OR_ENVIRONMENT_REASON_DETAILS)[number];

/**
 * configured_limit is deliberately the same shape as tracking_or_environment —
 * both are non-clinical, human-resumable pauses. Neither this type nor any
 * function in this module may describe configured_limit_exceeded as a
 * technical failure, a clinical safety event, a diagnosis, or an automatic
 * clinical stop.
 */
export type ProtectivePauseReason =
  | { category: "tracking_or_environment"; detail: TrackingOrEnvironmentReasonDetail }
  | { category: "configured_limit"; detail: "configured_limit_exceeded" };

export function isValidProtectivePauseReason(value: unknown): value is ProtectivePauseReason {
  if (!isRecord(value)) return false;
  if (value.category === "tracking_or_environment") {
    return (
      typeof value.detail === "string" &&
      (TRACKING_OR_ENVIRONMENT_REASON_DETAILS as readonly string[]).includes(value.detail)
    );
  }
  if (value.category === "configured_limit") {
    return value.detail === "configured_limit_exceeded";
  }
  return false;
}

export const PROTECTIVE_PAUSE_OUTCOMES = [
  "resumed",
  "escalated_to_clinical_stop",
  "session_ended_while_paused",
] as const;
export type ProtectivePauseOutcome = (typeof PROTECTIVE_PAUSE_OUTCOMES)[number];

export function isValidProtectivePauseOutcome(value: unknown): value is ProtectivePauseOutcome {
  return typeof value === "string" && (PROTECTIVE_PAUSE_OUTCOMES as readonly string[]).includes(value);
}

/** The system is never a valid resume actor — no "system"/"auto" member exists. */
export const PROTECTIVE_PAUSE_RESUME_ACTORS = ["patient", "clinician", "supervisor"] as const;
export type ProtectivePauseResumeActor = (typeof PROTECTIVE_PAUSE_RESUME_ACTORS)[number];

export function isValidProtectivePauseResumeActor(value: unknown): value is ProtectivePauseResumeActor {
  return typeof value === "string" && (PROTECTIVE_PAUSE_RESUME_ACTORS as readonly string[]).includes(value);
}

export type ProtectivePauseEvent = {
  reason: ProtectivePauseReason;
  startedAtMs: number;
  endedAtMs: number | null;
  outcome: ProtectivePauseOutcome;
  /** Set only after an explicit post-restoration readiness check — never implied by tracking restoration alone. */
  readinessConfirmedAt: string | null;
  /** Non-null only when outcome is "resumed"; never "system". */
  resumedBy: ProtectivePauseResumeActor | null;
};

/**
 * The not_assessable threshold (how much protective-pause time makes an
 * attempt unreliable) is deliberately not a hardcoded number in Phase 1.
 * It is either deferred to a later phase or supplied by external configuration.
 */
export type UpperLimbNotAssessableThresholdPolicy =
  | { kind: "deferred" }
  | { kind: "external_configuration"; source: string };

// ---------------------------------------------------------------------------
// Movement-attempt result
// ---------------------------------------------------------------------------

export const UPPER_LIMB_ATTEMPT_COMPLETION_STATES = [
  "completed",
  "incomplete",
  "interrupted",
  "stopped",
  "not_assessable",
  "not_started",
] as const;
export type UpperLimbAttemptCompletionState = (typeof UPPER_LIMB_ATTEMPT_COMPLETION_STATES)[number];

export function isValidUpperLimbAttemptCompletionState(
  value: unknown,
): value is UpperLimbAttemptCompletionState {
  return (
    typeof value === "string" &&
    (UPPER_LIMB_ATTEMPT_COMPLETION_STATES as readonly string[]).includes(value)
  );
}

/**
 * A ClinicalStopEvent touching an attempt must produce "stopped" — no other
 * value is legal in that case. "interrupted" is reserved exclusively for
 * unexpected non-clinical termination (runtime fault, connectivity loss,
 * application closure) and is not tied to any specific task. Protective
 * pauses never determine completion state by themselves — there is no
 * hasProtectivePause parameter here on purpose.
 */
export function isCompletionStateConsistentWithEvents(input: {
  completionState: UpperLimbAttemptCompletionState;
  hasClinicalStop: boolean;
  hasRuntimeInterruption: boolean;
}): boolean {
  if (input.hasClinicalStop) return input.completionState === "stopped";
  if (input.hasRuntimeInterruption) return input.completionState === "interrupted";
  return true;
}

/**
 * Raw wrist trajectory is intentionally absent — it stays ephemeral per the
 * approved design and is never part of this persisted contract. Only derived
 * metrics are modeled. shoulderElevationAngleDegrees is hip→shoulder→elbow;
 * elbowFlexionAngleDegrees is shoulder→elbow→wrist — they are never merged
 * into one field. No computation of these fields happens in Phase 1.
 */
export type UpperLimbMovementAttemptResult = {
  attemptIndex: number;
  taskId: UpperLimbTaskId;
  testedSide: UpperLimbSide;
  startedAtMs: number;
  completedAtMs: number | null;
  completionState: UpperLimbAttemptCompletionState;

  targetReached: boolean | null;
  dwellConfirmed: boolean | null;
  returnToStartCompleted: boolean | null;

  reachTimeMs: number | null;
  returnTimeMs: number | null;
  totalMovementTimeMs: number | null;
  normalizedPathLength: number | null;
  /** Straight-line distance / normalizedPathLength; null when tracking quality was insufficient for the whole attempt. */
  pathEfficiency: number | null;
  peakShoulderAngleDeg: number | null;
  peakElbowExtensionDeg: number | null;

  trunkDisplacementObserved: boolean | null;
  withinConfiguredLimitThroughout: boolean | null;

  trackingQualitySummary: "good" | "fair" | "poor" | "unknown";
  protectivePauseCount: number;
  protectivePauseDurationMs: number;
  protectivePauseEvents: ProtectivePauseEvent[];

  factualNotes: string[];
};

// ---------------------------------------------------------------------------
// CV session result (factual only — never carries clinician interpretation)
// ---------------------------------------------------------------------------

export type UpperLimbTaskCompletionSummary = {
  taskId: UpperLimbTaskId;
  testedSide: UpperLimbSide;
  completionState: UpperLimbAttemptCompletionState;
};

export type UpperLimbMotorScreenSessionResult = {
  id: string;
  /** Reference only — never nested. */
  assignmentId: string;
  status: "computed" | "finalized";
  taskCompletion: UpperLimbTaskCompletionSummary[];
  attempts: UpperLimbMovementAttemptResult[];
  technicalTrackingQuality: {
    overallQuality: "good" | "fair" | "poor" | "unknown";
    protectivePauseCount: number;
    protectivePauseDurationMsTotal: number;
    longestPauseGapMs: number;
  };
  interruptions: {
    clinicalStopEvents: ClinicalStopEvent[];
    protectivePauseEvents: ProtectivePauseEvent[];
  };
  observedMovementFeatures: {
    trunkCompensationObserved: boolean | null;
    asymmetryNotes: string[];
  };
  // Deliberately no clinicianInterpretation field. See UpperLimbMotorScreenClinicianReview.
};

// ---------------------------------------------------------------------------
// Clinician review — separate object, discriminated on status
// ---------------------------------------------------------------------------

export const UPPER_LIMB_CLINICIAN_REVIEW_OUTCOMES = [
  "approved",
  "approved_with_limitations",
  "rejected",
  "insufficient_data",
] as const;
export type UpperLimbClinicianReviewOutcome = (typeof UPPER_LIMB_CLINICIAN_REVIEW_OUTCOMES)[number];

export function isValidUpperLimbClinicianReviewOutcome(
  value: unknown,
): value is UpperLimbClinicianReviewOutcome {
  return (
    typeof value === "string" &&
    (UPPER_LIMB_CLINICIAN_REVIEW_OUTCOMES as readonly string[]).includes(value)
  );
}

export type UpperLimbClinicianReviewPending = {
  id: string;
  /** Reference only — never nested. */
  sessionResultId: string;
  status: "pending";
  notes?: string;
  taskLevelNotes?: Partial<Record<UpperLimbTaskId, string>>;
};

export type UpperLimbClinicianReviewReviewed = {
  id: string;
  sessionResultId: string;
  status: "reviewed";
  reviewedBy: string;
  reviewedAt: string;
  reviewOutcome: UpperLimbClinicianReviewOutcome;
  notes?: string;
  taskLevelNotes?: Partial<Record<UpperLimbTaskId, string>>;
};

export type UpperLimbMotorScreenClinicianReview =
  | UpperLimbClinicianReviewPending
  | UpperLimbClinicianReviewReviewed;

/**
 * Runtime validation — incoming JSON is not protected by the TypeScript
 * union. Pending must not carry reviewedBy/reviewedAt/reviewOutcome at all
 * (key presence is checked, not just value truthiness). Reviewed requires
 * all three.
 */
export function isValidUpperLimbMotorScreenClinicianReview(
  value: unknown,
): value is UpperLimbMotorScreenClinicianReview {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id.trim()) return false;
  if (typeof value.sessionResultId !== "string" || !value.sessionResultId.trim()) return false;

  if (value.status === "pending") {
    return !("reviewedBy" in value) && !("reviewedAt" in value) && !("reviewOutcome" in value);
  }

  if (value.status === "reviewed") {
    return (
      typeof value.reviewedBy === "string" &&
      value.reviewedBy.trim().length > 0 &&
      typeof value.reviewedAt === "string" &&
      value.reviewedAt.trim().length > 0 &&
      isValidUpperLimbClinicianReviewOutcome(value.reviewOutcome)
    );
  }

  return false;
}

// ---------------------------------------------------------------------------
// Safety vocabulary denylist — assignment and CV-result contracts only.
// Never applied to clinician review notes, which may legitimately contain
// clinical free text.
// ---------------------------------------------------------------------------

const FORBIDDEN_SAFETY_VOCABULARY_KEYS = new Set([
  "diagnosis",
  "fmascore",
  "fmaitemscore",
  "totalscore",
  "impairmentscore",
  "impairmentseverity",
  "spasticitygrade",
  "musclestrengthgrade",
  "safe",
  "unsafe",
  "cleared",
  "clearance",
  "treatmentplan",
  "recommendation",
  "automaticprogression",
  /**
   * Assignment and CV session-result payloads must never carry clinician
   * interpretation inline — it belongs only on the separate
   * UpperLimbMotorScreenClinicianReview object, linked by sessionResultId.
   */
  "clinicianinterpretation",
  "clinicianreview",
]);

/**
 * Checks object KEY names (not value content) against the denylist, so an
 * approved value like the ClinicalStopReason "clinician_or_caregiver_safety_concern"
 * is never mistaken for a forbidden field.
 */
export function findForbiddenSafetyVocabularyKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenSafetyVocabularyKeys(item, `${path}[${index}]`),
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, val]) => {
      const keyPath = path ? `${path}.${key}` : key;
      const hit = FORBIDDEN_SAFETY_VOCABULARY_KEYS.has(key.toLowerCase()) ? [keyPath] : [];
      return [...hit, ...findForbiddenSafetyVocabularyKeys(val, keyPath)];
    });
  }
  return [];
}

export function isSafetyVocabularyFree(value: unknown): boolean {
  return findForbiddenSafetyVocabularyKeys(value).length === 0;
}

// ---------------------------------------------------------------------------
// CV session-result safety validation
// ---------------------------------------------------------------------------

export type UpperLimbSessionResultSafetyValidationResult =
  | { ok: true }
  | { ok: false; forbiddenKeyPaths: string[] };

/**
 * Runtime, unknown-input safety check for a UpperLimbMotorScreenSessionResult
 * candidate — accepts raw JSON, never assumes the TypeScript shape already
 * held. Read-only: never mutates the candidate. Rejects the same forbidden
 * automated-claim keys as the assignment denylist, anywhere in the payload
 * (including nested objects and array items), which also means a smuggled
 * clinicianInterpretation or clinicianReview key is rejected here — clinician
 * review must only ever exist as the separate UpperLimbMotorScreenClinicianReview
 * object, linked by sessionResultId, never embedded in the session result.
 */
export function validateUpperLimbMotorScreenSessionResultSafety(
  candidate: unknown,
): UpperLimbSessionResultSafetyValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, forbiddenKeyPaths: [] };
  }
  const forbiddenKeyPaths = findForbiddenSafetyVocabularyKeys(candidate);
  return forbiddenKeyPaths.length === 0 ? { ok: true } : { ok: false, forbiddenKeyPaths };
}
