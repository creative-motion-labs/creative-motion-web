/**
 * Run: npx tsx --test app/lib/clinical/clinical-prescribed-side-contract.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCatalogPlanPostHandler } from "@/app/api/plans/from-catalog-program/route";
import { mapPlanSessionRowsToPatientSessions } from "@/app/api/patient/plan/route";
import {
  CreatePlanFromCatalogProgramError,
  type CreatePlanFromCatalogProgramInput,
  type CreatePlanFromCatalogProgramResult,
} from "@/app/lib/rehab-programs/create-plan-from-catalog-program";
import {
  validateGuidedPlanSessionPrescriptions,
} from "./clinical-prescribed-side";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const PROGRAM_ID = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "44444444-4444-4444-4444-444444444444";

function fakeRequest(body: unknown) {
  return {
    json: async () => body,
  };
}

function capabilityAdminClient(available = true) {
  return {
    from() {
      return {
        select() {
          return {
            limit: async () => {
              if (available) return { error: null };
              return {
                error: {
                  code: "42703",
                  message: 'column "prescribed_side" does not exist',
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("clinical prescribed-side contract", () => {
  it("1. valid guided clinician session with left persists left on insert payload", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "left" },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prescribedSideBySessionNumber.get(1), "left");
  });

  it("2. valid guided clinician session with right persists right on insert payload", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "right" },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prescribedSideBySessionNumber.get(1), "right");
  });

  it("3. catalog plan creation forwards session prescriptions to the RPC wrapper", async () => {
    const createPlanCalls: CreatePlanFromCatalogProgramInput[] = [];
    const handler = createCatalogPlanPostHandler({
      getAuthenticatedUser: async () => ({ id: PROVIDER_ID }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adminClient: capabilityAdminClient() as any,
      checkWriteLimit: () => ({ allowed: true }),
      createPlan: async (_client, input) => {
        createPlanCalls.push(input);
        return {
          planId: "66666666-6666-6666-6666-666666666666",
          sessionIds: ["77777777-7777-7777-7777-777777777777"],
          patientToken: "token",
          created: true,
        } satisfies CreatePlanFromCatalogProgramResult;
      },
    });

    const res = await handler(
      fakeRequest({
        patientId: PATIENT_ID,
        treatmentProgramId: PROGRAM_ID,
        catalogAssignmentRequestId: REQUEST_ID,
        sessions: [{ sessionNumber: 1, prescribedSide: "left" }],
      }),
    );

    assert.equal(res.status, 201);
    assert.deepEqual(createPlanCalls[0]?.sessionPrescribedSides, [
      { sessionNumber: 1, prescribedSide: "left" },
    ]);
  });

  it("4. patient-plan mapper returns stored prescribedSide from plan_sessions", () => {
    const mapped = mapPlanSessionRowsToPatientSessions(
      [{
        id: "session-a",
        session_number: 1,
        title: "Session 1",
        exercises: [],
        status: "upcoming",
        scheduled_at: null,
        completed_at: null,
        source_program_session_id: null,
        prescribed_side: "right",
      }],
      new Map(),
    );

    assert.equal(mapped[0]?.prescribedSide, "right");
  });

  it("5. existing session with null prescribed_side serializes as null", () => {
    const mapped = mapPlanSessionRowsToPatientSessions(
      [{
        id: "legacy-session",
        session_number: 1,
        title: "Lower limb",
        exercises: [{ exerciseId: "sit-to-stand", sets: 3, reps: "8-10" }],
        status: "upcoming",
        scheduled_at: null,
        completed_at: null,
        source_program_session_id: null,
        prescribed_side: null,
      }],
      new Map(),
    );

    assert.equal(mapped[0]?.prescribedSide, null);
  });

  it("6. invalid prescribedSide values are rejected for guided plans", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "north" },
    ]);
    assert.equal(result.ok, false);
  });

  it("7. bilateral is rejected as a prescription value", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "bilateral" },
    ]);
    assert.equal(result.ok, false);
  });

  it("8. missing prescribedSide does not become right", () => {
    const result = validateGuidedPlanSessionPrescriptions([{ sessionNumber: 1 }]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prescribedSideBySessionNumber.size, 0);
  });

  it("9. catalog route rejects patient-authoritative unknown body fields", async () => {
    const handler = createCatalogPlanPostHandler({
      getAuthenticatedUser: async () => ({ id: PROVIDER_ID }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adminClient: capabilityAdminClient() as any,
      checkWriteLimit: () => ({ allowed: true }),
      createPlan: async () => {
        throw new Error("should not be called");
      },
    });

    const res = await handler(
      fakeRequest({
        patientId: PATIENT_ID,
        treatmentProgramId: PROGRAM_ID,
        catalogAssignmentRequestId: REQUEST_ID,
        prescribedSide: "left",
      }),
    );

    assert.equal(res.status, 400);
  });

  it("10. side from one session cannot leak into another session", () => {
    const result = validateGuidedPlanSessionPrescriptions([
      { sessionNumber: 1, prescribedSide: "left" },
      { sessionNumber: 2 },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prescribedSideBySessionNumber.get(1), "left");
    assert.equal(result.prescribedSideBySessionNumber.get(2), undefined);
  });

  it("11. legacy lower-limb sessions remain compatible without prescribedSide", () => {
    const mapped = mapPlanSessionRowsToPatientSessions(
      [{
        id: "legacy-1",
        session_number: 1,
        title: "Sit to stand",
        exercises: [{ exerciseId: "sit-to-stand", sets: 3, reps: "8-10" }],
        status: "upcoming",
        scheduled_at: null,
        completed_at: null,
        source_program_session_id: null,
        prescribed_side: null,
      }],
      new Map(),
    );

    assert.equal(mapped[0]?.prescribedSide, null);
  });

  it("12. catalog route does not accept volunteer research fields", async () => {
    const handler = createCatalogPlanPostHandler({
      getAuthenticatedUser: async () => ({ id: PROVIDER_ID }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adminClient: capabilityAdminClient() as any,
      checkWriteLimit: () => ({ allowed: true }),
      createPlan: async () => {
        throw new CreatePlanFromCatalogProgramError("invalid_input", "nope");
      },
    });

    const res = await handler(
      fakeRequest({
        patientId: PATIENT_ID,
        treatmentProgramId: PROGRAM_ID,
        catalogAssignmentRequestId: REQUEST_ID,
        campaignCode: "VOLUNTEER",
      }),
    );

    assert.equal(res.status, 400);
  });

  it("13. patient-plan mapper does not expose internal provider or patient ids", () => {
    const mapped = mapPlanSessionRowsToPatientSessions(
      [{
        id: "session-a",
        session_number: 1,
        title: "Session 1",
        exercises: [],
        status: "upcoming",
        scheduled_at: null,
        completed_at: null,
        source_program_session_id: null,
        prescribed_side: "left",
      }],
      new Map(),
    );

    const session = mapped[0]!;
    assert.equal("providerId" in session, false);
    assert.equal("patientId" in session, false);
    assert.equal("provider_id" in session, false);
    assert.equal("patient_id" in session, false);
    assert.deepEqual(Object.keys(session).sort(), [
      "completedAt",
      "exercises",
      "id",
      "prescribedSide",
      "scheduledAt",
      "sessionNumber",
      "status",
      "title",
    ]);
  });
});
