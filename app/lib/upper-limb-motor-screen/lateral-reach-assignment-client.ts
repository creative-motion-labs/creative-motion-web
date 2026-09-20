/**
 * Clinician Lateral Reach assignment — browser-safe client for demo capture flow.
 *
 * Builds an allowlisted POST body for /api/upper-limb-motor-screen/assignments
 * with explicit demo-safe defaults. One lateral reach task per assignment.
 */

import {
  type ClinicianControlledConfiguration,
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
import {
  FORWARD_REACH_SCREEN_DEFINITION_ID,
  mapForwardReachAssignmentHttpError,
  type ForwardReachAssignmentCreateSuccess,
  type ForwardReachAssignmentRequestPayload,
} from "./forward-reach-assignment-client";

export const LATERAL_REACH_BASELINE_TASK_ID = "lateralReach" as const;

export const UPPER_LIMB_MOTOR_SCREEN_ASSESSMENT_HREF =
  "/clinician/assessments/upper-limb-motor-screen" as const;

export function lateralReachCapturePatientRoute(patientId: string): string {
  return `/clinician/patients/${encodeURIComponent(patientId)}/upper-limb-motor-screen/capture`;
}

export const LATERAL_REACH_ASSIGNMENT_USER_MESSAGES = {
  unauthorized: "Your session has expired. Sign in again to continue.",
  notFound: "This patient record could not be found.",
  conflict: "This assignment could not be created because of a conflict. Refresh and try again.",
  rateLimited: "Too many requests. Wait a moment and try again.",
  badRequest: "Some assignment details were invalid. Review and try again.",
  network: "Could not reach the server. Check your connection and try again.",
  unexpected: "Something went wrong while creating the assignment. Try again.",
  duplicateSubmit: "Assignment is already being submitted.",
} as const;

const DEMO_CONFIGURATION: ClinicianControlledConfiguration = {
  startingSittingPosition: "chair_with_armrests",
  backTrunkSupport: "full_back_support",
  affectedArmSupport: "armrest",
  baselinePainScore: 0,
  permittedMovementRange: { kind: "not_applicable" },
  caregiverSupervisionRequirement: "not_required",
  deliveryMode: "in_clinic",
  patientSpecificStopCriteria: [],
};

const REMOTE_CONFIGURATION: ClinicianControlledConfiguration = {
  ...DEMO_CONFIGURATION,
  deliveryMode: "remote_supervised",
};

export function buildLateralReachDemoAssignmentPayload(
  patientId: string,
  testedSide: UpperLimbSide,
  deliveryMode: ClinicianControlledConfiguration["deliveryMode"] = "in_clinic",
): ForwardReachAssignmentRequestSnapshotInput {
  const configuration =
    deliveryMode === "remote_supervised" ? REMOTE_CONFIGURATION : DEMO_CONFIGURATION;
  const taskGroup: UpperLimbTaskAssignmentGroup = {
    taskId: LATERAL_REACH_BASELINE_TASK_ID,
    testedSide,
    eligible: true,
    attempts: 1,
    restPeriodSeconds: 30,
    targetPlacement: {
      direction: "lateral",
      height: "shoulder height",
      distance: "comfortable reach",
    },
  };

  return {
    patientId: patientId.trim(),
    screenDefinitionId: FORWARD_REACH_SCREEN_DEFINITION_ID,
    affectedSide: testedSide,
    configuration,
    taskAssignmentGroups: [taskGroup],
  };
}

export function assertLateralReachPayloadMatchesAssignmentValidator(
  payload: ForwardReachAssignmentRequestSnapshotInput,
): boolean {
  const candidate = {
    id: "client-shape-check",
    screenDefinitionId: payload.screenDefinitionId,
    status: "assigned" as const,
    assignedAt: "2026-01-01T00:00:00.000Z",
    assignedBy: "server-owned",
    affectedSide: payload.affectedSide,
    configuration: payload.configuration,
    taskAssignmentGroups: payload.taskAssignmentGroups,
  };
  return validateUpperLimbMotorScreenAssignment(candidate).ok;
}

export type LateralReachAssignmentSubmitResult =
  | { ok: true; assignment: ForwardReachAssignmentCreateSuccess }
  | {
      ok: false;
      message: string;
      status?: number;
      duplicateSubmit?: boolean;
    };

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

export type LateralReachAssignmentSubmitter = {
  readonly inFlight: boolean;
  submit: (
    patientId: string,
    testedSide: UpperLimbSide,
    options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
  ) => Promise<LateralReachAssignmentSubmitResult>;
  getController: () => ForwardReachAssignmentAttemptController;
};

export function createLateralReachAssignmentSubmitter(): LateralReachAssignmentSubmitter {
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
      testedSide: UpperLimbSide,
      options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
    ): Promise<LateralReachAssignmentSubmitResult> {
      const fetchImpl = options.fetchImpl ?? fetch;
      const basePayload = buildLateralReachDemoAssignmentPayload(patientId, testedSide);
      const fingerprint = buildForwardReachAssignmentFingerprint(basePayload);
      const attempt = controller.beginSubmitAttempt(fingerprint);

      if (!attempt.ok) {
        return {
          ok: false,
          message: LATERAL_REACH_ASSIGNMENT_USER_MESSAGES.duplicateSubmit,
          duplicateSubmit: true,
        };
      }

      const payload: ForwardReachAssignmentRequestPayload = {
        ...basePayload,
        assignmentRequestId: attempt.requestId,
      };

      try {
        const response = await fetchImpl("/api/upper-limb-motor-screen/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: options.signal,
          body: JSON.stringify(payload),
        });

        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        if (!response.ok) {
          controller.completeFailure();
          return {
            ok: false,
            message: mapForwardReachAssignmentHttpError(response.status),
            status: response.status,
          };
        }

        const assignment = parseCreateSuccess(body);
        if (!assignment) {
          controller.completeFailure();
          return { ok: false, message: LATERAL_REACH_ASSIGNMENT_USER_MESSAGES.unexpected };
        }

        controller.completeSuccess(fingerprint);
        return { ok: true, assignment };
      } catch {
        controller.completeFailure();
        return { ok: false, message: LATERAL_REACH_ASSIGNMENT_USER_MESSAGES.network };
      }
    },
  };
}
