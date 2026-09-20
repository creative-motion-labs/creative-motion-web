/**
 * Run: npx tsx --test app/api/patient/interactive-shoulder-progress/route.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInteractiveShoulderProgressHandler,
  type InteractiveShoulderProgressDependencies,
} from "./route";
import type { ResolvePatientPortalAccessResult } from "@/app/lib/patient-portal-access";

const TOKEN = "patient-token-abc123";
const PROVIDER_A = "11111111-1111-1111-1111-111111111111";
const PROVIDER_B = "99999999-9999-9999-9999-999999999999";
const PATIENT_A = "22222222-2222-2222-2222-222222222222";
const PATIENT_B = "77777777-7777-7777-7777-777777777777";
const PLAN_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PLAN_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SESSION_B = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const OUTCOME_A = "55555555-5555-5555-5555-555555555555";
const OUTCOME_B = "66666666-6666-6666-6666-666666666666";

type OutcomeRow = {
  id: string;
  plan_id: string;
  plan_session_id: string;
  created_at: string;
  provider_id: string;
  patient_id: string;
  prescribed_side: string;
  session_state: string;
  outcome_payload: Record<string, unknown>;
  schema_version: string;
};

type LogRow = {
  plan_session_id: string;
  pain_score: number | null;
  effort_score: number | null;
  completed_at: string;
  patient_id: string;
  provider_id: string;
};

function makeAccess(patientId: string, providerId: string): ResolvePatientPortalAccessResult {
  return {
    ok: true,
    access: {
      token: TOKEN,
      patientId,
      providerId,
      patientName: "Test Patient",
      originalTokenPlanId: PLAN_B,
      currentPlanId: PLAN_B,
      currentPlan: {
        id: PLAN_B,
        patient_id: patientId,
        provider_id: providerId,
        title: "Current plan",
        structured_data: null,
        status: "active",
        total_weeks: 4,
        clinician_note: null,
        created_at: "2026-08-30T00:00:00.000Z",
      },
    },
  };
}

function outcomeRow(input: {
  id: string;
  planId: string;
  planSessionId: string;
  createdAt: string;
  patientId: string;
  providerId: string;
}): OutcomeRow {
  return {
    id: input.id,
    plan_id: input.planId,
    plan_session_id: input.planSessionId,
    created_at: input.createdAt,
    patient_id: input.patientId,
    provider_id: input.providerId,
    prescribed_side: "left",
    session_state: "completed",
    schema_version: "interactive-shoulder-movement-outcome-v1",
    outcome_payload: {
      sessionState: "completed",
      totalElapsedSeconds: 120,
      blocksCompleted: 1,
      blocksTotal: 1,
      blockResults: [],
    },
  };
}

function buildFakeAdmin(outcomes: OutcomeRow[], logs: LogRow[]) {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      let inColumn: string | null = null;
      let inValues: string[] = [];

      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        in(column: string, values: string[]) {
          inColumn = column;
          inValues = values;
          return builder;
        },
        order() {
          return builder;
        },
        returns<T>() {
          if (table === "interactive_shoulder_movement_outcomes") {
            const rows = outcomes.filter(
              (row) =>
                row.patient_id === filters.patient_id &&
                row.provider_id === filters.provider_id,
            );
            return Promise.resolve({ data: rows as T[], error: null });
          }

          if (table === "session_logs") {
            const rows = logs.filter((row) => {
              if (row.patient_id !== filters.patient_id) return false;
              if (row.provider_id !== filters.provider_id) return false;
              if (inColumn === "plan_session_id") {
                return inValues.includes(row.plan_session_id);
              }
              return true;
            });
            return Promise.resolve({ data: rows as T[], error: null });
          }

          return Promise.resolve({ data: [] as T[], error: null });
        },
      };

      return builder;
    },
  };
}

function buildDeps(
  outcomes: OutcomeRow[],
  logs: LogRow[],
  access: ResolvePatientPortalAccessResult,
): InteractiveShoulderProgressDependencies {
  return {
    adminClient: buildFakeAdmin(outcomes, logs) as never,
    checkReadLimit: () => ({ allowed: true, retryAfterSec: 0 }),
    resolvePatientAccess: async () => access,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requestForToken(token: string): any {
  return new Request(`http://localhost/api/patient/interactive-shoulder-progress?token=${token}`);
}

describe("GET /api/patient/interactive-shoulder-progress", () => {
  it("returns cross-plan Interactive Shoulder sessions for the resolved patient", async () => {
    const outcomes = [
      outcomeRow({
        id: OUTCOME_A,
        planId: PLAN_A,
        planSessionId: SESSION_A,
        createdAt: "2026-08-28T10:00:00.000Z",
        patientId: PATIENT_A,
        providerId: PROVIDER_A,
      }),
      outcomeRow({
        id: OUTCOME_B,
        planId: PLAN_B,
        planSessionId: SESSION_B,
        createdAt: "2026-08-30T10:00:00.000Z",
        patientId: PATIENT_A,
        providerId: PROVIDER_A,
      }),
    ];
    const logs = [
      {
        plan_session_id: SESSION_A,
        pain_score: 4,
        effort_score: 5,
        completed_at: "2026-08-28T10:05:00.000Z",
        patient_id: PATIENT_A,
        provider_id: PROVIDER_A,
      },
      {
        plan_session_id: SESSION_B,
        pain_score: 3,
        effort_score: 6,
        completed_at: "2026-08-30T10:05:00.000Z",
        patient_id: PATIENT_A,
        provider_id: PROVIDER_A,
      },
    ];

    const handler = createInteractiveShoulderProgressHandler(
      buildDeps(outcomes, logs, makeAccess(PATIENT_A, PROVIDER_A)),
    );
    const res = await handler(requestForToken(TOKEN));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      sessions: Array<{ id: string; painAfter: number | null; effortScore: number | null }>;
    };
    assert.equal(body.sessions.length, 2);
    assert.equal(body.sessions[0]?.id, OUTCOME_A);
    assert.equal(body.sessions[1]?.id, OUTCOME_B);
    assert.equal(body.sessions[1]?.painAfter, 3);
    assert.deepEqual(Object.keys(body.sessions[0] ?? {}).sort(), [
      "completedAt",
      "effortScore",
      "id",
      "painAfter",
    ]);
  });

  it("does not return another patient's outcomes", async () => {
    const outcomes = [
      outcomeRow({
        id: OUTCOME_A,
        planId: PLAN_A,
        planSessionId: SESSION_A,
        createdAt: "2026-08-28T10:00:00.000Z",
        patientId: PATIENT_B,
        providerId: PROVIDER_A,
      }),
    ];

    const handler = createInteractiveShoulderProgressHandler(
      buildDeps(outcomes, [], makeAccess(PATIENT_A, PROVIDER_A)),
    );
    const res = await handler(requestForToken(TOKEN));
    const body = (await res.json()) as { sessions: unknown[] };
    assert.equal(body.sessions.length, 0);
  });

  it("does not return another provider's outcomes", async () => {
    const outcomes = [
      outcomeRow({
        id: OUTCOME_A,
        planId: PLAN_A,
        planSessionId: SESSION_A,
        createdAt: "2026-08-28T10:00:00.000Z",
        patientId: PATIENT_A,
        providerId: PROVIDER_B,
      }),
    ];

    const handler = createInteractiveShoulderProgressHandler(
      buildDeps(outcomes, [], makeAccess(PATIENT_A, PROVIDER_A)),
    );
    const res = await handler(requestForToken(TOKEN));
    const body = (await res.json()) as { sessions: unknown[] };
    assert.equal(body.sessions.length, 0);
  });
});
