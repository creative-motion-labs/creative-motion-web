/**
 * Run:
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/lib/upper-limb-motor-screen/create-upper-limb-motor-screen-assignment.test.ts"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateUpperLimbMotorScreenAssignmentError,
  createUpperLimbMotorScreenAssignment,
  hashForwardReachAssignmentRequestPayload,
} from "./create-upper-limb-motor-screen-assignment";
import {
  buildForwardReachAssignmentCreatePayload,
  createEmptyForwardReachAssignmentForm,
  type ForwardReachAssignmentFormState,
} from "./forward-reach-assignment-client";
import type { UpperLimbMotorScreenAssignment } from "./types";
import { UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION } from "./schema-version";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_A = "22222222-2222-2222-2222-222222222222";
const PATIENT_B = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "44444444-4444-4444-4444-444444444444";
const ASSIGNMENT_ID = "55555555-5555-5555-5555-555555555555";

function validForm(overrides: Partial<ForwardReachAssignmentFormState> = {}): ForwardReachAssignmentFormState {
  return {
    ...createEmptyForwardReachAssignmentForm(),
    affectedSide: "right",
    testedSide: "right",
    startingSittingPosition: "chair_with_armrests",
    backTrunkSupport: "full_back_support",
    affectedArmSupport: "armrest",
    baselinePainScore: "2",
    permittedMovementRangeKind: "not_applicable",
    permittedMovementRangeDescription: "",
    caregiverSupervisionRequirement: "not_required",
    deliveryMode: "in_clinic",
    patientSpecificStopCriteria: "",
    eligible: true,
    attempts: "5",
    restPeriodSeconds: "30",
    targetDirection: "forward",
    targetHeight: "shoulder height",
    targetDistance: "arm's length",
    ...overrides,
  };
}

function buildAssignment(id: string): UpperLimbMotorScreenAssignment {
  return {
    id,
    screenDefinitionId: "upper-limb-motor-screen-v1",
    status: "assigned",
    assignedAt: "2026-08-26T10:00:00.000Z",
    assignedBy: PROVIDER_ID,
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
}

type StoredRow = {
  provider_id: string;
  patient_id: string;
  assignment_request_id: string;
  assignment_request_payload_hash: string;
  id: string;
  status: string;
  assignment_payload: UpperLimbMotorScreenAssignment;
  schema_version: string;
  created_at: string;
  updated_at: string;
};

function createInMemoryRpcClient() {
  const rows = new Map<string, StoredRow>();

  function key(providerId: string, requestId: string) {
    return `${providerId}:${requestId}`;
  }

  return {
    rows,
    client: {
      rpc: async (
        fn: string,
        args: {
          p_provider_id: string;
          p_patient_id: string;
          p_assignment_request_id: string | null;
          p_assignment_request_payload_hash: string | null;
          p_assignment_id: string;
          p_status: string;
          p_assignment_payload: UpperLimbMotorScreenAssignment;
          p_schema_version: string;
        },
      ) => {
        assert.equal(fn, "create_upper_limb_motor_screen_assignment");

        if (args.p_assignment_request_id === null) {
          const now = "2026-08-26T10:00:00.000Z";
          return {
            data: {
              id: args.p_assignment_id,
              created: true,
              provider_id: args.p_provider_id,
              patient_id: args.p_patient_id,
              status: args.p_status,
              assignment_payload: args.p_assignment_payload,
              schema_version: args.p_schema_version,
              created_at: now,
              updated_at: now,
            },
            error: null,
          };
        }

        const lookup = rows.get(key(args.p_provider_id, args.p_assignment_request_id));
        if (lookup) {
          if (
            lookup.patient_id !== args.p_patient_id ||
            lookup.assignment_request_payload_hash !== args.p_assignment_request_payload_hash
          ) {
            return {
              data: null,
              error: {
                message:
                  "create_upper_limb_motor_screen_assignment: assignment_request_id was already used for a different assignment",
              },
            };
          }
          return {
            data: {
              id: lookup.id,
              created: false,
              provider_id: lookup.provider_id,
              patient_id: lookup.patient_id,
              status: lookup.status,
              assignment_payload: lookup.assignment_payload,
              schema_version: lookup.schema_version,
              created_at: lookup.created_at,
              updated_at: lookup.updated_at,
            },
            error: null,
          };
        }

        const existingKey = key(args.p_provider_id, args.p_assignment_request_id);
        if (rows.has(existingKey)) {
          const row = rows.get(existingKey)!;
          return {
            data: {
              id: row.id,
              created: false,
              provider_id: row.provider_id,
              patient_id: row.patient_id,
              status: row.status,
              assignment_payload: row.assignment_payload,
              schema_version: row.schema_version,
              created_at: row.created_at,
              updated_at: row.updated_at,
            },
            error: null,
          };
        }

        const now = "2026-08-26T10:00:00.000Z";
        const row: StoredRow = {
          provider_id: args.p_provider_id,
          patient_id: args.p_patient_id,
          assignment_request_id: args.p_assignment_request_id,
          assignment_request_payload_hash: args.p_assignment_request_payload_hash ?? "",
          id: args.p_assignment_id,
          status: args.p_status,
          assignment_payload: args.p_assignment_payload,
          schema_version: args.p_schema_version,
          created_at: now,
          updated_at: now,
        };
        rows.set(existingKey, row);

        return {
          data: {
            id: row.id,
            created: true,
            provider_id: row.provider_id,
            patient_id: row.patient_id,
            status: row.status,
            assignment_payload: row.assignment_payload,
            schema_version: row.schema_version,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
          error: null,
        };
      },
    },
  };
}

describe("createUpperLimbMotorScreenAssignment", () => {
  it("5. same request ID + same payload replays the original result", async () => {
    const { client } = createInMemoryRpcClient();
    const payload = buildForwardReachAssignmentCreatePayload(PATIENT_A, validForm());
    assert.ok(payload);
    const hash = hashForwardReachAssignmentRequestPayload({ ...payload, assignmentRequestId: REQUEST_ID });
    const assignment = buildAssignment(ASSIGNMENT_ID);

    const first = await createUpperLimbMotorScreenAssignment(client as never, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_A,
      assignmentRequestId: REQUEST_ID,
      assignmentRequestPayloadHash: hash,
      assignment,
    });
    assert.equal(first.created, true);

    const replay = await createUpperLimbMotorScreenAssignment(client as never, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_A,
      assignmentRequestId: REQUEST_ID,
      assignmentRequestPayloadHash: hash,
      assignment: buildAssignment("different-id-should-not-be-used"),
    });
    assert.equal(replay.created, false);
    assert.equal(replay.row.id, ASSIGNMENT_ID);
  });

  it("6. same request ID + changed patient returns idempotency_conflict", async () => {
    const { client } = createInMemoryRpcClient();
    const payload = buildForwardReachAssignmentCreatePayload(PATIENT_A, validForm());
    assert.ok(payload);
    const hash = hashForwardReachAssignmentRequestPayload({ ...payload, assignmentRequestId: REQUEST_ID });

    await createUpperLimbMotorScreenAssignment(client as never, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_A,
      assignmentRequestId: REQUEST_ID,
      assignmentRequestPayloadHash: hash,
      assignment: buildAssignment(ASSIGNMENT_ID),
    });

    await assert.rejects(
      () =>
        createUpperLimbMotorScreenAssignment(client as never, {
          providerId: PROVIDER_ID,
          patientId: PATIENT_B,
          assignmentRequestId: REQUEST_ID,
          assignmentRequestPayloadHash: hash,
          assignment: buildAssignment("66666666-6666-6666-6666-666666666666"),
        }),
      (error: unknown) => {
        assert.ok(error instanceof CreateUpperLimbMotorScreenAssignmentError);
        assert.equal(error.reason, "idempotency_conflict");
        return true;
      },
    );
  });

  it("6b. same request ID + changed payload returns idempotency_conflict", async () => {
    const { client } = createInMemoryRpcClient();
    const payloadA = buildForwardReachAssignmentCreatePayload(PATIENT_A, validForm());
    const payloadB = buildForwardReachAssignmentCreatePayload(
      PATIENT_A,
      validForm({ testedSide: "left" }),
    );
    assert.ok(payloadA);
    assert.ok(payloadB);
    const hashA = hashForwardReachAssignmentRequestPayload({
      ...payloadA,
      assignmentRequestId: REQUEST_ID,
    });
    const hashB = hashForwardReachAssignmentRequestPayload({
      ...payloadB,
      assignmentRequestId: REQUEST_ID,
    });

    await createUpperLimbMotorScreenAssignment(client as never, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_A,
      assignmentRequestId: REQUEST_ID,
      assignmentRequestPayloadHash: hashA,
      assignment: buildAssignment(ASSIGNMENT_ID),
    });

    await assert.rejects(
      () =>
        createUpperLimbMotorScreenAssignment(client as never, {
          providerId: PROVIDER_ID,
          patientId: PATIENT_A,
          assignmentRequestId: REQUEST_ID,
          assignmentRequestPayloadHash: hashB,
          assignment: buildAssignment("77777777-7777-7777-7777-777777777777"),
        }),
      (error: unknown) => {
        assert.ok(error instanceof CreateUpperLimbMotorScreenAssignmentError);
        assert.equal(error.reason, "idempotency_conflict");
        return true;
      },
    );
  });

  it("7. concurrent same-key submissions create one stored record", async () => {
    const { client, rows } = createInMemoryRpcClient();
    const payload = buildForwardReachAssignmentCreatePayload(PATIENT_A, validForm());
    assert.ok(payload);
    const hash = hashForwardReachAssignmentRequestPayload({ ...payload, assignmentRequestId: REQUEST_ID });

    const [first, second] = await Promise.all([
      createUpperLimbMotorScreenAssignment(client as never, {
        providerId: PROVIDER_ID,
        patientId: PATIENT_A,
        assignmentRequestId: REQUEST_ID,
        assignmentRequestPayloadHash: hash,
        assignment: buildAssignment("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      }),
      createUpperLimbMotorScreenAssignment(client as never, {
        providerId: PROVIDER_ID,
        patientId: PATIENT_A,
        assignmentRequestId: REQUEST_ID,
        assignmentRequestPayloadHash: hash,
        assignment: buildAssignment("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      }),
    ]);

    assert.equal(rows.size, 1);
    assert.equal(first.row.id, second.row.id);
    assert.ok(first.created !== second.created);
  });

  it("13. legacy null request ID path remains available", async () => {
    const { client } = createInMemoryRpcClient();
    const result = await createUpperLimbMotorScreenAssignment(client as never, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_A,
      assignmentRequestId: null,
      assignmentRequestPayloadHash: null,
      assignment: buildAssignment(ASSIGNMENT_ID),
    });
    assert.equal(result.created, true);
    assert.equal(result.row.schema_version, UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION);
  });
});
