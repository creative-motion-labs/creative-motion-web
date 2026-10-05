# Judge demo — Ream Mohammed transfer runbook

This revision is **staging only**. It blocks Production and unknown destinations; approval or a command flag cannot override that guard. Local failure-injection tests are documented below. The earlier live staging rehearsal belongs to the previous revision and does not validate this revision. No live database operations, deployments, migrations, or merges were performed for this safety update.

## Source and destination

| Item | Identity |
|---|---|
| Staging project | `dpspapbqgkmhzgecljmx` |
| Blocked Production project | `vdtjrdnzvhmxporihswv` |
| Source patient | `3724b668-2975-429b-a558-fe8698df73d2` — `reem mohammed` |
| Source provider | `057ed99a-9c0e-4b18-807d-7f36488c0d32` |
| Clone label | `Demo — Ream Mohammed` |
| Clone file number | Source file number plus `-demo-` and the full run UUID |

Mutation commands require explicitly exported `DEST_SUPABASE_URL` and `DEST_SERVICE_ROLE_KEY`, plus `TRANSFER_CONFIRM_STAGING=true`. These three variables are not loaded from `.env.local`. The URL must be the exact HTTPS Supabase origin for staging, with no credentials, path, query, or fragment. The guard checks both that credential pair and the actual client's project/key before any write. There is no fallback to `NEXT_PUBLIC_*` or shared service keys for the destination.

`SOURCE_SUPABASE_URL` / `SOURCE_SERVICE_ROLE_KEY` may fall back to the existing local source configuration for reads. `DEST_PROVIDER_ID` defaults to the exported provider; changing it during an incomplete run is refused. Provider and catalog dependencies are rechecked on every import/restart, using SELECTs only.

## Private files and process ownership

Set `TRANSFER_EXPORT_DIR` to a private directory **outside Git**, including outside any symlink into the repository. Exports, manifests, regenerated destination tokens, keys, and backups must never be committed. Source `patient_access_tokens` are excluded; source remote tokens, session log tokens, ULMS token hashes and payload tokens are stripped from exported rows/snapshots.

Use the repository's supported Node version (20 or 22), on a filesystem that supports file and directory `fsync` (for example Linux/WSL). Files are created with mode `0600`; newly created export directories use `0700`. Manifest writes flush a private temporary file, rename atomically, then flush the directory. A failed flush stops mutations.

The CLI holds an exclusive per-run `.lock` before reading or replacing the manifest. If a process was killed, inspect the lock's host/PID and confirm no transfer process is running before removing **only the stale lock file**. Retry using the original run UUID and original files. Locks on another host or of uncertain ownership require operator reconciliation. Do not delete/reset the manifest or export to bypass a lock.

## Commands

```bash
node scripts/ops/judge-demo-patient-transfer.mjs --dry-run
node scripts/ops/judge-demo-patient-transfer.mjs --export
# Save the returned run UUID. Reuse it for every operation on this clone.

# Export DEST_* and TRANSFER_CONFIRM_STAGING=true explicitly to staging.
node scripts/ops/judge-demo-patient-transfer.mjs --import --run-id UUID
node scripts/ops/judge-demo-patient-transfer.mjs --verify --run-id UUID
node scripts/ops/judge-demo-patient-transfer.mjs --rollback --run-id UUID
node scripts/ops/judge-demo-patient-transfer.mjs --list-demo-clones
```

Exactly one mode is required. Unknown flags, invalid UUIDs, and `--purge-demo-clone` are rejected. `--list-demo-clones` is read-only: a name/file pattern is not ownership evidence. Exporting over an existing run is refused, including when it is incomplete.

## Durable plan and recovery

| Manifest phase | Behavior |
|---|---|
| `exported` | Version 2 export and original sanitized row snapshot; no destination writes |
| `importing` | Complete ID mappings, exact planned row payloads, destination, provider, counts, source digest, and plan digest persisted **before any insert** |
| Before each insert | Persist its exact row ID in `attemptedLedger` and `pendingInsert` |
| After each successful/recovered insert | Add its ID to `insertedLedger` and flush immediately before another insert |
| `imported` | Only after destination counts and every expected column/value/date pass verification |
| `rolling_back` | Explicit rollback intent persisted; import is blocked; retry rollback using the same run |
| `rolled_back` | Every attempted ID verified absent with no delete/read errors |

