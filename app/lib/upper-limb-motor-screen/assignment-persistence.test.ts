/**
 * Run:
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/assignment-persistence.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUpperLimbMotorScreenAssignmentInsert,
  toUpperLimbMotorScreenAssignmentPublic,
} from "./assignment-persistence";
import { UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION } from "./schema-version";
import type { UpperLimbMotorScreenAssignment } from "./types";
import type { UpperLimbMotorScreenAssignmentsRow } from "@/app/lib/supabase/database.types";

const ASSIGNMENT: UpperLimbMotorScreenAssignment = {
  id: "assignment-1",
  screenDefinitionId: "upper-limb-motor-screen-v1",
  status: "assigned",
  assignedAt: "2026-08-17T10:00:00.000Z",
  assignedBy: "provider-1",
  affectedSide: "right",
  configuration: {
    startingSittingPosition: "chair_with_armrests",
    backTrunkSupport: "full_back_support",
    affectedArmSupport: "armrest",
    baselinePainScore: 2,
    permittedMovementRange: { kind: "not_applicable" },
    caregiverSupervisionRequirement: "not_required",
    deliveryMode: "in_clinic",
    patientSpecificStopCriteria: [],
  },
  taskAssignmentGroups: [
    {
      taskId: "forwardReach",
      testedSide: "right",
      eligible: true,
      attempts: 5,
      restPeriodSeconds: 30,
      targetPlacement: { direction: "forward", height: "shoulder height", distance: "arm's length" },
    },
  ],
};

describe("buildUpperLimbMotorScreenAssignmentInsert", () => {
  it("builds a row matching 019's column shape", () => {
    const row = buildUpperLimbMotorScreenAssignmentInsert({
      providerId: "provider-1",
      patientId: "patient-1",
      assignment: ASSIGNMENT,
    });

    assert.equal(row.id, ASSIGNMENT.id);
    assert.equal(row.provider_id, "provider-1");
    assert.equal(row.patient_id, "patient-1");
    assert.equal(row.status, "assigned");
    assert.deepEqual(row.assignment_payload, ASSIGNMENT);
    assert.equal(row.schema_version, UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION);
  });

  it("assignment_payload.id and .status always match the row's own id/status (019's CHECK constraints)", () => {
    const row = buildUpperLimbMotorScreenAssignmentInsert({
      providerId: "provider-1",
      patientId: "patient-1",
      assignment: ASSIGNMENT,
    });
    assert.equal(row.assignment_payload.id, row.id);
    assert.equal(row.assignment_payload.status, row.status);
  });
});

describe("toUpperLimbMotorScreenAssignmentPublic", () => {
  it("maps a DB row back to the public response shape", () => {
    const row: UpperLimbMotorScreenAssignmentsRow = {
      id: ASSIGNMENT.id,
      provider_id: "provider-1",
      patient_id: "patient-1",
      status: "assigned",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assignment_payload: ASSIGNMENT as any,
      schema_version: UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION,
      assignment_request_id: null,
      assignment_request_payload_hash: null,
      screen_definition_id: null,
      assigned_at: null,
      affected_side: null,
      delivery_mode: null,
      token_hash: null,
      token_expires_at: null,
      created_at: "2026-08-17T10:00:01.000Z",
      updated_at: "2026-08-17T10:00:01.000Z",
    };

    const publicRow = toUpperLimbMotorScreenAssignmentPublic(row, true);
    assert.deepEqual(publicRow.assignment, ASSIGNMENT);
    assert.equal(publicRow.patientId, "patient-1");
    assert.equal(publicRow.providerId, "provider-1");
    assert.equal(publicRow.createdAt, "2026-08-17T10:00:01.000Z");
  });
});
