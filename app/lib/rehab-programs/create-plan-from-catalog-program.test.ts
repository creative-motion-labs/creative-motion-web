/**
 * Run: npx tsx --test app/lib/rehab-programs/create-plan-from-catalog-program.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPlanFromCatalogProgram,
  CreatePlanFromCatalogProgramError,
} from "./create-plan-from-catalog-program";

// ── Minimal mocked Supabase client ──────────────────────────────────────
//
// Only implements .rpc(), which is all this wrapper ever calls. Captures
// the exact function name and parameter object passed, so tests can
// assert on both without depending on any real database.

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

function createMockClient(result: RpcResult) {
  const rpcCalls: { fn: string; params: unknown }[] = [];
  const client = {
    rpc(fn: string, params: unknown) {
      rpcCalls.push({ fn, params });
      return Promise.resolve(result);
    },
    rpcCalls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return client;
}

const VALID_INPUT = {
  providerId: "11111111-1111-1111-1111-111111111111",
  patientId: "22222222-2222-2222-2222-222222222222",
  treatmentProgramId: "33333333-3333-3333-3333-333333333333",
  assessmentId: null,
  catalogAssignmentRequestId: "44444444-4444-4444-4444-444444444444",
};

const SUCCESS_DATA = {
  planId: "55555555-5555-5555-5555-555555555555",
  sessionIds: ["66666666-6666-6666-6666-666666666666"],
  patientToken: "irrelevant-because-server-generates-its-own",
  created: true,
};

function expectReason(
  promise: Promise<unknown>,
  reason: string,
): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof CreatePlanFromCatalogProgramError);
    assert.equal(err.reason, reason);
    return true;
  }) as unknown as Promise<void>;
}

describe("createPlanFromCatalogProgram", () => {
  it("1. rejects missing providerId/patientId/treatmentProgramId before calling the RPC", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    await expectReason(
      createPlanFromCatalogProgram(client, { ...VALID_INPUT, patientId: "" }),
      "invalid_input",
    );
    assert.deepEqual(client.rpcCalls, []);
  });

  it("2. rejects missing catalogAssignmentRequestId before calling the RPC", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    await expectReason(
      createPlanFromCatalogProgram(client, { ...VALID_INPUT, catalogAssignmentRequestId: "" }),
      "invalid_input",
    );
    assert.deepEqual(client.rpcCalls, []);
  });

  it("3. calls the RPC with the exact expected function name and parameter keys", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    await createPlanFromCatalogProgram(client, VALID_INPUT);
    assert.equal(client.rpcCalls.length, 1);
    assert.equal(client.rpcCalls[0].fn, "create_plan_from_catalog_program");
    const params = client.rpcCalls[0].params as Record<string, unknown>;
    assert.equal(params.p_provider_id, VALID_INPUT.providerId);
    assert.equal(params.p_patient_id, VALID_INPUT.patientId);
    assert.equal(params.p_program_id, VALID_INPUT.treatmentProgramId);
    assert.equal(params.p_assessment_id, VALID_INPUT.assessmentId);
    assert.equal(params.p_catalog_assignment_request_id, VALID_INPUT.catalogAssignmentRequestId);
    assert.equal("p_session_prescribed_sides" in params, false);
  });

  it("8. includes the seventh RPC argument when session prescriptions are supplied", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    await createPlanFromCatalogProgram(client, {
      ...VALID_INPUT,
      sessionPrescribedSides: [{ sessionNumber: 1, prescribedSide: "left" }],
    });
    const params = client.rpcCalls[0].params as Record<string, unknown>;
    assert.deepEqual(params.p_session_prescribed_sides, [
      { sessionNumber: 1, prescribedSide: "left" },
    ]);
  });

  it("9. classifies missing seventh RPC argument as prescribed_side_unavailable", async () => {
    const client = createMockClient({
      data: null,
      error: {
        code: "PGRST202",
        message:
          "Searched for the function public.create_plan_from_catalog_program with parameters p_session_prescribed_sides",
      },
    });

    await expectReason(
      createPlanFromCatalogProgram(client, {
        ...VALID_INPUT,
        sessionPrescribedSides: [{ sessionNumber: 1, prescribedSide: "right" }],
      }),
      "prescribed_side_unavailable",
    );
  });

  it("4. generates a non-empty server-side token and passes it as p_patient_token", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    await createPlanFromCatalogProgram(client, VALID_INPUT);
    const params = client.rpcCalls[0].params as Record<string, unknown>;
    assert.equal(typeof params.p_patient_token, "string");
    assert.ok((params.p_patient_token as string).length > 0);
  });

  it("5. two calls generate two different tokens (real entropy, not a fixed value)", async () => {
    const clientA = createMockClient({ data: SUCCESS_DATA, error: null });
    const clientB = createMockClient({ data: SUCCESS_DATA, error: null });
    await createPlanFromCatalogProgram(clientA, VALID_INPUT);
    await createPlanFromCatalogProgram(clientB, VALID_INPUT);
    const tokenA = (clientA.rpcCalls[0].params as Record<string, unknown>).p_patient_token;
    const tokenB = (clientB.rpcCalls[0].params as Record<string, unknown>).p_patient_token;
    assert.notEqual(tokenA, tokenB);
  });

  it("6. never returns the token it generated -- returns the RPC's own patientToken", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    const result = await createPlanFromCatalogProgram(client, VALID_INPUT);
    assert.equal(result.patientToken, SUCCESS_DATA.patientToken);
    const sentToken = (client.rpcCalls[0].params as Record<string, unknown>).p_patient_token;
    assert.notEqual(result.patientToken, sentToken);
  });

  it("7. successful fresh creation returns created: true and the plan/session ids", async () => {
    const client = createMockClient({ data: SUCCESS_DATA, error: null });
    const result = await createPlanFromCatalogProgram(client, VALID_INPUT);
    assert.equal(result.planId, SUCCESS_DATA.planId);
    assert.deepEqual(result.sessionIds, SUCCESS_DATA.sessionIds);
    assert.equal(result.created, true);
  });

  it("8. idempotent replay (created: false) is passed through unchanged", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, created: false }, error: null });
    const result = await createPlanFromCatalogProgram(client, VALID_INPUT);
    assert.equal(result.created, false);
  });

  it("9. a 'required' RPC error is classified as invalid_input", async () => {
    const client = createMockClient({
      data: null,
      error: { message: "create_plan_from_catalog_program: patient_token is required" },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "invalid_input");
  });

  it("10. a 'not eligible for assignment' RPC error is classified as program_not_eligible", async () => {
    const client = createMockClient({
      data: null,
      error: {
        message: "create_plan_from_catalog_program: source treatment program is not eligible for assignment",
      },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "program_not_eligible");
  });

  it("11. an 'already used for a different assignment' RPC error is classified as idempotency_conflict", async () => {
    const client = createMockClient({
      data: null,
      error: {
        message: "create_plan_from_catalog_program: catalog_assignment_request_id was already used for a different assignment",
      },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "idempotency_conflict");
  });

  it("12. a 'patient/provider verification failed' RPC error is classified as ownership_failed", async () => {
    const client = createMockClient({
      data: null,
      error: { message: "create_plan_from_catalog_program: patient/provider verification failed" },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "ownership_failed");
  });

  it("13. an 'assessment verification failed' RPC error is classified as assessment_failed", async () => {
    const client = createMockClient({
      data: null,
      error: { message: "create_plan_from_catalog_program: assessment verification failed" },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "assessment_failed");
  });

  it("14. a 'catalog assignment integrity error' RPC error is classified as integrity_failed", async () => {
    const client = createMockClient({
      data: null,
      error: {
        message: "create_plan_from_catalog_program: catalog assignment integrity error -- no sourced sessions found",
      },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "integrity_failed");
  });

  it("15. a duplicate-token unique_violation is NOT promoted to a trusted reason -- remains rpc_failed", async () => {
    const client = createMockClient({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "patient_access_tokens_token_key" secret_detail',
      },
    });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("16. raw Postgres error text is never leaked into the thrown error message", async () => {
    const client = createMockClient({
      data: null,
      error: { message: "duplicate key value violates unique constraint \"patient_access_tokens_token_key\" secret_detail" },
    });
    await assert.rejects(
      () => createPlanFromCatalogProgram(client, VALID_INPUT),
      (err: unknown) => {
        assert.ok(err instanceof CreatePlanFromCatalogProgramError);
        assert.ok(!err.message.includes("secret_detail"));
        assert.ok(!err.message.includes("patient_access_tokens_token_key"));
        return true;
      },
    );
  });

  it("17. a malformed RPC result (missing planId) is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, planId: undefined }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("18. a non-UUID planId is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, planId: "not-a-uuid" }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("19. an empty sessionIds array is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, sessionIds: [] }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("20. a non-string session id is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, sessionIds: [123] }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("21. a malformed session UUID string is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, sessionIds: ["not-a-uuid"] }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("22. a blank patientToken is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, patientToken: "   " }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("23. a non-boolean created flag is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: { ...SUCCESS_DATA, created: "yes" }, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });

  it("24. a null RPC result with no error is rejected as rpc_failed", async () => {
    const client = createMockClient({ data: null, error: null });
    await expectReason(createPlanFromCatalogProgram(client, VALID_INPUT), "rpc_failed");
  });
});
