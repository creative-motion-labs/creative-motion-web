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
import {
  DEFAULT_SOURCE_PATIENT_ID,
  DEST_DISPLAY_NAME,
  TABLE_PIPELINE,
  STAGING_PROJECT_REF,
  buildIntegritySnapshot,
  compareIntegrity,
  importBundleDurable,
  rollbackRunVerified,
  deleteLedgerRowsVerified,
  requireExplicitDestCredentials,
  extractSupabaseProjectRef,
} from "./judge-demo-transfer-lib.mjs";

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
  const runIdIdx = argv.indexOf("--run-id");
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
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, p);
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
    importStartedAt: null,
    importedAt: null,
    rolledBackAt: null,
    exportPath: outPath,
    expectedCounts: counts,
    idMappings: {},
    insertedLedger: {},
    integritySnapshot: buildIntegritySnapshot(bundle),
    dependencyChecks: null,
    destinationProjectRef: STAGING_PROJECT_REF,
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
  const destId = manifest.destPatientId;
  const { patient, counts } = await inventory(destAdmin, destId);
  const sourceInv = await inventory(sourceAdmin, manifest.sourcePatientId);

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

  return {
    destPatient: patient,
    destCounts: counts,
    sourceCountsUnchanged: sourceInv.counts,
    sourcePatientUnchanged: sourceInv.patient.full_name,
    countMismatches,
    integrityMismatches,
    ok:
      countMismatches.length === 0 &&
      integrityMismatches.length === 0 &&
      patient.full_name === DEST_DISPLAY_NAME,
  };
}

async function main() {
  loadEnvLocalMissingOnly();
  const args = parseArgs(process.argv.slice(2));
  const patientId = process.env.SOURCE_PATIENT_ID?.trim() || DEFAULT_SOURCE_PATIENT_ID;
  const exportDir = process.env.TRANSFER_EXPORT_DIR?.trim();
  if (!exportDir && !args.dryRun && !args.listDemoClones) {
    throw new Error("Set TRANSFER_EXPORT_DIR to a path outside the git repo");
  }

  const src = resolveSourceCredentials();
  const sourceAdmin = createClient(src.url, src.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (args.listDemoClones) {
    const dest = requireExplicitDestCredentials();
    const admin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin
      .from("patients")
      .select("id, full_name, file_number, created_at")
      .eq("full_name", DEST_DISPLAY_NAME);
    if (error) throw error;
    console.log(
      JSON.stringify({ phase: "demo-clones", count: data?.length ?? 0, rows: data }, null, 2),
    );
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

  if (!args.importMode && !args.verify && !args.rollback && !args.listDemoClones) {
    console.error(
      "Usage: --dry-run | --export [--run-id UUID] | --import|--verify|--rollback --run-id UUID | --list-demo-clones",
    );
    process.exit(1);
  }

  if (!args.runId) throw new Error("--run-id required for --import, --verify, --rollback");

  if (args.importMode) {
    assertStagingWriteGate();
    const dest = requireExplicitDestCredentials();
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const manifest = readManifest(exportDir, args.runId);
    const bundle = JSON.parse(readFileSync(manifest.exportPath, "utf8"));
    const destProviderId =
      process.env.DEST_PROVIDER_ID?.trim() || manifest.sourceProviderId;
    const result = await importBundleDurable(destAdmin, bundle, manifest, destProviderId, {
      persistManifest: async (m) => writeManifestAtomic(exportDir, m),
      hooks: {
        validateDestinationDeps: (admin, b, pid) => validateDestinationDeps(admin, b, pid),
      },
    });
    console.log(
      JSON.stringify({ phase: "imported", destPatientId: result.destPatientId, status: result.status }, null, 2),
    );
    return;
  }

  if (args.verify) {
    const dest = requireExplicitDestCredentials();
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const report = await verifyRun(destAdmin, sourceAdmin, exportDir, args.runId);
    console.log(JSON.stringify({ phase: "verify", ...report }, null, 2));
    if (!report.ok) process.exit(1);
    return;
  }

  if (args.rollback) {
    assertStagingWriteGate();
    const dest = requireExplicitDestCredentials();
    const destAdmin = createClient(dest.url, dest.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const manifest = readManifest(exportDir, args.runId);
    const result = await rollbackRunVerified(destAdmin, manifest, {
      persistManifest: async (m) => writeManifestAtomic(exportDir, m),
    });
    console.log(JSON.stringify({ phase: "rolled_back", runId: result.runId, verified: true }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {
  readManifest,
  writeManifestAtomic,
  exportBundle,
  verifyRun,
  validateDestinationDeps,
  extractSupabaseProjectRef,
};
