# Judge demo — Ream Mohammed patient transfer (tooling)

**Status:** Preparation only. **Do not run against Production** until explicitly approved.  
**No patient rows, exports, secrets, or tokens belong in Git.**

## Source patient (staging — creative-motion-staging)

| Field | Value |
|--------|--------|
| Display name (staging) | `reem mohammed` (user referred to “Ream Mohammed”) |
| Patient UUID | `3724b668-2975-429b-a558-fe8698df73d2` |
| File number | `P-0023` |
| Provider UUID | `057ed99a-9c0e-4b18-807d-7f36488c0d32` |
| Created | 2026-10-02 |

### Related record counts (staging, read-only inventory)

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
| `patient_access_tokens` | 10 |
| `ai_clinician_summaries` | 0 |
| `cv_session_metrics` | 0 |
| `speech_transcription_sessions` | 0 |
| `clinical_review_acknowledgments` | 0 |

## Destination label

Imported patient display name: **`Demo — Ream Mohammed`**  
Preserve assessment/plan/session **timestamps and measured values**; remap primary keys and foreign keys only.

## Production dependencies (read-only checks before any import)

Run on **Production** Supabase with **SELECT only** (no writes):

1. **Target provider** exists for the clinician account that will own the demo patient.
2. **Schema parity** — migrations through clinical/plan tables applied (compare `supabase_migrations.schema_migrations` or known migration list with staging).
3. **Catalog references** — if any `treatment_plans.structured_data` or plan sessions reference `rehabilitation_program_catalog` IDs, confirm those catalog rows exist in Production (read-only `select id from rehabilitation_program_catalog where id in (...)` from export manifest).
4. **Source patient on Production** — verify whether UUID `3724b668-2975-429b-a558-fe8698df73d2` already exists; if absent, import is insert-only for that UUID tree.

## Transfer scope (in dependency order)

1. `patients` (new row or clone with new id — manifest records mapping)
2. `assessments`
3. `treatment_plans`
4. `plan_sessions`
5. `session_logs`
6. `interactive_shoulder_movement_outcomes`
7. `upper_limb_motor_screen_assignments` → `upper_limb_motor_screen_session_results` (if any on export)
8. `remote_assessment_requests` (optional; exclude tokens from export files)
9. **Exclude from automated export by default:** `patient_access_tokens` (rotate/regenerate in destination environment instead of copying secrets)

## Repeat-safe tooling

Use `scripts/ops/judge-demo-patient-transfer.mjs`:

- Requires env: `SOURCE_SUPABASE_URL`, `SOURCE_SERVICE_ROLE_KEY`, `DEST_SUPABASE_URL`, `DEST_SERVICE_ROLE_KEY`, `TRANSFER_EXPORT_DIR` (local path **outside** repo).
- Writes `manifest.json` under `TRANSFER_EXPORT_DIR` with old→new id map and `transfer_run_id` (UUID).
- **`--dry-run`** — counts and manifest only, no destination writes.
- **`--import`** — destination writes (staging rehearsal only until Production approved).
- **`--rollback --run-id <transfer_run_id>`** — deletes rows created in that run using manifest (destination only).

## Verification (after import)

Run `supabase/queries/judge_demo_ream_mohammed_verify.sql` with `:dest_patient_id` set to the new patient UUID from manifest.

Expected: counts match source inventory; `full_name = 'Demo — Ream Mohammed'`; assessment dates unchanged vs export snapshot.

## Rollback

Run `supabase/queries/judge_demo_ream_mohammed_rollback.sql` with `:transfer_run_id` / patient id from manifest (child tables first). Keep manifest file for audit; do not commit manifest to Git.

## Safety

- Never commit export JSON, backups, `.env`, service role keys, or portal tokens.
- Do not execute Production writes from CI.
- Clinical tables only — no changes to `rasq_demo_*` analytics/leads.
