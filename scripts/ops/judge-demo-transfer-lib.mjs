/**
 * Core judge-demo transfer logic (imported by CLI + tests).
 */
import { randomUUID } from "node:crypto";

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

export const FK_REMAP = {
  patients: ["provider_id"],
  assessments: ["patient_id", "provider_id"],
  treatment_plans: ["patient_id", "provider_id", "assessment_id"],
  plan_sessions: ["plan_id", "patient_id", "provider_id"],
  session_logs: ["plan_id", "plan_session_id", "patient_id", "provider_id"],
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
    token: () => randomUUID().replace(/-/g, ""),
  },
  session_logs: {
    patient_token: (ctx, row) =>
      `demo-clone-${ctx.runId.slice(0, 8)}-${String(row.id).slice(0, 8)}`,
  },
  treatment_plans: {
    catalog_assignment_request_id: (_ctx, row) =>
      row.catalog_assignment_request_id != null ? randomUUID() : null,
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

/** Fields preserved byte-for-byte between source export and destination clone (per source row id). */
export const INTEGRITY_FIELDS = {
  patients: ["created_at", "updated_at"],
  assessments: ["created_at", "updated_at", "completed_at", "score", "metrics"],
  treatment_plans: ["created_at", "updated_at"],
  plan_sessions: ["created_at", "updated_at", "scheduled_at", "completed_at", "exercises"],
  session_logs: ["completed_at", "created_at", "effort_score", "exercises_completed", "pain_score"],
  interactive_shoulder_movement_outcomes: ["created_at", "outcome_payload", "schema_version"],
  upper_limb_motor_screen_assignments: [
    "created_at",
    "updated_at",
    "assignment_payload",
    "schema_version",
  ],
  upper_limb_motor_screen_session_results: [
    "created_at",
    "updated_at",
    "result_payload",
    "schema_version",
  ],
  remote_assessment_requests: ["created_at", "submitted_at", "expires_at", "included_sections"],
  ai_clinician_summaries: ["created_at", "approved_at", "inputs_snapshot", "draft_text"],
};

export function extractSupabaseProjectRef(url) {
  if (!url) return null;
  const trimmed = url.trim();
  const hostMatch = trimmed.match(/^https?:\/\/([^/?#]+)/i);
  if (!hostMatch) return null;
  const host = hostMatch[1].toLowerCase();
  const supabase = host.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (supabase) return supabase[1];
  return null;
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
      out[col] = fn(ctx, { ...row, id: out.id ?? oldPk });
    }
  }

  if (table === "session_logs") {
    out.patient_token = REGENERATE_ON_IMPORT.session_logs.patient_token(ctx, { id: out.id });
  }

  if (table === "upper_limb_motor_screen_assignments") {
    if ("token_hash" in out) out.token_hash = null;
    if ("token_expires_at" in out) out.token_expires_at = null;
    if (out.assignment_request_id != null) {
      out.assignment_request_id = ctx.plannedAssignmentRequestIds?.[oldPk] ?? randomUUID();
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

export function buildIntegritySnapshot(bundle) {
  const snapshot = {};
  for (const spec of TABLE_PIPELINE) {
    const table = spec.table;
    snapshot[table] = {};
    for (const row of bundle.tables[table] ?? []) {
      const fields = INTEGRITY_FIELDS[table] ?? [];
      const entry = {};
      for (const f of fields) {
        if (row[f] !== undefined) entry[f] = row[f];
      }
      snapshot[table][row.id] = entry;
    }
  }
  return snapshot;
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

export function compareIntegrity(bundle, manifest, destRowsByTable) {
  const mismatches = [];
  const snap = manifest.integritySnapshot ?? buildIntegritySnapshot(bundle);
  for (const spec of TABLE_PIPELINE) {
    const table = spec.table;
    if (table === "patients") continue;
    const tableSnap = snap[table] ?? {};
    for (const [sourceId, expected] of Object.entries(tableSnap)) {
      const destId = manifest.idMappings?.[table]?.[sourceId];
      if (!destId) {
        mismatches.push({ table, sourceId, reason: "missing_id_mapping" });
        continue;
      }
      const destRow = (destRowsByTable[table] ?? []).find((r) => r.id === destId);
      if (!destRow) {
        mismatches.push({ table, sourceId, destId, reason: "dest_row_missing" });
        continue;
      }
      for (const [field, expVal] of Object.entries(expected)) {
        const actVal = destRow[field];
        if (stableJson(expVal) !== stableJson(actVal)) {
          mismatches.push({ table, sourceId, destId, field, expected: expVal, actual: actVal });
        }
      }
    }
  }
  return mismatches;
}

function buildPatientInsertRow(sourcePatient, destPatientId, runId, destProviderId) {
  const shortRun = runId.slice(0, 8);
  return {
    ...sourcePatient,
    id: destPatientId,
    full_name: DEST_DISPLAY_NAME,
    file_number: sourcePatient.file_number
      ? `${sourcePatient.file_number}-demo-${shortRun}`
      : `demo-${shortRun}`,
    provider_id: destProviderId,
  };
}

export function buildImportPlan(bundle, manifest, destProviderId, idFactory = randomUUID) {
  const sourcePatient = bundle.tables.patients[0];
  if (!sourcePatient) throw new Error("Export missing source patient row");

  const sourcePatientId = manifest.sourcePatientId;

  if (
    manifest.status === "importing" &&
    manifest.destPatientId &&
    manifest.idMappings?.patients?.[sourcePatientId]
  ) {
    return {
      destPatientId: manifest.destPatientId,
      plannedIds: manifest.idMappings,
      plannedAssignmentRequestIds: manifest.plannedAssignmentRequestIds ?? {},
      patientInsert: buildPatientInsertRow(
        sourcePatient,
        manifest.destPatientId,
        manifest.runId,
        destProviderId,
      ),
      resumed: true,
    };
  }

  const destPatientId = idFactory();
  const plannedIds = { patients: { [sourcePatientId]: destPatientId } };
  const plannedAssignmentRequestIds = {};

  for (const spec of TABLE_PIPELINE) {
    const table = spec.table;
    if (table === "patients") continue;
    plannedIds[table] = {};
    for (const row of bundle.tables[table] ?? []) {
      plannedIds[table][row.id] = idFactory();
      if (table === "upper_limb_motor_screen_assignments" && row.assignment_request_id != null) {
        plannedAssignmentRequestIds[row.id] = idFactory();
      }
    }
  }

  return {
    destPatientId,
    plannedIds,
    plannedAssignmentRequestIds,
    patientInsert: buildPatientInsertRow(
      sourcePatient,
      destPatientId,
      manifest.runId,
      destProviderId,
    ),
    resumed: false,
  };
}

export function rowsMatchForRecovery(expectedRow, actualRow, table) {
  const ignore = new Set(["id", "patient_id", "provider_id", "token", "patient_token", "token_hash"]);
  if (table === "treatment_plans") ignore.add("catalog_assignment_request_id");
  if (table === "upper_limb_motor_screen_assignments") {
    ignore.add("assignment_request_id");
    ignore.add("token_expires_at");
  }
  for (const key of Object.keys(expectedRow)) {
    if (ignore.has(key)) continue;
    if (stableJson(expectedRow[key]) !== stableJson(actualRow[key])) return false;
  }
  return true;
}

export async function deleteLedgerRowsVerified(destAdmin, ledger, hooks = {}) {
  const remaining = {};
  const deleted = {};
  for (const table of ROLLBACK_DELETE_ORDER) {
    const ids = [...new Set(ledger[table] ?? [])];
    if (!ids.length) continue;
    deleted[table] = [];
    remaining[table] = [];

    try {
      if (hooks.beforeDeleteTable) await hooks.beforeDeleteTable(table, ids);
    } catch {
      remaining[table].push(...ids);
      continue;
    }

    for (const id of ids) {
      const { data, error, count } = await destAdmin
        .from(table)
        .delete({ count: "exact" })
        .eq("id", id)
        .select("id");
      if (error) {
        remaining[table].push(id);
        continue;
      }
      const removed = data?.[0]?.id === id || count === 1;
      if (!removed) {
        const { data: still } = await destAdmin.from(table).select("id").eq("id", id).maybeSingle();
        if (still) remaining[table].push(id);
        else deleted[table].push(id);
      } else {
        deleted[table].push(id);
      }
    }
  }
  const ok = Object.values(remaining).every((arr) => arr.length === 0);
  return { ok, deleted, remaining };
}

export async function verifyLedgerFullyRemoved(destAdmin, ledger) {
  const stillPresent = {};
  for (const table of ROLLBACK_DELETE_ORDER) {
    for (const id of ledger[table] ?? []) {
      const { data, error } = await destAdmin.from(table).select("id").eq("id", id).maybeSingle();
      if (error) throw new Error(`${table} verify: ${error.message}`);
      if (data) {
        stillPresent[table] = stillPresent[table] ?? [];
        stillPresent[table].push(id);
      }
    }
  }
  return { ok: Object.keys(stillPresent).length === 0, stillPresent };
}

export async function importBundleDurable(
  destAdmin,
  bundle,
  manifest,
  destProviderId,
  { persistManifest, hooks = {}, idFactory = randomUUID } = {},
) {
  if (manifest.status === "imported") {
    throw new Error(
      `Run ${manifest.runId} already imported (destPatientId=${manifest.destPatientId}).`,
    );
  }
  if (manifest.status === "rolled_back") {
    throw new Error(`Run ${manifest.runId} was rolled back. Export again before re-import.`);
  }

  manifest.destProviderId = destProviderId;
  manifest.integritySnapshot =
    manifest.integritySnapshot ?? buildIntegritySnapshot(bundle);
  manifest.dependencyChecks =
    manifest.dependencyChecks ??
    (await hooks.validateDestinationDeps?.(destAdmin, bundle, destProviderId));

  const plan = buildImportPlan(bundle, manifest, destProviderId, idFactory);
  manifest.destPatientId = plan.destPatientId;
  manifest.idMappings = plan.plannedIds;
  manifest.plannedAssignmentRequestIds = plan.plannedAssignmentRequestIds;
  manifest.insertedLedger = manifest.insertedLedger ?? {};
  manifest.status = "importing";
  manifest.importStartedAt = manifest.importStartedAt ?? new Date().toISOString();
  manifest.destinationProjectRef = STAGING_PROJECT_REF;
  await persistManifest(manifest);

  const ctx = {
    runId: manifest.runId,
    destProviderId,
    destPatientId: plan.destPatientId,
    plannedIds: plan.plannedIds,
    plannedAssignmentRequestIds: plan.plannedAssignmentRequestIds,
  };

  try {
    const patientDestId = plan.destPatientId;
    if (!(manifest.insertedLedger.patients ?? []).includes(patientDestId)) {
      const recovered = await tryRecoverOrInsert(
        destAdmin,
        "patients",
        plan.patientInsert,
        patientDestId,
        hooks,
      );
      if (!recovered.ok) throw new Error(`patients insert: ${recovered.error}`);
      manifest.insertedLedger.patients = [patientDestId];
      await persistManifest(manifest);
    }

    for (const spec of TABLE_PIPELINE) {
      const table = spec.table;
      if (table === "patients") continue;
      manifest.insertedLedger[table] = manifest.insertedLedger[table] ?? [];
      const insertedSet = new Set(manifest.insertedLedger[table]);

      for (const row of bundle.tables[table] ?? []) {
        const mapped = cloneRowForImport(table, row, ctx);
        const destId = mapped.id;
        if (insertedSet.has(destId)) continue;

        const recovered = await tryRecoverOrInsert(destAdmin, table, mapped, destId, hooks);
        if (!recovered.ok) throw new Error(`${table} insert: ${recovered.error}`);

        manifest.insertedLedger[table].push(destId);
        insertedSet.add(destId);
        await persistManifest(manifest);
      }
    }
  } catch (err) {
    manifest.lastError = String(err.message ?? err);
    manifest.status = "importing";
    await persistManifest(manifest);
    const comp = await deleteLedgerRowsVerified(destAdmin, manifest.insertedLedger, hooks);
    manifest.compensation = {
      attemptedAt: new Date().toISOString(),
      ok: comp.ok,
      remaining: comp.remaining,
    };
    if (comp.ok) {
      for (const table of Object.keys(manifest.insertedLedger)) {
        manifest.insertedLedger[table] = [];
      }
    }
    await persistManifest(manifest);
    if (!comp.ok) {
      throw new Error(
        `${err.message}; compensation incomplete: ${JSON.stringify(comp.remaining)}`,
      );
    }
    throw err;
  }

  manifest.status = "imported";
  manifest.importedAt = new Date().toISOString();
  manifest.lastError = null;
  await persistManifest(manifest);
  return manifest;
}

async function tryRecoverOrInsert(destAdmin, table, payload, destId, hooks) {
  if (hooks.beforeInsert) {
    try {
      await hooks.beforeInsert(table, payload, destId);
    } catch (e) {
      return { ok: false, error: e.message ?? String(e) };
    }
  }

  const { data: existing, error: exErr } = await destAdmin
    .from(table)
    .select("*")
    .eq("id", destId)
    .maybeSingle();
  if (exErr) return { ok: false, error: exErr.message };
  if (existing) {
    if (!rowsMatchForRecovery(payload, existing, table)) {
      return { ok: false, error: `planned id ${destId} exists with different payload` };
    }
    return { ok: true, recovered: true };
  }

  const { error } = await destAdmin.from(table).insert(payload);
  if (error) {
    const { data: raced } = await destAdmin.from(table).select("*").eq("id", destId).maybeSingle();
    if (raced && rowsMatchForRecovery(payload, raced, table)) {
      return { ok: true, recovered: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, recovered: false };
}

export async function rollbackRunVerified(destAdmin, manifest, { persistManifest, hooks = {} } = {}) {
  if (manifest.status !== "imported") {
    throw new Error(`Cannot rollback run in status=${manifest.status}`);
  }
  const destId = manifest.destPatientId;
  const ledger = manifest.insertedLedger ?? {};

  for (const table of TABLE_PIPELINE.map((t) => t.table)) {
    if (table === "patients") continue;
    const allowed = new Set(ledger[table] ?? []);
    const { data, error } = await destAdmin.from(table).select("id").eq("patient_id", destId);
    if (error) throw new Error(`${table} rollback scan: ${error.message}`);
    for (const row of data ?? []) {
      if (!allowed.has(row.id)) {
        throw new Error(
          `Rollback refused: ${table} has row ${row.id} for dest patient not in transfer ledger`,
        );
      }
    }
  }

  const comp = await deleteLedgerRowsVerified(destAdmin, ledger, hooks);
  if (!comp.ok) {
    manifest.rollbackAttempt = {
      attemptedAt: new Date().toISOString(),
      ok: false,
      remaining: comp.remaining,
    };
    await persistManifest(manifest);
    throw new Error(`Rollback delete incomplete: ${JSON.stringify(comp.remaining)}`);
  }

  const verify = await verifyLedgerFullyRemoved(destAdmin, ledger);
  if (!verify.ok) {
    manifest.rollbackAttempt = {
      attemptedAt: new Date().toISOString(),
      ok: false,
      stillPresent: verify.stillPresent,
    };
    await persistManifest(manifest);
    throw new Error(`Rollback verify failed: ${JSON.stringify(verify.stillPresent)}`);
  }

  manifest.status = "rolled_back";
  manifest.rolledBackAt = new Date().toISOString();
  manifest.rollbackAttempt = { attemptedAt: manifest.rolledBackAt, ok: true };
  await persistManifest(manifest);
  return manifest;
}
