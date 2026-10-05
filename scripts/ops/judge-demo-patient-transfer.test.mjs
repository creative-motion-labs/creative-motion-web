import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertMutationDestinationAllowed, requireExplicitDestCredentials,
  STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF, importBundleDurable,
  rollbackRunVerified, compareIntegrity, compareSourceIntegrity,
  buildIntegritySnapshot, buildImportPlan, readAllRows, TABLE_PIPELINE,
  buildReportDataCoverage,
} from "./judge-demo-transfer-lib.mjs";
import { writeJsonDurable, acquireRunLock } from "./judge-demo-transfer-files.mjs";

describe("judge presentation report data", () => {
  it("preserves CV report evidence and dates, remaps session links, and rolls back only the clone", async () => {
    const f = setup(true), original = structuredClone(f.bundle);
    await importBundleDurable(f.admin, f.bundle, f.manifest, PROVIDER, f.options);
    const cv = f.admin.store.cv_session_metrics[0];
    assert.equal(cv.patient_id, f.manifest.destPatientId);
    assert.equal(cv.plan_id, f.manifest.idMappings.treatment_plans["plan-1"]);
    assert.equal(cv.plan_session_id, f.manifest.idMappings.plan_sessions["session-1"]);
    assert.deepEqual(cv.motion_quality, original.tables.cv_session_metrics[0].motion_quality);
    assert.equal(cv.recorded_at, DATE);
    assert.equal(cv.rep_count, 5);
    assert.equal(compareIntegrity(f.bundle, f.manifest, f.admin.store).length, 0);
    assert.deepEqual(f.bundle, original);
    await rollbackRunVerified(f.admin, f.manifest, f.options);
    assert.equal(f.admin.store.cv_session_metrics.length, 0);
    assert.equal(f.admin.store.patients.length, 0);
    assert.deepEqual(f.bundle, original);
  });
  it("detects changed report evidence instead of accepting equal row counts", async () => {
    const f = setup(true);
    await importBundleDurable(f.admin, f.bundle, f.manifest, PROVIDER, f.options);
    f.admin.store.cv_session_metrics[0].motion_quality.smtPilot.measuredAngles[0] = 999;
    const drift = compareIntegrity(f.bundle, f.manifest, f.admin.store);
    assert.ok(drift.some((r) => r.table === "cv_session_metrics" && r.field === "motion_quality"));
  });
  it("compensates a CV report insert failure with verified cleanup", async () => {
    const f = setup(true, {}, { before: (state) =>
      state.table === "cv_session_metrics" && state.op === "insert"
        ? { data: null, error: { code: "23514", message: "synthetic report failure" } } : null });
    await assert.rejects(importBundleDurable(f.admin, f.bundle, f.manifest, PROVIDER, f.options));
    assert.equal(f.manifest.compensation.ok, true);
    assert.equal(f.admin.store.patients.length, 0);
    assert.equal((f.admin.store.cv_session_metrics ?? []).length, 0);
  });
  it("refuses an older export missing CV inventory before any new IDs or writes", async () => {
    const f = setup(true);
    delete f.bundle.tables.cv_session_metrics;
    let allocations = 0;
    await assert.rejects(importBundleDurable(f.admin, f.bundle, f.manifest, PROVIDER,
      { ...f.options, idFactory: () => { allocations++; return f.admin.idSeq(); } }), /predates motion report coverage/);
    assert.equal(allocations, 0);
    assert.equal(f.admin.requests.filter((r) => r.op !== "select").length, 0);
  });
  it("reports absent source evidence without fabricating a report or browser verification", () => {
    const empty = buildReportDataCoverage(makeBundle().tables);
    assert.equal(empty.motionAnalysis.sourceDataPresent, false);
    assert.equal(empty.motionAnalysis.rows, 0);
    assert.equal(empty.browserVerified, false);
    const rich = buildReportDataCoverage(makeBundle(true).tables);
    assert.equal(rich.motionAnalysis.rows, 1);
    assert.equal(rich.motionAnalysis.rowsWithMotionQuality, 1);
    assert.equal(rich.progress.assessmentRows, 2);
    assert.equal(rich.outcomes.rows, 1);
    assert.equal(rich.browserVerified, false);
  });
});
import { parseArgs, exportBundle, writeManifestAtomic, verifyRun } from "./judge-demo-patient-transfer.mjs";

const SOURCE_PATIENT = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const destination = { url: `https://${STAGING_PROJECT_REF}.supabase.co`, key: "fake-explicit-staging-key" };
const DATE = "2026-10-02T10:00:00.123400Z";

