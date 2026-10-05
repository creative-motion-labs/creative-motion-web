import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  assertMutationDestinationAllowed,
  requireExplicitDestCredentials,
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  importBundleDurable,
  rollbackRunVerified,
  deleteLedgerRowsVerified,
  compareIntegrity,
  buildIntegritySnapshot,
  TABLE_PIPELINE,
} from "./judge-demo-transfer-lib.mjs";

const SOURCE_PATIENT = "11111111-1111-1111-1111-111111111111";
const PROVIDER = "22222222-2222-2222-2222-222222222222";

function makeBundle() {
  return {
    runId: "run-test-001",
    sourcePatientId: SOURCE_PATIENT,
    tables: {
      patients: [
        {
          id: SOURCE_PATIENT,
          full_name: "reem mohammed",
          file_number: "P-0023",
          phone: "000",
          status: "new",
          created_at: "2026-10-02T10:00:00.000Z",
          updated_at: "2026-10-02T10:00:00.000Z",
          provider_id: PROVIDER,
        },
      ],
      assessments: [
        {
          id: "a0000001-0000-4000-8000-000000000001",
          patient_id: SOURCE_PATIENT,
          provider_id: PROVIDER,
          mode: "in_clinic",
          selected_tests: [],
          status: "completed",
          score: 12.5,
          metrics: { reps: 3 },
          created_at: "2026-10-02T11:00:00.000Z",
          updated_at: "2026-10-02T11:00:00.000Z",
          completed_at: "2026-10-02T11:05:00.000Z",
        },
        {
          id: "a0000002-0000-4000-8000-000000000002",
          patient_id: SOURCE_PATIENT,
          provider_id: PROVIDER,
          mode: "in_clinic",
          selected_tests: [],
          status: "completed",
          score: 9,
          metrics: { reps: 2 },
          created_at: "2026-10-02T12:00:00.000Z",
          updated_at: "2026-10-02T12:00:00.000Z",
          completed_at: "2026-10-02T12:05:00.000Z",
        },
      ],
      treatment_plans: [],
      plan_sessions: [],
      session_logs: [],
      interactive_shoulder_movement_outcomes: [],
      upper_limb_motor_screen_assignments: [],
      upper_limb_motor_screen_session_results: [],
      remote_assessment_requests: [],
      ai_clinician_summaries: [],
    },
  };
}

function createMockAdmin(initial = {}) {
  const store = structuredClone(initial);
  let seq = 0;
  const idSeq = () => `0000000${++seq}-0000-4000-8000-000000000099`;

  function from(table) {
    const state = {
      filters: [],
      op: "select",
      payload: null,
      countExact: false,
    };
    const api = {
      select(_cols) {
        if (state.op === "delete") return exec();
        return api;
      },
      eq(col, val) {
        state.filters.push({ col, val, op: "eq" });
        return api;
      },
      in(col, vals) {
        state.filters.push({ col, vals, op: "in" });
        return api;
      },
      insert(row) {
        state.op = "insert";
        state.payload = row;
        return exec();
      },
      delete(opts) {
        state.op = "delete";
        state.countExact = opts?.count === "exact";
        return api;
      },
      maybeSingle() {
        return exec();
      },
    };
    api.then = (resolve, reject) => exec().then(resolve, reject);
    return api;

    function match(row) {
      return state.filters.every((f) => {
        if (f.op === "eq") return row[f.col] === f.val;
        if (f.op === "in") return f.vals.includes(row[f.col]);
        return true;
      });
    }

    async function exec() {
      store[table] = store[table] ?? [];
      if (state.op === "insert") {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
        for (const r of rows) {
          if (store[table].some((x) => x.id === r.id)) {
            return { data: null, error: { message: "duplicate key" } };
          }
          store[table].push(structuredClone(r));
        }
        return { data: rows, error: null };
      }
      if (state.op === "delete") {
        const before = store[table].length;
        const idFilter = state.filters.find((f) => f.col === "id" && f.op === "eq");
        const ids = idFilter?.val;
        store[table] = store[table].filter((r) => r.id !== ids);
        const removed = before - store[table].length;
        return {
          data: removed ? [{ id: ids }] : [],
          error: null,
          count: removed,
        };
      }
      const rows = store[table].filter(match);
      if (state.filters.some((f) => f.op === "eq" && f.col === "id")) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    }
  }

  return { from, store, idSeq };
}

