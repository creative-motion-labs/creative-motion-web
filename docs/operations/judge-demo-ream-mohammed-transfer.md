# Judge demo — Ream Mohammed patient transfer (tooling)

**Status:** Staging rehearsal completed (2026-10-05). **No Production writes** until explicitly approved.  
**No patient rows, export JSON, secrets, or tokens belong in Git.**

## Source patient (staging — creative-motion-staging)

| Field | Value |
|--------|--------|
| Display name (staging) | `reem mohammed` (user referred to “Ream Mohammed”) |
| Patient UUID | `3724b668-2975-429b-a558-fe8698df73d2` |
| File number | `P-0023` |
| Provider UUID | `057ed99a-9c0e-4b18-807d-7f36488c0d32` |
| Created | 2026-10-02 |

### Related record counts (staging inventory)

| Table | Count |
|--------|------:|
| `patients` | 1 |
| `assessments` | 16 |
| `treatment_plans` | 10 |
| `plan_sessions` | 10 |
| `session_logs` | 7 |
| `interactive_shoulder_movement_outcomes` | 3 |
| `upper_limb_motor_screen_assignments` | 32 |
| `upper_limb_motor_screen_session_results` | 0 |
| `remote_assessment_requests` | 1 |
| `patient_access_tokens` | 10 (**not copied**) |
| `ai_clinician_summaries` | 0 |

## Destination label

Clone display name: **`Demo — Ream Mohammed`**  
File number pattern: `{source-file}-demo-{runId8}` (unique per provider).  
**Measured fields, JSON payloads, and timestamps are preserved**; primary keys, idempotency keys, portal tokens, and remote link secrets are remapped or cleared.

## Schema scope (FK-aware)

The script walks tables in dependency order and handles FKs explicitly:

| Table | Scoped by | Notes |
|--------|-----------|--------|
| `patients` | source id | New UUID on import |
| `assessments` | `patient_id` | Remaps `provider_id` |
| `treatment_plans` | `patient_id` | Remaps `assessment_id`; new `catalog_assignment_request_id` when set |
| `plan_sessions` | `patient_id` | Remaps `plan_id` |
| `session_logs` | `patient_id` | Remaps `plan_id`, `plan_session_id`; **new** synthetic `patient_token` |
| `interactive_shoulder_movement_outcomes` | `patient_id` | Remaps `plan_id`, `plan_session_id` |
| `upper_limb_motor_screen_assignments` | `patient_id` | New row `id`; patches `assignment_payload.id`; clears `token_hash`; new `assignment_request_id` when set |
| `upper_limb_motor_screen_session_results` | **`assignment_id`** (not patient_id alone) | Loaded for exported assignment ids only |
| `remote_assessment_requests` | `patient_id` | **`token` omitted on export**; new token on import |
| `ai_clinician_summaries` | `patient_id` | Included when present |

**Excluded:** `patient_access_tokens` and all portal/remote secrets.

## Destination dependency checks (before insert)

On `--import`, the script validates (SELECT only):

1. Destination **provider** exists (`DEST_PROVIDER_ID` or source provider id).
2. Each `treatment_plans.source_treatment_program_id` → row in `treatment_programs`.
3. Each `plan_sessions.source_program_session_id` → row in `program_sessions`.

Import **refuses** if any destination row id already exists (no overwrites).

## Tooling: `scripts/ops/judge-demo-patient-transfer.mjs`

### Environment

| Variable | Purpose |
|----------|---------|
| `SOURCE_SUPABASE_URL` / `SOURCE_SERVICE_ROLE_KEY` | Source (defaults to `.env.local` `NEXT_PUBLIC_*` + service role) |
| `DEST_SUPABASE_URL` / `DEST_SERVICE_ROLE_KEY` | Destination (defaults to same as source for staging clone rehearsal) |
| `DEST_PROVIDER_ID` | Optional; defaults to source provider |
| `TRANSFER_EXPORT_DIR` | **Required** for export/import/verify/rollback — path **outside** repo |
| `TRANSFER_CONFIRM_STAGING=true` | Required for any write (`--import`, `--rollback`, `--purge-demo-clone`) |
| `SOURCE_PATIENT_ID` | Optional; defaults to Ream staging UUID above |

### Commands

```bash
# Inventory only (source)
node scripts/ops/judge-demo-patient-transfer.mjs --dry-run

# Export bundle + manifest (no DB writes on destination)
node scripts/ops/judge-demo-patient-transfer.mjs --export [--run-id UUID]

# Import clone on destination (staging rehearsal only until Production approved)
node scripts/ops/judge-demo-patient-transfer.mjs --import --run-id UUID

# Verify clone counts vs manifest; confirm source patient unchanged
node scripts/ops/judge-demo-patient-transfer.mjs --verify --run-id UUID

# Ledger-only rollback (refuses if extra rows exist on clone patient)
node scripts/ops/judge-demo-patient-transfer.mjs --rollback --run-id UUID

# List / purge failed partial clones (Demo name + `-demo-` file number only)
node scripts/ops/judge-demo-patient-transfer.mjs --list-demo-clones
node scripts/ops/judge-demo-patient-transfer.mjs --purge-demo-clone --dest-patient-id UUID
```

### Manifest (`manifest-{runId}.json` under `TRANSFER_EXPORT_DIR`)

- `status`: `exported` → `imported` → `rolled_back`
- `idMappings`: per-table `{ sourceUuid: destUuid }`
- `insertedLedger`: per-table list of **exact** destination ids created
- `expectedCounts`, `dependencyChecks`, `destPatientId`, `destProviderId`

Repeat safety:

- Re-running `--import` for the same run after success **errors** (export a new run for another clone).
- Failed imports **compensate** (delete partial ledger) before throwing.
- `--rollback` deletes **only** ledger ids and **refuses** if the clone patient has any other rows.

## Verification SQL

`supabase/queries/judge_demo_ream_mohammed_verify.sql` — set UUID with psql:

```text
\set dest_patient_id '00000000-0000-0000-0000-000000000000'
```

Uses `:'dest_patient_id'::uuid` on all predicates.

## Rollback SQL (fallback)

`supabase/queries/judge_demo_ream_mohammed_rollback.sql` — manual **ledger id arrays** only; prefer `node … --rollback`. Default file ends in `ROLLBACK;`.

## Staging rehearsal (2026-10-05)

On **creative-motion-staging** (same DB for source and destination):

| Step | Result |
|------|--------|
| `--dry-run` on source `3724b668…` | Counts match inventory table above |
| `--export` + `--import` + `--verify` | Clone counts matched; `full_name` = `Demo — Ream Mohammed`; source `reem mohammed` unchanged |
| Second `--import` same run | Refused (already imported) |
| `--rollback` | Ledger rows removed; manifest `rolled_back` |
| Second export/import/rollback cycle | Success |
| `--list-demo-clones` after cleanup | **0** clones (one partial orphan from an earlier failed attempt was removed with `--purge-demo-clone`) |

**Production:** not exercised. Use read-only dependency checks from this doc before any Production import approval.

## Production dependencies (read-only, before Production import)

1. Target provider exists.
2. Schema parity through tables in scope.
3. Catalog ids from export manifest exist in Production (`treatment_programs`, `program_sessions`).
4. Confirm source UUID is absent on Production (insert-only clone).

## Safety

- Never commit export JSON, manifests, backups, `.env`, or service role keys.
- Do not run writes with Production URLs.
- Clinical tables only — no `rasq_demo_*` analytics/leads.
