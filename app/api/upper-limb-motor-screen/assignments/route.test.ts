/**
 * Run:
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/api/upper-limb-motor-screen/assignments/route.test.ts"
 *
 * Uses createUpperLimbAssignmentPostHandler(deps) directly, injecting
 * fakes for auth, rate limiting, id/clock generation, and a minimal
 * fake Supabase admin client — no real Next.js server, Supabase
 * client, or database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUpperLimbAssignmentPostHandler,
  type UpperLimbAssignmentPostDependencies,
} from "./route";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const GENERATED_ID = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "44444444-4444-4444-4444-444444444444";
const NOW = "2026-08-17T10:00:00.000Z";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeRequest(body: unknown | (() => unknown)): any {
  return {
    json: async () => {
      if (typeof body === "function") return (body as () => unknown)();
      return body;
    },
  };
}

function validConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    startingSittingPosition: "chair_with_armrests",
    backTrunkSupport: "full_back_support",
    affectedArmSupport: "armrest",
    baselinePainScore: 2,
    permittedMovementRange: { kind: "not_applicable" },
    caregiverSupervisionRequirement: "not_required",
    deliveryMode: "in_clinic",
    patientSpecificStopCriteria: [],
    ...overrides,
  };
}

function taskGroup(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "forwardReach",
    testedSide: "right",
    eligible: true,
    attempts: 5,
    restPeriodSeconds: 30,
    targetPlacement: { direction: "forward", height: "shoulder height", distance: "arm's length" },
    ...overrides,
  };
}

const VALID_BODY = {
  patientId: PATIENT_ID,
  screenDefinitionId: "upper-limb-motor-screen-v1",
  affectedSide: "right",
  configuration: validConfiguration(),
  taskAssignmentGroups: [taskGroup()],
  assignmentRequestId: REQUEST_ID,
};

type FakeResult = { data: unknown; error: { code?: string; message: string } | null };

type FakeAdminOptions = {
  patientLookup?: FakeResult;
  rpcResult?: FakeResult | ((args: Record<string, unknown>) => FakeResult);
};

function buildFakeAdminClient(options: FakeAdminOptions = {}) {
  const rpcCalls: Record<string, unknown>[] = [];
  const patientEqCalls: [string, unknown][] = [];
  const patientLookup: FakeResult = options.patientLookup ?? {
    data: { id: PATIENT_ID, provider_id: PROVIDER_ID },
    error: null,
  };
  const defaultRpcResult: FakeResult = {
    data: null,
    error: { message: "rpc not configured for this test" },
  };

  const client = {
    from(table: string) {
      if (table === "patients") {
        return {
          select: () => ({
            eq: (column: string, value: unknown) => {
              patientEqCalls.push([column, value]);
              return {
                eq: (column2: string, value2: unknown) => {
                  patientEqCalls.push([column2, value2]);
                  return { single: async () => patientLookup };
                },
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table in fake admin client: ${table}`);
    },
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      if (typeof options.rpcResult === "function") {
        return options.rpcResult(args);
      }
      return options.rpcResult ?? defaultRpcResult;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { client, rpcCalls, patientEqCalls };
}

type BuildDepsOptions = {
  authenticated?: boolean;
  rateLimited?: boolean;
  admin?: FakeAdminOptions;
};

function buildDeps(options: BuildDepsOptions = {}) {
  const { client, rpcCalls, patientEqCalls } = buildFakeAdminClient(options.admin);
  const deps: UpperLimbAssignmentPostDependencies = {
    getAuthenticatedUser: async () =>
      options.authenticated === false ? null : { id: PROVIDER_ID },
    adminClient: client,
    checkWriteLimit: () =>
      options.rateLimited ? { allowed: false, retryAfterSec: 30 } : { allowed: true },
    generateId: () => GENERATED_ID,
    now: () => NOW,
  };
  return { deps, rpcCalls, patientEqCalls };
}

const INSERTED_ROW = {
  id: GENERATED_ID,
  provider_id: PROVIDER_ID,
  patient_id: PATIENT_ID,
  status: "assigned",
  assignment_payload: {
    id: GENERATED_ID,
    screenDefinitionId: VALID_BODY.screenDefinitionId,
    status: "assigned",
    assignedAt: NOW,
    assignedBy: PROVIDER_ID,
    affectedSide: VALID_BODY.affectedSide,
    configuration: VALID_BODY.configuration,
    taskAssignmentGroups: VALID_BODY.taskAssignmentGroups,
  },
  schema_version: "upper-limb-motor-screen/v1",
  created_at: NOW,
  updated_at: NOW,
};

function successRpc(created = true): FakeResult {
  return {
    data: { ...INSERTED_ROW, created },
    error: null,
  };
}

function omitKey<T extends Record<string, unknown>>(body: T, key: keyof T): Omit<T, typeof key> {
  const copy = { ...body };
  delete copy[key];
  return copy;
}

describe("POST /api/upper-limb-motor-screen/assignments", () => {
  it("unauthenticated request -> 401, no ownership lookup or rpc", async () => {
    const { deps, rpcCalls } = buildDeps({ authenticated: false });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 401);
    assert.deepEqual(rpcCalls, []);
  });

  it("rate-limited -> 429, no rpc", async () => {
    const { deps, rpcCalls } = buildDeps({ rateLimited: true });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 429);
    assert.deepEqual(rpcCalls, []);
  });

  it("invalid JSON body -> 400", async () => {
    const { deps } = buildDeps();
    const res = await createUpperLimbAssignmentPostHandler(deps)(
      fakeRequest(() => {
        throw new Error("not json");
      }),
    );
    assert.equal(res.status, 400);
  });

  it("missing patientId -> 400, no ownership lookup", async () => {
    const { deps, rpcCalls, patientEqCalls } = buildDeps();
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(omitKey(VALID_BODY, "patientId")));
    assert.equal(res.status, 400);
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(patientEqCalls, []);
  });

  it("malformed (non-UUID) patientId -> 400, no ownership lookup, no rpc", async () => {
    const { deps, rpcCalls, patientEqCalls } = buildDeps();
    const res = await createUpperLimbAssignmentPostHandler(deps)(
      fakeRequest({ ...VALID_BODY, patientId: "not-a-uuid" }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(patientEqCalls, []);
  });

  it("malformed patientId rejects a numeric/demo-style id too (never silently treated as ownable)", async () => {
    const { deps, rpcCalls, patientEqCalls } = buildDeps();
    const res = await createUpperLimbAssignmentPostHandler(deps)(
      fakeRequest({ ...VALID_BODY, patientId: "42" }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(patientEqCalls, []);
  });

  it("patient ownership failure -> 404, no rpc", async () => {
    const { deps, rpcCalls } = buildDeps({
      admin: { patientLookup: { data: null, error: { code: "PGRST116", message: "no rows" } } },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 404);
    assert.deepEqual(rpcCalls, []);
  });

  it("ownership lookup filters on exactly (id, patientId) then (provider_id, providerId) — regression guard against swapped columns/values", async () => {
    const { deps, patientEqCalls } = buildDeps({
      admin: { rpcResult: successRpc() },
    });
    await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.deepEqual(patientEqCalls, [
      ["id", PATIENT_ID],
      ["provider_id", PROVIDER_ID],
    ]);
  });

  it("invalid assignment shape (missing screenDefinitionId) -> 400, no rpc", async () => {
    const { deps, rpcCalls } = buildDeps();
    const res = await createUpperLimbAssignmentPostHandler(deps)(
      fakeRequest(omitKey(VALID_BODY, "screenDefinitionId")),
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.ok(json.reason);
    assert.deepEqual(rpcCalls, []);
  });

  it("successful creation -> 201, id/status/assignedAt/assignedBy are server-decided", async () => {
    const { deps, rpcCalls } = buildDeps({
      admin: { rpcResult: successRpc(true) },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 201);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcArgs = rpcCalls[0] as any;
    assert.equal(rpcArgs.p_assignment_id, GENERATED_ID);
    assert.equal(rpcArgs.p_provider_id, PROVIDER_ID);
    assert.equal(rpcArgs.p_patient_id, PATIENT_ID);
    assert.equal(rpcArgs.p_status, "assigned");
    assert.equal(rpcArgs.p_assignment_payload.assignedAt, NOW);
    assert.equal(rpcArgs.p_assignment_payload.assignedBy, PROVIDER_ID);
    assert.equal(rpcArgs.p_assignment_request_id, REQUEST_ID);
    assert.equal(typeof rpcArgs.p_assignment_request_payload_hash, "string");
  });

  it("attacker-supplied unknown top-level fields are rejected before rpc", async () => {
    const { deps, rpcCalls } = buildDeps({
      admin: { rpcResult: successRpc(true) },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(
      fakeRequest({
        ...VALID_BODY,
        id: "attacker-id",
        status: "completed",
        assignedBy: "attacker-provider",
        providerId: "attacker-provider",
      }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(rpcCalls, []);
  });

  it("idempotent replay -> 200 with created=false", async () => {
    const { deps } = buildDeps({
      admin: { rpcResult: successRpc(false) },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.created, false);
  });

  it("idempotency conflict -> sanitized 409", async () => {
    const { deps } = buildDeps({
      admin: {
        rpcResult: {
          data: null,
          error: {
            message:
              "create_upper_limb_motor_screen_assignment: assignment_request_id was already used for a different assignment",
          },
        },
      },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.ok(!JSON.stringify(json).includes("different assignment"));
  });

  it("rpc failure -> sanitized 500", async () => {
    const { deps } = buildDeps({
      admin: { rpcResult: { data: null, error: { message: "unexpected database failure" } } },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.ok(!JSON.stringify(json).includes("database failure"));
  });

  it("14. legacy caller without assignmentRequestId still reaches rpc with null idempotency fields", async () => {
    const { deps, rpcCalls } = buildDeps({
      admin: { rpcResult: successRpc(true) },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(
      fakeRequest(omitKey(VALID_BODY, "assignmentRequestId")),
    );
    assert.equal(res.status, 201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcArgs = rpcCalls[0] as any;
    assert.equal(rpcArgs.p_assignment_request_id, null);
    assert.equal(rpcArgs.p_assignment_request_payload_hash, null);
  });

  it("14b. cross-provider ownership failure remains 404 without rpc side effects", async () => {
    const { deps, rpcCalls } = buildDeps({
      admin: {
        patientLookup: { data: null, error: { code: "PGRST116", message: "no rows" } },
      },
    });
    const res = await createUpperLimbAssignmentPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 404);
    assert.deepEqual(rpcCalls, []);
  });
});
