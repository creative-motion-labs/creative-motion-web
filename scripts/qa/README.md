# QA scripts

Operator utilities for **Staging / local** validation. Not imported by the application.

## Volunteer Research 8B.1 — Staging smoke

**Script:** `scripts/qa/volunteer-8b1-staging-smoke.mjs`

Exercises the three volunteer research API routes against a running local Next.js app
configured for **Staging Supabase** (via `.env.local`). Performs safe read-only DB
assertions and deletes the QA session rows it creates when cleanup succeeds.

### Prerequisites

1. Migration `021_ml_research_volunteer_sessions.sql` applied on **Staging** (not Production).
2. Local dev server running, e.g. `npm run dev` (default `http://localhost:3000`).
3. `.env.local` includes Staging Supabase URL/keys, `ML_VOLUNTEER_COLLECTION_ENABLED=true`,
   and `VOLUNTEER_CAMPAIGN_CODE_HASH` (hash only — never commit the raw campaign code).
4. Shared pilot campaign code available to the operator **in the current shell only**.

### Run

PowerShell (set campaign code in-process; do not commit or paste into tracked files):

```powershell
$env:VOLUNTEER_QA_CONFIRM_STAGING = "true"
$env:VOLUNTEER_QA_CAMPAIGN_CODE = "<pilot-campaign-code>"
npx tsx scripts/qa/volunteer-8b1-staging-smoke.mjs
```

Optional:

| Variable | Default | Purpose |
|----------|---------|---------|
| `VOLUNTEER_QA_BASE_URL` | `http://localhost:3000` | App under test |
| `VOLUNTEER_QA_SKIP_CLEANUP` | unset | Set `true` to retain QA rows for debugging |
| `VOLUNTEER_QA_RUN_REPETITIONS` | unset | Set `true` to run live repetition persistence checks (Migration 022 required — see below) |

### Safety

- **Production:** Script exits unless `VOLUNTEER_QA_CONFIRM_STAGING=true` and `VERCEL_ENV` is not `production`.
- **Secrets:** Never logs campaign code, session tokens, deletion codes, hashes, or service-role keys.
- **Campaign code:** High-entropy shared secret — provide only via `VOLUNTEER_QA_CAMPAIGN_CODE` in the operator process. Rotate if exposed.
- **Consent timestamp:** Recorded server-side at session creation; do not send `consentAcceptedAtMs` in the request body.

### Slice 8B.2 — repetition persistence (after Migration 022)

Migration `022_ml_research_volunteer_repetitions.sql` must be applied on Staging before
live repetition QA. The smoke harness does **not** POST repetitions by default — the
8B.1 checks and their pass count are unchanged when the flag below is unset (a single
`SKIP` is recorded instead).

When Migration 022 is applied and you want to extend live QA, set:

`VOLUNTEER_QA_RUN_REPETITIONS=true`

(Repetition live checks are optional and should remain off until migration review completes.)

With the flag set, after movement block 1 is created the harness submits one minimal
synthetic **valid** Shoulder Abduction Reach v1 repetition payload (two frames, in-range
landmarks/confidence, consistent tracking-quality ratios) built via the same
`buildVolunteerRepetitionFixture` helper used by the repetition unit/API tests — not
dev-data and not clinical thresholds. It exercises:

- First submission → `200` with `created: true` and a `repetitionId`.
- Identical retry (same `clientSubmissionId` + payload) → `200` with `created: false`
  and the same `repetitionId` (idempotent).
- Reused `clientSubmissionId` with a changed payload → `409` (conflict).
- The corresponding row exists in `ml_research_volunteer_repetitions` (research-only,
  no clinical FK) with a matching `payload_hash`.
- Cleanup deletes the repetition row(s) **before** the parent movement/collection rows
  (required by the `ON DELETE RESTRICT` FK) and verifies zero repetition rows remain.

As with the rest of the harness, only redacted status/shape information is logged —
never raw frames, hashes, tokens, or identity data.

| Code | Meaning |
|------|---------|
| `0` | All required checks passed (skips allowed) |
| `1` | One or more checks failed |
| `2` | Missing configuration or unsafe target environment |