function baseManifest(bundle) {
  return {
    runId: bundle.runId,
    status: "exported",
    sourcePatientId: SOURCE_PATIENT,
    sourceProviderId: PROVIDER,
    exportPath: "/tmp/x.json",
    expectedCounts: { assessments: 2, patients: 1 },
    integritySnapshot: buildIntegritySnapshot(bundle),
  };
}

describe("destination project ref guards", () => {
  it("rejects Production ref without writes", () => {
    assert.throws(
      () =>
        assertMutationDestinationAllowed(`https://${PRODUCTION_PROJECT_REF}.supabase.co`),
      /Production/,
    );
  });

  it("rejects unknown ref", () => {
    assert.throws(
      () => assertMutationDestinationAllowed("https://unknownref123.supabase.co"),
      /must be/,
    );
  });

  it("allows staging ref", () => {
    assert.equal(
      assertMutationDestinationAllowed(`https://${STAGING_PROJECT_REF}.supabase.co`),
      STAGING_PROJECT_REF,
    );
  });

  it("requires explicit DEST credentials for mutations", () => {
    const saved = { ...process.env };
    delete process.env.DEST_SUPABASE_URL;
    delete process.env.DEST_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
    assert.throws(() => requireExplicitDestCredentials(), /explicit DEST/);
    Object.assign(process.env, saved);
  });
});

describe("durable import + failure injection", () => {
  /** @type {ReturnType<createMockAdmin>} */
  let admin;
  let manifest;
  let bundle;
  let persisted;

  beforeEach(() => {
    admin = createMockAdmin();
    bundle = makeBundle();
    persisted = null;
    manifest = baseManifest(bundle);
  });

  async function persist(m) {
    persisted = structuredClone(m);
    manifest = m;
  }

  it("fails midway through a table and compensates ledger rows", async () => {
    let assessmentInserts = 0;
    await assert.rejects(
      () =>
        importBundleDurable(admin, bundle, manifest, PROVIDER, {
          persistManifest: persist,
          idFactory: admin.idSeq,
          hooks: {
            beforeInsert(table) {
              if (table === "assessments") {
                assessmentInserts += 1;
                if (assessmentInserts === 2) {
                  throw new Error("injected assessment failure");
                }
              }
            },
          },
        }),
      /injected assessment failure/,
    );
    assert.equal(persisted.status, "importing");
    assert.equal(persisted.compensation?.ok, true);
    assert.deepEqual(persisted.insertedLedger.patients ?? [], []);
    assert.equal(admin.store.patients?.length ?? 0, 0);
    assert.equal(admin.store.assessments?.length ?? 0, 0);
  });

  it("resumes incomplete run without new dest patient id", async () => {
    let assessmentAttempt = 0;
    await importBundleDurable(admin, bundle, manifest, PROVIDER, {
      persistManifest: persist,
      idFactory: admin.idSeq,
      hooks: {
        beforeInsert(table) {
          if (table === "assessments") {
            assessmentAttempt += 1;
            if (assessmentAttempt === 2) throw new Error("injected interrupt");
          }
        },
      },
    }).catch(() => {});

    const firstDestPatient = persisted.destPatientId;
    const firstMappings = structuredClone(persisted.idMappings);

    await importBundleDurable(admin, bundle, persisted, PROVIDER, {
      persistManifest: persist,
      idFactory: admin.idSeq,
    });

    assert.equal(persisted.status, "imported");
    assert.equal(persisted.destPatientId, firstDestPatient);
    assert.deepEqual(persisted.idMappings.patients, firstMappings.patients);
    assert.equal(admin.store.assessments.length, 2);
  });

  it("reports compensation failure when delete fails", async () => {
    await importBundleDurable(admin, bundle, manifest, PROVIDER, {
      persistManifest: persist,
      idFactory: admin.idSeq,
      hooks: {
        beforeInsert(table) {
          if (table === "assessments") throw new Error("fail early");
        },
        beforeDeleteTable(table) {
          if (table === "patients") throw new Error("injected delete failure");
        },
      },
    }).catch(() => {});

    assert.equal(persisted.compensation?.ok, false);
    assert.equal(persisted.status, "importing");
    assert.ok((persisted.insertedLedger.patients ?? []).length > 0);
  });
});

