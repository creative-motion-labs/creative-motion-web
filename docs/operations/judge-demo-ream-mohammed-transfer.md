# Judge demo — Ream Mohammed patient transfer (tooling)

**Status:** Staging-rehearsed tooling with durable ledger and verified rollback. **No Production writes** until explicitly approved.  
**No patient rows, export JSON, secrets, or tokens belong in Git.**

## Source patient (staging — `dpspapbqgkmhzgecljmx`)

| Field | Value |
|--------|--------|
| Display name (staging) | `reem mohammed` (“Ream Mohammed”) |
| Patient UUID | `3724b668-2975-429b-a558-fe8698df73d2` |
| File number | `P-0023` |
| Provider UUID | `057ed99a-9c0e-4b18-807d-7f36488c0d32` |

## Destination identity (mutations)

All **writes** (`--import`, `--rollback`) require:

| Requirement | Detail |
|-------------|--------|
| `TRANSFER_CONFIRM_STAGING=true` | Operator gate |
| **`DEST_SUPABASE_URL`** | Explicit — **no** `NEXT_PUBLIC_*` fallback |
| **`DEST_SERVICE_ROLE_KEY`** | Explicit — **no** shared env fallback |
| Project ref | Must be **`dpspapbqgkmhzgecljmx`** (staging) |
| Blocked ref | **`vdtjrdnzvhmxporihswv`** (Production) and any other ref |

Validation uses the Supabase host (`https://<ref>.supabase.co`), not URL substring heuristics.

Reads (`--dry-run`, `--export`, `--verify`) may use `SOURCE_*` or `.env.local` `NEXT_PUBLIC_SUPABASE_URL` for the source inventory.

## Durable transfer ledger

Manifest path: `TRANSFER_EXPORT_DIR/manifest-{runId}.json`

| Phase | `status` | Behavior |
|--------|-----------|----------|
| Export | `exported` | Bundle + `integritySnapshot` (measured fields/dates per source row) |
| Plan | `importing` | **All destination UUIDs** written to `idMappings` **before** any insert |
| Per row | `importing` | Each successful insert appended to `insertedLedger` and manifest flushed immediately |
| Done | `imported` | Full tree present |
| Undo | `rolled_back` | Only after delete + verify; manifest records `rollbackAttempt.ok` |

**Retry / interruption:** Re-run `--import --run-id <same>` while `status=importing`. Reuses `destPatientId` and planned ids from the manifest. Skips rows already in `insertedLedger`. If a row exists at the planned id with matching payload (ambiguous network), treats it as success.

**Failure:** On error, compensation deletes ledger rows with **verified** deletes. Manifest keeps `status=importing`, `lastError`, and `compensation` (including `remaining` if incomplete). **No new clone** until a new export run.

There is **no** `--purge-demo-clone` — cleanup is **manifest ledger only** (`--rollback` when `imported`, or retry `--import` / manual ops from `insertedLedger` + SQL fallback).

## Schema scope (FK-aware)

See prior inventory table in Git history; ULMS session results are scoped by **`assignment_id`**, not `patient_id` alone.  
Excluded: `patient_access_tokens`; remote `token` omitted on export and regenerated on import.

## Commands

```bash
node scripts/ops/judge-demo-patient-transfer.mjs --dry-run
node scripts/ops/judge-demo-patient-transfer.mjs --export [--run-id UUID]

# Set DEST_* explicitly to staging before import/rollback:
node scripts/ops/judge-demo-patient-transfer.mjs --import --run-id UUID
node scripts/ops/judge-demo-patient-transfer.mjs --verify --run-id UUID
node scripts/ops/judge-demo-patient-transfer.mjs --rollback --run-id UUID
node scripts/ops/judge-demo-patient-transfer.mjs --list-demo-clones
```

## Verification

`--verify` checks:

1. Row **counts** vs `expectedCounts`
2. **Integrity** — `created_at`, `completed_at`, `score`, `metrics`, payloads, etc. vs `integritySnapshot` through `idMappings`
3. Source patient name/counts unchanged

SQL helper: `supabase/queries/judge_demo_ream_mohammed_verify.sql` with `\set dest_patient_id '…'` and `:'dest_patient_id'::uuid`.

## Rollback

Prefer `node … --rollback --run-id UUID`:

- Refuses if any row exists for the clone patient **outside** `insertedLedger`
- Deletes ledger ids one-by-one with response checks
- **Does not** set `rolled_back` until verify confirms ids are gone

SQL fallback: `judge_demo_ream_mohammed_rollback.sql` — paste ids from `insertedLedger` only.

## Automated tests

```bash
node --test scripts/ops/judge-demo-patient-transfer.test.mjs
```

Covers: midway insert failure, resume without new clone, compensation delete failure, rollback blocked by unrelated rows, Production/unknown ref rejection, integrity drift detection.

## Production

Not exercised. Before any Production import: read-only provider/catalog checks; explicit approval; `DEST_*` must **not** point at Production.

## Safety

- Never commit export JSON, manifests, backups, or keys.
- Clinical tables only — no `rasq_demo_*`.
