/**
 * Clinician Forward Reach Baseline assignment — browser-safe client contract.
 *
 * Builds an explicit allowlisted POST body for
 * /api/upper-limb-motor-screen/assignments. Never sends server-owned
 * fields (id, status, assignedAt, assignedBy, providerId).
 */

import {
  AFFECTED_ARM_SUPPORT_LEVELS,
  BACK_TRUNK_SUPPORT_LEVELS,
  CAREGIVER_SUPERVISION_REQUIREMENTS,
  STARTING_SITTING_POSITIONS,
  UPPER_LIMB_DELIVERY_MODES,
  UPPER_LIMB_SIDES,
  type AffectedArmSupportLevel,
  type BackTrunkSupportLevel,
  type CaregiverSupervisionRequirement,
  type ClinicianControlledConfiguration,
  type StartingSittingPosition,
  type UpperLimbDeliveryMode,
  type UpperLimbSide,
  type UpperLimbTaskAssignmentGroup,
} from "./types";
import { validateUpperLimbMotorScreenAssignment } from "./assignment-validation";
import {
  buildForwardReachAssignmentFingerprint,
  type ForwardReachAssignmentRequestSnapshotInput,
} from "./assignment-request-payload";
import {
  createForwardReachAssignmentAttemptController,
  type ForwardReachAssignmentAttemptController,
} from "./forward-reach-assignment-idempotency";

export const FORWARD_REACH_SCREEN_DEFINITION_ID = "upper-limb-motor-screen-v1" as const;
export const FORWARD_REACH_BASELINE_TASK_ID = "forwardReach" as const;

export const FORWARD_REACH_ASSIGNMENT_REQUEST_TOP_LEVEL_KEYS = [
  "patientId",
  "screenDefinitionId",
  "affectedSide",
  "configuration",
  "taskAssignmentGroups",
  "assignmentRequestId",
] as const;

export type ForwardReachAssignmentRequestPayload = {
  patientId: string;
  screenDefinitionId: typeof FORWARD_REACH_SCREEN_DEFINITION_ID;
  affectedSide: UpperLimbSide;
  configuration: ClinicianControlledConfiguration;
  taskAssignmentGroups: [UpperLimbTaskAssignmentGroup];
  assignmentRequestId: string;
};

export type ForwardReachAssignmentFormState = {
  affectedSide: "" | UpperLimbSide;
  testedSide: "" | UpperLimbSide;
  startingSittingPosition: "" | StartingSittingPosition;
  backTrunkSupport: "" | BackTrunkSupportLevel;
  affectedArmSupport: "" | AffectedArmSupportLevel;
  baselinePainScore: string;
  permittedMovementRangeKind: "" | "not_applicable" | "configured";
  permittedMovementRangeDescription: string;
  caregiverSupervisionRequirement: "" | CaregiverSupervisionRequirement;
  deliveryMode: "" | UpperLimbDeliveryMode;
  patientSpecificStopCriteria: string;
  eligible: boolean | null;
  attempts: string;
  restPeriodSeconds: string;
  targetDirection: string;
  targetHeight: string;
  targetDistance: string;
};

export type ForwardReachFormFieldError = {
  field: keyof ForwardReachAssignmentFormState;
  message: string;
};

export type ForwardReachAssignmentCreateSuccess = {
  id: string;
  status: "assigned";
  assignedAt: string;
  assignedBy: string;
};

export const FORWARD_REACH_ASSIGNMENT_USER_MESSAGES = {
  validation: "Review the highlighted fields before assigning.",
  unauthorized: "Your session has expired. Sign in again to continue.",
  notFound: "This patient record could not be found.",
  conflict: "This assignment could not be created because of a conflict. Refresh and try again.",
  rateLimited: "Too many requests. Wait a moment and try again.",
  badRequest: "Some assignment details were invalid. Review the form and try again.",
  network: "Could not reach the server. Check your connection and try again.",
  unexpected: "Something went wrong while creating the assignment. Try again.",
  duplicateSubmit: "Assignment is already being submitted.",
  success: "Forward Reach Baseline assignment created for therapist review.",
} as const;

