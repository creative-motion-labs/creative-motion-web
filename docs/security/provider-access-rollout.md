# Provider access control rollout (migration 028)

## Purpose

Separate **Supabase authentication** from **clinician authorization** during the RASQ pilot. New public registrations create a **pending access request** and do not receive clinician workspace access until founder/admin approval.

## Production order

1. Apply `supabase/migrations/028_provider_access_control.sql` on staging, verify.
2. Set `RASQ_PLATFORM_ADMIN_USER_IDS` on Vercel (comma-separated Supabase auth user UUIDs for founders).
3. **Founder-reviewed legacy provider approval** (see below) on staging, then production.
4. Apply migration 028 on production Supabase (`vdtjrdnzvhmxporihswv`).
5. Repeat founder-reviewed legacy approvals on production if needed.
6. Deploy frontend after steps 1–5.

## Migration 028 behavior (revised)

- Adds `provider_access_requests` and `providers.approval_status` (`pending` default).
- **Does not** auto-approve existing `providers` rows. Legacy rows with `NULL` approval_status become **`pending`**.
- Existing rows are **not** trusted merely because they exist (public signup previously auto-created provider rows).

## Existing providers — founder-reviewed procedure (manual, not in migration)

After migration 028 and before clinicians use production:

1. Export current `providers` list from Supabase (id, email, name, created_at only — no PHI in tickets).
2. Founder confirms each UUID that should retain clinician access.
3. For each confirmed UUID, run **once** in Supabase SQL (replace placeholders):

```sql
-- Manual production step — run only for founder-reviewed UUIDs
update public.providers
set approval_status = 'approved',
    approved_at = now(),
    approved_by = '<founder-auth-user-uuid>'
where id = '<reviewed-provider-auth-uuid>';
```

4. Optionally mirror approved state in `provider_access_requests` via `/admin/access-requests` or admin API.

**Emergency access:** founders in `RASQ_PLATFORM_ADMIN_USER_IDS` can sign in and use `/admin/access-requests` even when their own provider row is still `pending`.

## Founder workflow (new requests)

1. Sign in with allowlisted admin UUID or approved `providers.role = admin`.
2. Open `/admin/access-requests`.
3. Approve / reject pending requests (self-approval blocked server-side).

## Rollback

Revert the app deploy first. Dropping migration 028 without a plan can strand pending requests; prefer forward-fix.

## RLS notes

- `provider_access_requests`: authenticated users may **select** their own row only; writes are service-role/admin API only.
- `providers`: trigger blocks self-updates to `role`, `approval_status`, `approved_at`, and `approved_by`.
