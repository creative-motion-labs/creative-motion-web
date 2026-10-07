/**
 * Run:
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register --test "app/api/upper-limb-motor-screen/session-results/route.test.ts"
 *
 * Uses createUpperLimbSessionResultPostHandler(deps) directly,
 * injecting fakes for auth, rate limiting, id generation, and a
 * minimal fake Supabase admin client — no real Next.js server,
 * Supabase client, or database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUpperLimbSessionResultPostHandler,
  type UpperLimbSessionResultPostDependencies,
} from "./route";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const ASSIGNMENT_ID = "33333333-3333-3333-3333-333333333333";
const GENERATED_ID = "44444444-4444-4444-4444-444444444444";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeRequest(body: unknown | (() => unknown)): any {
  return {
    json: async () => {
      if (typeof body === "function") return (body as () => unknown)();
      return body;
    },
  };
}

const VALID_BODY = {
  assignmentId: ASSIGNMENT_ID,
  taskCompletion: [{ taskId: "lateralReach", testedSide: "right", completionState: "completed" }],
  attempts: [],
  clinicalStopEvents: [],
  overallTrackingQuality: "unknown",
  longestPauseGapMs: 0,
  trunkCompensationObserved: null,
  asymmetryNotes: [],
};

type FakeResult = { data: unknown; error: { code?: string; message: string } | null };

type FakeAdminOptions = {
  assignmentLookup?: FakeResult;
  insertResult?: FakeResult;
};

function buildFakeAdminClient(options: FakeAdminOptions = {}) {
  const insertCalls: unknown[] = [];
  // Records the exact (column, value) pairs the assignment-ownership
  // lookup filters on, in call order — see the assignments route test
  // for why this matters: a swapped column/value would still "work"
  // against a naive fake but must fail this regression assertion.
  const assignmentEqCalls: [string, unknown][] = [];
  const assignmentLookup: FakeResult = options.assignmentLookup ?? {
    data: { id: ASSIGNMENT_ID, provider_id: PROVIDER_ID, patient_id: PATIENT_ID },
    error: null,
  };
  const insertResult: FakeResult = options.insertResult ?? {
    data: null,
    error: { message: "insert not configured for this test" },
  };

  const client = {
    from(table: string) {
      if (table === "upper_limb_motor_screen_assignments") {
        return {
          select: () => ({
            eq: (column: string, value: unknown) => {
              assignmentEqCalls.push([column, value]);
              return {
                eq: (column2: string, value2: unknown) => {
                  assignmentEqCalls.push([column2, value2]);
                  return { maybeSingle: async () => assignmentLookup };
                },
              };
            },
          }),
        };
      }
      if (table === "upper_limb_motor_screen_session_results") {
        return {
          insert: (payload: unknown) => {
            insertCalls.push(payload);
            return {
              select: () => ({
                single: async () => insertResult,
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table in fake admin client: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { client, insertCalls, assignmentEqCalls };
}

type BuildDepsOptions = {
  authenticated?: boolean;
  rateLimited?: boolean;
  admin?: FakeAdminOptions;
};

function buildDeps(options: BuildDepsOptions = {}) {
  const { client, insertCalls, assignmentEqCalls } = buildFakeAdminClient(options.admin);
  const deps: UpperLimbSessionResultPostDependencies = {
    getAuthenticatedUser: async () =>
      options.authenticated === false ? null : { id: PROVIDER_ID },
    adminClient: client,
    checkWriteLimit: () =>
      options.rateLimited ? { allowed: false, retryAfterSec: 30 } : { allowed: true },
    generateId: () => GENERATED_ID,
  };
  return { deps, insertCalls, assignmentEqCalls };
}

const INSERTED_ROW = {
  id: GENERATED_ID,
  assignment_id: ASSIGNMENT_ID,
  provider_id: PROVIDER_ID,
  patient_id: PATIENT_ID,
  status: "computed",
  result_payload: {
    id: GENERATED_ID,
    assignmentId: ASSIGNMENT_ID,
    status: "computed",
    taskCompletion: VALID_BODY.taskCompletion,
    attempts: [],
    technicalTrackingQuality: {
      overallQuality: "unknown",
      protectivePauseCount: 0,
      protectivePauseDurationMsTotal: 0,
      longestPauseGapMs: 0,
    },
    interruptions: { clinicalStopEvents: [], protectivePauseEvents: [] },
    observedMovementFeatures: { trunkCompensationObserved: null, asymmetryNotes: [] },
  },
  overall_quality: "unknown",
  protective_pause_count: 0,
  protective_pause_duration_ms_total: 0,
  schema_version: "upper-limb-motor-screen/v1",
  created_at: "2026-08-17T10:00:00.000Z",
  updated_at: "2026-08-17T10:00:00.000Z",
};

describe("POST /api/upper-limb-motor-screen/session-results", () => {
  it("unauthenticated request -> 401, no ownership lookup or insert", async () => {
    const { deps, insertCalls } = buildDeps({ authenticated: false });
    const res = await createUpperLimbSessionResultPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 401);
    assert.deepEqual(insertCalls, []);
  });

  it("rate-limited -> 429, no insert", async () => {
    const { deps, insertCalls } = buildDeps({ rateLimited: true });
    const res = await createUpperLimbSessionResultPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 429);
    assert.deepEqual(insertCalls, []);
  });

  it("invalid JSON body -> 400", async () => {
    const { deps } = buildDeps();
    const res = await createUpperLimbSessionResultPostHandler(deps)(
      fakeRequest(() => {
        throw new Error("not json");
      }),
    );
    assert.equal(res.status, 400);
  });

  it("malformed request shape -> 400, no ownership lookup or insert", async () => {
    const { deps, insertCalls } = buildDeps();
    const res = await createUpperLimbSessionResultPostHandler(deps)(
      fakeRequest({ ...VALID_BODY, overallTrackingQuality: "excellent" }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(insertCalls, []);
  });

  it("assignment ownership failure -> 404, no insert", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: { assignmentLookup: { data: null, error: null } },
    });
    const res = await createUpperLimbSessionResultPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 404);
    assert.deepEqual(insertCalls, []);
  });

  it("ownership lookup filters on exactly (id, assignmentId) then (provider_id, providerId) — regression guard against swapped columns/values", async () => {
    const { deps, assignmentEqCalls } = buildDeps({
      admin: { insertResult: { data: INSERTED_ROW, error: null } },
    });
    await createUpperLimbSessionResultPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.deepEqual(assignmentEqCalls, [
      ["id", ASSIGNMENT_ID],
      ["provider_id", PROVIDER_ID],
    ]);
  });

  it("successful creation -> 201, provider_id/patient_id come only from the assignment row", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: { insertResult: { data: INSERTED_ROW, error: null } },
    });
    const res = await createUpperLimbSessionResultPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 201);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertedPayload = insertCalls[0] as any;
    assert.equal(insertedPayload.id, GENERATED_ID);
    assert.equal(insertedPayload.provider_id, PROVIDER_ID);
    assert.equal(insertedPayload.patient_id, PATIENT_ID);
    assert.equal(insertedPayload.status, "computed");
  });

  it("attacker-supplied provider_id/patient_id/status/id in the body are ignored", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: { insertResult: { data: INSERTED_ROW, error: null } },
    });
    await createUpperLimbSessionResultPostHandler(deps)(
      fakeRequest({
        ...VALID_BODY,
        id: "attacker-id",
        status: "finalized",
        providerId: "attacker-provider",
        patientId: "attacker-patient",
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertedPayload = insertCalls[0] as any;
    assert.equal(insertedPayload.id, GENERATED_ID);
    assert.equal(insertedPayload.status, "computed");
    assert.equal(insertedPayload.provider_id, PROVIDER_ID);
    assert.equal(insertedPayload.patient_id, PATIENT_ID);
  });

  it("insert failure -> sanitized 500", async () => {
    const { deps } = buildDeps({
      admin: { insertResult: { data: null, error: { message: "duplicate key value violates unique constraint" } } },
    });
    const res = await createUpperLimbSessionResultPostHandler(deps)(fakeRequest(VALID_BODY));
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.ok(!JSON.stringify(json).includes("unique constraint"));
  });
});
