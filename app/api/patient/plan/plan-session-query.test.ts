/**
 * Run: npx tsx --test app/api/patient/plan/plan-session-query.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchPlanSessionsForPatientPortal,
  isMissingPrescribedSideColumn,
  isMissingSourceProgramSessionIdColumn,
  LEGACY_PLAN_SESSION_SELECT,
  MODERN_PLAN_SESSION_SELECT,
} from "./plan-session-query";

const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const MODERN_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  session_number: 1,
  title: "Session 1",
  exercises: [{ exerciseId: "sit-to-stand" }],
  status: "upcoming",
  scheduled_at: null,
  completed_at: null,
  source_program_session_id: "22222222-2222-2222-2222-222222222222",
  prescribed_side: "left",
};

const MISSING_PRESCRIBED_SIDE_COLUMN_ERROR = {
  code: "42703",
  message: 'column "prescribed_side" does not exist',
};

const LEGACY_ROW = {
  id: "33333333-3333-3333-3333-333333333333",
  session_number: 2,
  title: "Session 2",
  exercises: [{ exerciseId: "mini-squat" }],
  status: "today",
  scheduled_at: "2026-07-26T00:00:00.000Z",
  completed_at: null,
};

const MISSING_SOURCE_COLUMN_ERROR = {
  code: "42703",
  message: 'column "source_program_session_id" does not exist',
};

const OTHER_MISSING_COLUMN_ERROR = {
  code: "42703",
  message: 'column "laterality_policy" does not exist',
};

const PERMISSION_ERROR = {
  code: "42501",
  message: "permission denied for table plan_sessions",
};

type QueryCall = {
  select: string;
  planId: string;
};

function createMockAdmin(
  handlers: Array<
    | { data: unknown[] | null; error: { code?: string; message?: string } | null }
    | ((call: QueryCall) => { data: unknown[] | null; error: { code?: string; message?: string } | null })
  >,
) {
  const calls: QueryCall[] = [];
  let callIndex = 0;

  const admin = {
    from(table: string) {
      assert.equal(table, "plan_sessions");
      const builder = {
        select(select: string) {
          return {
            eq(column: string, planId: string) {
              assert.equal(column, "plan_id");
              return {
                order(column: string, opts?: { ascending?: boolean }) {
                  assert.equal(column, "session_number");
                  assert.equal(opts?.ascending, true);
                  const handler = handlers[callIndex];
                  callIndex += 1;
                  const resolved =
                    typeof handler === "function"
                      ? handler({ select, planId })
                      : handler;
                  calls.push({ select, planId });
                  return Promise.resolve(resolved);
                },
              };
            },
          };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { admin, calls };
}

describe("isMissingSourceProgramSessionIdColumn", () => {
  it("matches exact Production 42703 missing-column signature", () => {
    assert.equal(isMissingSourceProgramSessionIdColumn(MISSING_SOURCE_COLUMN_ERROR), true);
  });

  it("rejects 42703 for a different missing column", () => {
    assert.equal(isMissingSourceProgramSessionIdColumn(OTHER_MISSING_COLUMN_ERROR), false);
  });
});

describe("isMissingPrescribedSideColumn", () => {
  it("matches exact 42703 missing prescribed_side signature", () => {
    assert.equal(isMissingPrescribedSideColumn(MISSING_PRESCRIBED_SIDE_COLUMN_ERROR), true);
  });
});

describe("fetchPlanSessionsForPatientPortal", () => {
  it("1. modern schema query succeeds with preserved source_program_session_id and no fallback", async () => {
    const { admin, calls } = createMockAdmin([{ data: [MODERN_ROW], error: null }]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.queryMode, "modern");
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0]?.source_program_session_id, MODERN_ROW.source_program_session_id);
    assert.equal(result.sessions[0]?.prescribed_side, "left");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.select, MODERN_PLAN_SESSION_SELECT);
    assert.equal(calls[0]?.planId, PLAN_ID);
  });

  it("2b. missing prescribed_side column retries with source_program_session_id only and null prescribed_side", async () => {
    const legacyWithSourceSelect =
      "id, session_number, title, exercises, status, scheduled_at, completed_at, source_program_session_id";
    const { admin, calls } = createMockAdmin([
      { data: null, error: MISSING_PRESCRIBED_SIDE_COLUMN_ERROR },
      { data: [{ ...MODERN_ROW, prescribed_side: undefined }], error: null },
    ]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.queryMode, "legacy");
    assert.equal(result.sessions[0]?.prescribed_side, null);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.select, MODERN_PLAN_SESSION_SELECT);
    assert.equal(calls[1]?.select, legacyWithSourceSelect);
  });

  it("2. exact Production incident: 42703 on source_program_session_id triggers one legacy retry", async () => {
    const { admin, calls } = createMockAdmin([
      { data: null, error: MISSING_SOURCE_COLUMN_ERROR },
      { data: [LEGACY_ROW, { ...LEGACY_ROW, id: "44444444-4444-4444-4444-444444444444", session_number: 3 }], error: null },
    ]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.queryMode, "legacy");
    assert.equal(result.sessions.length, 2);
    assert.ok(result.sessions.every((row) => row.source_program_session_id === null));
    assert.ok(result.sessions.every((row) => row.prescribed_side === null));
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.select, MODERN_PLAN_SESSION_SELECT);
    assert.equal(calls[1]?.select, LEGACY_PLAN_SESSION_SELECT);
  });

  it("3. modern query returns no rows without error and does not fallback", async () => {
    const { admin, calls } = createMockAdmin([{ data: [], error: null }]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.sessions, []);
    assert.equal(result.queryMode, "modern");
    assert.equal(calls.length, 1);
  });

  it("4. arbitrary database error does not fallback", async () => {
    const { admin, calls } = createMockAdmin([{ data: null, error: PERMISSION_ERROR }]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "query_failed");
    assert.equal(result.queryMode, "modern");
    assert.equal(result.errorCode, "42501");
    assert.equal(calls.length, 1);
  });

  it("5. 42703 for a different missing column does not fallback", async () => {
    const { admin, calls } = createMockAdmin([{ data: null, error: OTHER_MISSING_COLUMN_ERROR }]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "query_failed");
    assert.equal(result.queryMode, "modern");
    assert.equal(result.errorCode, "42703");
    assert.equal(calls.length, 1);
  });

  it("6. missing-column error followed by legacy-query failure returns typed failure", async () => {
    const { admin, calls } = createMockAdmin([
      { data: null, error: MISSING_SOURCE_COLUMN_ERROR },
      { data: null, error: PERMISSION_ERROR },
    ]);

    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "legacy_retry_failed");
    assert.equal(result.queryMode, "legacy");
    assert.equal(result.errorCode, "42501");
    assert.equal(calls.length, 2);
  });

  it("7. preserves plan_id filtering and query order", async () => {
    const { admin, calls } = createMockAdmin([
      ({ planId }) => {
        assert.equal(planId, PLAN_ID);
        return { data: [MODERN_ROW], error: null };
      },
    ]);

    await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(calls[0]?.planId, PLAN_ID);
    assert.equal(calls[0]?.select, MODERN_PLAN_SESSION_SELECT);
  });
});

describe("fetchPlanSessionsForPatientPortal logging safety", () => {
  it("8. failure results expose only sanitized codes and query modes", async () => {
    const { admin } = createMockAdmin([{ data: null, error: PERMISSION_ERROR }]);
    const result = await fetchPlanSessionsForPatientPortal(admin, PLAN_ID);

    assert.equal(result.ok, false);
    if (result.ok) return;

    const serialized = JSON.stringify(result);
    assert.match(serialized, /42501/);
    assert.doesNotMatch(serialized, /sit-to-stand|Session 1|patient|token|plan_id/i);
  });
});
