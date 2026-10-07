/**
 * RASQ Upper-Limb Motor Screen — Phase 1 assignment validation.
 *
 * Closed enums, explicit rejection, no silent defaults. Every clinician-
 * controlled field must be explicitly present and valid; missing fields are
 * rejected, never filled in. affectedSide and each task-assignment group's
 * testedSide are validated independently and never conflated.
 */

import {
  AFFECTED_ARM_SUPPORT_LEVELS,
  BACK_TRUNK_SUPPORT_LEVELS,
  CAREGIVER_SUPERVISION_REQUIREMENTS,
  STARTING_SITTING_POSITIONS,
  UPPER_LIMB_ASSIGNMENT_STATUSES,
  UPPER_LIMB_DELIVERY_MODES,
  isRecord,
  isSafetyVocabularyFree,
  isValidUpperLimbSide,
  isValidUpperLimbTaskId,
  type AffectedArmSupportLevel,
  type BackTrunkSupportLevel,
  type CaregiverSupervisionRequirement,
  type ClinicianControlledConfiguration,
  type StartingSittingPosition,
  type UpperLimbAssignmentStatus,
  type UpperLimbDeliveryMode,
  type UpperLimbMotorScreenAssignment,
  type UpperLimbPermittedMovementRange,
  type UpperLimbTargetPlacement,
  type UpperLimbTaskAssignmentGroup,
} from "./types";

export type UpperLimbAssignmentValidationFailure =
  | "invalid_configuration"
  | "invalid_delivery_mode"
  | "invalid_affected_side"
  | "no_task_assignment_groups"
  | "invalid_task_assignment_group"
  | "duplicate_task_assignment_group"
  | "forbidden_safety_vocabulary";

export type UpperLimbAssignmentValidationResult =
  | { ok: true; assignment: UpperLimbMotorScreenAssignment }
  | { ok: false; reason: UpperLimbAssignmentValidationFailure; detail?: string };

type ConfigurationValidationResult =
  | { ok: true; configuration: ClinicianControlledConfiguration }
  | { ok: false; reason: "invalid_configuration" | "invalid_delivery_mode"; detail?: string };

type RangeValidationResult =
  | { ok: true; range: UpperLimbPermittedMovementRange }
  | { ok: false; reason: "invalid_configuration"; detail?: string };

type TargetPlacementValidationResult =
  | { ok: true; placement: UpperLimbTargetPlacement }
  | { ok: false; reason: "invalid_task_assignment_group"; detail?: string };

type TaskAssignmentGroupValidationResult =
  | { ok: true; group: UpperLimbTaskAssignmentGroup }
  | { ok: false; reason: "invalid_task_assignment_group"; detail?: string };

function validatePermittedMovementRange(candidate: unknown): RangeValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_configuration", detail: "permittedMovementRange is required" };
  }
  if (candidate.kind === "not_applicable") {
    return { ok: true, range: { kind: "not_applicable" } };
  }
  if (
    candidate.kind === "configured" &&
    typeof candidate.clinicianDescription === "string" &&
    candidate.clinicianDescription.trim().length > 0
  ) {
    return {
      ok: true,
      range: { kind: "configured", clinicianDescription: candidate.clinicianDescription },
    };
  }
  return { ok: false, reason: "invalid_configuration", detail: "permittedMovementRange is invalid" };
}

function validateClinicianControlledConfiguration(candidate: unknown): ConfigurationValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_configuration", detail: "configuration is required" };
  }

  if (
    typeof candidate.startingSittingPosition !== "string" ||
    !(STARTING_SITTING_POSITIONS as readonly string[]).includes(candidate.startingSittingPosition)
  ) {
    return { ok: false, reason: "invalid_configuration", detail: "startingSittingPosition is required" };
  }

  if (
    typeof candidate.backTrunkSupport !== "string" ||
    !(BACK_TRUNK_SUPPORT_LEVELS as readonly string[]).includes(candidate.backTrunkSupport)
  ) {
    return { ok: false, reason: "invalid_configuration", detail: "backTrunkSupport is required" };
  }

  if (
    typeof candidate.affectedArmSupport !== "string" ||
    !(AFFECTED_ARM_SUPPORT_LEVELS as readonly string[]).includes(candidate.affectedArmSupport)
  ) {
    return { ok: false, reason: "invalid_configuration", detail: "affectedArmSupport is required" };
  }

  if (
    typeof candidate.baselinePainScore !== "number" ||
    !Number.isInteger(candidate.baselinePainScore) ||
    candidate.baselinePainScore < 0 ||
    candidate.baselinePainScore > 10
  ) {
    return {
      ok: false,
      reason: "invalid_configuration",
      detail: "baselinePainScore is required (integer 0-10)",
    };
  }

  const rangeResult = validatePermittedMovementRange(candidate.permittedMovementRange);
  if (!rangeResult.ok) return rangeResult;

  if (
    typeof candidate.caregiverSupervisionRequirement !== "string" ||
    !(CAREGIVER_SUPERVISION_REQUIREMENTS as readonly string[]).includes(
      candidate.caregiverSupervisionRequirement,
    )
  ) {
    return {
      ok: false,
      reason: "invalid_configuration",
      detail: "caregiverSupervisionRequirement is required",
    };
  }

  if (
    typeof candidate.deliveryMode !== "string" ||
    !(UPPER_LIMB_DELIVERY_MODES as readonly string[]).includes(candidate.deliveryMode)
  ) {
    return { ok: false, reason: "invalid_delivery_mode" };
  }

  if (
    !Array.isArray(candidate.patientSpecificStopCriteria) ||
    !candidate.patientSpecificStopCriteria.every((item) => typeof item === "string")
  ) {
    return {
      ok: false,
      reason: "invalid_configuration",
      detail: "patientSpecificStopCriteria is required (array of strings, may be empty)",
    };
  }

  return {
    ok: true,
    configuration: {
      startingSittingPosition: candidate.startingSittingPosition as StartingSittingPosition,
      backTrunkSupport: candidate.backTrunkSupport as BackTrunkSupportLevel,
      affectedArmSupport: candidate.affectedArmSupport as AffectedArmSupportLevel,
      baselinePainScore: candidate.baselinePainScore,
      permittedMovementRange: rangeResult.range,
      caregiverSupervisionRequirement:
        candidate.caregiverSupervisionRequirement as CaregiverSupervisionRequirement,
      deliveryMode: candidate.deliveryMode as UpperLimbDeliveryMode,
      patientSpecificStopCriteria: candidate.patientSpecificStopCriteria as string[],
    },
  };
}