describe("rollback safety", () => {
  it("refuses rollback when unrelated dependent rows exist", async () => {
    const admin = createMockAdmin();
    const bundle = makeBundle();
    const manifest = {
      ...baseManifest(bundle),
      status: "imported",
      destPatientId: "d0000001-0000-4000-8000-000000000001",
      insertedLedger: {
        patients: ["d0000001-0000-4000-8000-000000000001"],
        assessments: ["d0000002-0000-4000-8000-000000000002"],
      },
      idMappings: {
        patients: { [SOURCE_PATIENT]: "d0000001-0000-4000-8000-000000000001" },
        assessments: {
          "a0000001-0000-4000-8000-000000000001": "d0000002-0000-4000-8000-000000000002",
        },
      },
    };
    admin.store.patients = [
      { id: manifest.destPatientId, patient_id: manifest.destPatientId },
    ];
    admin.store.assessments = [
      {
        id: "d0000002-0000-4000-8000-000000000002",
        patient_id: manifest.destPatientId,
      },
      {
        id: "extra-row-not-in-ledger",
        patient_id: manifest.destPatientId,
      },
    ];

    await assert.rejects(
      () =>
        rollbackRunVerified(admin, manifest, {
          persistManifest: async () => {},
        }),
      /Rollback refused/,
    );
  });

  it("does not mark rolled_back unless verify passes", async () => {
    const admin = createMockAdmin();
    const bundle = makeBundle();
    let saved = null;
    const manifest = {
      ...baseManifest(bundle),
      status: "imported",
      destPatientId: "d0000001-0000-4000-8000-000000000001",
      insertedLedger: {
        patients: ["d0000001-0000-4000-8000-000000000001"],
        assessments: [],
      },
    };
    admin.store.patients = [{ id: manifest.destPatientId, patient_id: manifest.destPatientId }];

    const result = await rollbackRunVerified(admin, manifest, {
      persistManifest: async (m) => {
        saved = m;
      },
    });
    assert.equal(result.status, "rolled_back");
    assert.equal(saved.rollbackAttempt?.ok, true);
    assert.equal(admin.store.patients.length, 0);
  });
});

describe("integrity verification", () => {
  it("detects measured value / date drift", () => {
    const bundle = makeBundle();
    const manifest = baseManifest(bundle);
    manifest.idMappings = {
      assessments: {
        "a0000001-0000-4000-8000-000000000001": "dest-a1",
      },
    };
    const destRowsByTable = {
      assessments: [
        {
          id: "dest-a1",
          created_at: "2026-10-02T11:00:00.000Z",
          updated_at: "2026-10-02T11:00:00.000Z",
          completed_at: "2026-10-02T11:05:00.000Z",
          score: 99,
          metrics: { reps: 3 },
        },
      ],
    };
    const mismatches = compareIntegrity(bundle, manifest, destRowsByTable);
    assert.ok(mismatches.some((m) => m.field === "score"));
  });
});

describe("deleteLedgerRowsVerified", () => {
  it("returns remaining ids when delete fails", async () => {
    const admin = createMockAdmin({
      patients: [{ id: "p1" }, { id: "p2" }],
    });
    const result = await deleteLedgerRowsVerified(admin, {
      patients: ["p1", "p2"],
    }, {
      beforeDeleteTable(table, ids) {
        if (table === "patients" && ids.includes("p2")) {
          throw new Error("block p2 delete");
        }
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.remaining.patients.includes("p2"));
  });
});
