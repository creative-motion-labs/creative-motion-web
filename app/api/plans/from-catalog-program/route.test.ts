/**
 * Run: npx tsx --test app/api/plans/from-catalog-program/route.test.ts
 *
 * Uses createCatalogPlanPostHandler(deps) directly, injecting fakes for
 * auth, rate limiting, the admin client, and the RPC wrapper — no
 * node:test mock.module (unavailable in this execution environment)
 * and no real Next.js server, Supabase client, or database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCatalogPlanPostHandler,
  type CatalogPlanPostDependencies,
} from "./route";
import {
  CreatePlanFromCatalogProgramError,
  type CreatePlanFromCatalogProgramInput,
  type CreatePlanFromCatalogProgramResult,
} from "../../../lib/rehab-programs/create-plan-from-catalog-program";

// ── Fakes ────────────────────────────────────────────────────────────────────

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const PROGRAM_ID = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "44444444-4444-4444-4444-444444444444";
const ASSESSMENT_ID = "55555555-5555-5555-5555-555555555555";

const SUCCESS_RESULT: CreatePlanFromCatalogProgramResult = {
  planId: "66666666-6666-6666-6666-666666666666",
  sessionIds: ["77777777-7777-7777-7777-777777777777"],
  patientToken: "a-persisted-token",
  created: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeRequest(body: unknown | (() => unknown)): any {
  return {
    json: async () => {
      if (typeof body === "function") return (body as () => unknown)();
      return body;
    },
  };
}

type FakeDepsOptions = {
  authenticated?: boolean;
  rateLimited?: boolean;
  createPlanResult?: CreatePlanFromCatalogProgramResult;
  createPlanError?: Error;
  capabilityAvailable?: boolean;
  capabilityProbeOk?: boolean;
};

function buildCapabilityAdmin(available: boolean, ok = true) {
  return {
    from() {
      return {
        select() {
          return {
            limit: async () => {
              if (!ok) {
                return { error: { code: "42501", message: "permission denied" } };
              }
              if (available) {
                return { error: null };
              }
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

function buildFakeDeps(options: FakeDepsOptions = {}) {
  const createPlanCalls: { client: unknown; input: CreatePlanFromCatalogProgramInput }[] = [];

  const createPlan = async (
    client: unknown,
    input: CreatePlanFromCatalogProgramInput,
  ): Promise<CreatePlanFromCatalogProgramResult> => {
    createPlanCalls.push({ client, input });
    if (options.createPlanError) throw options.createPlanError;
    return options.createPlanResult ?? SUCCESS_RESULT;
  };

  const capabilityAvailable = options.capabilityAvailable ?? true;
  const capabilityProbeOk = options.capabilityProbeOk ?? true;
  const adminClientSentinel = buildCapabilityAdmin(capabilityAvailable, capabilityProbeOk);

  const deps: CatalogPlanPostDependencies = {
    getAuthenticatedUser: async () =>
      options.authenticated === false ? null : { id: PROVIDER_ID },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adminClient: adminClientSentinel as any,
    checkWriteLimit: () =>
      options.rateLimited ? { allowed: false, retryAfterSec: 30 } : { allowed: true },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPlan: createPlan as any,
  };

  return { deps, createPlanCalls, adminClientSentinel };
}

const VALID_BODY = {
  patientId: PATIENT_ID,
  treatmentProgramId: PROGRAM_ID,
  catalogAssignmentRequestId: REQUEST_ID,
  assessmentId: ASSESSMENT_ID,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/plans/from-catalog-program", () => {
  it("1. unauthenticated request -> 401, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps({ authenticated: false });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 401);
    assert.deepEqual(createPlanCalls, []);
  });

  it("2. invalid JSON body -> 400, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest(() => {
        throw new Error("not json");
      }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("3. missing required field (patientId) -> 400, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const rest = { ...VALID_BODY };
    delete (rest as Partial<typeof VALID_BODY>).patientId;
    const res = await handler(fakeRequest(rest));
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("4. malformed patientId -> 400, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest({ ...VALID_BODY, patientId: "not-a-uuid" }));
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("5. malformed treatmentProgramId -> 400, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest({ ...VALID_BODY, treatmentProgramId: "12345" }));
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("6. malformed catalogAssignmentRequestId -> 400, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest({ ...VALID_BODY, catalogAssignmentRequestId: "xyz" }));
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("7. malformed assessmentId -> 400, wrapper never called", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest({ ...VALID_BODY, assessmentId: "bad-id" }));
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("8. omitted/null assessmentId reaches the wrapper as null", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const rest = { ...VALID_BODY };
    delete (rest as Partial<typeof VALID_BODY>).assessmentId;
    const res = await handler(fakeRequest(rest));
    assert.equal(res.status, 201);
    assert.equal(createPlanCalls[0].input.assessmentId, null);
  });

  it("9. providerId comes only from auth.getUser()", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    await handler(fakeRequest(VALID_BODY));
    assert.equal(createPlanCalls[0].input.providerId, PROVIDER_ID);
  });

  it("10. attacker-supplied providerId in the body is rejected", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest({ ...VALID_BODY, providerId: "99999999-9999-9999-9999-999999999999" }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("11. attacker-supplied token/patientToken fields are rejected", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest({
        ...VALID_BODY,
        token: "attacker-token",
        patientToken: "attacker-patient-token",
      }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("12. exercises/blocks/provenance fields are rejected as unknown request fields", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest({
        ...VALID_BODY,
        exercises: ["fake-exercise"],
        blocks: [{ blockKey: "x" }],
        sourceTreatmentProgramId: "88888888-8888-8888-8888-888888888888",
        sourceProgramSessionId: "99999999-9999-9999-9999-999999999999",
      }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(createPlanCalls, []);
  });

  it("13. created:true -> 201", async () => {
    const { deps } = buildFakeDeps({ createPlanResult: { ...SUCCESS_RESULT, created: true } });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.created, true);
    assert.equal(json.id, SUCCESS_RESULT.planId);
    assert.equal(json.patient_token, SUCCESS_RESULT.patientToken);
    assert.deepEqual(json.sessions, [{ id: SUCCESS_RESULT.sessionIds[0] }]);
  });

  it("14. created:false -> 200", async () => {
    const { deps } = buildFakeDeps({ createPlanResult: { ...SUCCESS_RESULT, created: false } });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.created, false);
  });

  it("15. ownership_failed -> 404", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new CreatePlanFromCatalogProgramError("ownership_failed", "x"),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 404);
  });

  it("16. assessment_failed -> 404", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new CreatePlanFromCatalogProgramError("assessment_failed", "x"),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 404);
  });

  it("17. idempotency_conflict -> 409", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new CreatePlanFromCatalogProgramError("idempotency_conflict", "x"),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 409);
  });

  it("18. program_not_eligible -> 422", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new CreatePlanFromCatalogProgramError("program_not_eligible", "x"),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 422);
  });

  it("19. integrity_failed -> sanitized 500", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new CreatePlanFromCatalogProgramError(
        "integrity_failed",
        "catalog assignment integrity error -- no sourced sessions found",
      ),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.ok(!JSON.stringify(json).includes("no sourced sessions found"));
  });

  it("20. unexpected/rpc_failed -> sanitized 500", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new Error("some totally unexpected throw"),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.ok(!JSON.stringify(json).includes("some totally unexpected throw"));
  });

  it("21. raw SQL error text never appears in any response, across every error reason", async () => {
    const secretText = "duplicate key value violates unique constraint patient_access_tokens_token_key";
    const reasons = [
      "invalid_input",
      "ownership_failed",
      "assessment_failed",
      "program_not_eligible",
      "idempotency_conflict",
      "integrity_failed",
      "prescribed_side_unavailable",
      "rpc_failed",
    ] as const;
    for (const reason of reasons) {
      const { deps } = buildFakeDeps({
        createPlanError: new CreatePlanFromCatalogProgramError(reason, secretText),
      });
      const handler = createCatalogPlanPostHandler(deps);
      const res = await handler(fakeRequest(VALID_BODY));
      const json = await res.json();
      assert.ok(
        !JSON.stringify(json).includes("unique constraint"),
        `reason ${reason} leaked raw SQL text`,
      );
    }
  });

  it("22. rate-limit rejection preserves the existing route convention (429, no wrapper call)", async () => {
    const { deps, createPlanCalls } = buildFakeDeps({ rateLimited: true });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 429);
    assert.deepEqual(createPlanCalls, []);
  });

  it("6. catalog creation without side forwards an empty prescription list", async () => {
    const { deps, createPlanCalls } = buildFakeDeps();
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 201);
    assert.deepEqual(createPlanCalls[0]?.input.sessionPrescribedSides, []);
  });

  it("7. catalog creation without side succeeds when migration capability is unavailable", async () => {
    const { deps, createPlanCalls } = buildFakeDeps({ capabilityAvailable: false });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(fakeRequest(VALID_BODY));
    assert.equal(res.status, 201);
    assert.equal(createPlanCalls.length, 1);
  });

  it("9. side-aware catalog creation returns 503 before wrapper call when capability is unavailable", async () => {
    const { deps, createPlanCalls } = buildFakeDeps({ capabilityAvailable: false });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest({
        ...VALID_BODY,
        sessions: [{ sessionNumber: 1, prescribedSide: "left" }],
      }),
    );
    assert.equal(res.status, 503);
    assert.deepEqual(createPlanCalls, []);
    const json = await res.json();
    assert.equal(json.error, "Service temporarily unavailable.");
  });

  it("9b. side-aware RPC unavailable maps to sanitized 503 response", async () => {
    const { deps } = buildFakeDeps({
      createPlanError: new CreatePlanFromCatalogProgramError(
        "prescribed_side_unavailable",
        "Could not create the treatment plan.",
      ),
    });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest({
        ...VALID_BODY,
        sessions: [{ sessionNumber: 1, prescribedSide: "right" }],
      }),
    );
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.error, "Service temporarily unavailable.");
  });

  it("10. unrelated capability probe failures return 500 without calling wrapper", async () => {
    const { deps, createPlanCalls } = buildFakeDeps({ capabilityProbeOk: false });
    const handler = createCatalogPlanPostHandler(deps);
    const res = await handler(
      fakeRequest({
        ...VALID_BODY,
        sessions: [{ sessionNumber: 1, prescribedSide: "left" }],
      }),
    );
    assert.equal(res.status, 500);
    assert.deepEqual(createPlanCalls, []);
  });
});
