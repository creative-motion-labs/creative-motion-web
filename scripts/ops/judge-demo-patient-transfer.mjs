/**
 * Judge demo patient transfer — export, import, verify, rollback (staging rehearsal).
 * No secrets or export bundles in Git. See docs/operations/judge-demo-ream-mohammed-transfer.md
 */
import {
  mkdirSync,
  readFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SOURCE_PATIENT_ID,
  DEST_DISPLAY_NAME,
  TABLE_PIPELINE,
  buildReportDataCoverage,
  buildIntegritySnapshot,
  buildImportPlan,
  compareIntegrity,
  compareSourceIntegrity,
  sanitizeExportRow,
  readAllRows,
  importBundleDurable,
  rollbackRunVerified,
  requireExplicitDestCredentials,
  extractSupabaseProjectRef,
} from "./judge-demo-transfer-lib.mjs";
import { writeJsonDurable, acquireRunLock } from "./judge-demo-transfer-files.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const OMIT_ON_EXPORT = {
  patient_access_tokens: true,
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
    if (["DEST_SUPABASE_URL", "DEST_SERVICE_ROLE_KEY", "TRANSFER_CONFIRM_STAGING"].includes(key)) continue;
    if (!(key in process.env)) process.env[key] = val;
  }
}

function resolveSourceCredentials() {
  const url =
    process.env.SOURCE_SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SOURCE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Missing source Supabase URL and service role key");
  return { url, key };
}

function parseArgs(argv) {
  const modes = ["--dry-run", "--export", "--import", "--verify", "--rollback", "--list-demo-clones"];
  if (argv.filter((arg) => modes.includes(arg)).length !== 1) throw new Error("Choose exactly one transfer command");
  for (let i = 0; i < argv.length; i++) {
    if (modes.includes(argv[i])) continue;
    if (argv[i] === "--run-id" && argv[i + 1]) { i++; continue; }
    throw new Error(`Unknown argument: ${argv[i]}`);
  }
  const runIdIdx = argv.indexOf("--run-id");
  if (runIdIdx >= 0 && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(argv[runIdIdx + 1] ?? "")) {
    throw new Error("--run-id must be a UUID");
  }
  return {
    dryRun: argv.includes("--dry-run"),
    exportMode: argv.includes("--export"),
    importMode: argv.includes("--import"),
    verify: argv.includes("--verify"),
    rollback: argv.includes("--rollback"),
    listDemoClones: argv.includes("--list-demo-clones"),
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
  writeJsonDurable(p, manifest);
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
    return readAllRows(() => admin.from(table).select("*").in("assignment_id", assignmentIds));
  }
  return readAllRows(() => admin.from(table).select("*").eq("patient_id", patientId));
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
  if (existsSync(manifestPath(exportDir, runId)) || existsSync(exportBundlePath(exportDir, runId))) {
    throw new Error("Run already exists; preserve its export/manifest and use the same run for recovery");
  }
  const assignmentRows = await fetchTableRows(
    admin,
    { table: "upper_limb_motor_screen_assignments", scope: "patient_id" },
    patientId,
    [],
  );
  const assignmentIds = assignmentRows.map((r) => r.id);

  const tables = {};
  for (const spec of TABLE_PIPELINE) {
    tables[spec.table] = (await fetchTableRows(admin, spec, patientId, assignmentIds))
      .map((row) => sanitizeExportRow(spec.table, row));
  }

  const bundle = {
    runId,
    sourcePatientId: patientId,
    exportedAt: new Date().toISOString(),
    tables,
  };

  const outPath = exportBundlePath(exportDir, runId);
  writeJsonDurable(outPath, bundle);

  const patient = tables.patients[0];
  if (!patient) throw new Error(`Patient not found: ${patientId}`);
  const counts = Object.fromEntries(TABLE_PIPELINE.map(({ table }) => [table, tables[table].length]));
  const manifest = {
    ledgerVersion: 2,
    runId,
    status: "exported",
    sourcePatientId: patientId,
    sourceProviderId: patient.provider_id,
    destProviderId: null,
    destPatientId: null,
    destDisplayName: DEST_DISPLAY_NAME,
    exportedAt: bundle.exportedAt,
    importStartedAt: null,
    importedAt: null,
    rolledBackAt: null,
    exportPath: outPath,
    expectedCounts: counts,
    reportDataCoverage: buildReportDataCoverage(tables),
    idMappings: {},
    insertedLedger: {},
    integritySnapshot: buildIntegritySnapshot(bundle),
    dependencyChecks: null,
    destinationProjectRef: null,
  };
  writeManifestAtomic(exportDir, manifest);
  return { outPath, manifest, patient, counts };
}

