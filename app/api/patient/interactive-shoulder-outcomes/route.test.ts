/**
 * Run:
 *   npx tsx --test app/api/patient/interactive-shoulder-outcomes/route.test.ts
 *
 * Uses createInteractiveShoulderOutcomeSubmissionHandler(deps) directly,
 * injecting fakes for the feature flag, rate limiting, patient-access
 * resolution, and a minimal fake Supabase admin client covering only
 * plan_sessions and interactive_shoulder_movement_outcomes (the two
 * tables O1's persistence helpers touch) — no real Next.js server,
 * Supabase client, or database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInteractiveShoulderOutcomeSubmissionHandler,
  resolveInteractiveShoulderOutcomeSubmissionFeatureFlag,
  type InteractiveShoulderOutcomeSubmissionDependencies,
} from "./route";
import type { ResolvePatientPortalAccessResult } from "@/app/lib/patient-portal-access";
import type { InteractiveShoulderOutcomeServerFailureEvent } from "@/app/lib/interactive-shoulder/movement-outcome-telemetry";

const TOKEN = "patient-token-abc123";
const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_PATIENT_ID = "77777777-7777-7777-7777-777777777777";
const PLAN_SESSION_ID = "33333333-3333-3333-3333-333333333333";
const PLAN_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_PLAN_ID = "88888888-8888-8888-8888-888888888888";
const ROW_ID = "55555555-5555-5555-5555-555555555555";
const NOW = "2026-08-27T10:00:00.000Z";

function blockResult() {
  return {
    blockId: "block-1",
    movementId: "shoulder-abduction-reach",
    startedAtMs: 0,
    completedAtMs: 4000,
    completionReason: "duration",
    interaction: {
      targetsContacted: 5,
      patternsCompleted: 0,
      timingSamplesMs: [400, 420],
      responseConsistency: 0.8,
      participationDurationSeconds: 30,
    },
    measured: {
      validRepetitions: 5,
      invalidRepetitions: 0,
      rangeValuesDegrees: [90, 92],
      holdDurationSeconds: null,
      movementSpeed: null,
      returnControl: null,
      trackingConfidence: 0.9,
    },
    interpreted: {
      compensationEvents: 0,
      asymmetryObservations: [],
      fatigueTrend: "stable",
      reducedControl: false,
      trackingLimitations: [],
    },
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    planSessionId: PLAN_SESSION_ID,
    sessionState: "completed",
    totalElapsedSeconds: 120,
    blocksCompleted: 1,
    blocksTotal: 1,
    blockResults: [blockResult()],
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeRequest(body: unknown | (() => unknown)): any {
  return {
    json: async () => {
      if (typeof body === "function") return (body as () => unknown)();
      return body;
    },
    // invalidPatientTokenResponse's failed-token rate limiter reads
    // x-forwarded-for/x-real-ip via req.headers.get(...).
    headers: { get: () => null },
  };
}

type FakeResult = { data: unknown; error: { code?: string; message: string } | null };

function planSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_SESSION_ID,
    plan_id: PLAN_ID,
    provider_id: PROVIDER_ID,
    patient_id: PATIENT_ID,
    prescribed_side: "right",
    ...overrides,
  };
}

function buildFakeAdminClient(options: {
  planSessionLookup?: FakeResult;
  insertResult?: FakeResult;
  reselectResult?: FakeResult;
}) {
  const insertCalls: unknown[] = [];
  const planSessionLookup: FakeResult = options.planSessionLookup ?? {
    data: planSessionRow(),
    error: null,
  };
  const insertResult: FakeResult = options.insertResult ?? {
    data: null,
    error: { message: "insert not configured for this test" },
  };
  const reselectResult: FakeResult = options.reselectResult ?? { data: null, error: null };

  const client = {
    from(table: string) {
      if (table === "plan_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => planSessionLookup }),
            }),
          }),
        };
      }
      if (table === "interactive_shoulder_movement_outcomes") {
        return {
          insert: (payload: unknown) => {
            insertCalls.push(payload);
            return { select: () => ({ single: async () => insertResult }) };
          },
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => reselectResult }) }),
          }),
        };
      }
      throw new Error(`unexpected table in fake admin client: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { client, insertCalls };
}

type BuildDepsOptions = {
  featureEnabled?: boolean;
  rateLimited?: boolean;
  accessResult?: ResolvePatientPortalAccessResult;
  admin?: {
    planSessionLookup?: FakeResult;
    insertResult?: FakeResult;
    reselectResult?: FakeResult;
  };
};

const OK_ACCESS: ResolvePatientPortalAccessResult = {
  ok: true,
  access: {
    token: TOKEN,
    patientId: PATIENT_ID,
    providerId: PROVIDER_ID,
    patientName: "Test Patient",
    originalTokenPlanId: PLAN_ID,
    currentPlanId: PLAN_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentPlan: {} as any,
  },
};

function buildDeps(options: BuildDepsOptions = {}) {
  const { client, insertCalls } = buildFakeAdminClient(options.admin ?? {});
  let resolveCalls = 0;
  const serverFailures: InteractiveShoulderOutcomeServerFailureEvent[] = [];
  const deps: InteractiveShoulderOutcomeSubmissionDependencies = {
    featureEnabled: options.featureEnabled ?? true,
    adminClient: client,
    checkWriteLimit: () =>
      options.rateLimited ? { allowed: false, retryAfterSec: 30 } : { allowed: true },
    resolvePatientAccess: async () => {
      resolveCalls += 1;
      return options.accessResult ?? OK_ACCESS;
    },
    recordServerFailure: (event) => {
      serverFailures.push(event);
    },
  };
  return {
    deps,
    insertCalls,
    getResolveCalls: () => resolveCalls,
    getServerFailures: () => serverFailures,
  };
}

const INSERTED_ROW = {
  id: ROW_ID,
  plan_session_id: PLAN_SESSION_ID,
  plan_id: PLAN_ID,
  provider_id: PROVIDER_ID,
  patient_id: PATIENT_ID,
  prescribed_side: "right",
  session_state: "completed",
  outcome_payload: {
    planSessionId: PLAN_SESSION_ID,
    prescribedSide: "right",
    sessionState: "completed",
    totalElapsedSeconds: 120,
    blocksCompleted: 1,
    blocksTotal: 1,
    blockResults: [blockResult()],
    schemaVersion: "interactive-shoulder-movement-outcome/v1",
  },
  schema_version: "interactive-shoulder-movement-outcome/v1",
  created_at: NOW,
};

describe("resolveInteractiveShoulderOutcomeSubmissionFeatureFlag", () => {
  it("only the exact string 'true' enables it", () => {
    assert.equal(resolveInteractiveShoulderOutcomeSubmissionFeatureFlag("true"), true);
    assert.equal(resolveInteractiveShoulderOutcomeSubmissionFeatureFlag("false"), false);
    assert.equal(resolveInteractiveShoulderOutcomeSubmissionFeatureFlag("1"), false);
    assert.equal(resolveInteractiveShoulderOutcomeSubmissionFeatureFlag("TRUE"), false);
    assert.equal(resolveInteractiveShoulderOutcomeSubmissionFeatureFlag(undefined), false);
  });
});

describe("POST /api/patient/interactive-shoulder-outcomes", () => {
  it("disabled feature flag -> 503, no admin/resolve calls at all", async () => {
    const { deps, insertCalls, getResolveCalls } = buildDeps({
      featureEnabled: false,
      admin: { insertResult: { data: INSERTED_ROW, error: null } },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 503);
    assert.deepEqual(insertCalls, []);
    assert.equal(getResolveCalls(), 0);
  });

  it("rate-limited -> 429, no insert", async () => {
    const { deps, insertCalls } = buildDeps({ rateLimited: true });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 429);
    assert.deepEqual(insertCalls, []);
  });

  it("invalid JSON body -> 400", async () => {
    const { deps } = buildDeps();
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(() => {
        throw new Error("not json");
      }),
    );
    assert.equal(res.status, 400);
  });

  it("missing token -> 400, no patient-access resolution attempted", async () => {
    const { deps, getResolveCalls } = buildDeps();
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody({ token: "" })),
    );
    assert.equal(res.status, 400);
    assert.equal(getResolveCalls(), 0);
  });

  it("malformed movement-outcome shape -> 400, no patient-access resolution attempted", async () => {
    const { deps, getResolveCalls } = buildDeps();
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody({ sessionState: "not-a-real-state" })),
    );
    assert.equal(res.status, 400);
    assert.equal(getResolveCalls(), 0);
  });

  for (const forbidden of ["providerId", "patientId", "planId", "prescribedSide", "id"]) {
    it(`client-forged ${forbidden} in the body fails closed — the request is rejected before any resolution or persistence work, never silently ignored`, async () => {
      const { deps, insertCalls, getResolveCalls } = buildDeps({
        admin: { insertResult: { data: INSERTED_ROW, error: null } },
      });
      const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
        fakeRequest(validBody({ [forbidden]: "attacker-value" })),
      );
      assert.equal(res.status, 400);
      const json = await res.json();
      // Generic message naming only the offending key — never explains why
      // it is forbidden or what it would have controlled.
      assert.equal(json.error, `Unknown request field: ${forbidden}.`);
      assert.equal(insertCalls.length, 0);
      assert.equal(getResolveCalls(), 0);
    });
  }

  it("invalid/expired patient access -> rejected, no insert", async () => {
    const { deps, insertCalls } = buildDeps({
      accessResult: { ok: false, reason: "invalid_token" },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 404);
    assert.deepEqual(insertCalls, []);
  });

  it("invalid_token and plan_not_found are routine, expected rejections -> no server-failure telemetry recorded", async () => {
    const invalidTokenRun = buildDeps({ accessResult: { ok: false, reason: "invalid_token" } });
    await createInteractiveShoulderOutcomeSubmissionHandler(invalidTokenRun.deps)(fakeRequest(validBody()));
    assert.deepEqual(invalidTokenRun.getServerFailures(), []);

    const planNotFoundRun = buildDeps({ accessResult: { ok: false, reason: "plan_not_found" } });
    await createInteractiveShoulderOutcomeSubmissionHandler(planNotFoundRun.deps)(fakeRequest(validBody()));
    assert.deepEqual(planNotFoundRun.getServerFailures(), []);
  });

  it("an unexpected server_error resolving patient access -> 500, and exactly one safe telemetry event is recorded (O5)", async () => {
    const { deps, insertCalls, getServerFailures } = buildDeps({
      accessResult: { ok: false, reason: "server_error" },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 500);
    assert.deepEqual(insertCalls, []);
    const failures = getServerFailures();
    assert.equal(failures.length, 1);
    assert.deepEqual(failures[0], { reason: "patient_access_resolution_failed", httpStatus: 500 });
  });

  it("plan session belongs to a different provider -> not found, not exposed", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: {
        planSessionLookup: { data: null, error: null }, // O1's own fetch already scopes by provider_id
      },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 404);
    assert.deepEqual(insertCalls, []);
  });

  it("plan session belongs to the right provider but a different patient -> rejected, not exposed", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: { planSessionLookup: { data: planSessionRow({ patient_id: OTHER_PATIENT_ID }), error: null } },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 404);
    assert.deepEqual(insertCalls, []);
  });

  it("plan session belongs to a different plan than the token's current plan -> rejected, not exposed", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: { planSessionLookup: { data: planSessionRow({ plan_id: OTHER_PLAN_ID }), error: null } },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 404);
    assert.deepEqual(insertCalls, []);
  });

  it("missing authoritative prescribed_side -> fail closed with 400, never persisted with a null side", async () => {
    const { deps, insertCalls } = buildDeps({
      admin: { planSessionLookup: { data: planSessionRow({ prescribed_side: null }), error: null } },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.reason, "prescribed_side_required");
    assert.deepEqual(insertCalls, []);
  });

  it("a non-completed sessionState -> rejected by the assembler, no insert", async () => {
    const { deps, insertCalls } = buildDeps();
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody({ sessionState: "stopped" })),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(insertCalls, []);
  });

  it("valid completed session -> 201, persisted with server-resolved ownership/side, never client input", async () => {
    const { deps, insertCalls, getServerFailures } = buildDeps({
      admin: { insertResult: { data: INSERTED_ROW, error: null } },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 201);
    assert.equal(insertCalls.length, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertedPayload = insertCalls[0] as any;
    assert.equal(insertedPayload.provider_id, PROVIDER_ID);
    assert.equal(insertedPayload.patient_id, PATIENT_ID);
    assert.equal(insertedPayload.plan_id, PLAN_ID);
    assert.equal(insertedPayload.prescribed_side, "right");
    const body = await res.json();
    assert.equal(body.id, ROW_ID);
    assert.equal(body.created, true);
    // Observability (O5): the happy path never records a failure event.
    assert.deepEqual(getServerFailures(), []);
  });

  it("a persistence insert failure with an unexpected 5xx status -> 500-class response, and exactly one safe telemetry event is recorded (O5)", async () => {
    const { deps, getServerFailures } = buildDeps({
      admin: {
        insertResult: { data: null, error: { message: "unexpected database failure" } },
      },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 500);
    const failures = getServerFailures();
    assert.equal(failures.length, 1);
    assert.deepEqual(failures[0], { reason: "persistence_insert_failed", httpStatus: 500 });
  });

  it("telemetry events never carry a token, id, or any request/outcome payload field — only the closed reason enum and a numeric status (O5)", async () => {
    const { deps, getServerFailures } = buildDeps({
      accessResult: { ok: false, reason: "server_error" },
    });
    await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody({ totalElapsedSeconds: 999 })),
    );
    const [event] = getServerFailures();
    assert.ok(event);
    assert.deepEqual(Object.keys(event).sort(), ["httpStatus", "reason"]);
    const serialized = JSON.stringify(event);
    for (const forbidden of [TOKEN, PROVIDER_ID, PATIENT_ID, PLAN_ID, PLAN_SESSION_ID]) {
      assert.equal(serialized.includes(forbidden), false, `telemetry event leaked ${forbidden}`);
    }
  });

  it("duplicate POST (retry) -> idempotent replay: 200, same existing outcome, not a second row", async () => {
    const { deps, insertCalls, getServerFailures } = buildDeps({
      admin: {
        insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
        reselectResult: { data: INSERTED_ROW, error: null },
      },
    });
    const res = await createInteractiveShoulderOutcomeSubmissionHandler(deps)(
      fakeRequest(validBody()),
    );
    assert.equal(res.status, 200);
    assert.equal(insertCalls.length, 1);
    // A 23505-conflict replay is handled and successful, not an unexpected failure.
    assert.deepEqual(getServerFailures(), []);
    const body = await res.json();
    assert.equal(body.id, ROW_ID);
    assert.equal(body.created, false);
  });

  it("never queries any volunteer/research table", async () => {
    const { deps } = buildDeps({ admin: { insertResult: { data: INSERTED_ROW, error: null } } });
    const originalFrom = deps.adminClient.from.bind(deps.adminClient);
    const touched: string[] = [];
    deps.adminClient.from = ((table: string) => {
      touched.push(table);
      return originalFrom(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await createInteractiveShoulderOutcomeSubmissionHandler(deps)(fakeRequest(validBody()));
    for (const table of touched) {
      assert.equal(table.includes("volunteer"), false, table);
      assert.equal(table.includes("ml_research"), false, table);
    }
  });
});