export function createEmptyForwardReachAssignmentForm(): ForwardReachAssignmentFormState {
  return {
    affectedSide: "",
    testedSide: "",
    startingSittingPosition: "",
    backTrunkSupport: "",
    affectedArmSupport: "",
    baselinePainScore: "",
    permittedMovementRangeKind: "",
    permittedMovementRangeDescription: "",
    caregiverSupervisionRequirement: "",
    deliveryMode: "",
    patientSpecificStopCriteria: "",
    eligible: null,
    attempts: "",
    restPeriodSeconds: "",
    targetDirection: "",
    targetHeight: "",
    targetDistance: "",
  };
}

function parseStopCriteria(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseNonNegativeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function validateForwardReachAssignmentForm(
  form: ForwardReachAssignmentFormState,
): { ok: true } | { ok: false; errors: ForwardReachFormFieldError[] } {
  const errors: ForwardReachFormFieldError[] = [];

  if (!UPPER_LIMB_SIDES.includes(form.affectedSide as UpperLimbSide)) {
    errors.push({ field: "affectedSide", message: "Select the clinically affected side." });
  }
  if (!UPPER_LIMB_SIDES.includes(form.testedSide as UpperLimbSide)) {
    errors.push({ field: "testedSide", message: "Select which side will be tested." });
  }
  if (
    !STARTING_SITTING_POSITIONS.includes(form.startingSittingPosition as StartingSittingPosition)
  ) {
    errors.push({
      field: "startingSittingPosition",
      message: "Select the starting sitting position.",
    });
  }
  if (!BACK_TRUNK_SUPPORT_LEVELS.includes(form.backTrunkSupport as BackTrunkSupportLevel)) {
    errors.push({ field: "backTrunkSupport", message: "Select back and trunk support." });
  }
  if (!AFFECTED_ARM_SUPPORT_LEVELS.includes(form.affectedArmSupport as AffectedArmSupportLevel)) {
    errors.push({ field: "affectedArmSupport", message: "Select affected-arm support." });
  }

  const pain = Number.parseInt(form.baselinePainScore.trim(), 10);
  if (!Number.isInteger(pain) || pain < 0 || pain > 10) {
    errors.push({
      field: "baselinePainScore",
      message: "Enter baseline pain as a whole number from 0 to 10.",
    });
  }

  if (form.permittedMovementRangeKind === "") {
    errors.push({
      field: "permittedMovementRangeKind",
      message: "Select whether a permitted movement range applies.",
    });
  } else if (form.permittedMovementRangeKind === "configured") {
    if (!form.permittedMovementRangeDescription.trim()) {
      errors.push({
        field: "permittedMovementRangeDescription",
        message: "Describe the permitted movement range for therapist review.",
      });
    }
  }

  if (
    !CAREGIVER_SUPERVISION_REQUIREMENTS.includes(
      form.caregiverSupervisionRequirement as CaregiverSupervisionRequirement,
    )
  ) {
    errors.push({
      field: "caregiverSupervisionRequirement",
      message: "Select whether caregiver supervision is required.",
    });
  }
  if (!UPPER_LIMB_DELIVERY_MODES.includes(form.deliveryMode as UpperLimbDeliveryMode)) {
    errors.push({ field: "deliveryMode", message: "Select the delivery mode." });
  }

  if (form.eligible !== true && form.eligible !== false) {
    errors.push({ field: "eligible", message: "Indicate whether this task is eligible today." });
  }

  const attempts = parsePositiveInteger(form.attempts);
  if (attempts === null) {
    errors.push({ field: "attempts", message: "Enter a positive whole number of attempts." });
  }

  const restPeriodSeconds = parseNonNegativeNumber(form.restPeriodSeconds);
  if (restPeriodSeconds === null) {
    errors.push({
      field: "restPeriodSeconds",
      message: "Enter rest between attempts in seconds (0 or greater).",
    });
  }

  if (!form.targetDirection.trim()) {
    errors.push({ field: "targetDirection", message: "Enter the target direction." });
  }
  if (!form.targetHeight.trim()) {
    errors.push({ field: "targetHeight", message: "Enter the target height." });
  }
  if (!form.targetDistance.trim()) {
    errors.push({ field: "targetDistance", message: "Enter the target distance." });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function buildForwardReachAssignmentCreatePayload(
  patientId: string,
  form: ForwardReachAssignmentFormState,
): ForwardReachAssignmentRequestSnapshotInput | null {
  const validation = validateForwardReachAssignmentForm(form);
  if (!validation.ok) return null;

  const attempts = parsePositiveInteger(form.attempts);
  const restPeriodSeconds = parseNonNegativeNumber(form.restPeriodSeconds);
  if (attempts === null || restPeriodSeconds === null) return null;

  const pain = Number.parseInt(form.baselinePainScore.trim(), 10);

  const permittedMovementRange =
    form.permittedMovementRangeKind === "not_applicable"
      ? { kind: "not_applicable" as const }
      : {
          kind: "configured" as const,
          clinicianDescription: form.permittedMovementRangeDescription.trim(),
        };

  const configuration: ClinicianControlledConfiguration = {
    startingSittingPosition: form.startingSittingPosition as StartingSittingPosition,
    backTrunkSupport: form.backTrunkSupport as BackTrunkSupportLevel,
    affectedArmSupport: form.affectedArmSupport as AffectedArmSupportLevel,
    baselinePainScore: pain,
    permittedMovementRange,
    caregiverSupervisionRequirement:
      form.caregiverSupervisionRequirement as CaregiverSupervisionRequirement,
    deliveryMode: form.deliveryMode as UpperLimbDeliveryMode,
    patientSpecificStopCriteria: parseStopCriteria(form.patientSpecificStopCriteria),
  };

  const taskGroup: UpperLimbTaskAssignmentGroup = {
    taskId: FORWARD_REACH_BASELINE_TASK_ID,
    testedSide: form.testedSide as UpperLimbSide,
    eligible: form.eligible as boolean,
    attempts,
    restPeriodSeconds,
    targetPlacement: {
      direction: form.targetDirection.trim(),
      height: form.targetHeight.trim(),
      distance: form.targetDistance.trim(),
    },
  };

  return {
    patientId: patientId.trim(),
    screenDefinitionId: FORWARD_REACH_SCREEN_DEFINITION_ID,
    affectedSide: form.affectedSide as UpperLimbSide,
    configuration,
    taskAssignmentGroups: [taskGroup],
  };
}

/** Mirrors the server-side domain check using placeholder server-owned fields. */
export function assertForwardReachPayloadMatchesAssignmentValidator(
  payload: ForwardReachAssignmentRequestSnapshotInput,
): boolean {
  const candidate = {
    id: "client-shape-check",
    screenDefinitionId: payload.screenDefinitionId,
    status: "assigned",
    assignedAt: "2026-01-01T00:00:00.000Z",
    assignedBy: "server-owned",
    affectedSide: payload.affectedSide,
    configuration: payload.configuration,
    taskAssignmentGroups: payload.taskAssignmentGroups,
  };
  return validateUpperLimbMotorScreenAssignment(candidate).ok;
}

export function mapForwardReachAssignmentHttpError(status: number): string {
  if (status === 400) return FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.badRequest;
  if (status === 401) return FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unauthorized;
  if (status === 404) return FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.notFound;
  if (status === 409) return FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.conflict;
  if (status === 429) return FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.rateLimited;
  return FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unexpected;
}

function parseCreateSuccess(body: unknown): ForwardReachAssignmentCreateSuccess | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const assignment =
    typeof record.assignment === "object" && record.assignment !== null
      ? (record.assignment as Record<string, unknown>)
      : record;

  const id = typeof assignment.id === "string" ? assignment.id : null;
  const status = assignment.status;
  const assignedAt = typeof assignment.assignedAt === "string" ? assignment.assignedAt : null;
  const assignedBy = typeof assignment.assignedBy === "string" ? assignment.assignedBy : null;

  if (!id || status !== "assigned" || !assignedAt || !assignedBy) return null;
  return { id, status: "assigned", assignedAt, assignedBy };
}

export type ForwardReachAssignmentSubmitResult =
  | { ok: true; assignment: ForwardReachAssignmentCreateSuccess }
  | {
      ok: false;
      message: string;
      status?: number;
      duplicateSubmit?: boolean;
      fieldErrors?: ForwardReachFormFieldError[];
    };

function isRetryableAssignmentHttpStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export type ForwardReachAssignmentSubmitOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  scopeAtStart?: number;
  currentScope?: () => number;
  generationAtStart?: number;
  currentGeneration?: () => number;
};

export type ForwardReachAssignmentSubmitter = {
  readonly inFlight: boolean;
  submit: (
    patientId: string,
    form: ForwardReachAssignmentFormState,
    options?: ForwardReachAssignmentSubmitOptions,
  ) => Promise<ForwardReachAssignmentSubmitResult>;
  getController: () => ForwardReachAssignmentAttemptController;
};

export function createForwardReachAssignmentSubmitter(): ForwardReachAssignmentSubmitter {
  const controller = createForwardReachAssignmentAttemptController();

  return {
    get inFlight(): boolean {
      return controller.isInFlight();
    },

    getController(): ForwardReachAssignmentAttemptController {
      return controller;
    },

    async submit(
      patientId: string,
      form: ForwardReachAssignmentFormState,
      options: ForwardReachAssignmentSubmitOptions = {},
    ): Promise<ForwardReachAssignmentSubmitResult> {
      const fetchImpl = options.fetchImpl ?? fetch;

      const fieldValidation = validateForwardReachAssignmentForm(form);
      if (!fieldValidation.ok) {
        return {
          ok: false,
          message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.validation,
          fieldErrors: fieldValidation.errors,
        };
      }

      const basePayload = buildForwardReachAssignmentCreatePayload(patientId, form);
      if (!basePayload) {
        return {
          ok: false,
          message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.validation,
        };
      }

      const fingerprint = buildForwardReachAssignmentFingerprint(basePayload);
      const attempt = controller.beginSubmitAttempt(fingerprint);
      if (!attempt.ok) {
        return {
          ok: false,
          message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.duplicateSubmit,
          duplicateSubmit: true,
        };
      }

      const payload: ForwardReachAssignmentRequestPayload = {
        ...basePayload,
        assignmentRequestId: attempt.requestId,
      };

      const generationAtStart = attempt.generation;
      const scopeAtStart = options.scopeAtStart ?? 0;

      try {
        if (options.signal?.aborted) {
          controller.completeFailure();
          return { ok: false, message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.network };
        }

        let response: Response;
        try {
          response = await fetchImpl("/api/upper-limb-motor-screen/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: options.signal,
            body: JSON.stringify(payload),
          });
        } catch {
          controller.completeFailure();
          return { ok: false, message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.network };
        }

        if (
          options.signal?.aborted ||
          (options.currentScope && options.currentScope() !== scopeAtStart) ||
          controller.getGeneration() !== generationAtStart
        ) {
          controller.completeFailure();
          return { ok: false, message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.network };
        }

        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        if (!response.ok) {
          if (response.status === 409) {
            controller.completeConflict();
          } else if (isRetryableAssignmentHttpStatus(response.status)) {
            controller.completeFailure();
          } else {
            controller.completeFailure();
          }
          return {
            ok: false,
            message: mapForwardReachAssignmentHttpError(response.status),
            status: response.status,
          };
        }

        if (response.status !== 200 && response.status !== 201) {
          controller.completeFailure();
          return { ok: false, message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unexpected };
        }

        const assignment = parseCreateSuccess(body);
        if (!assignment) {
          controller.completeFailure();
          return { ok: false, message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unexpected };
        }

        controller.completeSuccess(fingerprint);
        return { ok: true, assignment };
      } catch {
        controller.completeFailure();
        return { ok: false, message: FORWARD_REACH_ASSIGNMENT_USER_MESSAGES.unexpected };
      }
    },
  };
}

export const forwardReachAssignmentPatientRoute = (patientId: string): string =>
  `/clinician/patients/${encodeURIComponent(patientId)}/upper-limb-motor-screen/assign`;