function makeBundle(rich = false) {
  const tables = Object.fromEntries(TABLE_PIPELINE.map(({ table }) => [table, []]));
  tables.patients = [{ id: SOURCE_PATIENT, provider_id: PROVIDER, full_name: "test patient",
    file_number: "TEST-001", phone: "synthetic", created_at: DATE, updated_at: DATE }];
  tables.assessments = [1, 2].map((i) => ({ id: `assessment-${i}`, patient_id: SOURCE_PATIENT,
    provider_id: PROVIDER, status: "completed", score: i * 12.5, metrics: { reps: i, reach: 1.75 },
    structured_data: { observation: { value: 4.5, units: "test" } },
    created_at: DATE, updated_at: DATE, completed_at: DATE }));
  if (rich) {
    tables.treatment_plans = [{ id: "plan-1", patient_id: SOURCE_PATIENT, provider_id: PROVIDER,
      assessment_id: "assessment-1", catalog_assignment_request_id: "old-request", created_at: DATE }];
    tables.plan_sessions = [{ id: "session-1", patient_id: SOURCE_PATIENT, provider_id: PROVIDER,
      plan_id: "plan-1", prescribed_side: "left", scheduled_at: DATE, exercises: [{ duration: 32 }] }];
    tables.session_logs = [{ id: "log-1", patient_id: SOURCE_PATIENT, provider_id: PROVIDER,
      plan_id: "plan-1", plan_session_id: "session-1", patient_token: "source-secret",
      effort_score: 2.75, exercises_completed: 7, completed_at: DATE }];
    tables.cv_session_metrics = [{ id: "cv-1", patient_id: SOURCE_PATIENT, provider_id: PROVIDER,
      plan_id: "plan-1", plan_session_id: "session-1", exercise_id: "sit_to_stand",
      rep_count: 5, session_duration_s: 44, tracking_quality: "good",
      movement_detected: true, frames_with_pose: 100, frames_total: 120,
      source: "patient_session", recorded_at: DATE,
      motion_quality: { smtPilot: { measuredAngles: [12.5, 24.75], capturedAt: DATE } } }];
    tables.interactive_shoulder_movement_outcomes = [{ id: "outcome-1", patient_id: SOURCE_PATIENT,
      provider_id: PROVIDER, plan_id: "plan-1", plan_session_id: "session-1", created_at: DATE,
      outcome_payload: { measured: [12.5, 11.75], completedAt: DATE } }];
    tables.upper_limb_motor_screen_assignments = [{ id: "assignment-1", patient_id: SOURCE_PATIENT,
      provider_id: PROVIDER, assignment_request_id: "old-request", token_hash: "source-secret",
      token_expires_at: DATE, created_at: DATE, updated_at: DATE, assignment_payload: {
        id: "assignment-1", assignmentRequestId: "old-request", token: "source-secret",
        repetitions: 5, measuredAt: DATE,
      } }];
    tables.upper_limb_motor_screen_session_results = [{ id: "result-1", assignment_id: "assignment-1",
      patient_id: SOURCE_PATIENT, provider_id: PROVIDER, created_at: DATE, protective_pause_count: 3,
      result_payload: { id: "result-1", assignmentId: "assignment-1", measurement: { speed: 3.125 } } }];
    tables.remote_assessment_requests = [{ id: "remote-1", patient_id: SOURCE_PATIENT,
      provider_id: PROVIDER, assessment_id: "assessment-2", token: "source-secret",
      created_at: DATE, submitted_at: DATE, expires_at: DATE }];
  }
  return { runId: RUN_ID, sourcePatientId: SOURCE_PATIENT, tables };
}

