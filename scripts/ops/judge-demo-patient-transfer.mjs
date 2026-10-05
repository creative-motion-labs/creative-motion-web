/**
 * Judge demo patient transfer — export, import, verify, rollback (staging rehearsal).
 * No secrets or export bundles in Git. See docs/operations/judge-demo-ream-mohammed-transfer.md
 */
import { createClient } from "@supabase/supabase-js";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE_PATIENT_ID = "3724b668-2975-429b-a558-fe8698df73d2";
const DEST_DISPLAY_NAME = "Demo — Ream Mohammed";

/** Insert order respects FK dependencies. ULMS results scoped via assignment ids, not patient_id alone. */
const TABLE_PIPELINE = [
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

const ROLLBACK_DELETE_ORDER = [...TABLE_PIPELINE].reverse().map((t) => t.table);

const FK_REMAP = {
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

const OMIT_ON_EXPORT = {
  patient_access_tokens: true,
};

const REGENERATE_ON_IMPORT = {
  remote_assessment_requests: {
    token: () => randomUUID().replace(/-/g, ""),
  },
  session_logs: {
    patient_token: (ctx, row) =>
      `demo-clone-${ctx.runId.slice(0, 8)}-${String(row.id).slice(0, 8)}`,
  },
  treatment_plans: {
    catalog_assignment_request_id: (ctx, row) =>
      row.catalog_assignment_request_id != null ? randomUUID() : null,
  },
};

const JSONB_ID_PATCH = {
  upper_limb_motor_screen_assignments: [
    { column: "assignment_payload", path: ["id"], idField: "id" },
  ],
  upper_limb_motor_screen_session_results: [
    { column: "result_payload", path: ["id"], idField: "id" },
    { column: "result_payload", path: ["assignmentId"], fkTable: "upper_limb_motor_screen_assignments" },
  ],
};

function loadEnvLocalMissingOnly() {
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function resolveSupabasePair(prefix) {
  if (prefix === "SOURCE") {
    return {
      url: process.env.SOURCE_SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
      key:
        process.env.SOURCE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    };
  }
  return {
    url: process.env.DEST_SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    key:
      process.env.DEST_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  };
}

function parseArgs(argv) {
  const runIdIdx = argv.indexOf("--run-id");
  return {
    dryRun: argv.includes("--dry-run"),
    exportMode: argv.includes("--export"),
    importMode: argv.includes("--import"),
    verify: argv.includes("--verify"),
    rollback: argv.includes("--rollback"),
    listDemoClones: argv.includes("--list-demo-clones"),
    purgeDemoClone: argv.includes("--purge-demo-clone"),
    destPatientId: argv.find((a, i) => argv[i - 1] === "--dest-patient-id") ?? null,
    runId: runIdIdx >= 0 ? argv[runIdIdx + 1] : null,
  };
}

function manifestPath(exportDir, runId) {
  return join(exportDir, `manifest-${runId}.json`);
}

function exportBundlePath(exportDir, runId) {
  return join(exportDir, `judge-demo-export-${runId}.json`);
}

function readManifest(exportDir, runId) {
  const p = manifestPath(exportDir, runId);
  if (!existsSync(p)) throw new Error(`Manifest not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeManifestAtomic(exportDir, manifest) {
  const p = manifestPath(exportDir, manifest.runId);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, p);
}

function mapId(mappings, table, oldId) {
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

function cloneRowForImport(table, row, ctx) {
  const out = { ...row };
  const oldPk = out.id;

  if (table !== "patients") {
    out.id = randomUUID();
    ctx.mappings[table][oldPk] = out.id;
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
    if (refTable) out[col] = mapId(ctx.mappings, refTable, val);
  }

  const regen = REGENERATE_ON_IMPORT[table];
  if (regen) {
    for (const [col, fn] of Object.entries(regen)) {
      out[col] = fn(ctx, { ...row, id: out.id ?? oldPk });
    }
  }

  if (table === "session_logs") {
    out.patient_token = REGENERATE_ON_IMPORT.session_logs.patient_token(ctx, {
      id: out.id,
    });
  }

  if (table === "upper_limb_motor_screen_assignments") {
    if ("token_hash" in out) out.token_hash = null;
    if ("token_expires_at" in out) out.token_expires_at = null;
    if (out.assignment_request_id != null) {
      out.assignment_request_id = randomUUID();
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
        const oldAssign = row.assignment_id;
        setJsonPath(copy, patch.path, mapId(ctx.mappings, patch.fkTable, oldAssign));
      }
      out[patch.column] = copy;
    }
  }

  return out;
}

async function fetchTableRows(admin, spec, patientId, assignmentIds) {
  const { table, scope } = spec;
  if (OMIT_ON_EXPORT[table]) return [];

  if (scope === "row") {
    const { data, error } = await admin.from(table).select("*").eq("id", patientId).maybeSingle();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ? [data] : [];
  }
  if (scope === "assignment_ids") {
    if (!assignmentIds.length) return [];
    const { data, error } = await admin
      .from(table)
      .select("*")
      .in("assignment_id", assignmentIds);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  }
  const { data, error } = await admin.from(table).select("*").eq("patient_id", patientId);
  if (error) throw new Error(`${table}: ${error.message}`);
  const rows = data ?? [];
  if (table === "remote_assessment_requests") {
    return rows.map(({ token: _token, ...rest }) => rest);
  }
  return rows;
}

async function inventory(admin, patientId) {
  const assignmentRows = await fetchTableRows(
    admin,
    { table: "upper_limb_motor_screen_assignments", scope: "patient_id" },
    patientId,
    [],
  );
  const assignmentIds = assignmentRows.map((r) => r.id);
  const counts = {};
  for (const spec of TABLE_PIPELINE) {
    const rows = await fetchTableRows(admin, spec, patientId, assignmentIds);
    counts[spec.table] = rows.length;
  }
  const { data: patient, error } = await admin
    .from("patients")
    .select("id, full_name, file_number, provider_id, created_at")
    .eq("id", patientId)
    .maybeSingle();
  if (error) throw error;
  if (!patient) throw new Error(`Patient not found: ${patientId}`);
  return { patient, counts };
}

async function assertRowAbsent(admin, table, id) {
  const { data, error } = await admin.from(table).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`${table} existence check: ${error.message}`);
  if (data) throw new Error(`Refusing to overwrite existing ${table}.id=${id}`);
}

async function validateDestinationDeps(admin, bundle, destProviderId) {
  const checks = { providerExists: false, catalogPrograms: {}, programSessions: {} };

  const { data: provider, error: pErr } = await admin
    .from("providers")
    .select("id")
    .eq("id", destProviderId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!provider) throw new Error(`Destination provider not found: ${destProviderId}`);
  checks.providerExists = true;

  const programIds = new Set();
  const sessionIds = new Set();
  for (const plan of bundle.tables.treatment_plans ?? []) {
    if (plan.source_treatment_program_id) programIds.add(plan.source_treatment_program_id);
  }
  for (const ps of bundle.tables.plan_sessions ?? []) {
    if (ps.source_program_session_id) sessionIds.add(ps.source_program_session_id);
  }

  for (const pid of programIds) {
    const { data, error } = await admin
      .from("treatment_programs")
      .select("id, status")
      .eq("id", pid)
      .maybeSingle();
    if (error) throw error;
    checks.catalogPrograms[pid] = data ? data.status : "missing";
    if (!data) {
      throw new Error(`Destination missing treatment_programs.id=${pid} referenced by a plan`);
    }
  }

  for (const sid of sessionIds) {
    const { data, error } = await admin
      .from("program_sessions")
      .select("id")
      .eq("id", sid)
      .maybeSingle();
    if (error) throw error;
    checks.programSessions[sid] = data ? "present" : "missing";
    if (!data) {
      throw new Error(
        `Destination missing program_sessions.id=${sid} referenced by plan_sessions`,
      );
    }
  }

  return checks;
}

async function exportBundle(admin, patientId, exportDir, runId) {
  mkdirSync(exportDir, { recursive: true });
  const assignmentRows = await fetchTableRows(
    admin,
    { table: "upper_limb_motor_screen_assignments", scope: "patient_id" },
    patientId,
    [],
  );
  const assignmentIds = assignmentRows.map((r) => r.id);

  const tables = {};
  for (const spec of TABLE_PIPELINE) {
    tables[spec.table] = await fetchTableRows(admin, spec, patientId, assignmentIds);
  }

  const bundle = {
    runId,
    sourcePatientId: patientId,
    exportedAt: new Date().toISOString(),
    tables,
  };

  const outPath = exportBundlePath(exportDir, runId);
  writeFileSync(outPath, JSON.stringify(bundle, null, 2));

  const { patient, counts } = await inventory(admin, patientId);
  const manifest = {
    runId,
    status: "exported",
    sourcePatientId: patientId,
    sourceProviderId: patient.provider_id,
    destProviderId: null,
    destPatientId: null,
    destDisplayName: DEST_DISPLAY_NAME,
    exportedAt: bundle.exportedAt,
    importedAt: null,
    rolledBackAt: null,
    exportPath: outPath,
    expectedCounts: counts,
    idMappings: {},
    insertedLedger: {},
    dependencyChecks: null,
  };
  writeManifestAtomic(exportDir, manifest);
  return { outPath, manifest, patient, counts };
}

async function deleteLedgerRows(destAdmin, ledger) {
  for (const table of ROLLBACK_DELETE_ORDER) {
    const ids = ledger[table];
    if (!ids?.length) continue;
    await destAdmin.from(table).delete().in("id", ids);
  }
}

async function importBundle(destAdmin, exportDir, runId, destProviderId) {
  const manifest = readManifest(exportDir, runId);
  if (manifest.status === "imported") {
    throw new Error(
      `Run ${runId} already imported (destPatientId=${manifest.destPatientId}). Export a new run for another clone.`,
    );
  }
  if (manifest.status === "rolled_back") {
    throw new Error(`Run ${runId} was rolled back. Export again before re-import.`);
  }

  const bundle = JSON.parse(readFileSync(manifest.exportPath, "utf8"));
  const sourcePatientId = manifest.sourcePatientId;

  const destPatientId = randomUUID();
  manifest.destProviderId = destProviderId;
  manifest.destPatientId = destPatientId;
  manifest.dependencyChecks = await validateDestinationDeps(destAdmin, bundle, destProviderId);

  const ctx = {
    runId,
    destProviderId,
    destPatientId,
    mappings: { patients: { [sourcePatientId]: destPatientId } },
  };
  for (const spec of TABLE_PIPELINE) {
    if (spec.table !== "patients") ctx.mappings[spec.table] = {};
  }

  manifest.idMappings = {};
  manifest.insertedLedger = {};

  const sourcePatient = bundle.tables.patients[0];
  if (!sourcePatient) throw new Error("Export missing source patient row");

  await assertRowAbsent(destAdmin, "patients", destPatientId);

  const shortRun = runId.slice(0, 8);
  const patientInsert = {
    ...sourcePatient,
    id: destPatientId,
    full_name: DEST_DISPLAY_NAME,
    file_number: sourcePatient.file_number
      ? `${sourcePatient.file_number}-demo-${shortRun}`
      : `demo-${shortRun}`,
    provider_id: destProviderId,
  };

  try {
    const { error: pInsErr } = await destAdmin.from("patients").insert(patientInsert);
    if (pInsErr) throw new Error(`patients insert: ${pInsErr.message}`);
    manifest.insertedLedger.patients = [destPatientId];
    manifest.idMappings.patients = { [sourcePatientId]: destPatientId };

    for (const spec of TABLE_PIPELINE) {
      const table = spec.table;
      if (table === "patients") continue;
      const rows = bundle.tables[table] ?? [];
      const inserted = [];
      const tableMap = {};

      for (const row of rows) {
        const mapped = cloneRowForImport(table, row, ctx);
        await assertRowAbsent(destAdmin, table, mapped.id);
        const { error } = await destAdmin.from(table).insert(mapped);
        if (error) throw new Error(`${table} insert: ${error.message}`);
        inserted.push(mapped.id);
        tableMap[row.id] = mapped.id;
      }
      manifest.insertedLedger[table] = inserted;
      manifest.idMappings[table] = tableMap;
    }
  } catch (err) {
    await deleteLedgerRows(destAdmin, manifest.insertedLedger);
    throw err;
  }

  manifest.status = "imported";
  manifest.importedAt = new Date().toISOString();
  writeManifestAtomic(exportDir, manifest);

  return manifest;
}

async function verifyRun(destAdmin, sourceAdmin, exportDir, runId) {
  const manifest = readManifest(exportDir, runId);
  if (!manifest.destPatientId) throw new Error("Import not completed — no destPatientId on manifest");

  const destId = manifest.destPatientId;
  const { patient, counts } = await inventory(destAdmin, destId);
  const sourceInv = await inventory(sourceAdmin, manifest.sourcePatientId);

  const mismatches = [];
  for (const [table, expected] of Object.entries(manifest.expectedCounts ?? {})) {
    const actual = counts[table] ?? 0;
    if (actual !== expected) mismatches.push({ table, expected, actual });
  }

  return {
    destPatient: patient,
    destCounts: counts,
    sourceCountsUnchanged: sourceInv.counts,
    sourcePatientUnchanged: sourceInv.patient.full_name,
    mismatches,
    ok: mismatches.length === 0 && patient.full_name === DEST_DISPLAY_NAME,
  };
}

async function purgeDemoClonePatient(destAdmin, patientId) {
  const { data: patient, error } = await destAdmin
    .from("patients")
    .select("id, full_name, file_number")
    .eq("id", patientId)
    .maybeSingle();
  if (error) throw error;
  if (!patient) throw new Error(`Patient not found: ${patientId}`);
  if (patient.full_name !== DEST_DISPLAY_NAME) {
    throw new Error(`Refusing purge: full_name is not "${DEST_DISPLAY_NAME}"`);
  }
  if (!patient.file_number?.includes("-demo-")) {
    throw new Error("Refusing purge: file_number does not look like a demo clone");
  }
  if (patientId === DEFAULT_SOURCE_PATIENT_ID) {
    throw new Error("Refusing purge: source judge patient id");
  }

  const assignmentRows = await fetchTableRows(
    destAdmin,
    { table: "upper_limb_motor_screen_assignments", scope: "patient_id" },
    patientId,
    [],
  );
  const assignmentIds = assignmentRows.map((r) => r.id);
  const ulmsResults = await fetchTableRows(
    destAdmin,
    { table: "upper_limb_motor_screen_session_results", scope: "assignment_ids" },
    patientId,
    assignmentIds,
  );

  const ledger = {};
  for (const spec of TABLE_PIPELINE) {
    if (spec.table === "patients") continue;
    const rows =
      spec.table === "upper_limb_motor_screen_session_results"
        ? ulmsResults
        : await fetchTableRows(destAdmin, spec, patientId, assignmentIds);
    ledger[spec.table] = rows.map((r) => r.id);
  }
  ledger.patients = [patientId];
  await deleteLedgerRows(destAdmin, ledger);
  return { patientId, deleted: ledger };
}

async function rollbackRun(destAdmin, exportDir, runId) {
  const manifest = readManifest(exportDir, runId);
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
          `Rollback refused: ${table} has row ${row.id} for dest patient not in transfer ledger (unrelated data?)`,
        );
      }
    }
  }

  for (const table of ROLLBACK_DELETE_ORDER) {
    const ids = ledger[table];
    if (!ids?.length) continue;
    const { error } = await destAdmin.from(table).delete().in("id", ids);
    if (error) throw new Error(`${table} rollback delete: ${error.message}`);
  }

  manifest.status = "rolled_back";
  manifest.rolledBackAt = new Date().toISOString();
  writeManifestAtomic(exportDir, manifest);
  return manifest;
}

function assertStagingWritesAllowed() {
  if (process.env.TRANSFER_CONFIRM_STAGING !== "true") {
    throw new Error(
      "Refusing writes: set TRANSFER_CONFIRM_STAGING=true and target staging (not Production).",
    );
  }
  const url =
    process.env.DEST_SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  if (/prod|production|r asqhealth\.com/i.test(url) && !url.includes("dev.")) {
    throw new Error("Refusing writes: destination URL looks like Production.");
  }
}

async function main() {
  loadEnvLocalMissingOnly();
  const args = parseArgs(process.argv.slice(2));
  const patientId = process.env.SOURCE_PATIENT_ID?.trim() || DEFAULT_SOURCE_PATIENT_ID;
  const exportDir = process.env.TRANSFER_EXPORT_DIR?.trim();
  if (!exportDir && !args.dryRun && !args.listDemoClones && !args.purgeDemoClone) {
    throw new Error("Set TRANSFER_EXPORT_DIR to a path outside the git repo");
  }

  const src = resolveSupabasePair("SOURCE");
  if (!src.url || !src.key) {
    throw new Error("Missing SOURCE/NEXT_PUBLIC Supabase URL and service role key");
  }
  const sourceAdmin = createClient(src.url, src.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (args.listDemoClones) {
    const dest = resolveSupabasePair("DEST");
    const admin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin
      .from("patients")
      .select("id, full_name, file_number, created_at")
      .eq("full_name", DEST_DISPLAY_NAME);
    if (error) throw error;
    console.log(JSON.stringify({ phase: "demo-clones", count: data?.length ?? 0, rows: data }, null, 2));
    return;
  }

  if (args.dryRun) {
    const { patient, counts } = await inventory(sourceAdmin, patientId);
    console.log(JSON.stringify({ phase: "inventory", patient, counts }, null, 2));
    return;
  }

  if (args.exportMode) {
    const runId = args.runId || randomUUID();
    const { outPath, patient, counts } = await exportBundle(sourceAdmin, patientId, exportDir, runId);
    console.log(JSON.stringify({ phase: "exported", runId, outPath, patient, counts }, null, 2));
    return;
  }

  if (
    !args.importMode &&
    !args.verify &&
    !args.rollback &&
    !args.listDemoClones &&
    !args.purgeDemoClone
  ) {
    console.error(
      "Usage: --dry-run | --export [--run-id UUID] | --import|--verify|--rollback --run-id UUID | --list-demo-clones | --purge-demo-clone --dest-patient-id UUID",
    );
    process.exit(1);
  }

  if (args.purgeDemoClone) {
    assertStagingWritesAllowed();
    const destPatientId = args.destPatientId;
    if (!destPatientId) throw new Error("--dest-patient-id required with --purge-demo-clone");
    const dest = resolveSupabasePair("DEST");
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const result = await purgeDemoClonePatient(destAdmin, destPatientId);
    console.log(JSON.stringify({ phase: "purged-demo-clone", ...result }, null, 2));
    return;
  }

  if (!args.runId) throw new Error("--run-id required for --import, --verify, --rollback");

  if (args.importMode) {
    assertStagingWritesAllowed();
    const dest = resolveSupabasePair("DEST");
    if (!dest.url || !dest.key) throw new Error("Missing DEST Supabase credentials");
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const destProviderId =
      process.env.DEST_PROVIDER_ID?.trim() ||
      readManifest(exportDir, args.runId).sourceProviderId;
    const manifest = await importBundle(destAdmin, exportDir, args.runId, destProviderId);
    console.log(JSON.stringify({ phase: "imported", destPatientId: manifest.destPatientId }, null, 2));
    return;
  }

  if (args.verify) {
    const dest = resolveSupabasePair("DEST");
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const report = await verifyRun(destAdmin, sourceAdmin, exportDir, args.runId);
    console.log(JSON.stringify({ phase: "verify", ...report }, null, 2));
    if (!report.ok) process.exit(1);
    return;
  }

  if (args.rollback) {
    assertStagingWritesAllowed();
    const dest = resolveSupabasePair("DEST");
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const manifest = await rollbackRun(destAdmin, exportDir, args.runId);
    console.log(JSON.stringify({ phase: "rolled_back", runId: manifest.runId }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