function assertStagingWriteGate() {
  if (process.env.TRANSFER_CONFIRM_STAGING !== "true") {
    throw new Error(
      "Refusing writes: set TRANSFER_CONFIRM_STAGING=true after confirming staging destination.",
    );
  }
}

async function verifyRun(destAdmin, sourceAdmin, exportDir, runId) {
  const manifest = readManifest(exportDir, runId);
  if (!manifest.destPatientId) throw new Error("Import not completed — no destPatientId on manifest");
  if (manifest.status !== "imported") {
    throw new Error(`Verify requires status=imported (got ${manifest.status})`);
  }

  const bundle = JSON.parse(readFileSync(manifest.exportPath, "utf8"));
  buildImportPlan(bundle, manifest, manifest.destProviderId); // Validate the saved plan/export binding.
  const destId = manifest.destPatientId;
  const { patient, counts } = await inventory(destAdmin, destId);
  const sourceInv = await inventory(sourceAdmin, manifest.sourcePatientId);
  if (manifest.ledgerVersion !== 2 || !manifest.plannedRows) throw new Error("Verify requires a version 2 durable plan");

  const countMismatches = [];
  for (const [table, expected] of Object.entries(manifest.expectedCounts ?? {})) {
    const actual = counts[table] ?? 0;
    if (actual !== expected) countMismatches.push({ table, expected, actual });
  }

  const destRowsByTable = {};
  const assignmentRows = await fetchTableRows(
    destAdmin,
    { table: "upper_limb_motor_screen_assignments", scope: "patient_id" },
    destId,
    [],
  );
  const assignmentIds = assignmentRows.map((r) => r.id);
  for (const spec of TABLE_PIPELINE) {
    destRowsByTable[spec.table] = await fetchTableRows(
      destAdmin,
      spec,
      destId,
      assignmentIds,
    );
  }

  const integrityMismatches = compareIntegrity(bundle, manifest, destRowsByTable);
  const sourceRowsByTable = {};
  const sourceAssignments = await fetchTableRows(sourceAdmin,
    { table: "upper_limb_motor_screen_assignments", scope: "patient_id" }, manifest.sourcePatientId, []);
  for (const spec of TABLE_PIPELINE) {
    sourceRowsByTable[spec.table] = await fetchTableRows(sourceAdmin, spec,
      manifest.sourcePatientId, sourceAssignments.map((r) => r.id));
  }
  const sourceIntegrityMismatches = compareSourceIntegrity(bundle, sourceRowsByTable);

  return {
    destPatient: patient,
    destCounts: counts,
    sourceCounts: sourceInv.counts,
    sourceUnchanged: sourceIntegrityMismatches.length === 0,
    sourceIntegrityMismatches,
    countMismatches,
    integrityMismatches,
    reportDataCoverage: buildReportDataCoverage(destRowsByTable),
    ok:
      countMismatches.length === 0 &&
      integrityMismatches.length === 0 &&
      sourceIntegrityMismatches.length === 0 &&
      patient.full_name === DEST_DISPLAY_NAME,
  };
}