// Faults occur at the API boundary, including responses lost AFTER a committed write.
function createMockAdmin(initial = {}, faults = {}) {
  const store = structuredClone(initial), requests = [];
  let seq = 0;
  const admin = { store, requests, supabaseUrl: destination.url, supabaseKey: destination.key,
    idSeq: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    from(table) {
      const state = { table, op: "select", filters: [], single: false, range: null };
      const api = {
        select() { return api; }, eq(col, val) { state.filters.push({ col, val }); return api; },
        in(col, vals) { state.filters.push({ col, vals }); return api; },
        order() { return api; }, limit(n) { state.limit = n; return api; },
        range(start, end) { state.range = [start, end]; return api; },
        insert(row) { state.op = "insert"; state.payload = structuredClone(row); return api; },
        delete() { state.op = "delete"; return api; },
        maybeSingle() { state.single = true; return api; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        requests.push(structuredClone(state));
        const injected = await faults.before?.(state, admin);
        if (injected) return injected;
        store[table] ??= [];
        const matches = (row) => state.filters.every((f) => f.vals ? f.vals.includes(row[f.col]) : row[f.col] === f.val);
        let response;
        if (state.op === "insert") {
          if (store[table].some((r) => r.id === state.payload.id)) return { data: null, error: { message: "duplicate key" } };
          store[table].push(structuredClone(state.payload));
          response = { data: null, error: null };
        } else if (state.op === "delete") {
          const deleted = store[table].filter(matches);
          store[table] = store[table].filter((r) => !matches(r));
          response = { data: deleted.map((r) => ({ id: r.id })), count: deleted.length, error: null };
        } else {
          let rows = store[table].filter(matches).sort((a, b) => a.id.localeCompare(b.id));
          if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
          response = { data: structuredClone(state.single ? rows[0] ?? null : rows), error: null };
        }
        return await faults.after?.(state, admin, response) ?? response;
      }
      return api;
    },
  };
  return admin;
}

function setup(rich = false, initial = {}, faults = {}) {
  const bundle = makeBundle(rich), admin = createMockAdmin(initial, faults);
  const manifest = { ledgerVersion: 2, runId: RUN_ID, status: "exported", sourcePatientId: SOURCE_PATIENT,
    sourceProviderId: PROVIDER, idMappings: {}, integritySnapshot: buildIntegritySnapshot(bundle) };
  let saved;
  const persistManifest = async (m) => { saved = structuredClone(m); };
  const options = { destination, persistManifest, idFactory: admin.idSeq };
  return { bundle, admin, manifest, options, saved: () => saved,
    run: (m = manifest, extra = {}) => importBundleDurable(admin, bundle, m, PROVIDER, { ...options, ...extra }) };
}

function writes(admin, op) { return admin.requests.filter((r) => r.op === op); }

function secondAssessmentFailure() {
  let attempts = 0;
  return { beforeInsert(table) {
    if (table === "assessments" && ++attempts === 2) throw new Error("injected midway failure");
  } };
}

describe("exact destination identity before any mutations", () => {
  for (const url of [
    `https://${PRODUCTION_PROJECT_REF}.supabase.co`, "https://unknownref.supabase.co",
    `http://${STAGING_PROJECT_REF}.supabase.co`, `https://${STAGING_PROJECT_REF}.supabase.co.evil.test`,
    `https://${STAGING_PROJECT_REF}.supabase.co/?production=false`,
  ]) {
    it(`rejects ${url}`, async () => {
      const f = setup();
      await assert.rejects(() => f.run(f.manifest, { destination: { ...destination, url } }), /Refusing mutation/);
      assert.equal(f.admin.requests.length, 0);
      assert.equal(f.saved(), undefined);
    });
  }
  it("guards the actual client even if declared credentials say staging", async () => {
    const f = setup();
    f.admin.supabaseUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
    await assert.rejects(() => f.run(), /Production/);
    assert.equal(f.admin.requests.length, 0);
  });
  it("guards rollback as well as import", async () => {
    const f = setup();
    await f.run();
    const before = f.admin.requests.length;
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, {
      ...f.options, destination: { ...destination, url: "https://unknownref.supabase.co" },
    }), /must be/);
    assert.equal(f.admin.requests.length, before);
  });
  it("requires explicit destination credentials without public/shared fallbacks", () => {
    const keys = ["DEST_SUPABASE_URL", "DEST_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      delete process.env.DEST_SUPABASE_URL; delete process.env.DEST_SERVICE_ROLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_URL = destination.url; process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
      assert.throws(() => requireExplicitDestCredentials(), /explicit DEST/);
      assert.equal(assertMutationDestinationAllowed(destination.url), STAGING_PROJECT_REF);
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    }
  });
});

