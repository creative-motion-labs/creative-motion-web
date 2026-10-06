# RASQ production release runbook (frontend)

**Repository:** `creative-motion-labs/creative-motion-web`  
**Promotion path:** feature/fix branch → `test` → `main` (production)  
**Release PR example:** #303 (`test` → `main`)

This runbook covers the **Next.js frontend** on Vercel. Backend/API releases follow the backend repository process.

---

## 1. Branch and review workflow (ongoing)

1. Implement on a **dedicated branch** (never commit directly to `main`).
2. Open PR → **`test`**. CI + reviewer sign-off.
3. Merge to **`test`**. Validate on integration/dev (e.g. `dev.rasqhealth.com` when that project tracks `test`).
4. Open or refresh **release PR** (`test` → `main`) with updated **candidate SHA** and gate evidence.
5. **MSI / release engineer** runs gates below, applies **DB prerequisites** if auto-deploy is enabled, then merges #303.
6. Post-release smoke on **production** URLs; hotfixes use a new branch from `main` → PR → `test` → cherry-pick or forward-fix → release PR.

**Staging:** Keep staging/dev environments running during production promotes. Pausing staging is a **separate** change: document dependencies (Supabase staging project, Vercel preview/dev projects, Resend dev keys, demo smoke scripts) and ensure **dev + `/qa/*` harnesses** remain on non-production data before pausing.

**Data isolation:** Do not point local `.env`, QA harnesses, or staging at **production** Supabase. Use staging project IDs documented in team ops notes only.

---

## 2. Release candidate SHA

Record the **exact** git SHA on the release PR head after the last merge to `test`:

```powershell
git fetch upstream test main
git rev-parse upstream/test
```

Update the release PR description with that SHA. Re-run all gates if `test` moves.

---

## 3. Validation gates (repeatable)

Run from a **clean worktree** at the candidate SHA:

```powershell
git worktree add C:\wt-rasq-release-candidate upstream/test
cd C:\wt-rasq-release-candidate
git rev-parse HEAD   # record as candidate evidence
git status -sb       # must be clean
npm ci
```

| Gate | Command | Pass criteria |
|------|---------|---------------|
| Unit / contract tests | `npm test` | All tests pass |
| Laterality QA | included in `npm test` (`interactive-shoulder-laterality-equivalence.test.ts`) | 9/9 |
| PR313 QA guard unit tests | included in `npm test` (`pr313-production-guard.test.ts`) | 3/3 |
| Release-changed ESLint | `npm run release:lint-changed` | `error_count=0` |
| Production build | `npm run build` | Exit 0 |
| PR313 lifecycle E2E (optional, needs dev server) | `npm run test:e2e-pr313` | 7/7 (set `PLAYWRIGHT_BASE_URL`, `NEXT_PUBLIC_PR313_QA_NAV=1`) |
| QA blocked on prod runtime | See §4 | QA paths 404; `/demo` and `/assessment/*` reachable |

Full gate script:

```powershell
npm run release:gates
```

**Lint scope:** Generated at runtime — do not hand-edit `scripts/release/lint-changed-files.txt`.

```powershell
npm run release:lint-changed
# equivalent: node scripts/regenerate-lint-changed-files.mjs upstream/main HEAD
#             node scripts/release/lint-changed-report.mjs
```

---

## 4. PR #313 QA harness — production safety

- Routes under `/qa/pr313` are **synthetic** (fixtures, floating nav when `NEXT_PUBLIC_PR313_QA_NAV=1`).
- **Server block:** `proxy.ts` returns **404** for `/qa/pr313` and nested paths when `NODE_ENV=production` **or** `VERCEL_ENV=production` (see `app/lib/qa/pr313-production-guard.ts`).
- The guard runs **before** Supabase session refresh and auth routing.
- **Important:** `next start` and Vercel production builds set `NODE_ENV=production`, so the harness is **not** reachable on production or on local `next start` smoke tests—even if `NEXT_PUBLIC_PR313_QA_NAV=1`.
- Vercel **Preview** uses `VERCEL_ENV=preview` but still `NODE_ENV=production`; the harness remains blocked because `NODE_ENV=production` satisfies the guard.

Local production smoke:

```powershell
npm run build
$env:NODE_ENV='production'
$env:VERCEL_ENV='production'
$env:NEXT_PUBLIC_PR313_QA_NAV='1'
npx next start -p 3018
node scripts/release/verify-production-qa-block.mjs http://127.0.0.1:3018
```

---

## 5. Database prerequisites (production Supabase)

Before merging a release that serves **new app code** on `main` when **automatic production deploy** is enabled:

1. Run read-only verification in Supabase SQL Editor (production project):

   `supabase/queries/release_prod_schema_verify_readonly.sql`

2. If `rasq_demo_analytics_events` is **missing**, apply **only**:

   `supabase/migrations/027_rasq_demo_analytics_events.sql`

   Do **not** re-apply `026` if `rasq_demo_leads` already exists on production.

3. Re-run the read-only query; confirm `present = true` for analytics table.

**Production schema status** must come from live SQL results, not from repository presence of migration files.

---

## 6. Vercel deployment

| Environment | Typical project | Production URL |
|-------------|-----------------|----------------|
| Production | `creative-motion-web` | https://rasqhealth.com |
| Dev / integration | `creative-motion-web-nhnv` | https://dev.rasqhealth.com |

**Verify in Vercel UI (authoritative):** Git connection, **Production Branch** (`main` expected), automatic deployments on merge.

CLI snapshot (rollback candidate, re-verify before use):

```powershell
vercel inspect rasqhealth.com
```

Known-good production deployment (2026-10-05): `dpl_2yAVWMV5QzEQryhvPhFaz4GkFdrf`.

---

## 7. Deployment order (#303)

1. Merge fix/lint PRs into **`test`** (e.g. #313) and refresh release PR head.
2. Complete §3 gates on **`upstream/test`** SHA.
3. Confirm Vercel production branch + auto-deploy (§6).
4. If auto-deploy on `main` merge: apply and verify **027** on production DB (§5).
5. Merge release PR **`test` → `main`**.
6. Confirm Vercel production deployment for new SHA.
7. Post-release checks: `/`, `/demo`, `/login`, clinician login, patient token assessment (invalid token messaging), demo analytics insert (if 027 applied).

---

## 8. Rollback

1. **Application:** Promote previous production deployment in Vercel (use `vercel inspect rasqhealth.com` for current alias target). Prefer deployment ID recorded in release notes.
2. **Schema:** Keep **additive** migrations (e.g. 027) in place during app rollback; dropping tables is out of scope for hot rollback.
3. **Hotfix forward:** Branch from `main` → fix → PR to `test` → fast-track review → new release PR or cherry-pick to `test` then re-promote.

---

## 9. Hotfix workflow (normal)

```
main (prod incident)
  ↑ PR
fix/hotfix-*  →  test  (validate)  →  main
```

Never push directly to `main`. Preserve clinical safety wording and measured-vs-AI separation in all hotfixes.

---

## Document maintenance

Update this runbook when release gates, migration numbers, or Vercel project names change. Link the active release PR and candidate SHA in the PR description, not only in chat.