async function main() {
  loadEnvLocalMissingOnly();
  const args = parseArgs(process.argv.slice(2));
  const patientId = process.env.SOURCE_PATIENT_ID?.trim() || DEFAULT_SOURCE_PATIENT_ID;
  const needsDest = args.importMode || args.verify || args.rollback || args.listDemoClones;
  // Resolve/validate explicit destination BEFORE constructing any mutation client.
  const dest = needsDest ? requireExplicitDestCredentials() : null;
  if (args.importMode || args.rollback) assertStagingWriteGate();
  const { createClient } = await import("@supabase/supabase-js");
  const destAdmin = dest ? createClient(dest.url, dest.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) : null;
  function sourceClient() {
    const src = resolveSourceCredentials();
    return createClient(src.url, src.key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  if (args.dryRun) {
    const { patient, counts } = await inventory(sourceClient(), patientId);
    console.log(JSON.stringify({ phase: "inventory", patient, counts }, null, 2));
    return;
  }
  if (args.listDemoClones) {
    const rows = await readAllRows(() => destAdmin.from("patients")
      .select("id, full_name, file_number, created_at").eq("full_name", DEST_DISPLAY_NAME));
    console.log(JSON.stringify({ phase: "demo-clones", count: rows.length, rows,
      note: "Read-only listing; names are not deletion ownership evidence" }, null, 2));
    return;
  }
  const exportDir = process.env.TRANSFER_EXPORT_DIR?.trim();
  if (!exportDir) throw new Error("Set TRANSFER_EXPORT_DIR to a private path outside the git repo");
  mkdirSync(exportDir, { recursive: true, mode: 0o700 });
  const relativePath = relative(realpathSync(REPO_ROOT), realpathSync(exportDir));
  if (!relativePath || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw new Error("TRANSFER_EXPORT_DIR must be outside the git repo (including symlinks)");
  }
  const runId = args.runId || (args.exportMode ? randomUUID() : null);
  if (!runId) throw new Error("--run-id required for --import, --verify, --rollback");
  const releaseLock = acquireRunLock(join(exportDir, `manifest-${runId}.lock`));
  try {
    if (args.exportMode) {
      const { outPath, counts } = await exportBundle(sourceClient(), patientId, exportDir, runId);
      console.log(JSON.stringify({ phase: "exported", runId, outPath, counts }, null, 2));
      return;
    }
    if (args.verify) {
      const report = await verifyRun(destAdmin, sourceClient(), exportDir, runId);
      console.log(JSON.stringify({ phase: "verify", ...report }, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    const manifest = readManifest(exportDir, runId);
    if (manifest.runId !== runId) throw new Error("Manifest run ID does not match requested run");
    const persistManifest = async (m) => writeManifestAtomic(exportDir, m);
    if (args.importMode) {
      const bundle = JSON.parse(readFileSync(manifest.exportPath, "utf8"));
      const destProviderId = process.env.DEST_PROVIDER_ID?.trim() || manifest.sourceProviderId;
      const result = await importBundleDurable(destAdmin, bundle, manifest, destProviderId, {
        destination: dest, persistManifest,
        hooks: { validateDestinationDeps: (admin, b, pid) => validateDestinationDeps(admin, b, pid) },
      });
      console.log(JSON.stringify({ phase: "imported", destPatientId: result.destPatientId,
        status: result.status, resumed: result.resumed, verified: result.importVerification.ok }, null, 2));
      return;
    }
    const result = await rollbackRunVerified(destAdmin, manifest, { destination: dest, persistManifest });
    console.log(JSON.stringify({ phase: "rolled_back", runId: result.runId, verified: result.rollbackAttempt.ok }, null, 2));
  } finally { releaseLock(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message); // Never print credentials, bundles, or raw client errors.
    process.exitCode = 1;
  });
}

export { readManifest, writeManifestAtomic, exportBundle, verifyRun, validateDestinationDeps,
  extractSupabaseProjectRef, parseArgs };