describe("durable plans and recovery", () => {
  it("persists all planned rows and IDs before the first insert, then flushes every success", async () => {
    const f = setup(true);
    const snapshots = [];
    await f.run(f.manifest, { persistManifest: async (m) => {
      snapshots.push({ manifest: structuredClone(m), writes: writes(f.admin, "insert").length });
    }, hooks: { beforeInsert(table, row) {
      const durable = snapshots.at(-1).manifest;
      assert.equal(durable.plannedRows.patients.length, 1);
      assert.equal(durable.plannedRows.assessments.length, 2);
      assert.equal(durable.plannedRows[table].some((r) => r.id === row.id), true);
      assert.equal(Object.values(durable.insertedLedger).flat().length, writes(f.admin, "insert").length);
    } } });
    assert.equal(snapshots[0].writes, 0);
    assert.equal(snapshots[0].manifest.status, "importing");
    assert.equal(f.manifest.importVerification.ok, true);
  });
  it("fails midway through a table and verifies compensation", async () => {
    const f = setup();
    await assert.rejects(() => f.run(f.manifest, { hooks: secondAssessmentFailure() }), /midway failure/);
    const saved = f.saved();
    assert.equal(saved.status, "importing");
    assert.equal(saved.compensation.ok, true);
    assert.deepEqual(saved.compensation.remaining, {});
    assert.deepEqual(saved.compensation.unverified, {});
    assert.equal(f.admin.store.patients.length + f.admin.store.assessments.length, 0);
    assert.equal(saved.insertedLedger.assessments.length, 1); // Retained history, not blindly skipped.
  });
  it("restarts after partial compensation and reinserts missing ledgered rows with the same IDs", async () => {
    const f = setup();
    await assert.rejects(() => f.run(f.manifest, { hooks: { ...secondAssessmentFailure(),
      beforeDeleteTable(table) { if (table === "patients") throw new Error("injected parent delete failure"); },
    } }), /compensation incomplete/);
    assert.equal(f.admin.store.patients.length, 1);
    assert.equal(f.admin.store.assessments.length, 0);
    const saved = f.saved(), ids = structuredClone(saved.idMappings);
    await f.run(saved, { idFactory: () => { throw new Error("must not allocate IDs on retry"); } });
    assert.deepEqual(saved.idMappings, ids);
    assert.equal(f.admin.store.patients.length, 1);
    assert.equal(f.admin.store.assessments.length, 2);
    assert.equal(compareIntegrity(null, saved, f.admin.store).length, 0);
  });
  it("recovers an insert whose response was lost after commit", async () => {
    let lost = false;
    const f = setup(true, {}, { after(state) {
      if (state.op === "insert" && state.table === "remote_assessment_requests" && !lost) {
        lost = true; throw new Error("connection lost after commit");
      }
    } });
    await f.run();
    assert.equal(f.admin.store.remote_assessment_requests.length, 1);
    assert.equal(f.manifest.status, "imported");
    assert.equal(f.manifest.insertedLedger.remote_assessment_requests.length, 1);
  });
  it("pauses on an ambiguous response plus read failure; restart adopts only the original planned IDs", async () => {
    let offline = false;
    const f = setup(true, {}, { after(state) {
      if (state.op === "insert" && state.table === "remote_assessment_requests") {
        offline = true; throw new Error("connection lost");
      }
    }, before(state) {
      if (offline && state.op === "select") return { data: null, error: { message: "offline" } };
    } });
    await assert.rejects(() => f.run(), /unverified/);
    assert.equal(writes(f.admin, "delete").length, 0);
    const saved = f.saved(), originalId = saved.destPatientId;
    const remotePayload = structuredClone(f.admin.store.remote_assessment_requests[0]);
    offline = false;
    await f.run(saved, { idFactory: () => { throw new Error("new clone prohibited"); } });
    assert.equal(saved.destPatientId, originalId);
    assert.equal(f.admin.store.patients.length, 1);
    assert.deepEqual(f.admin.store.remote_assessment_requests, [remotePayload]);
  });
  it("restarts from the durable file after interruption between insert commit and ledger flush", async () => {
    const dir = mkdtempSync(join(tmpdir(), "transfer-restart-")), path = join(dir, "manifest.json");
    const f = setup(true);
    let interrupted = false;
    try {
      await assert.rejects(() => f.run(f.manifest, { persistManifest: async (m) => {
        if (f.admin.store.assessments?.length === 1) interrupted = true;
        if (interrupted) throw new Error("simulated process interruption before flush");
        writeJsonDurable(path, m);
      } }), /Manifest flush failed/);
      const disk = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(disk.insertedLedger.assessments?.length ?? 0, 0);
      assert.equal(disk.attemptedLedger.assessments.length, 1);
      assert.equal(f.admin.store.assessments.length, 1);
      assert.equal(writes(f.admin, "delete").length, 0);
      const ids = structuredClone(disk.idMappings), remotePlan = structuredClone(disk.plannedRows.remote_assessment_requests);
      await f.run(disk, { idFactory: () => { throw new Error("new ID prohibited"); } });
      assert.deepEqual(disk.idMappings, ids);
      assert.deepEqual(f.admin.store.remote_assessment_requests, remotePlan);
      assert.equal(f.admin.store.patients.length, 1);
      assert.equal(f.admin.store.assessments.length, 2);
      if (process.platform !== "win32") {
        assert.equal(statSync(path).mode & 0o777, 0o600);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("does not write if the initial plan cannot be persisted", async () => {
    const f = setup();
    await assert.rejects(() => f.run(f.manifest, { persistManifest: async () => { throw new Error("disk full"); } }), /flush failed/);
    assert.equal(f.admin.requests.length, 0);
  });
  it("refuses legacy incomplete manifests without creating new IDs", async () => {
    const f = setup();
    Object.assign(f.manifest, { status: "importing", destPatientId: "existing-partial-id" });
    await assert.rejects(() => f.run(f.manifest, { idFactory: () => { throw new Error("new ID allocated"); } }), /legacy manifest/);
    assert.equal(f.admin.requests.length, 0);
  });
  it("refuses a changed provider or bundle on retry", async () => {
    const f = setup(); buildImportPlan(f.bundle, f.manifest, PROVIDER, f.admin.idSeq);
    await assert.rejects(() => importBundleDurable(f.admin, f.bundle, f.manifest, "different-provider", f.options), /Cannot change/);
    f.bundle.tables.assessments[0].structured_data.observation.value = 99;
    await assert.rejects(() => f.run(), /Cannot change/);
    assert.equal(f.admin.requests.length, 0);
  });
  it("does not adopt a preexisting matching row without a durable insert intent", async () => {
    const f = setup(); buildImportPlan(f.bundle, f.manifest, PROVIDER, f.admin.idSeq);
    f.admin.store.patients = structuredClone(f.manifest.plannedRows.patients);
    await assert.rejects(() => f.run(), /unowned/);
    assert.equal(writes(f.admin, "insert").length + writes(f.admin, "delete").length, 0);
  });
  it("checks patient/provider relationships during ambiguous recovery", async () => {
    const f = setup(); buildImportPlan(f.bundle, f.manifest, PROVIDER, f.admin.idSeq);
    const row = structuredClone(f.manifest.plannedRows.assessments[0]); row.patient_id = SOURCE_PATIENT;
    f.admin.store.assessments = [row]; f.manifest.attemptedLedger.assessments = [row.id];
    await assert.rejects(() => f.run(), /unowned or changed/);
    assert.equal(writes(f.admin, "delete").length, 0);
  });
});

describe("verified cleanup and dependent ownership", () => {
  it("checks a failed DELETE response, preserves the manifest, and never deletes parents afterward", async () => {
    const f = setup(false, {}, { before(state) {
      if (state.op === "delete" && state.table === "assessments") return { data: null, error: { message: "permission denied" } };
    } });
    await assert.rejects(() => f.run(f.manifest, { hooks: secondAssessmentFailure() }), /compensation incomplete/);
    const saved = f.saved();
    assert.equal(saved.compensation.ok, false);
    assert.equal(saved.compensation.remaining.assessments.length, 1);
    assert.equal(saved.compensation.remaining.patients.length, 1);
    assert.equal(writes(f.admin, "delete").some((r) => r.table === "patients"), false);
    assert.equal(saved.status, "importing");
  });
  it("does not trust a successful-looking delete response when the row remains", async () => {
    const f = setup(false, {}, { before(state) {
      if (state.op === "delete") return { data: [{ id: state.filters.find((x) => x.col === "id").val }], count: 1, error: null };
    } });
    await assert.rejects(() => f.run(f.manifest, { hooks: secondAssessmentFailure() }), /compensation incomplete/);
    assert.equal(f.saved().compensation.ok, false);
    assert.equal(f.saved().compensation.remaining.assessments.length, 1);
    assert.equal(writes(f.admin, "delete").length, 1);
  });
  it("reports verification read failures as unverified rows, not successful cleanup", async () => {
    let readFailed = false;
    const f = setup(false, {}, { after(state) { if (state.op === "delete") readFailed = true; },
      before(state) {
        if (readFailed && state.op === "select") return { data: null, error: { message: "read timeout" } };
      } });
    await assert.rejects(() => f.run(f.manifest, { hooks: secondAssessmentFailure() }), /compensation incomplete/);
    const result = f.saved().compensation;
    assert.equal(result.ok, false);
    assert.equal(result.unverified.patients.length, 1);
    assert.equal(result.unverified.assessments.length, 1);
    assert.equal(writes(f.admin, "delete").length, 1);
  });
  for (const table of ["assessments", "patient_access_tokens", "session_motion_summaries"]) {
    it(`refuses rollback with an unrelated row in ${table}`, async () => {
      const f = setup(); await f.run();
      (f.admin.store[table] ??= []).push({ id: "unrelated", patient_id: f.manifest.destPatientId });
      await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /Rollback incomplete/);
      assert.equal(writes(f.admin, "delete").length, 0);
      assert.equal(f.saved().rollbackAttempt.ok, false);
      assert.equal(f.saved().status, "rolling_back");
      assert.equal(f.admin.store.patients.length, 1);
    });
  }
  it("finds an unrelated child via assignment_id even with a different patient_id", async () => {
    const f = setup(true); await f.run();
    f.admin.store.upper_limb_motor_screen_session_results.push({ id: "unrelated", patient_id: SOURCE_PATIENT,
      assignment_id: f.manifest.plannedRows.upper_limb_motor_screen_assignments[0].id });
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /unrelated/);
    assert.equal(writes(f.admin, "delete").length, 0);
  });
  it("blocks SET NULL effects on unrelated rows linked only by plan_id", async () => {
    const f = setup(true); await f.run();
    f.admin.store.cv_session_metrics = [{ id: "external", patient_id: SOURCE_PATIENT,
      plan_id: f.manifest.plannedRows.treatment_plans[0].id }];
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /unrelated/);
    assert.equal(writes(f.admin, "delete").length, 0);
  });
  it("refuses rollback if a ledgered row was changed by someone else", async () => {
    const f = setup(); await f.run(); f.admin.store.assessments[0].score = 100;
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /unowned or changed/);
    assert.equal(writes(f.admin, "delete").length, 0);
  });
  it("resumes a failed rollback and reports success only after all owned IDs are absent", async () => {
    let fail = true;
    const f = setup(false, {}, { before(state) {
      if (fail && state.op === "delete" && state.table === "patients") return { data: null, error: { message: "delete failure" } };
    } });
    await f.run();
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /Rollback incomplete/);
    assert.equal(f.saved().status, "rolling_back"); assert.equal(f.admin.store.assessments.length, 0);
    fail = false;
    await rollbackRunVerified(f.admin, f.manifest, f.options);
    assert.equal(f.saved().status, "rolled_back"); assert.equal(f.saved().rollbackAttempt.ok, true);
    assert.equal(f.admin.store.patients.length, 0);
    await assert.rejects(() => f.run(), /Cannot import/);
  });
  it("skips inbound checks only when session_motion_summaries is absent (PGRST205)", async () => {
    const f = setup();
    await f.run();
    const realFrom = f.admin.from.bind(f.admin);
    f.admin.from = (table) => {
      if (table === "session_motion_summaries") {
        const api = {
          select() { return api; },
          limit() { return api; },
          then(resolve) {
            resolve({
              data: null,
              error: {
                code: "PGRST205",
                message: "Could not find the table 'public.session_motion_summaries' in the schema cache",
              },
            });
          },
        };
        return api;
      }
      return realFrom(table);
    };
    await rollbackRunVerified(f.admin, f.manifest, f.options);
    assert.equal(f.saved().status, "rolled_back");
    assert.equal(f.saved().rollbackAttempt.ok, true);
    assert.equal(f.admin.store.patients.length, 0);
  });
  it("blocks rollback when session_motion_summaries probe fails for non-PGRST205 errors", async () => {
    const f = setup();
    await f.run();
    const realFrom = f.admin.from.bind(f.admin);
    f.admin.from = (table) => {
      if (table === "session_motion_summaries") {
        const api = {
          select() { return api; },
          limit() { return api; },
          then(resolve) {
            resolve({
              data: null,
              error: { code: "PGRST301", message: "permission denied for table session_motion_summaries" },
            });
          },
        };
        return api;
      }
      return realFrom(table);
    };
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /Rollback incomplete/);
    assert.equal(writes(f.admin, "delete").length, 0);
    assert.equal(f.saved().rollbackAttempt.ok, false);
  });
  it("does not treat PGRST205 on required inbound tables as skippable", async () => {
    const f = setup();
    await f.run();
    const realFrom = f.admin.from.bind(f.admin);
    f.admin.from = (table) => {
      if (table === "patient_access_tokens") {
        const api = {
          select() { return api; },
          in() { return api; },
          order() { return api; },
          range() { return api; },
          limit() { return api; },
          then(resolve) {
            resolve({
              data: null,
              error: {
                code: "PGRST205",
                message: "Could not find the table 'public.patient_access_tokens' in the schema cache",
              },
            });
          },
        };
        return api;
      }
      return realFrom(table);
    };
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /Rollback incomplete/);
    assert.equal(writes(f.admin, "delete").length, 0);
  });
});

