/**
 * Core judge-demo transfer logic (imported by CLI + tests).
 */
import { randomUUID, createHash } from "node:crypto";

export const STAGING_PROJECT_REF = "dpspapbqgkmhzgecljmx";
export const PRODUCTION_PROJECT_REF = "vdtjrdnzvhmxporihswv";
export const DEFAULT_SOURCE_PATIENT_ID = "3724b668-2975-429b-a558-fe8698df73d2";
export const DEST_DISPLAY_NAME = "Demo — Ream Mohammed";

export const TABLE_PIPELINE = [
  { table: "patients", scope: "row", pk: "id" },
  { table: "assessments", scope: "patient_id" },
  { table: "treatment_plans", scope: "patient_id" },
  { table: "plan_sessions", scope: "patient_id" },
  { table: "session_logs", scope: "patient_id" },
  { table: "cv_session_metrics", scope: "patient_id" },
  { table: "interactive_shoulder_movement_outcomes", scope: "patient_id" },
  { table: "upper_limb_motor_screen_assignments", scope: "patient_id" },
  {
    table: "upper_limb_motor_screen_session_results",
    scope: "assignment_ids",
    parentTable: "upper_limb_motor_screen_assignments",
  },
  { table: "remote_assessment_requests", scope: "patient_id" },
  { table: "ai_clinician_summaries", scope: "patient_id" },
];

export const ROLLBACK_DELETE_ORDER = [...TABLE_PIPELINE].reverse().map((t) => t.table);

// Inventory evidence, not a claim that reports have rendered in the browser.
export function buildReportDataCoverage(tables) {
  const cv = tables.cv_session_metrics ?? [];
  return {
    motionAnalysis: {
      rows: cv.length,
      rowsWithMotionQuality: cv.filter((r) => r.motion_quality != null).length,
      sourceDataPresent: cv.length > 0,
    },
    progress: { assessmentRows: (tables.assessments ?? []).length },
    outcomes: { rows: (tables.interactive_shoulder_movement_outcomes ?? []).length },
    browserVerified: false,
  };
}

export const FK_REMAP = {
  patients: ["provider_id"],
  assessments: ["patient_id", "provider_id"],
  treatment_plans: ["patient_id", "provider_id", "assessment_id"],
  plan_sessions: ["plan_id", "patient_id", "provider_id"],
  session_logs: ["plan_id", "plan_session_id", "patient_id", "provider_id"],
  cv_session_metrics: ["plan_id", "plan_session_id", "patient_id", "provider_id"],
  interactive_shoulder_movement_outcomes: [
    "plan_session_id",
    "plan_id",
    "patient_id",
    "provider_id",
  ],
  upper_limb_motor_screen_assignments: ["patient_id", "provider_id"],
  upper_limb_motor_screen_session_results: ["assignment_id", "patient_id", "provider_id"],
  remote_assessment_requests: ["patient_id", "provider_id", "assessment_id"],
  ai_clinician_summaries: ["patient_id", "provider_id", "plan_id", "approved_by"],
};

export const REGENERATE_ON_IMPORT = {
  remote_assessment_requests: {
    token: (ctx, row) => ctx.generatedValues.remote_assessment_requests[row.sourceId].token,
  },
  session_logs: {
    patient_token: (ctx, row) =>
      `demo-clone-${ctx.runId.slice(0, 8)}-${String(row.id).slice(0, 8)}`,
  },
  treatment_plans: {
    catalog_assignment_request_id: (ctx, row) =>
      row.catalog_assignment_request_id != null
        ? ctx.generatedValues.treatment_plans[row.sourceId].catalog_assignment_request_id
        : null,
  },
};

export const JSONB_ID_PATCH = {
  upper_limb_motor_screen_assignments: [
    { column: "assignment_payload", path: ["id"], idField: "id" },
  ],
  upper_limb_motor_screen_session_results: [
    { column: "result_payload", path: ["id"], idField: "id" },
    {
      column: "result_payload",
      path: ["assignmentId"],
      fkTable: "upper_limb_motor_screen_assignments",
    },
  ],
};

