/**
 * Run:
 *   npx tsx --test app/lib/interactive-shoulder/movement-outcome-persistence.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInteractiveShoulderMovementOutcomeInsert,
  fetchInteractiveShoulderOutcomesForPatient,
  fetchPlanSessionForOutcomeOwnership,
  insertInteractiveShoulderMovementOutcome,
  resolvePrescribedSideForOutcome,
  toInteractiveShoulderMovementOutcomePublic,
  type InteractiveShoulderOutcomeReportRow,
  type PlanSessionOutcomeContext,
} from "./movement-outcome-persistence";
import type { InteractiveShoulderMovementOutcomeSnapshot } from "./movement-outcome-types";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROVIDER_ID = "99999999-9999-9999-9999-999999999999";
const PATIENT_ID = "22222222-2222-2222-2222-222222222222";
const PLAN_SESSION_ID = "33333333-3333-3333-3333-333333333333";
const PLAN_ID = "44444444-4444-4444-4444-444444444444";
const ROW_ID = "55555555-5555-5555-5555-555555555555";
const NOW = "2026-08-27T10:00:00.000Z";

type FakeResult = { data: unknown; error: { code?: string; message: string } | null };

function snapshot(overrides: Partial<InteractiveShoulderMovementOutcomeSnapshot> = {}): InteractiveShoulderMovementOutcomeSnapshot {
  return {
    planSessionId: PLAN_SESSION_ID,
    prescribedSide: "right",
    sessionState: "completed",
    totalElapsedSeconds: 120,
    blocksCompleted: 2,
    blocksTotal: 2,
    blockResults: [],
    schemaVersion: "interactive-shoulder-movement-outcome/v1",
    ...overrides,
  };
}

function planSessionContext(
  overrides: Partial<PlanSessionOutcomeContext> = {},
): PlanSessionOutcomeContext {
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
  const planSessionEqCalls: [string, unknown][] = [];
  const outcomeInsertCalls: unknown[] = [];
  const reselectEqCalls: [string, unknown][] = [];
  const touchedTables: string[] = [];

  const planSessionLookup: FakeResult = options.planSessionLookup ?? {
    data: planSessionContext(),
    error: null,
  };
  const insertResult: FakeResult = options.insertResult ?? {
    data: null,
    error: { message: "insert not configured for this test" },
  };
  const reselectResult: FakeResult = options.reselectResult ?? { data: null, error: null };

  const client = {
    from(table: string) {
      touchedTables.push(table);
      if (table === "plan_sessions") {
        return {
          select: () => ({
            eq: (column: string, value: unknown) => {
              planSessionEqCalls.push([column, value]);
              return {
                eq: (column2: string, value2: unknown) => {
                  planSessionEqCalls.push([column2, value2]);
                  return { maybeSingle: async () => planSessionLookup };
                },
              };
            },
          }),
        };
      }
      if (table === "interactive_shoulder_movement_outcomes") {
        return {
          insert: (payload: unknown) => {
            outcomeInsertCalls.push(payload);
            return {
              select: () => ({
                single: async () => insertResult,
              }),
            };
          },
          select: () => ({
            eq: (column: string, value: unknown) => {
              reselectEqCalls.push([column, value]);
              return {
                eq: (column2: string, value2: unknown) => {
                  reselectEqCalls.push([column2, value2]);
                  return { maybeSingle: async () => reselectResult };
                },
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table in fake admin client: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { client, planSessionEqCalls, outcomeInsertCalls, reselectEqCalls, touchedTables };
}

describe("fetchPlanSessionForOutcomeOwnership", () => {
  it("owner fetch succeeds and returns the plan session context including prescribed_side", async () => {
    const { client } = buildFakeAdminClient({});
    const result = await fetchPlanSessionForOutcomeOwnership(client, {
      planSessionId: PLAN_SESSION_ID,
      providerId: PROVIDER_ID,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.planSession.id, PLAN_SESSION_ID);
      assert.equal(result.planSession.prescribed_side, "right");
    }
  });

  it("query filters on exactly (id, planSessionId) then (provider_id, providerId) — regression guard against swapped columns/values", async () => {
    const { client, planSessionEqCalls } = buildFakeAdminClient({});
    await fetchPlanSessionForOutcomeOwnership(client, {
      planSessionId: PLAN_SESSION_ID,
      providerId: PROVIDER_ID,
    });
    assert.deepEqual(planSessionEqCalls, [
      ["id", PLAN_SESSION_ID],
      ["provider_id", PROVIDER_ID],
    ]);
  });

  it("plan session owned by another provider (or nonexistent) -> 404, not exposed", async () => {
    const { client } = buildFakeAdminClient({ planSessionLookup: { data: null, error: null } });
    const result = await fetchPlanSessionForOutcomeOwnership(client, {
      planSessionId: PLAN_SESSION_ID,
      providerId: OTHER_PROVIDER_ID,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.httpStatus, 404);
  });

  it("query error -> sanitized 500", async () => {
    const { client } = buildFakeAdminClient({
      planSessionLookup: { data: null, error: { message: "unexpected database failure" } },
    });
    const result = await fetchPlanSessionForOutcomeOwnership(client, {
      planSessionId: PLAN_SESSION_ID,
      providerId: PROVIDER_ID,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.httpStatus, 500);
      assert.equal(result.message.includes("unexpected database failure"), false);
    }
  });

  it("never queries any volunteer/research table", async () => {
    const { client, touchedTables } = buildFakeAdminClient({});
    await fetchPlanSessionForOutcomeOwnership(client, {
      planSessionId: PLAN_SESSION_ID,
      providerId: PROVIDER_ID,
    });
    for (const table of touchedTables) {
      assert.equal(table.includes("volunteer"), false, table);
      assert.equal(table.includes("ml_research"), false, table);
    }
  });
});

describe("resolvePrescribedSideForOutcome", () => {
  it("resolves a real left/right DB value", () => {
    assert.equal(resolvePrescribedSideForOutcome(planSessionContext({ prescribed_side: "left" })), "left");
    assert.equal(resolvePrescribedSideForOutcome(planSessionContext({ prescribed_side: "right" })), "right");
  });

  it("resolves null (not unilaterally prescribed) to null — never defaults to a side", () => {
    assert.equal(resolvePrescribedSideForOutcome(planSessionContext({ prescribed_side: null })), null);
  });

  it("an unexpected stored value (e.g. legacy 'bilateral') resolves to null rather than a fabricated side", () => {
    assert.equal(
      resolvePrescribedSideForOutcome(planSessionContext({ prescribed_side: "bilateral" })),
      null,
    );
  });
});

describe("buildInteractiveShoulderMovementOutcomeInsert", () => {
  it("takes provider_id/patient_id/plan_id from the plan session, never from the snapshot", () => {
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    assert.equal(row.provider_id, PROVIDER_ID);
    assert.equal(row.patient_id, PATIENT_ID);
    assert.equal(row.plan_id, PLAN_ID);
    assert.equal(row.plan_session_id, PLAN_SESSION_ID);
  });

  it("outcome_payload is the full snapshot, unmodified", () => {
    const theSnapshot = snapshot();
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: theSnapshot,
    });
    assert.deepEqual(row.outcome_payload, theSnapshot);
  });
});

describe("insertInteractiveShoulderMovementOutcome", () => {
  const INSERTED_ROW = {
    id: ROW_ID,
    plan_session_id: PLAN_SESSION_ID,
    plan_id: PLAN_ID,
    provider_id: PROVIDER_ID,
    patient_id: PATIENT_ID,
    prescribed_side: "right",
    session_state: "completed",
    outcome_payload: snapshot(),
    schema_version: "interactive-shoulder-movement-outcome/v1",
    created_at: NOW,
  };

  it("successful insert -> created: true, real row returned", async () => {
    const { client, outcomeInsertCalls } = buildFakeAdminClient({
      insertResult: { data: INSERTED_ROW, error: null },
    });
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    const result = await insertInteractiveShoulderMovementOutcome(client, row);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.created, true);
      assert.equal(result.row.id, ROW_ID);
    }
    assert.equal(outcomeInsertCalls.length, 1);
  });

  it("unique-violation (23505) on retry -> idempotent replay: created:false, existing row returned, not an error", async () => {
    const { client, reselectEqCalls } = buildFakeAdminClient({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"ishmo_plan_session_unique\"" } },
      reselectResult: { data: INSERTED_ROW, error: null },
    });
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    const result = await insertInteractiveShoulderMovementOutcome(client, row);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.created, false);
      assert.equal(result.row.id, ROW_ID);
    }
    assert.deepEqual(reselectEqCalls, [
      ["plan_session_id", PLAN_SESSION_ID],
      ["provider_id", PROVIDER_ID],
    ]);
  });

  it("a retried insert never produces a second row — only ever one insert call regardless of outcome", async () => {
    const { client, outcomeInsertCalls } = buildFakeAdminClient({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      reselectResult: { data: INSERTED_ROW, error: null },
    });
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    await insertInteractiveShoulderMovementOutcome(client, row);
    assert.equal(outcomeInsertCalls.length, 1);
  });

  it("an unrelated insert failure -> sanitized 500, not treated as a replay", async () => {
    const { client } = buildFakeAdminClient({
      insertResult: { data: null, error: { message: "unexpected database failure" } },
    });
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    const result = await insertInteractiveShoulderMovementOutcome(client, row);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.httpStatus, 500);
      assert.equal(result.message.includes("unexpected database failure"), false);
    }
  });

  it("a failed reselect after a genuine conflict -> sanitized 500, never fabricates a row", async () => {
    const { client } = buildFakeAdminClient({
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      reselectResult: { data: null, error: { message: "reselect failed" } },
    });
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    const result = await insertInteractiveShoulderMovementOutcome(client, row);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.httpStatus, 500);
  });

  it("never touches any volunteer/research table", async () => {
    const { client, touchedTables } = buildFakeAdminClient({
      insertResult: { data: INSERTED_ROW, error: null },
    });
    const row = buildInteractiveShoulderMovementOutcomeInsert({
      planSession: planSessionContext(),
      snapshot: snapshot(),
    });
    await insertInteractiveShoulderMovementOutcome(client, row);
    for (const table of touchedTables) {
      assert.equal(table.includes("volunteer"), false, table);
      assert.equal(table.includes("ml_research"), false, table);
    }
  });
});

describe("toInteractiveShoulderMovementOutcomePublic", () => {
  it("maps a DB row to the public shape, including the real id and created flag", () => {
    const row = {
      id: ROW_ID,
      plan_session_id: PLAN_SESSION_ID,
      plan_id: PLAN_ID,
      provider_id: PROVIDER_ID,
      patient_id: PATIENT_ID,
      prescribed_side: "right",
      session_state: "completed",
      outcome_payload: snapshot(),
      schema_version: "interactive-shoulder-movement-outcome/v1",
      created_at: NOW,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const publicShape = toInteractiveShoulderMovementOutcomePublic(row, true);
    assert.equal(publicShape.id, ROW_ID);
    assert.equal(publicShape.planSessionId, PLAN_SESSION_ID);
    assert.equal(publicShape.providerId, PROVIDER_ID);
    assert.equal(publicShape.patientId, PATIENT_ID);
    assert.equal(publicShape.created, true);
    assert.deepEqual(publicShape.outcome, snapshot());
  });
});

describe("fetchInteractiveShoulderOutcomesForPatient (O3 clinician read)", () => {
  const ROW_2_ID = "66666666-6666-6666-6666-666666666666";
  const OTHER_PLAN_ID = "88888888-8888-8888-8888-888888888888";

  function reportRow(overrides: Partial<InteractiveShoulderOutcomeReportRow> = {}): InteractiveShoulderOutcomeReportRow {
    return {
      id: ROW_ID,
      plan_session_id: PLAN_SESSION_ID,
      plan_id: PLAN_ID,
      prescribed_side: "right",
      session_state: "completed",
      outcome_payload: snapshot(),
      schema_version: "interactive-shoulder-movement-outcome/v1",
      created_at: NOW,
      ...overrides,
    };
  }

  type ReadChainCalls = { eq: [string, unknown][]; order: [string, unknown][]; selectCols: string[] };

  function buildFakeReadOnlyAdminClient(options: {
    result?: FakeResult;
  }) {
    const touchedTables: string[] = [];
    const calls: ReadChainCalls = { eq: [], order: [], selectCols: [] };
    const result: FakeResult = options.result ?? { data: [], error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      eq(column: string, value: unknown) {
        calls.eq.push([column, value]);
        return chain;
      },
      order(column: string, opts: unknown) {
        calls.order.push([column, opts]);
        return chain;
      },
      returns() {
        return chain;
      },
      then(onResolve: (value: FakeResult) => unknown) {
        return onResolve(result);
      },
    };

    const client = {
      from(table: string) {
        touchedTables.push(table);
        if (table === "interactive_shoulder_movement_outcomes") {
          return {
            select: (cols: string) => {
              calls.selectCols.push(cols);
              return chain;
            },
          };
        }
        throw new Error(`unexpected table in fake read-only admin client: ${table}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    return { client, calls, touchedTables };
  }

  it("owner + patient scoped fetch succeeds and returns the rows unchanged", async () => {
    const rows = [reportRow()];
    const { client } = buildFakeReadOnlyAdminClient({ result: { data: rows, error: null } });
    const result = await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.rows, rows);
    }
  });

  it("filters on exactly provider_id then patient_id — never trusts an unscoped list", async () => {
    const { client, calls } = buildFakeReadOnlyAdminClient({});
    await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.deepEqual(calls.eq, [
      ["provider_id", PROVIDER_ID],
      ["patient_id", PATIENT_ID],
    ]);
  });

  it("when a planId is given, also scopes by plan_id — never a different provider's or patient's rows regardless of plan", async () => {
    const { client, calls } = buildFakeReadOnlyAdminClient({});
    await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: PLAN_ID,
    });
    assert.deepEqual(calls.eq, [
      ["provider_id", PROVIDER_ID],
      ["patient_id", PATIENT_ID],
      ["plan_id", PLAN_ID],
    ]);
  });

  it("a different provider's identical query would filter on their own provider_id — no cross-provider leak in the query itself", async () => {
    const otherProvider = "99999999-9999-9999-9999-999999999999";
    const { client, calls } = buildFakeReadOnlyAdminClient({});
    await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: otherProvider,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.deepEqual(calls.eq[0], ["provider_id", otherProvider]);
  });

  it("orders most-recent-first with a deterministic tie-break on id", async () => {
    const { client, calls } = buildFakeReadOnlyAdminClient({});
    await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.deepEqual(calls.order, [
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("multiple completed sessions come back in the query's own deterministic order, unmodified", async () => {
    const rows = [
      reportRow({ id: ROW_2_ID, created_at: "2026-08-27T12:00:00.000Z" }),
      reportRow({ id: ROW_ID, created_at: "2026-08-27T10:00:00.000Z" }),
    ];
    const { client } = buildFakeReadOnlyAdminClient({ result: { data: rows, error: null } });
    const result = await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.rows.map((r) => r.id), [ROW_2_ID, ROW_ID]);
    }
  });

  it("no outcomes recorded for this patient -> ok:true, empty array, not an error", async () => {
    const { client } = buildFakeReadOnlyAdminClient({ result: { data: [], error: null } });
    const result = await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.rows, []);
  });

  it("a null data response (no rows, driver quirk) is treated as an empty list, not a crash", async () => {
    const { client } = buildFakeReadOnlyAdminClient({ result: { data: null, error: null } });
    const result = await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.rows, []);
  });

  it("a query error -> ok:false, not silently treated as an empty result", async () => {
    const { client } = buildFakeReadOnlyAdminClient({
      result: { data: null, error: { message: "unexpected database failure" } },
    });
    const result = await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: OTHER_PLAN_ID,
    });
    assert.equal(result.ok, false);
  });

  it("a row with a null plan_session_id (historical, session later deleted) is returned unchanged, not dropped or crashed on", async () => {
    const rows = [reportRow({ plan_session_id: null })];
    const { client } = buildFakeReadOnlyAdminClient({ result: { data: rows, error: null } });
    const result = await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows[0]?.plan_session_id, null);
  });

  it("never queries any volunteer/research table", async () => {
    const { client, touchedTables } = buildFakeReadOnlyAdminClient({});
    await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    for (const table of touchedTables) {
      assert.equal(table.includes("volunteer"), false, table);
      assert.equal(table.includes("ml_research"), false, table);
    }
  });

  it("selects only the narrow projection needed by the report DTO — never select('*')", async () => {
    const { client, calls } = buildFakeReadOnlyAdminClient({});
    await fetchInteractiveShoulderOutcomesForPatient(client, {
      providerId: PROVIDER_ID,
      patientId: PATIENT_ID,
      planId: null,
    });
    assert.equal(calls.selectCols.length, 1);
    assert.equal(calls.selectCols[0]?.includes("*"), false);
    assert.equal(calls.selectCols[0]?.includes("provider_id"), false);
    assert.equal(calls.selectCols[0]?.includes("patient_id"), false);
  });
});