describe("measured values, dates, source, and local durability", () => {
  it("preserves every measurement/date and verifies remapped JSON IDs with reordered JSONB keys", async () => {
    const initial = makeBundle(true).tables, f = setup(true, initial);
    const sourceBefore = structuredClone(initial);
    await f.run();
    assert.equal(compareIntegrity(null, f.manifest, f.admin.store).length, 0);
    const assignment = f.admin.store.upper_limb_motor_screen_assignments.find((r) => r.patient_id === f.manifest.destPatientId);
    assert.equal(assignment.assignment_payload.id, assignment.id);
    assert.equal(assignment.assignment_payload.repetitions, 5);
    assert.equal(assignment.assignment_payload.token, undefined);
    const assessment = f.admin.store.assessments.find((r) => r.patient_id === f.manifest.destPatientId);
    assessment.metrics = { reach: 1.75, reps: 1 };
    assessment.completed_at = "2026-10-02T10:00:00.123400+00:00";
    assert.equal(compareIntegrity(null, f.manifest, f.admin.store).length, 0);
    assessment.structured_data.observation.value = 999;
    assert.ok(compareIntegrity(null, f.manifest, f.admin.store).some((m) => m.field === "structured_data"));
    assessment.structured_data.observation.value = 4.5;
    assessment.completed_at = "2026-10-02T10:00:00.123401Z";
    assert.ok(compareIntegrity(null, f.manifest, f.admin.store).some((m) => m.field === "completed_at"));
    assessment.completed_at = DATE;
    await rollbackRunVerified(f.admin, f.manifest, f.options);
    for (const { table } of TABLE_PIPELINE) assert.deepEqual(f.admin.store[table], sourceBefore[table]);
  });
  it("source verification detects measured/date changes even when counts and name are unchanged", () => {
    const bundle = makeBundle(true), rows = structuredClone(bundle.tables);
    assert.deepEqual(compareSourceIntegrity(bundle, rows), []);
    rows.assessments[0].structured_data.observation.value = 77;
    assert.ok(compareSourceIntegrity(bundle, rows).length > 0);
    rows.assessments[0] = structuredClone(bundle.tables.assessments[0]);
    rows.patients[0].created_at = "2026-10-03T10:00:00.123400Z";
    assert.ok(compareSourceIntegrity(bundle, rows).length > 0);
  });
  it("paginates beyond the default PostgREST row limit", async () => {
    const admin = createMockAdmin({ assessments: Array.from({ length: 1101 }, (_, i) => ({ id: String(i).padStart(5, "0") })) });
    const rows = await readAllRows(() => admin.from("assessments").select("*"));
    assert.equal(rows.length, 1101);
    assert.equal(admin.requests.length, 3);
  });
  it("exclusively locks a run and keeps complete private JSON after replacement", () => {
    const dir = mkdtempSync(join(tmpdir(), "transfer-ledger-")), lock = join(dir, "run.lock"), path = join(dir, "manifest.json");
    try {
      const release = acquireRunLock(lock);
      assert.throws(() => acquireRunLock(lock), /locked/);
      writeJsonDurable(path, { status: "importing", plannedIds: ["id-1"] });
      writeJsonDurable(path, { status: "imported", plannedIds: ["id-1"] });
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { status: "imported", plannedIds: ["id-1"] });
      release();
      acquireRunLock(lock)();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("CLI guards and real export/verification wiring", () => {
  it("rejects purge, multiple modes, and invalid run IDs", () => {
    assert.throws(() => parseArgs(["--purge-demo-clone"]), /exactly one/);
    assert.throws(() => parseArgs(["--import", "--purge-demo-clone", "--run-id", RUN_ID]), /Unknown/);
    assert.throws(() => parseArgs(["--export", "--import"]), /exactly one/);
    assert.throws(() => parseArgs(["--import", "--run-id", "../unsafe"]), /UUID/);
  });
  it("rejects Production/unknown refs in the actual CLI before loading any DB client", () => {
    for (const ref of [PRODUCTION_PROJECT_REF, "unknownref"]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./judge-demo-patient-transfer.mjs", import.meta.url)),
        "--import", "--run-id", RUN_ID], { encoding: "utf8", env: { ...process.env,
          DEST_SUPABASE_URL: `https://${ref}.supabase.co`, DEST_SERVICE_ROLE_KEY: "synthetic-secret-do-not-print",
          TRANSFER_CONFIRM_STAGING: "true" } });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Refusing mutation/);
      assert.doesNotMatch(result.stderr, /synthetic-secret-do-not-print|ERR_MODULE_NOT_FOUND/);
    }
  });
  it("exports no source tokens and refuses to overwrite an existing run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "transfer-export-")), bundle = makeBundle(true);
    try {
      const source = createMockAdmin(bundle.tables);
      const { manifest, outPath } = await exportBundle(source, SOURCE_PATIENT, dir, RUN_ID);
      const text = readFileSync(outPath, "utf8") + readFileSync(join(dir, `manifest-${RUN_ID}.json`), "utf8");
      assert.doesNotMatch(text, /source-secret/);
      assert.equal(manifest.ledgerVersion, 2);
      await assert.rejects(() => exportBundle(source, SOURCE_PATIENT, dir, RUN_ID), /Run already exists/);
      assert.equal(text, readFileSync(outPath, "utf8") + readFileSync(join(dir, `manifest-${RUN_ID}.json`), "utf8"));
      assert.equal(writes(source, "insert").length + writes(source, "delete").length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("verifyRun checks original source measurements and dates, not only counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "transfer-verify-")), f = setup(true);
    try {
      const source = createMockAdmin(f.bundle.tables);
      const { manifest } = await exportBundle(source, SOURCE_PATIENT, dir, RUN_ID);
      await f.run(manifest, { persistManifest: async (m) => writeManifestAtomic(dir, m) });
      const good = await verifyRun(f.admin, source, dir, RUN_ID);
      assert.equal(good.ok, true); assert.equal(good.sourceUnchanged, true);
      source.store.assessments[0].structured_data.observation.value = 71;
      const bad = await verifyRun(f.admin, source, dir, RUN_ID);
      assert.equal(bad.ok, false); assert.equal(bad.sourceUnchanged, false);
      assert.equal(bad.countMismatches.length, 0); assert.equal(bad.integrityMismatches.length, 0);
      assert.equal(bad.sourceIntegrityMismatches[0].reason, "source_values_or_dates_changed");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("compensates a real API insert error midway through a table", async () => {
    let attempts = 0;
    const f = setup(false, {}, { before(state) {
      if (state.op === "insert" && state.table === "assessments" && ++attempts === 2) {
        return { data: null, error: { code: "23514", message: "synthetic insert failure" } };
      }
    } });
    await assert.rejects(() => f.run(), /assessments insert failed.*compensation verified/);
    assert.equal(f.saved().compensation.ok, true);
    assert.equal(f.admin.store.patients.length + f.admin.store.assessments.length, 0);
  });
});

describe("ambiguous requests and fail-closed dependency reads", () => {
  it("does not compensate a timed-out insert just because an immediate read sees no row", async () => {
    let failed = false;
    const f = setup(false, {}, { before(state) {
      if (!failed && state.op === "insert" && state.table === "assessments") {
        failed = true; return { data: null, error: { message: "request timed out", code: "" } };
      }
    } });
    await assert.rejects(() => f.run(), /insert response ambiguous/);
    const saved = f.saved();
    assert.equal(saved.attemptedLedger.assessments.length, 1);
    assert.equal(writes(f.admin, "delete").length, 0);
    // Simulate the same server request committing after the first absence read.
    f.admin.store.assessments = [structuredClone(saved.plannedRows.assessments[0])];
    const originalPatientId = saved.destPatientId;
    await f.run(saved, { idFactory: () => { throw new Error("must reuse original plan"); } });
    assert.equal(saved.destPatientId, originalPatientId);
    assert.equal(f.admin.store.patients.length, 1); assert.equal(f.admin.store.assessments.length, 2);
  });
  it("does not clean up when a dependency table cannot be inspected (auth/network)", async () => {
    let blockRead = false;
    const f = setup(false, {}, { before(state) {
      if (blockRead && state.op === "select" && state.table === "patient_access_tokens") {
        return { data: null, error: { code: "", message: "fetch failed: network timeout" } };
      }
    } });
    await f.run(); blockRead = true;
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /Rollback incomplete/);
    assert.equal(writes(f.admin, "delete").length, 0);
    assert.equal(f.saved().rollbackAttempt.ok, false);
  });
  it("does not mark rollback complete after an ambiguous delete, even if the row is now absent", async () => {
    let responseLost = false;
    const f = setup(false, {}, { after(state) {
      if (state.op === "delete" && !responseLost) { responseLost = true; throw new Error("delete response lost"); }
    } });
    await f.run();
    await assert.rejects(() => rollbackRunVerified(f.admin, f.manifest, f.options), /Rollback incomplete/);
    assert.equal(f.saved().status, "rolling_back"); assert.equal(f.saved().rollbackAttempt.ok, false);
    assert.equal(writes(f.admin, "delete").length, 1);
    await rollbackRunVerified(f.admin, f.manifest, f.options);
    assert.equal(f.saved().status, "rolled_back"); assert.equal(f.saved().rollbackAttempt.ok, true);
  });
});
