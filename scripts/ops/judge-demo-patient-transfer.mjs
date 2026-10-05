/**
 * Judge demo patient transfer — export/import/rollback helper (no secrets in repo).
 *
 * Usage (dry-run export counts only):
 *   SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
 *   TRANSFER_EXPORT_DIR=/path/outside/repo \
 *   node scripts/ops/judge-demo-patient-transfer.mjs --dry-run
 *
 * Default source patient: 3724b668-2975-429b-a558-fe8698df73d2 (staging reem mohammed)
 *
 * Import and Production execution require explicit approval — not run in CI.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_SOURCE_PATIENT_ID = "3724b668-2975-429b-a558-fe8698df73d2";
const DEST_DISPLAY_NAME = "Demo — Ream Mohammed";

const TABLES_BY_PATIENT_ID = [
  "assessments",
  "treatment_plans",
  "plan_sessions",
  "session_logs",
  "interactive_shoulder_movement_outcomes",
  "upper_limb_motor_screen_assignments",
  "upper_limb_motor_screen_session_results",
  "remote_assessment_requests",
  "ai_clinician_summaries",
  "cv_session_metrics",
  "speech_transcription_sessions",
  "clinical_review_acknowledgments",
];

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    importMode: argv.includes("--import"),
    rollback: argv.includes("--rollback"),
    runId: argv.find((a, i) => argv[i - 1] === "--run-id") ?? null,
  };
}

async function countPatientTree(admin, patientId) {
  const counts = { patients: 0 };
  const { data: patient, error: pErr } = await admin
    .from("patients")
    .select("id, full_name, file_number, provider_id, created_at")
    .eq("id", patientId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!patient) throw new Error(`Patient not found: ${patientId}`);
  counts.patients = 1;

  for (const table of TABLES_BY_PATIENT_ID) {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("patient_id", patientId);
    if (error) {
      counts[table] = `error: ${error.message}`;
    } else {
      counts[table] = count ?? 0;
    }
  }
  return { patient, counts };
}

async function exportPatientTree(admin, patientId, exportDir, runId) {
  mkdirSync(exportDir, { recursive: true });
  const bundle = { runId, sourcePatientId: patientId, exportedAt: new Date().toISOString(), tables: {} };

  const { data: patient } = await admin.from("patients").select("*").eq("id", patientId).single();
  bundle.tables.patients = [patient];

  for (const table of TABLES_BY_PATIENT_ID) {
    const { data, error } = await admin.from(table).select("*").eq("patient_id", patientId);
    if (error) throw new Error(`${table}: ${error.message}`);
    bundle.tables[table] = data ?? [];
  }

  const outPath = join(exportDir, `judge-demo-export-${runId}.json`);
  writeFileSync(outPath, JSON.stringify(bundle, null, 2));
  writeFileSync(
    join(exportDir, "manifest.json"),
    JSON.stringify(
      {
        runId,
        sourcePatientId: patientId,
        destDisplayName: DEST_DISPLAY_NAME,
        exportPath: outPath,
        tableCounts: Object.fromEntries(
          Object.entries(bundle.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
        ),
      },
      null,
      2,
    ),
  );
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const patientId = process.env.SOURCE_PATIENT_ID?.trim() || DEFAULT_SOURCE_PATIENT_ID;
  const exportDir = process.env.TRANSFER_EXPORT_DIR?.trim();

  if (args.rollback) {
    console.error("Rollback uses SQL templates + manifest; implement in ops window with service role.");
    console.error("See supabase/queries/judge_demo_ream_mohammed_rollback.sql");
    process.exit(1);
  }

  if (args.importMode) {
    console.error("Import is intentionally not automated in this PR — review manifest and run approved SQL/ops steps.");
    process.exit(1);
  }

  requireEnv("SOURCE_SUPABASE_URL");
  requireEnv("SOURCE_SERVICE_ROLE_KEY");
  if (!exportDir) throw new Error("Set TRANSFER_EXPORT_DIR to a path outside the git repo");

  const admin = createClient(process.env.SOURCE_SUPABASE_URL, process.env.SOURCE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const runId = randomUUID();
  const { patient, counts } = await countPatientTree(admin, patientId);
  console.log(JSON.stringify({ phase: "inventory", patient, counts }, null, 2));

  if (args.dryRun) {
    console.log(JSON.stringify({ phase: "dry-run-complete", runId, patientId, destDisplayName: DEST_DISPLAY_NAME }));
    return;
  }

  const outPath = await exportPatientTree(admin, patientId, exportDir, runId);
  console.log(JSON.stringify({ phase: "exported", outPath, runId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
