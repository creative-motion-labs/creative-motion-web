/**
 * Run: npx tsx --test app/api/patient/plan/route.test.ts
 *
 * Covers loadCatalogSessionsById() — the entire new behavior this PR
 * adds to GET /api/patient/plan. The rest of the route (token
 * resolution, patient/assessment lookups, lifetime summary) is
 * pre-existing and unchanged, and is not re-tested here; that
 * unmodified code has no test file today either.
 *
 * loadCatalogSessionsById() is dependency-injected (takes an admin
 * client, not GET's own buildAdminClient()), so it is directly
 * testable with a mock client, without mocking env vars, the network
 * layer, or the rest of the route — the same pattern established by
 * app/lib/rehab-programs/*.test.ts's mock Supabase clients.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handlePlanSessionQueryResult,
  loadCatalogSessionsById,
  mapPlanSessionRowsToPatientSessions,
} from "./route";
import { API_ERRORS } from "../../../lib/api/safe-errors";
import type { PlanSessionRow } from "./plan-session-query";
import type { ProgramSession } from "../../../lib/rehab-programs/rehab-program-types";

// ── Minimal mocked Supabase client, matching
// load-catalog-session-for-playback.test.ts's own mock shape, since
// loadCatalogSessionsById calls loadCatalogSessionForPlayback
// internally with whatever client it is given.

type TableName = "program_sessions" | "treatment_programs" | "program_session_blocks";
type MockTableResult = { data: unknown; error: { message: string } | null };

/**
 * .eq() genuinely filters by column/value (not a pass-through no-op):
 * these tests query the same shared client concurrently for multiple,
 * distinct ids, so a no-op .eq() would let every query return the
 * first fixture row regardless of which id was actually requested,
 * silently masking real per-session independence bugs.
 */