Planned payloads include regenerated remote tokens and idempotency UUIDs, so retries do not regenerate these either. Plan/export/provider changes are refused. Historical inserted IDs remain in the ledger even after deletion; they are never treated as proof a row is still present.

For `status=importing`, rerun `--import --run-id SAME_UUID`. The script reads **all planned IDs**, including ledgered IDs, before writes. A matching existing row is adopted only with a durable write intent. It checks patient/provider relationships, measured values, dates, and JSON as well as IDs. Missing rows removed by partial compensation are reinserted using the same IDs. A preexisting unowned ID, changed payload, unreadable row, or failed manifest flush stops the run.

An insert response may be lost after commit. The script reads the same planned ID to recover it. If the response remains ambiguous, or an immediate absence read follows a timeout/network/unknown error, it preserves the intent and pauses: that request may still commit later. It does not compensate based on guessed absence. Explicit database statement failures may trigger compensation.

Legacy/incomplete manifests from older revisions are **refused**, without allocating any new IDs. Preserve those files and reconcile their actual destination rows read-only with ops before continuing. Do not create another run to conceal an incomplete old run.

## Cleanup and rollback

Compensation and rollback use the same manifest-owned cleanup path. Rollback can abandon an incomplete `importing` run as well as undo an `imported` run. Once rollback begins, only rollback can resume it.

Before deletion, reconcile attempted rows and check inbound dependencies. This includes copied tables, `patient_access_tokens`, clinical review acknowledgments, CV metrics, speech transcription sessions, and legacy patient motion summaries. It checks child links through `assignment_id`, `plan_id`, session/log/assessment/request IDs as applicable, including FKs whose delete action is SET NULL. Unrelated or changed dependent rows block cleanup **before any delete**. Missing/unreadable dependency tables/columns block cleanup rather than being ignored.

Delete only exact attempted/inserted IDs owned by the saved plan, with patient/provider predicates where present. Recheck ownership/dependents before deleting a parent. Check every delete response and read the row afterward. **Stop on the first failure**; never continue to parent deletions after a child failure. Persist delete progress and retain all original ownership records.

Cleanup results distinguish:

- `remaining`: IDs read and confirmed present.
- `unverified`: IDs whose presence could not be read; never counted as absent.
- `absent`: IDs read and confirmed gone.
- `deleted`: IDs returned by successful deletes and then verified absent.
- `errors`: deletion, ownership, persistence, or verification errors.

A failed/ambiguous delete response keeps the run incomplete even if a later read finds that row absent. Retry rollback after resolving the failure, using the same manifest. No manifest is removed on failure or success. Success requires all attempted IDs verified absent and no errors; the CLI does not print a success phase otherwise.

`judge_demo_ream_mohammed_rollback.sql` is now a **read-only identification aid**. Executable manual delete arrays were removed because they bypass ownership and destination guards. Use the CLI for deletion.

## Measurement/date and source verification

`--verify` validates the immutable plan/export binding, counts for every copied table, and every exported expected column — including nested measured JSON, patient dates, completion/scheduled dates, scores, and typed projections. Only declared identity/secret remaps are changed. JSON key ordering is ignored; timestamp comparisons preserve microseconds while accepting equivalent timezone formatting. ULMS payload IDs are compared with their explicitly remapped IDs, not the original row IDs.

The source is also read and compared with its sanitized export snapshot by original row IDs: unchanged counts or name alone are insufficient. Source measurement/date drift makes `ok=false`. Reports name mismatching fields/IDs without printing measured payloads or tokens. The SQL verification helper is counts/identity only; use the CLI for the full comparison.

## Local validation for this revision

```bash
npm run test:ops-transfer
node --check scripts/ops/judge-demo-transfer-lib.mjs
node --check scripts/ops/judge-demo-transfer-files.mjs
node --check scripts/ops/judge-demo-patient-transfer.mjs
```