function validateTargetPlacement(candidate: unknown, index: number): TargetPlacementValidationResult {
  if (!isRecord(candidate)) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].targetPlacement is required`,
    };
  }
  const { direction, height, distance } = candidate;
  if (
    typeof direction !== "string" ||
    !direction.trim() ||
    typeof height !== "string" ||
    !height.trim() ||
    typeof distance !== "string" ||
    !distance.trim()
  ) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].targetPlacement requires direction, height, and distance`,
    };
  }
  return { ok: true, placement: { direction, height, distance } };
}

function validateTaskAssignmentGroup(candidate: unknown, index: number): TaskAssignmentGroupValidationResult {
  if (!isRecord(candidate)) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}] must be an object`,
    };
  }
  if (!isValidUpperLimbTaskId(candidate.taskId)) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].taskId is invalid`,
    };
  }
  if (!isValidUpperLimbSide(candidate.testedSide)) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].testedSide must be 'left' or 'right' (no bilateral value)`,
    };
  }
  if (typeof candidate.eligible !== "boolean") {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].eligible is required`,
    };
  }
  if (!Number.isInteger(candidate.attempts) || (candidate.attempts as number) <= 0) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].attempts is required (positive integer)`,
    };
  }
  if (
    typeof candidate.restPeriodSeconds !== "number" ||
    !Number.isFinite(candidate.restPeriodSeconds) ||
    candidate.restPeriodSeconds < 0
  ) {
    return {
      ok: false,
      reason: "invalid_task_assignment_group",
      detail: `taskAssignmentGroups[${index}].restPeriodSeconds is required (>= 0)`,
    };
  }

  const placementResult = validateTargetPlacement(candidate.targetPlacement, index);
  if (!placementResult.ok) return placementResult;

  return {
    ok: true,
    group: {
      taskId: candidate.taskId,
      testedSide: candidate.testedSide,
      eligible: candidate.eligible,
      attempts: candidate.attempts as number,
      restPeriodSeconds: candidate.restPeriodSeconds,
      targetPlacement: placementResult.placement,
    },
  };
}

export function validateUpperLimbMotorScreenAssignment(
  candidate: unknown,
): UpperLimbAssignmentValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reason: "invalid_configuration", detail: "assignment must be an object" };
  }

  if (!isSafetyVocabularyFree(candidate)) {
    return { ok: false, reason: "forbidden_safety_vocabulary" };
  }

  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return { ok: false, reason: "invalid_configuration", detail: "id is required" };
  }
  if (typeof candidate.screenDefinitionId !== "string" || !candidate.screenDefinitionId.trim()) {
    return { ok: false, reason: "invalid_configuration", detail: "screenDefinitionId is required" };
  }
  if (
    typeof candidate.status !== "string" ||
    !(UPPER_LIMB_ASSIGNMENT_STATUSES as readonly string[]).includes(candidate.status)
  ) {
    return { ok: false, reason: "invalid_configuration", detail: "status is required" };
  }
  if (typeof candidate.assignedAt !== "string" || !candidate.assignedAt.trim()) {
    return { ok: false, reason: "invalid_configuration", detail: "assignedAt is required" };
  }
  if (typeof candidate.assignedBy !== "string" || !candidate.assignedBy.trim()) {
    return { ok: false, reason: "invalid_configuration", detail: "assignedBy is required" };
  }

  if (!isValidUpperLimbSide(candidate.affectedSide)) {
    return { ok: false, reason: "invalid_affected_side" };
  }

  const configurationResult = validateClinicianControlledConfiguration(candidate.configuration);
  if (!configurationResult.ok) return configurationResult;

  if (!Array.isArray(candidate.taskAssignmentGroups) || candidate.taskAssignmentGroups.length === 0) {
    return { ok: false, reason: "no_task_assignment_groups" };
  }

  const seen = new Set<string>();
  const groups: UpperLimbTaskAssignmentGroup[] = [];
  for (const [index, rawGroup] of candidate.taskAssignmentGroups.entries()) {
    const groupResult = validateTaskAssignmentGroup(rawGroup, index);
    if (!groupResult.ok) return groupResult;

    const key = `${groupResult.group.taskId}:${groupResult.group.testedSide}`;
    if (seen.has(key)) {
      return { ok: false, reason: "duplicate_task_assignment_group", detail: key };
    }
    seen.add(key);
    groups.push(groupResult.group);
  }

  const assignment: UpperLimbMotorScreenAssignment = {
    id: candidate.id,
    screenDefinitionId: candidate.screenDefinitionId,
    status: candidate.status as UpperLimbAssignmentStatus,
    assignedAt: candidate.assignedAt,
    assignedBy: candidate.assignedBy,
    affectedSide: candidate.affectedSide,
    configuration: configurationResult.configuration,
    taskAssignmentGroups: groups,
  };

  return { ok: true, assignment };
}