function createMockClient(responses: Partial<Record<TableName, MockTableResult>>) {
  function chain(table: TableName) {
    const original = responses[table] ?? { data: null, error: null };
    let data = Array.isArray(original.data) ? [...(original.data as Record<string, unknown>[])] : original.data;
    const error = original.error;
    const builder = {
      select() { return builder; },
      eq(column: string, value: unknown) {
        if (Array.isArray(data)) {
          data = (data as Record<string, unknown>[]).filter((row) => row[column] === value);
        }
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        if (Array.isArray(data)) {
          const dir = opts?.ascending === false ? -1 : 1;
          const rows = data as Record<string, unknown>[];
          data = [...rows].sort((a, b) => {
            const av = a[column] as string | number;
            const bv = b[column] as string | number;
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
          });
        }
        return builder;
      },
      async maybeSingle() {
        const rows = (data as unknown[] | null) ?? [];
        if (error) return { data: null, error };
        return { data: rows[0] ?? null, error: null };
      },
      // Chain itself resolves like a real PostgREST builder when awaited
      // directly (no .maybeSingle()) — the program_session_blocks query
      // does exactly this.
      then(
        onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({ data, error }).then(onFulfilled, onRejected);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return builder;
  }
  return {
    from(table: TableName) {
      return chain(table);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const PROGRAM_ID = "11111111-1111-1111-1111-111111111111";

const SESSION_ROW = {
  id: SESSION_ID,
  treatment_program_id: PROGRAM_ID,
  session_key: "stroke-upper-limb-recovery-foundation-v1-session-1",
  session_number: 1,
  title: "Session 1",
  goal: "Activation and Functional Reaching",
  estimated_duration_minutes_min: 10,
  estimated_duration_minutes_max: 15,
  requires_calibration: true,
  summary_mode: "standard",
};

const BLOCK_ROW = {
  program_session_id: SESSION_ID,
  block_key: "stroke-ulrf-v1-session-1-warm-up",
  block_order: 1,
  block_type: "instructional",
  title: "Warm-up",
  instructions: "Small, slow reaches.",
  movement_id: null,
  feedback_profile: null,
  target_duration_seconds: 60,
};

function successfulCatalogClient() {
  return createMockClient({
    program_sessions: { data: [SESSION_ROW], error: null },
    treatment_programs: { data: [{ id: PROGRAM_ID, status: "published" }], error: null },
    program_session_blocks: { data: [BLOCK_ROW], error: null },
  });
}

describe("loadCatalogSessionsById", () => {
  it("1. a legacy session (source_program_session_id null) is entirely absent from the returned map", async () => {
    const client = successfulCatalogClient();
    const result = await loadCatalogSessionsById(client, [
      { id: "legacy-1", source_program_session_id: null },
    ]);
    assert.equal(result.has("legacy-1"), false);
  });

  it("2. a catalog-sourced session that loads successfully is populated with its runtime data", async () => {
    const client = successfulCatalogClient();
    const result = await loadCatalogSessionsById(client, [
      { id: "plan-session-1", source_program_session_id: SESSION_ID },
    ]);
    assert.equal(result.has("plan-session-1"), true);
    const value = result.get("plan-session-1");
    assert.ok(value);
    assert.equal(value!.id, SESSION_ID);
    assert.equal(value!.blocks.length, 1);
  });

  it("3. a catalog-sourced session whose loader call fails is populated with null, not omitted or thrown", async () => {
    const client = createMockClient({
      program_sessions: { data: [], error: null }, // not_found
    });
    const result = await loadCatalogSessionsById(client, [
      { id: "plan-session-2", source_program_session_id: SESSION_ID },
    ]);
    assert.equal(result.has("plan-session-2"), true);
    assert.equal(result.get("plan-session-2"), null);
  });

  it("4. one session's load failure does not block or affect another session's success", async () => {
    // A single mock client instance is shared; only program_sessions
    // has data, so session A (a real id present in the fixture)
    // succeeds and session B (an id absent from the fixture) fails --
    // proving independence, not shared failure state.
    const client = successfulCatalogClient();
    const result = await loadCatalogSessionsById(client, [
      { id: "ok-session", source_program_session_id: SESSION_ID },
      { id: "missing-session", source_program_session_id: "99999999-9999-9999-9999-999999999999" },
    ]);
    assert.ok(result.get("ok-session"));
    assert.equal(result.get("missing-session"), null);
  });

  it("5. mixed legacy and catalog sessions in one call: legacy absent, catalog present/null as appropriate", async () => {
    const client = successfulCatalogClient();
    const result = await loadCatalogSessionsById(client, [
      { id: "legacy-a", source_program_session_id: null },
      { id: "catalog-a", source_program_session_id: SESSION_ID },
      { id: "legacy-b", source_program_session_id: null },
    ]);
    assert.equal(result.has("legacy-a"), false);
    assert.equal(result.has("legacy-b"), false);
    assert.ok(result.get("catalog-a"));
  });

  it("6. an empty sessions array returns an empty map without error", async () => {
    const client = successfulCatalogClient();
    const result = await loadCatalogSessionsById(client, []);
    assert.equal(result.size, 0);
  });

  it("7. a raw database error during a catalog load does not propagate out of loadCatalogSessionsById", async () => {
    const client = createMockClient({
      program_sessions: {
        data: null,
        error: { message: "relation permission denied for role internal_detail" },
      },
    });
    const result = await loadCatalogSessionsById(client, [
      { id: "plan-session-3", source_program_session_id: SESSION_ID },
    ]);
    assert.equal(result.get("plan-session-3"), null);
  });
});

describe("handlePlanSessionQueryResult", () => {
  it("returns a generic 500 response for a failed session query instead of masking as success", async () => {
    const handled = handlePlanSessionQueryResult({
      ok: false,
      errorCode: "42501",
      queryMode: "modern",
      reason: "query_failed",
    });

    assert.equal(handled.ok, false);
    if (handled.ok) return;

    const body = (await handled.response.json()) as { error: string };
    assert.equal(handled.response.status, 500);
    assert.equal(body.error, API_ERRORS.GENERIC);
  });

  it("passes successful session rows through unchanged", () => {
    const rows: PlanSessionRow[] = [{
      id: "legacy-session-1",
      session_number: 1,
      title: "Session 1",
      exercises: [{ exerciseId: "sit-to-stand", sets: 3, reps: "8-10" }],
      status: "upcoming",
      scheduled_at: null,
      completed_at: null,
      source_program_session_id: null,
      prescribed_side: null,
    }];

    const handled = handlePlanSessionQueryResult({
      ok: true,
      sessions: rows,
      queryMode: "legacy",
    });

    assert.equal(handled.ok, true);
    if (!handled.ok) return;
    assert.deepEqual(handled.sessions, rows);
  });
});

describe("mapPlanSessionRowsToPatientSessions", () => {
  it("maps legacy fallback rows without a catalogSession key", () => {
    const rows: PlanSessionRow[] = [{
      id: "legacy-session-1",
      session_number: 1,
      title: "Session 1",
      exercises: [],
      status: "upcoming",
      scheduled_at: null,
      completed_at: null,
      source_program_session_id: null,
      prescribed_side: null,
    }];

    const mapped = mapPlanSessionRowsToPatientSessions(rows, new Map());

    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]?.sessionNumber, 1);
    assert.equal(mapped[0]?.prescribedSide, null);
    assert.equal("catalogSession" in (mapped[0] ?? {}), false);
    assert.deepEqual(mapped[0]?.exercises, []);
  });

  it("preserves modern catalog-compatible catalogSession attachment", () => {
    const catalogSession = {
      id: SESSION_ID,
      blocks: [],
    } as unknown as ProgramSession;

    const rows: PlanSessionRow[] = [{
      id: "plan-session-1",
      session_number: 1,
      title: "Session 1",
      exercises: [],
      status: "upcoming",
      scheduled_at: null,
      completed_at: null,
      source_program_session_id: SESSION_ID,
      prescribed_side: "right",
    }];

    const mapped = mapPlanSessionRowsToPatientSessions(
      rows,
      new Map([["plan-session-1", catalogSession]]),
    );

    assert.equal(mapped[0]?.catalogSession, catalogSession);
  });
});