Failure-injection coverage includes midway table failures; interrupted ledger flush/restart; commit followed by lost response; delayed commit after a timeout/absence read; partial compensation/resume; API delete failures; deceptive delete success; failed verification reads; unrelated/changed dependents; assignment-only and plan-only child links; actual CLI Production/unknown rejection before any DB client loads; private files/exclusive locks; pagination; source measurement/date drift; and exact preservation of original source rows after clone rollback. Tests use synthetic data and a fault-injectable API double; they do not access a live DB.

No Next.js application code or database schema changed. An application build is not an ops-transfer validation substitute.

## Judge presentation: report, progress, and outcomes

The transfer now includes `cv_session_metrics`, with patient/provider/plan/session
foreign keys remapped and every persisted measurement, `recorded_at`, and
`motion_quality` JSON value preserved. Source queries fail closed if this table
cannot be read. It is deleted before its parent session/plan/patient during
manifest-owned rollback, using the existing dependency and durable-ledger guards.

Verified application data paths at the a5d8c36 baseline:
- Motion Analysis Report: `CvReviewSummary` builds the report from a CV metric and
  `MotionAnalysisReportPanel` renders it. Data comes from
  `/api/cv/session-metrics` and `cv_session_metrics`.
- Progress: patient assessments and CV metrics through
  `/api/clinician/progress-outcomes`; assessment dates/values remain unchanged.
- Interactive Shoulder Outcomes: `interactive_shoulder_movement_outcomes`
  (already in the transfer), with original session dates and outcome payloads.

Export manifests and CLI verification include `reportDataCoverage` (CV rows,
rows with motion-quality evidence, assessment rows, and outcome rows).
`browserVerified: false` is deliberate: these counts do not prove a report
rendered. A zero CV count means no stored CV report evidence was found; do not
fabricate evidence, re-run measurements, or claim report availability.
Existing UI eligibility rules may also hide a report for certain exercise/source
types or insufficient evidence. The legacy `session_motion_summaries` table is
not used by the traced UI report path; it remains an excluded dependency guard.

Older exports without a CV inventory are refused before allocating IDs/writing.
Preserve any incomplete run and reconcile it with ops; do not overwrite its
manifest or create another clone to hide it. Start a fresh export only after
confirming the earlier run never wrote or was fully rolled back.

Before accepting a staging rehearsal, open the source and cloned patient under
the appropriate clinician and compare:
1. Motion Analysis Report for each eligible recorded session: exercise, date,
   repetitions, duration, quality/evidence, and matching remapped session links.
2. Progress charts: same dates, values, baseline/latest comparisons, and points.
3. Outcomes: same recorded sessions, dates, target interactions, response times,
   effort/pain, and available movement evidence.
4. Read-only browser checks must not complete new sessions or submit assessments.
   Keep demonstration-data labeling visible when presenting to judges.
5. Record actual URLs/screenshots and any missing evidence. Re-run CLI verification,
   then ledger rollback; verify source unchanged and every clone ID absent.

This report-coverage extension passed 46 local mocked tests. It did not import
patient data, query a live database, deploy, migrate, merge, or verify a real
browser report. Windows durability limitations from a5d8c36 remain to be reviewed.

## Remaining staging/manual checks

Review actual staging schema/trigger parity before a fresh rehearsal, including inbound FKs added outside repository migrations. The dependency list reflects migrations 000–025 plus the legacy motion-summary patient link; it is not a dynamic schema discovery system. Freeze application writes to the rehearsal clone while importing/verifying/rolling back. Supabase REST operations and preflight SELECTs are not one database transaction and do not provide a cross-process database lock.

On staging only, run one new export/import/verify/rollback cycle with this revision and confirm source values/dates unchanged and every clone ID absent afterward. This has **not** been performed for this revision. Existing source data, Production, analytics, and other release PRs are outside this safety update. Production import still requires a separately reviewed operational design; this script intentionally remains unable to write to Production.