export function extractSupabaseProjectRef(url) {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function assertMutationDestinationAllowed(destUrl) {
  const ref = extractSupabaseProjectRef(destUrl);
  if (!ref) {
    throw new Error(
      `Refusing mutation: DEST_SUPABASE_URL must be https://<project-ref>.supabase.co (got unparseable host)`,
    );
  }
  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Refusing mutation: destination project ref ${PRODUCTION_PROJECT_REF} (Production) is blocked`,
    );
  }
  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(
      `Refusing mutation: destination project ref must be ${STAGING_PROJECT_REF} (got ${ref})`,
    );
  }
  return ref;
}

export function requireExplicitDestCredentials() {
  const url = process.env.DEST_SUPABASE_URL?.trim();
  const key = process.env.DEST_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Mutations require explicit DEST_SUPABASE_URL and DEST_SERVICE_ROLE_KEY (no NEXT_PUBLIC fallback)",
    );
  }
  assertMutationDestinationAllowed(url);
  return { url, key };
}

// Guard the actual client as well as the operator's explicit credential pair.
export function assertMutationClientAllowed(admin, destination) {
  if (!destination?.url?.trim() || !destination?.key?.trim()) {
    throw new Error("Mutations require explicit DEST credentials");
  }
  assertMutationDestinationAllowed(destination.url);
  assertMutationDestinationAllowed(admin.supabaseUrl);
  if (new URL(destination.url).origin !== new URL(admin.supabaseUrl).origin ||
      admin.supabaseKey !== destination.key) {
    throw new Error("Destination credentials do not match the mutation client");
  }
}

export function mapId(mappings, table, oldId) {
  if (oldId == null) return null;
  const m = mappings[table]?.[oldId];
  if (!m) throw new Error(`Missing id mapping for ${table}.${oldId}`);
  return m;
}

function setJsonPath(obj, pathKeys, value) {
  let cur = obj;
  for (let i = 0; i < pathKeys.length - 1; i++) {
    const k = pathKeys[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[pathKeys[pathKeys.length - 1]] = value;
}

export function cloneRowForImport(table, row, ctx) {
  const out = { ...row };
  const oldPk = out.id;

  if (table === "patients") {
    out.id = ctx.destPatientId;
  } else {
    out.id = mapId(ctx.plannedIds, table, oldPk);
  }

  for (const col of FK_REMAP[table] ?? []) {
    const val = out[col];
    if (val == null) continue;
    if (col === "provider_id") {
      out[col] = ctx.destProviderId;
      continue;
    }
    if (col === "patient_id") {
      out[col] = ctx.destPatientId;
      continue;
    }
    if (col === "approved_by") {
      out[col] = ctx.destProviderId;
      continue;
    }
    const refTable =
      col === "assessment_id"
        ? "assessments"
        : col === "plan_id"
          ? "treatment_plans"
          : col === "plan_session_id"
            ? "plan_sessions"
            : col === "assignment_id"
              ? "upper_limb_motor_screen_assignments"
              : null;
    if (refTable) out[col] = mapId(ctx.plannedIds, refTable, val);
  }

  const regen = REGENERATE_ON_IMPORT[table];
  if (regen) {
    for (const [col, fn] of Object.entries(regen)) {
      out[col] = fn(ctx, { ...row, sourceId: oldPk, id: out.id ?? oldPk });
    }
  }

  if (table === "session_logs") {
    out.patient_token = REGENERATE_ON_IMPORT.session_logs.patient_token(ctx, { id: out.id });
  }

  if (table === "upper_limb_motor_screen_assignments") {
    if ("token_hash" in out) out.token_hash = null;
    if ("token_expires_at" in out) out.token_expires_at = null;
    if (out.assignment_request_id != null) {
      out.assignment_request_id = ctx.generatedValues.upper_limb_motor_screen_assignments[oldPk].assignment_request_id;
    }
    if (out.assignment_payload && typeof out.assignment_payload === "object") {
      const copy = structuredClone(out.assignment_payload);
      for (const key of ["remoteToken", "token", "tokenHash", "remoteLinkToken"]) {
        if (key in copy) delete copy[key];
      }
      if (copy.assignmentRequestId != null) {
        copy.assignmentRequestId = out.assignment_request_id;
      }
      out.assignment_payload = copy;
    }
  }

  const patches = JSONB_ID_PATCH[table];
  if (patches) {
    for (const patch of patches) {
      const payload = out[patch.column];
      if (!payload || typeof payload !== "object") continue;
      const copy = structuredClone(payload);
      if (patch.idField) {
        setJsonPath(copy, patch.path, out.id);
      } else if (patch.fkTable) {
        setJsonPath(copy, patch.path, mapId(ctx.plannedIds, patch.fkTable, row.assignment_id));
      }
      out[patch.column] = copy;
    }
  }

  return out;
}

// Source secrets are never copied into the export or verification snapshot.
export function sanitizeExportRow(table, row) {
  const out = structuredClone(row);
  if (table === "remote_assessment_requests") delete out.token;
  if (table === "session_logs") delete out.patient_token;
  if (table === "upper_limb_motor_screen_assignments") {
    if ("token_hash" in out) out.token_hash = null;
    if ("token_expires_at" in out) out.token_expires_at = null;
    for (const key of ["remoteToken", "token", "tokenHash", "remoteLinkToken"]) {
      if (out.assignment_payload) delete out.assignment_payload[key];
    }
  }
  return out;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

// Compare timestamptz instants without discarding PostgreSQL's microseconds.
function normalizedTimestamp(value) {
  if (typeof value !== "string") return value;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return value;
  const seconds = Date.parse(match[1] + match[3]);
  return Number.isFinite(seconds) ? `${seconds}:${(match[2] ?? "").padEnd(6, "0")}` : value;
}

function valuesEqual(field, expected, actual) {
  if (/(?:_at|_timestamp)$/.test(field)) {
    return normalizedTimestamp(expected) === normalizedTimestamp(actual);
  }
  return stableJson(expected) === stableJson(actual);
}

export function rowsMatchForRecovery(expected, actual) {
  return actual && Object.entries(expected).every(([k, v]) => valuesEqual(k, v, actual[k]));
}

export function buildIntegritySnapshot(bundle) {
  return Object.fromEntries(TABLE_PIPELINE.map(({ table }) => [table,
    Object.fromEntries((bundle.tables[table] ?? []).map((row) =>
      [row.id, sanitizeExportRow(table, row)])),
  ]));
}

export function compareSourceIntegrity(bundle, sourceRowsByTable) {
  const mismatches = [];
  const expected = buildIntegritySnapshot(bundle);
  for (const { table } of TABLE_PIPELINE) {
    const rows = sourceRowsByTable[table] ?? [];
    const original = Object.values(expected[table]);
    if (rows.length !== original.length) mismatches.push({ table, reason: "source_count_changed" });
    for (const row of original) {
      if (!rowsMatchForRecovery(row, sanitizeExportRow(table, rows.find((r) => r.id === row.id) ?? {}))) {
        mismatches.push({ table, sourceId: row.id, reason: "source_values_or_dates_changed" });
      }
    }
  }
  return mismatches;
}

export function compareIntegrity(_bundle, manifest, destRowsByTable) {
  const mismatches = [];
  for (const { table } of TABLE_PIPELINE) {
    for (const expected of manifest.plannedRows?.[table] ?? []) {
      const actual = (destRowsByTable[table] ?? []).find((r) => r.id === expected.id);
      if (!actual) {
        mismatches.push({ table, destId: expected.id, reason: "dest_row_missing" });
        continue;
      }
      for (const [field, value] of Object.entries(expected)) {
        if (!valuesEqual(field, value, actual[field])) {
          // Do not print contact details, measured payloads, or destination tokens.
          mismatches.push({ table, destId: expected.id, field, reason: "value_or_date_changed" });
        }
      }
    }
  }
  return mismatches;
}

function planDigest(manifest) {
  return digest({ runId: manifest.runId, sourceDigest: manifest.sourceDigest,
    destProviderId: manifest.destProviderId, destPatientId: manifest.destPatientId,
    destinationProjectRef: manifest.destinationProjectRef,
    idMappings: manifest.idMappings, plannedRows: manifest.plannedRows });
}

function validateStoredPlan(manifest) {
  if (manifest.ledgerVersion !== 2 || !manifest.plannedRows || !manifest.planDigest ||
      !manifest.attemptedLedger || !manifest.insertedLedger) {
    throw new Error("Incomplete legacy manifest: preserve it; reconcile with ops before retry. No new IDs allocated.");
  }
  if (manifest.destinationProjectRef !== STAGING_PROJECT_REF || manifest.planDigest !== planDigest(manifest)) {
    throw new Error("Manifest destination or planned payload changed; refusing writes");
  }
  const attempted = manifest.attemptedLedger ?? {};
  const inserted = manifest.insertedLedger ?? {};
  for (const { table } of TABLE_PIPELINE) {
    const planned = manifest.plannedRows[table] ?? [];
    const ids = new Set(planned.map((r) => r.id));
    const mappingIds = Object.values(manifest.idMappings[table] ?? {});
    if (ids.size !== planned.length || mappingIds.length !== ids.size || mappingIds.some((id) => !ids.has(id))) {
      throw new Error(`${table}: invalid durable ID mappings`);
    }
    if ((attempted[table] ?? []).some((id) => !ids.has(id)) ||
        (inserted[table] ?? []).some((id) => !ids.has(id) || !(attempted[table] ?? []).includes(id))) {
      throw new Error(`${table}: ledger contains IDs without a durable write intent`);
    }
  }
  if (manifest.plannedRows.patients?.length !== 1 ||
      manifest.idMappings.patients?.[manifest.sourcePatientId] !== manifest.destPatientId ||
      manifest.plannedRows.patients[0].id !== manifest.destPatientId) {
    throw new Error("Invalid durable patient plan");
  }
}

export function buildImportPlan(bundle, manifest, destProviderId, idFactory = randomUUID) {
  if (!Array.isArray(bundle.tables?.cv_session_metrics)) {
    throw new Error("Export predates motion report coverage: preserve this run and reconcile before retry; no writes or new clone IDs");
  }
  if (manifest.ledgerVersion !== 2) {
    throw new Error("Incomplete legacy manifest: preserve it; reconcile with ops before retry. No new IDs allocated.");
  }
  if (bundle.runId !== manifest.runId || bundle.sourcePatientId !== manifest.sourcePatientId ||
      bundle.tables.patients?.length !== 1 || bundle.tables.patients[0].id !== manifest.sourcePatientId) {
    throw new Error("Bundle does not belong to this transfer run");
  }
  const sourceDigest = digest(buildIntegritySnapshot(bundle));
  if (manifest.status !== "exported" || manifest.destPatientId || manifest.plannedRows ||
      manifest.importStartedAt || Object.keys(manifest.idMappings ?? {}).length ||
      Object.values(manifest.insertedLedger ?? {}).flat().length ||
      Object.values(manifest.attemptedLedger ?? {}).flat().length) {
    validateStoredPlan(manifest);
    if (manifest.destProviderId !== destProviderId || manifest.sourceDigest !== sourceDigest) {
      throw new Error("Cannot change provider or export data while resuming the same run");
    }
    return { resumed: true };
  }
  const plannedIds = {};
  const generatedValues = {};
  const sourceIds = new Set(TABLE_PIPELINE.flatMap(({ table }) => (bundle.tables[table] ?? []).map((r) => r.id)));
  const newIds = new Set();
  function allocate() {
    const id = idFactory();
    if (sourceIds.has(id) || newIds.has(id)) throw new Error("Generated ID collision; no writes performed");
    newIds.add(id);
    return id;
  }
  for (const { table } of TABLE_PIPELINE) {
    plannedIds[table] = {};
    generatedValues[table] = {};
    for (const row of bundle.tables[table] ?? []) {
      if (!row.id || plannedIds[table][row.id] ||
          (row.patient_id != null && row.patient_id !== manifest.sourcePatientId)) {
        throw new Error(`${table}: invalid source row identity`);
      }
      plannedIds[table][row.id] = allocate();
      if (table === "remote_assessment_requests") generatedValues[table][row.id] = { token: allocate().replace(/-/g, "") };
      if (table === "treatment_plans" && row.catalog_assignment_request_id != null) {
        generatedValues[table][row.id] = { catalog_assignment_request_id: allocate() };
      }
      if (table === "upper_limb_motor_screen_assignments" && row.assignment_request_id != null) {
        generatedValues[table][row.id] = { assignment_request_id: allocate() };
      }
    }
  }
  const destPatientId = plannedIds.patients[manifest.sourcePatientId];
  const ctx = { runId: manifest.runId, destPatientId, destProviderId, plannedIds, generatedValues };
  const plannedRows = {};
  for (const { table } of TABLE_PIPELINE) {
    plannedRows[table] = (bundle.tables[table] ?? []).map((row) => {
      const clone = cloneRowForImport(table, sanitizeExportRow(table, row), ctx);
      if (table === "patients") {
        clone.full_name = DEST_DISPLAY_NAME;
        clone.file_number = `${row.file_number || "patient"}-demo-${manifest.runId}`;
      }
      return clone;
    });
  }
  Object.assign(manifest, { ledgerVersion: 2, sourceDigest, destPatientId, destProviderId,
    destinationProjectRef: STAGING_PROJECT_REF, idMappings: plannedIds, plannedRows,
    expectedCounts: Object.fromEntries(TABLE_PIPELINE.map(({ table }) => [table, plannedRows[table].length])),
    attemptedLedger: {}, insertedLedger: {}, status: "importing" });
  manifest.planDigest = planDigest(manifest);
  validateStoredPlan(manifest);
  return { resumed: false };
}

function recoveryError(message, cause) {
  const error = new Error(message, { cause });
  error.needsRecovery = true;
  return error;
}

async function persist(persistManifest, manifest) {
  if (typeof persistManifest !== "function") throw recoveryError("Durable manifest writer required");
  try { await persistManifest(manifest); }
  catch (error) { throw recoveryError("Manifest flush failed; stop mutations and retry the same run after storage recovery", error); }
}

async function readRow(admin, table, id) {
  try {
    const { data, error } = await admin.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  } catch (error) {
    throw recoveryError(`${table}.${id}: read failed; row presence is unverified`, error);
  }
}

/** Legacy optional inbound table — not in all staging schemas; never copied by transfer. */
export const OPTIONAL_ABSENT_INBOUND_TABLE = "session_motion_summaries";

/** Only PGRST205 on session_motion_summaries may be skipped; no broad "missing table" heuristics. */
export function isOptionalSessionMotionSummariesAbsent(error) {
  return error?.code === "PGRST205";
}

async function readInboundDependencyRows(admin, table, column, parentIds) {
  if (table === OPTIONAL_ABSENT_INBOUND_TABLE) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (!error) {
      return readAllRows(() => admin.from(table).select("*").in(column, parentIds));
    }
    if (isOptionalSessionMotionSummariesAbsent(error)) return [];
    throw recoveryError("Dependency/table read failed; no cleanup is safe", error);
  }
  return readAllRows(() => admin.from(table).select("*").in(column, parentIds));
}

export async function readAllRows(queryFactory) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    let response;
    try { response = await queryFactory().order("id").range(offset, offset + 499); }
    catch (error) { throw recoveryError("Dependency/table read failed; no cleanup is safe", error); }
    const { data, error } = response;
    if (error) throw recoveryError("Dependency/table read failed; no cleanup is safe", error);
    if (!Array.isArray(data)) throw recoveryError("Invalid table read response");
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

function addLedger(manifest, key, table, id) {
  manifest[key] ??= {};
  manifest[key][table] ??= [];
  if (!manifest[key][table].includes(id)) manifest[key][table].push(id);
}

// Read even ledgered rows: a previous compensation may have removed only some.
async function reconcileAttemptedRows(admin, manifest, persistManifest) {
  for (const { table } of TABLE_PIPELINE) {
    for (const expected of manifest.plannedRows[table]) {
      const actual = await readRow(admin, table, expected.id);
      if (!actual) continue;
      if (!(manifest.attemptedLedger[table] ?? []).includes(expected.id) || !rowsMatchForRecovery(expected, actual)) {
        throw recoveryError(`${table}.${expected.id}: planned ID is occupied by an unowned or changed row`);
      }
      if (!(manifest.insertedLedger[table] ?? []).includes(expected.id)) {
        addLedger(manifest, "insertedLedger", table, expected.id);
        await persist(persistManifest, manifest);
      }
    }
  }
}

// All inbound FKs to transferred tables in migrations 000-025, including SET NULL.
// Tables excluded from copy must still block cleanup. Unknown/missing columns fail closed.
export const INBOUND_DEPENDENCIES = [
  ["assessments", "patient_id", "patients"],
  ["treatment_plans", "patient_id", "patients"], ["treatment_plans", "assessment_id", "assessments"],
  ["plan_sessions", "patient_id", "patients"], ["plan_sessions", "plan_id", "treatment_plans"],
  ["session_logs", "patient_id", "patients"], ["session_logs", "plan_id", "treatment_plans"],
  ["session_logs", "plan_session_id", "plan_sessions"],
  ["interactive_shoulder_movement_outcomes", "patient_id", "patients"],
  ["interactive_shoulder_movement_outcomes", "plan_id", "treatment_plans"],
  ["interactive_shoulder_movement_outcomes", "plan_session_id", "plan_sessions"],
  ["upper_limb_motor_screen_assignments", "patient_id", "patients"],
  ["upper_limb_motor_screen_session_results", "assignment_id", "upper_limb_motor_screen_assignments"],
  ["upper_limb_motor_screen_session_results", "patient_id", "patients"],
  ["remote_assessment_requests", "patient_id", "patients"], ["remote_assessment_requests", "assessment_id", "assessments"],
  ["ai_clinician_summaries", "patient_id", "patients"], ["ai_clinician_summaries", "plan_id", "treatment_plans"],
  ["patient_access_tokens", "patient_id", "patients"], ["patient_access_tokens", "plan_id", "treatment_plans"],
  ["clinical_review_acknowledgments", "patient_id", "patients"],
  ["clinical_review_acknowledgments", "plan_id", "treatment_plans"],
  ["clinical_review_acknowledgments", "session_log_id", "session_logs"],
  ["cv_session_metrics", "patient_id", "patients"], ["cv_session_metrics", "plan_id", "treatment_plans"],
  ["cv_session_metrics", "plan_session_id", "plan_sessions"],
  ["speech_transcription_sessions", "patient_id", "patients"],
  ["speech_transcription_sessions", "remote_request_id", "remote_assessment_requests"],
  ["speech_transcription_sessions", "assessment_id", "assessments"],
  ["session_motion_summaries", "patient_id", "patients"],
];

async function assertNoUnownedDependents(admin, manifest, parentTable = null) {
  for (const [table, column, parent] of INBOUND_DEPENDENCIES) {
    if (parentTable && parent !== parentTable) continue;
    const parentIds = Object.values(manifest.idMappings[parent] ?? {});
    if (!parentIds.length) continue;
    const rows = await readInboundDependencyRows(admin, table, column, parentIds);
    for (const actual of rows) {
      const expected = manifest.plannedRows[table]?.find((r) => r.id === actual.id);
      if (!(manifest.insertedLedger[table] ?? []).includes(actual.id) ||
          !expected || !rowsMatchForRecovery(expected, actual)) {
        throw recoveryError(`Cleanup refused: ${table}.${actual.id} is an unrelated or changed dependent row`);
      }
    }
  }
}

export async function verifyLedgerFullyRemoved(admin, ledger) {
  const remaining = {}, unverified = {}, absent = {}, errors = [];
  for (const { table } of TABLE_PIPELINE) {
    for (const id of [...new Set(ledger[table] ?? [])]) {
      try {
        const row = await readRow(admin, table, id);
        const target = row ? remaining : absent;
        (target[table] ??= []).push(id);
      } catch (error) {
        (unverified[table] ??= []).push(id);
        errors.push(error.message);
      }
    }
  }
  return { ok: !Object.keys(remaining).length && !Object.keys(unverified).length,
    remaining, unverified, absent, errors };
}

// No patient-wide or name-based deletion. Stop at the FIRST failure, before parents.
export async function deleteLedgerRowsVerified(admin, manifest, { destination, persistManifest, hooks = {} } = {}) {
  assertMutationClientAllowed(admin, destination);
  if (!["importing", "imported", "rolling_back"].includes(manifest.status)) {
    throw new Error(`Cannot cleanup run in status=${manifest.status}`);
  }
  validateStoredPlan(manifest);
  const ledger = manifest.attemptedLedger;
  const errors = [], deleted = {};
  try {
    await reconcileAttemptedRows(admin, manifest, persistManifest);
    await assertNoUnownedDependents(admin, manifest);
    for (const table of ROLLBACK_DELETE_ORDER) {
      const ids = [...new Set(ledger[table] ?? [])];
      if (!ids.length) continue;
      await hooks.beforeDeleteTable?.(table, ids);
      for (const id of ids) {
        await hooks.beforeDelete?.(table, id);
        const actual = await readRow(admin, table, id);
        if (!actual) continue;
        const expected = manifest.plannedRows[table].find((r) => r.id === id);
        if (!rowsMatchForRecovery(expected, actual)) throw recoveryError(`${table}.${id}: cleanup ownership changed`);
        await assertNoUnownedDependents(admin, manifest, table);
        manifest.pendingDelete = { table, id };
        await persist(persistManifest, manifest);
        let query = admin.from(table).delete({ count: "exact" }).eq("id", id);
        for (const col of ["patient_id", "provider_id"]) {
          if (expected[col] != null) query = query.eq(col, expected[col]);
        }
        const { data, error, count } = await query.select("id");
        if (error) throw new Error(`${table}.${id}: delete failed (${error.code ?? "request error"})`);
        if (!Array.isArray(data) || data.some((r) => r.id !== id) || (count != null && count > 1)) {
          throw new Error(`${table}.${id}: unexpected delete response`);
        }
        if (await readRow(admin, table, id)) throw new Error(`${table}.${id}: row remains after delete`);
        if (data.some((r) => r.id === id)) (deleted[table] ??= []).push(id);
        manifest.pendingDelete = null;
        manifest.cleanupProgress = { deleted, lastVerifiedAbsent: { table, id } };
        await persist(persistManifest, manifest);
      }
    }
  } catch (error) { errors.push(error.message); }
  const verify = await verifyLedgerFullyRemoved(admin, ledger);
  return { ...verify, deleted, errors: [...errors, ...verify.errors], ok: !errors.length && verify.ok };
}

async function insertOrRecover(admin, table, expected, manifest, persistManifest, hooks) {
  const existing = await readRow(admin, table, expected.id);
  if (existing) {
    if (!(manifest.attemptedLedger[table] ?? []).includes(expected.id) || !rowsMatchForRecovery(expected, existing)) {
      throw recoveryError(`${table}.${expected.id}: occupied planned ID`);
    }
  } else {
    await hooks.beforeInsert?.(table, expected, expected.id);
    addLedger(manifest, "attemptedLedger", table, expected.id);
    manifest.pendingInsert = { table, id: expected.id };
    await persist(persistManifest, manifest);
    let insertError;
    try {
      const result = await admin.from(table).insert(expected);
      insertError = result.error;
    } catch (error) { insertError = error; }
    if (insertError) {
      // A failed/throwing response can follow a committed insert. Do not guess.
      const recovered = await readRow(admin, table, expected.id);
      if (!recovered) {
        // A timeout/5xx can leave a request still running server-side. Absence now
        // does not prove it cannot commit later. Only explicit SQL errors permit
        // automatic compensation; all ambiguous responses pause the run.
        if (!/^[0-9A-Z]{5}$/.test(insertError.code ?? "")) {
          throw recoveryError(`${table}.${expected.id}: insert response ambiguous; preserve intent and retry the same run`);
        }
        throw new Error(`${table} insert failed (${insertError.code})`);
      }
      if (!rowsMatchForRecovery(expected, recovered)) throw recoveryError(`${table}.${expected.id}: ambiguous insert has different payload`);
    }
  }
  addLedger(manifest, "insertedLedger", table, expected.id);
  manifest.pendingInsert = null;
  await persist(persistManifest, manifest); // Must finish before another insert.
}

async function verifyDestinationRows(admin, manifest) {
  const rows = {};
  const countMismatches = [];
  for (const { table, scope } of TABLE_PIPELINE) {
    if (scope === "row") {
      const row = await readRow(admin, table, manifest.destPatientId);
      rows[table] = row ? [row] : [];
    } else if (scope === "assignment_ids") {
      const ids = Object.values(manifest.idMappings.upper_limb_motor_screen_assignments);
      rows[table] = ids.length ? await readAllRows(() => admin.from(table).select("*").in("assignment_id", ids)) : [];
    } else {
      rows[table] = await readAllRows(() => admin.from(table).select("*").eq("patient_id", manifest.destPatientId));
    }
    if (rows[table].length !== manifest.expectedCounts[table]) countMismatches.push(table);
  }
  const integrityMismatches = compareIntegrity(null, manifest, rows);
  return { ok: !countMismatches.length && !integrityMismatches.length, countMismatches, integrityMismatches };
}

export async function importBundleDurable(admin, bundle, manifest, destProviderId,
  { destination, persistManifest, hooks = {}, idFactory = randomUUID } = {}) {
  assertMutationClientAllowed(admin, destination);
  if (!["exported", "importing"].includes(manifest.status)) throw new Error(`Cannot import run in status=${manifest.status}`);
  const plan = buildImportPlan(bundle, manifest, destProviderId, idFactory);
  manifest.importStartedAt ??= new Date().toISOString();
  await persist(persistManifest, manifest); // Complete immutable plan before ANY DB write.
  await reconcileAttemptedRows(admin, manifest, persistManifest);
  // Re-check dependencies on EVERY restart, even if cached previously.
  manifest.dependencyChecks = await hooks.validateDestinationDeps?.(admin, bundle, destProviderId) ?? null;
  await persist(persistManifest, manifest);
  try {
    for (const { table } of TABLE_PIPELINE) {
      for (const expected of manifest.plannedRows[table]) {
        await insertOrRecover(admin, table, expected, manifest, persistManifest, hooks);
      }
    }
    const verification = await verifyDestinationRows(admin, manifest);
    manifest.importVerification = verification;
    if (!verification.ok) throw recoveryError("Destination counts/values/dates do not match the durable plan");
  } catch (error) {
    manifest.lastError = error.message;
    if (error.needsRecovery) {
      // IO/read uncertainty: preserve IDs + intents and stop. No unsafe compensation.
      try { await persist(persistManifest, manifest); } catch { /* last durable plan survives */ }
      throw error;
    }
    await persist(persistManifest, manifest);
    const comp = await deleteLedgerRowsVerified(admin, manifest, { destination, persistManifest, hooks });
    manifest.compensation = { attemptedAt: new Date().toISOString(), ...comp };
    await persist(persistManifest, manifest);
    throw new Error(`${error.message}; compensation ${comp.ok ? "verified" : "incomplete"}`);
  }
  manifest.status = "imported";
  manifest.importedAt = new Date().toISOString();
  manifest.lastError = null;
  try { await persist(persistManifest, manifest); }
  catch (error) { manifest.status = "importing"; throw error; }
  return { ...manifest, resumed: plan.resumed };
}

export async function rollbackRunVerified(admin, manifest, { destination, persistManifest, hooks = {} } = {}) {
  assertMutationClientAllowed(admin, destination);
  if (!["imported", "importing", "rolling_back"].includes(manifest.status)) {
    throw new Error(`Cannot rollback run in status=${manifest.status}`);
  }
  validateStoredPlan(manifest);
  const previousStatus = manifest.status;
  manifest.status = "rolling_back";
  await persist(persistManifest, manifest);
  const comp = await deleteLedgerRowsVerified(admin, manifest, { destination, persistManifest, hooks });
  manifest.rollbackAttempt = { attemptedAt: new Date().toISOString(), ...comp };
  if (!comp.ok) {
    // Do not resume import after an explicit rollback starts.
    await persist(persistManifest, manifest);
    throw new Error(`Rollback incomplete: remaining=${JSON.stringify(comp.remaining)}, unverified=${JSON.stringify(comp.unverified)}; ${comp.errors.join("; ")}`);
  }
  manifest.status = "rolled_back";
  manifest.rolledBackAt = new Date().toISOString();
  try { await persist(persistManifest, manifest); }
  catch (error) { manifest.status = previousStatus === "rolling_back" ? previousStatus : "rolling_back"; throw error; }
  return manifest;
}
