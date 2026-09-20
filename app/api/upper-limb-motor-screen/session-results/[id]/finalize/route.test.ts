/**
 * Run (node's --test flag glob-matches "[id]" as a character class and
 * silently finds 0 tests on this path — run as a plain script instead,
 * which still executes every node:test describe/it in the file):
 *   $env:JITI_ALIAS = @{ '@' = (Get-Location).Path } | ConvertTo-Json -Compress
 *   node --import jiti/register "app/api/upper-limb-motor-screen/session-results/[id]/finalize/route.test.ts"
 *
 * Uses createUpperLimbSessionResultFinalizeHandler(deps) directly,
 * injecting fakes for auth, rate limiting, and a minimal fake
 * Supabase admin client — no real Next.js server, Supabase client,
 * or database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUpperLimbSessionResultFinalizeHandler,
  type UpperLimbSessionResultFinalizeDependencies,
} from "./route";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_RESULT_ID = "22222222-2222-2222-2222-222222222222";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FAKE_REQUEST = {} as any;

function computedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_RESULT_ID,
    assignment_id: "assignment-1",
    provider_id: PROVIDER_ID,
    patient_id: "patient-1",
    status: "computed",
    result_payload: {
      id: SESSION_RESULT_ID,
      assignmentId: "assignment-1",
      status: "computed",
      taskCompletion: [],
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
    ...overrides,
  };
}

type FakeResult = { data: unknown; error: { message: string } | null };

type FakeAdminOptions = {
  fetchResult?: FakeResult;
  updateResult?: FakeResult;
};

function buildFakeAdminClient(options: FakeAdminOptions = {}) {
  const updateCalls: unknown[] = [];
  // Records the exact (column, value) pairs used for the pre-update
  // fetch's WHERE clause and the update's own WHERE clause, in call
  // order. A regression test asserts against both so a swapped column
  // or value (e.g. filtering the update on "id" twice instead of also
  // requiring provider_id/status = "computed") fails the test even
  // though the fake still "works" mechanically.
  const fetchEqCalls: [string, unknown][] = [];
  const updateEqCalls: [string, unknown][] = [];
  const fetchResult: FakeResult = options.fetchResult ?? { data: computedRow(), error: null };
  // Default finalize result mirrors 019's trigger: both the row's own
  // status AND result_payload.status flip together (jsonb_set), never
  // just one — a fixture bug here would silently hide a real regression.
  const finalized = computedRow();
  const updateResult: FakeResult =
    options.updateResult ?? {
      data: {
        ...finalized,
        status: "finalized",
        result_payload: { ...finalized.result_payload, status: "finalized" },
      },
      error: null,
    };

  const client = {
    from(table: string) {
      if (table !== "upper_limb_motor_screen_session_results") {
        throw new Error(`unexpected table in fake admin client: ${table}`);
      }
      return {
        select: () => ({
          eq: (column: string, value: unknown) => {
            fetchEqCalls.push([column, value]);
            return { maybeSingle: async () => fetchResult };
          },
        }),
        update: (patch: unknown) => {
          updateCalls.push(patch);
          return {
            eq: (column: string, value: unknown) => {
              updateEqCalls.push([column, value]);
              return {
                eq: (column2: string, value2: unknown) => {
                  updateEqCalls.push([column2, value2]);
                  return {
                    eq: (column3: string, value3: unknown) => {
                      updateEqCalls.push([column3, value3]);
                      return {
                        select: () => ({
                          maybeSingle: async () => updateResult,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { client, updateCalls, fetchEqCalls, updateEqCalls };
}

type BuildDepsOptions = {
  authenticated?: boolean;
  rateLimited?: boolean;
  admin?: FakeAdminOptions;
};

function buildDeps(options: BuildDepsOptions = {}) {
  const { client, updateCalls, fetchEqCalls, updateEqCalls } = buildFakeAdminClient(options.admin);
  const deps: UpperLimbSessionResultFinalizeDependencies = {
    getAuthenticatedUser: async () =>
      options.authenticated === false ? null : { id: PROVIDER_ID },
    adminClient: client,
    checkWriteLimit: () =>
      options.rateLimited ? { allowed: false, retryAfterSec: 30 } : { allowed: true },
  };
  return { deps, updateCalls, fetchEqCalls, updateEqCalls };
}

describe("POST /api/upper-limb-motor-screen/session-results/[id]/finalize", () => {
  it("unauthenticated request -> 401, no update", async () => {
    const { deps, updateCalls } = buildDeps({ authenticated: false });
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 401);
    assert.deepEqual(updateCalls, []);
  });

  it("rate-limited -> 429, no update", async () => {
    const { deps, updateCalls } = buildDeps({ rateLimited: true });
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 429);
    assert.deepEqual(updateCalls, []);
  });

  it("blank id -> 400, no fetch/update", async () => {
    const { deps, updateCalls } = buildDeps();
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(FAKE_REQUEST, "  ");
    assert.equal(res.status, 400);
    assert.deepEqual(updateCalls, []);
  });

  it("missing row -> 404, no update", async () => {
    const { deps, updateCalls } = buildDeps({ admin: { fetchResult: { data: null, error: null } } });
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 404);
    assert.deepEqual(updateCalls, []);
  });

  it("cross-provider row -> 404, no update", async () => {
    const { deps, updateCalls } = buildDeps({
      admin: { fetchResult: { data: computedRow({ provider_id: "someone-else" }), error: null } },
    });
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 404);
    assert.deepEqual(updateCalls, []);
  });

  it("already-finalized row -> 409, no update", async () => {
    const { deps, updateCalls } = buildDeps({
      admin: { fetchResult: { data: computedRow({ status: "finalized" }), error: null } },
    });
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 409);
    assert.deepEqual(updateCalls, []);
  });

  it("successful finalize -> 200, patch sends only {status: 'finalized'}", async () => {
    const { deps, updateCalls } = buildDeps();
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(updateCalls, [{ status: "finalized" }]);
    const json = await res.json();
    assert.equal(json.sessionResult.status, "finalized");
  });

  it("fetch filters on exactly (id, sessionResultId) — regression guard against a swapped/missing column", async () => {
    const { deps, fetchEqCalls } = buildDeps();
    await createUpperLimbSessionResultFinalizeHandler(deps)(FAKE_REQUEST, SESSION_RESULT_ID);
    assert.deepEqual(fetchEqCalls, [["id", SESSION_RESULT_ID]]);
  });

  it("update filters on exactly (id, sessionResultId), (provider_id, providerId), (status, 'computed') in order — regression guard against swapped columns/values", async () => {
    const { deps, updateEqCalls } = buildDeps();
    await createUpperLimbSessionResultFinalizeHandler(deps)(FAKE_REQUEST, SESSION_RESULT_ID);
    assert.deepEqual(updateEqCalls, [
      ["id", SESSION_RESULT_ID],
      ["provider_id", PROVIDER_ID],
      ["status", "computed"],
    ]);
  });

  it("race: update affects 0 rows -> 409", async () => {
    const { deps } = buildDeps({ admin: { updateResult: { data: null, error: null } } });
    const res = await createUpperLimbSessionResultFinalizeHandler(deps)(
      FAKE_REQUEST,
      SESSION_RESULT_ID,
    );
    assert.equal(res.status, 409);
  });
});
